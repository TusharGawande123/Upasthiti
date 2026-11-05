"""Encrypts and decrypts backup files in chunks with AES-256-GCM (F-93, decision 0038 item 5).

A backup can be hundreds of megabytes, so it is never held in memory: it is cut into chunks of
1 MB and every chunk is sealed on its own with a fresh random nonce. File layout:

    header:  8 bytes magic | 1 byte key id (a letter) | 4 bytes chunk size
    chunk:   4 bytes sealed length | 12 bytes nonce | sealed bytes (ciphertext + 16-byte tag)

The associated data of every chunk holds the header, the file name, the chunk number and a
"last chunk" flag. So a changed byte, a renamed file, swapped or removed chunks and a file cut
short are all refused. Pure functions: the key is an argument, nothing here reads settings.
"""

import os
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.crypto import NONCE_LENGTH_BYTES

MAGIC = b"UPSBKUP1"
CHUNK_SIZE_BYTES = 1024 * 1024
_HEADER = struct.Struct(">8s1sI")
_LENGTH = struct.Struct(">I")
_TAG_LENGTH_BYTES = 16
# A chunk is never longer than this, so a damaged length field cannot make us read gigabytes.
_MAX_SEALED_BYTES = 64 * 1024 * 1024 + _TAG_LENGTH_BYTES


class BackupFormatError(Exception):
    """The file is not one of our backups (wrong start) or it is damaged."""


class BackupDecryptionError(Exception):
    """Wrong key, or the file was changed, renamed or cut short. Never says which."""


def _chunk_associated_data(header: bytes, file_name: str, index: int, is_last: bool) -> bytes:
    return b"|".join(
        [header, file_name.encode(), index.to_bytes(8, "big"), b"L" if is_last else b"M"]
    )


def _read_chunks_with_last_flag(source: BinaryIO, chunk_size: int) -> Iterator[tuple[bytes, bool]]:
    """Yield (chunk, is_last). Reads one chunk ahead to know which one is the last."""
    current = source.read(chunk_size)
    while True:
        following = source.read(chunk_size) if len(current) == chunk_size else b""
        yield current, not following
        if not following:
            return
        current = following


def encrypt_file(source_path: Path, target_path: Path, *, key: bytes, key_id: str) -> None:
    """Write the encrypted copy of source_path to target_path (its file name is bound in)."""
    header = _HEADER.pack(MAGIC, key_id.encode("ascii"), CHUNK_SIZE_BYTES)
    cipher = AESGCM(key)
    with source_path.open("rb") as source, target_path.open("wb") as target:
        target.write(header)
        for index, (chunk, is_last) in enumerate(
            _read_chunks_with_last_flag(source, CHUNK_SIZE_BYTES)
        ):
            nonce = os.urandom(NONCE_LENGTH_BYTES)
            associated = _chunk_associated_data(header, target_path.name, index, is_last)
            sealed = cipher.encrypt(nonce, chunk, associated)
            target.write(_LENGTH.pack(len(sealed)) + nonce + sealed)


def read_key_id(encrypted_path: Path) -> str:
    """The letter of the key that made this backup (to tell the user which key to use)."""
    with encrypted_path.open("rb") as source:
        header = source.read(_HEADER.size)
    if len(header) != _HEADER.size or not header.startswith(MAGIC):
        raise BackupFormatError("this is not an Upasthiti backup file")
    return _HEADER.unpack(header)[1].decode("ascii", errors="replace")


def decrypt_file(encrypted_path: Path, target_path: Path, *, key: bytes) -> None:
    """Decrypt into target_path. On ANY problem the partly written target is removed first."""
    try:
        _decrypt_chunks(encrypted_path, target_path, key)
    except BaseException:
        target_path.unlink(missing_ok=True)
        raise


def _read_sealed_chunk(source: BinaryIO) -> tuple[bytes, bytes]:
    length_bytes = source.read(_LENGTH.size)
    if not length_bytes:
        # The last chunk (flag L) ends the file. Reaching the end without it means a cut.
        raise BackupDecryptionError("the backup is cut short")
    if len(length_bytes) != _LENGTH.size:
        raise BackupFormatError("the backup is damaged")
    (sealed_length,) = _LENGTH.unpack(length_bytes)
    if not _TAG_LENGTH_BYTES <= sealed_length <= _MAX_SEALED_BYTES:
        raise BackupFormatError("the backup is damaged")
    body = source.read(NONCE_LENGTH_BYTES + sealed_length)
    if len(body) != NONCE_LENGTH_BYTES + sealed_length:
        raise BackupFormatError("the backup is cut short")
    return body[:NONCE_LENGTH_BYTES], body[NONCE_LENGTH_BYTES:]


def _decrypt_chunks(encrypted_path: Path, target_path: Path, key: bytes) -> None:
    cipher = AESGCM(key)
    with encrypted_path.open("rb") as source, target_path.open("wb") as target:
        header = source.read(_HEADER.size)
        if len(header) != _HEADER.size or not header.startswith(MAGIC):
            raise BackupFormatError("this is not an Upasthiti backup file")
        index = 0
        while True:
            nonce, sealed = _read_sealed_chunk(source)
            # The chunk is the last one when nothing follows it.
            is_last = source.read(1) == b""
            if not is_last:
                source.seek(-1, os.SEEK_CUR)
            associated = _chunk_associated_data(header, encrypted_path.name, index, is_last)
            try:
                target.write(cipher.decrypt(nonce, sealed, associated))
            except InvalidTag:
                raise BackupDecryptionError(
                    "wrong key, or the backup was changed, renamed or cut short"
                ) from None
            if is_last:
                return
            index += 1
