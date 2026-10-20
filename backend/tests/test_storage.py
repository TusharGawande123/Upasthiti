"""The snapshot storage: a folder on disk and Supabase Storage (spec §7 rule 14; AC-20, AC-21).

Supabase is tested against a fake HTTP server (httpx2's MockTransport), so no test ever reaches
the internet and no real key is needed."""

import json
import logging
from pathlib import Path

import httpx2
import pytest

from app.core.config import get_settings
from app.core.storage import (
    LocalStorage,
    ObjectNotFoundError,
    StorageError,
    SupabaseStorage,
    check_key,
    get_storage,
)

KEY = "snapshots/2026/10/20/5f0c9b6e-1a2b-4c3d-8e9f-001122334455.bin"
SERVICE_KEY = "service-key-that-must-never-be-logged"
BASE = "https://project.supabase.invalid"
BUCKET = "punch-snapshots"


# --- The key rules ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [KEY, "a.bin", "snapshots/a", "a-b_c.d/e"],
)
def test_normal_keys_are_allowed(key: str) -> None:
    check_key(key)


@pytest.mark.parametrize(
    "key",
    [
        "",
        "/etc/passwd",
        "../outside.bin",
        "snapshots/../../outside.bin",
        "snapshots//double.bin",
        "snapshots/",
        "snap shots/a.bin",
        "snapshots\\a.bin",
        "C:/windows/a.bin",
        "snapshots/ä.bin",
        ".hidden",
        "snapshots/.hidden",
        "a" * 5 + "\n",
    ],
)
def test_keys_that_could_leave_the_folder_or_are_odd_are_refused(key: str) -> None:
    with pytest.raises(ValueError):
        check_key(key)


# --- A folder on disk -------------------------------------------------------------------------


@pytest.fixture
def local(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "storage")


def test_a_file_can_be_saved_and_read_back(local: LocalStorage) -> None:
    local.save(KEY, b"encrypted bytes")

    assert local.read(KEY) == b"encrypted bytes"


def test_saving_again_replaces_the_file(local: LocalStorage) -> None:
    local.save(KEY, b"first")
    local.save(KEY, b"second")

    assert local.read(KEY) == b"second"


def test_the_folders_are_made_as_needed_and_the_file_stays_inside(
    local: LocalStorage, tmp_path: Path
) -> None:
    local.save(KEY, b"x")

    assert (tmp_path / "storage" / KEY).is_file()
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == [tmp_path / "storage" / KEY]


def test_no_half_written_file_is_left_behind(local: LocalStorage, tmp_path: Path) -> None:
    local.save(KEY, b"x")

    assert not list(tmp_path.rglob("*.part"))


def test_reading_a_missing_file_says_so(local: LocalStorage) -> None:
    with pytest.raises(ObjectNotFoundError):
        local.read(KEY)


def test_deleting_removes_files_and_ignores_missing_ones(local: LocalStorage) -> None:
    other = "snapshots/2026/10/20/other.bin"
    local.save(KEY, b"1")
    local.save(other, b"2")

    local.delete([KEY, "snapshots/2026/10/20/never-existed.bin"])

    with pytest.raises(ObjectNotFoundError):
        local.read(KEY)
    assert local.read(other) == b"2"


def test_the_folder_storage_refuses_an_unsafe_key(local: LocalStorage) -> None:
    with pytest.raises(ValueError):
        local.save("../outside.bin", b"x")
    with pytest.raises(ValueError):
        local.read("/etc/passwd")
    with pytest.raises(ValueError):
        local.delete(["../outside.bin"])


def test_a_folder_that_cannot_be_written_is_a_storage_error(tmp_path: Path) -> None:
    blocker = tmp_path / "storage"
    blocker.write_bytes(b"a file where the folder should be")

    with pytest.raises((StorageError, OSError)):
        LocalStorage(blocker).save(KEY, b"x")


# --- Supabase against a fake server -----------------------------------------------------------


class FakeSupabase:
    """Answers like Supabase Storage and remembers every request."""

    def __init__(self, answers: list[httpx2.Response | Exception] | None = None) -> None:
        self.requests: list[httpx2.Request] = []
        self.answers = answers or []
        self.files: dict[str, bytes] = {}

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        if self.answers:
            answer = self.answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer
        path = request.url.path
        if request.method == "POST":
            self.files[path.split(f"/{BUCKET}/", 1)[1]] = request.content
            return httpx2.Response(200, json={"Key": "ok"})
        if request.method == "GET":
            name = path.split(f"/{BUCKET}/", 1)[1]
            if name in self.files:
                return httpx2.Response(200, content=self.files[name])
            return httpx2.Response(
                400, json={"statusCode": "404", "error": "not_found", "message": "Object not found"}
            )
        if request.method == "DELETE":
            for name in json.loads(request.content)["prefixes"]:
                self.files.pop(name, None)
            return httpx2.Response(200, json=[])
        return httpx2.Response(405)


def make_storage(fake: FakeSupabase, *, url: str = BASE) -> SupabaseStorage:
    client = httpx2.Client(transport=httpx2.MockTransport(fake), timeout=5.0)
    return SupabaseStorage(url, SERVICE_KEY, BUCKET, client=client)


def test_upload_goes_to_the_private_bucket_with_the_service_key() -> None:
    fake = FakeSupabase()

    make_storage(fake).save(KEY, b"encrypted bytes")

    [request] = fake.requests
    assert request.method == "POST"
    assert str(request.url) == f"{BASE}/storage/v1/object/{BUCKET}/{KEY}"
    assert request.headers["authorization"] == f"Bearer {SERVICE_KEY}"
    assert request.headers["apikey"] == SERVICE_KEY
    assert request.headers["content-type"] == "application/octet-stream"
    assert request.headers["x-upsert"] == "true"
    assert request.content == b"encrypted bytes"


def test_download_uses_the_authenticated_address_not_a_public_one() -> None:
    fake = FakeSupabase()
    storage = make_storage(fake)
    storage.save(KEY, b"bytes")

    assert storage.read(KEY) == b"bytes"

    download = fake.requests[-1]
    assert download.method == "GET"
    assert f"/object/authenticated/{BUCKET}/" in str(download.url)
    assert "/object/public/" not in str(download.url)


def test_a_missing_object_is_reported_as_missing_in_both_of_supabases_ways() -> None:
    for missing in (
        httpx2.Response(404, json={"error": "not_found"}),
        httpx2.Response(400, json={"statusCode": "404", "error": "not_found"}),
    ):
        storage = make_storage(FakeSupabase([missing]))

        with pytest.raises(ObjectNotFoundError):
            storage.read(KEY)


def test_a_400_that_is_not_a_missing_object_is_a_plain_storage_error() -> None:
    storage = make_storage(FakeSupabase([httpx2.Response(400, json={"statusCode": "400"})]))

    with pytest.raises(StorageError) as refused:
        storage.read(KEY)

    assert not isinstance(refused.value, ObjectNotFoundError)


def test_delete_sends_the_keys_in_batches_of_100() -> None:
    fake = FakeSupabase()
    keys = [f"snapshots/2026/10/20/{number}.bin" for number in range(250)]

    make_storage(fake).delete(keys)

    batches = [json.loads(request.content)["prefixes"] for request in fake.requests]
    assert [len(batch) for batch in batches] == [100, 100, 50]
    assert sum(batches, []) == keys
    assert {request.method for request in fake.requests} == {"DELETE"}
    assert str(fake.requests[0].url) == f"{BASE}/storage/v1/object/{BUCKET}"


def test_deleting_nothing_makes_no_request() -> None:
    fake = FakeSupabase()

    make_storage(fake).delete([])

    assert fake.requests == []


def test_a_trailing_slash_on_the_project_address_makes_no_difference() -> None:
    fake = FakeSupabase()

    make_storage(fake, url=f"{BASE}/").save(KEY, b"x")

    assert str(fake.requests[0].url) == f"{BASE}/storage/v1/object/{BUCKET}/{KEY}"


def test_an_unsafe_key_is_refused_before_anything_is_sent() -> None:
    fake = FakeSupabase()
    storage = make_storage(fake)

    for action in (
        lambda: storage.save("../x.bin", b"x"),
        lambda: storage.read("/x.bin"),
        lambda: storage.delete(["a//b"]),
    ):
        with pytest.raises(ValueError):
            action()
    assert fake.requests == []


# --- Slow and failing servers (a storage outage must never stop the gate) ----------------------


def test_a_timeout_is_tried_once_more_and_then_works() -> None:
    fake = FakeSupabase([httpx2.ReadTimeout("slow"), httpx2.Response(200, json={})])

    make_storage(fake).save(KEY, b"x")

    assert len(fake.requests) == 2


def test_a_lost_connection_is_tried_once_more() -> None:
    fake = FakeSupabase([httpx2.ConnectError("down"), httpx2.Response(200, json={})])

    make_storage(fake).save(KEY, b"x")

    assert len(fake.requests) == 2


def test_a_server_error_is_tried_once_more() -> None:
    fake = FakeSupabase([httpx2.Response(503), httpx2.Response(200, json={})])

    make_storage(fake).save(KEY, b"x")

    assert len(fake.requests) == 2


def test_two_timeouts_in_a_row_give_a_storage_error() -> None:
    fake = FakeSupabase([httpx2.ReadTimeout("slow"), httpx2.ReadTimeout("slow")])

    with pytest.raises(StorageError, match="timeout"):
        make_storage(fake).save(KEY, b"x")

    assert len(fake.requests) == 2  # one try and one retry, no more


def test_two_server_errors_in_a_row_give_a_storage_error() -> None:
    fake = FakeSupabase([httpx2.Response(500), httpx2.Response(502)])

    with pytest.raises(StorageError):
        make_storage(fake).read(KEY)

    assert len(fake.requests) == 2


@pytest.mark.parametrize("status", [401, 403, 413])
def test_a_refusal_is_not_retried(status: int) -> None:
    fake = FakeSupabase([httpx2.Response(status, json={"message": "no"})])

    with pytest.raises(StorageError, match=str(status)):
        make_storage(fake).save(KEY, b"x")

    assert len(fake.requests) == 1


def test_the_default_client_waits_at_most_5_seconds() -> None:
    storage = SupabaseStorage(BASE, SERVICE_KEY, BUCKET)

    assert storage._client.timeout == httpx2.Timeout(5.0)  # noqa: SLF001 (the setting to check)


def test_failures_never_put_the_key_the_file_name_or_the_address_in_the_log_or_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake = FakeSupabase([httpx2.ReadTimeout("slow"), httpx2.Response(500)])
    caplog.set_level(logging.DEBUG)

    with pytest.raises(StorageError) as failed:
        make_storage(fake).save(KEY, b"photo bytes")

    seen = caplog.text + str(failed.value)
    for secret in (SERVICE_KEY, KEY, "5f0c9b6e", "project.supabase.invalid", "photo bytes"):
        assert secret not in seen
    assert "Storage request failed" in caplog.text


# --- Choosing the storage from the settings ---------------------------------------------------


def test_the_folder_is_used_by_default_outside_production(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    get_settings.cache_clear()
    get_storage.cache_clear()

    storage = get_storage()
    storage.save(KEY, b"x")

    assert isinstance(storage, LocalStorage)
    assert (tmp_path / "snapshots" / KEY).is_file()


def test_supabase_is_used_when_chosen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "supabase")
    monkeypatch.setenv("SUPABASE_URL", BASE)
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", SERVICE_KEY)
    monkeypatch.setenv("SNAPSHOT_BUCKET", "my-bucket")
    get_settings.cache_clear()
    get_storage.cache_clear()

    storage = get_storage()

    assert isinstance(storage, SupabaseStorage)
    assert storage._bucket == "my-bucket"  # noqa: SLF001


def test_supabase_without_its_address_or_key_is_a_clear_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "supabase")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    get_settings.cache_clear()
    get_storage.cache_clear()

    with pytest.raises(StorageError, match="SUPABASE_URL"):
        get_storage()


def test_the_storage_is_made_once_and_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    get_settings.cache_clear()
    get_storage.cache_clear()

    assert get_storage() is get_storage()
