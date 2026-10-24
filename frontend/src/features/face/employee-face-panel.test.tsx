// The face panel, the consent dialog and the enrolment wizard on an employee's page (spec M3
// §4.7–§4.9): what each role sees, that the camera stays off until "I agree", the decline path,
// withdraw and delete, five shots with a retake, the duplicate warning and the cancel on close.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, type RecordedCall, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, employee, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

// The camera and MediaPipe cannot run in jsdom: the camera gives a fake stream and every shot is
// the same small text; the pose guide is "not available" (the wizard's timed fallback).
const camera = vi.hoisted(() => ({
  startFaceCamera: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
  stopFaceCamera: vi.fn(),
  listCameras: vi.fn(async () => []),
  takeShot: vi.fn(async () => "SHOT"),
}));
vi.mock("./face-camera", async (original) => ({
  ...(await original<typeof import("./face-camera")>()),
  ...camera,
}));
vi.mock("@/lib/face-guide/landmarker", () => ({ loadFaceGuide: async () => null }));

const PERSON = employee({ id: "e-1", full_name: "Sunita Jadhav", employee_code: "EMP-0312" });

function face(overrides: Record<string, unknown> = {}) {
  return {
    punch_method: "face",
    face_state: "not_enrolled",
    consent: null,
    template: null,
    reenrol_suggested: false,
    reenrol_reason: null,
    history: [],
    ...overrides,
  };
}

const AGREED = {
  choice: "agreed",
  text_version: "face-consent-v1",
  language: "en",
  explained_language: null,
  given_at: "2026-10-20T04:30:00Z",
  recorded_by: { id: "u-1", name: "Tushar Gawande" },
  withdrawn_at: null,
  withdrawn_by: null,
  withdraw_kind: null,
  withdraw_reason: null,
};

const TEMPLATE = {
  enrolled_at: "2026-10-22T03:45:00Z",
  enrolled_by: { id: "u-1", name: "Tushar Gawande" },
  model_id: "buffalo_s",
  shot_count: 5,
};

function answers(options: { me?: unknown; faceBody?: unknown; extra?: Record<string, unknown> }) {
  const { me = SUPER_ADMIN, faceBody = face(), extra = {} } = options;
  return {
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /contractors": { body: [] },
    "GET /settings": { body: { settings: [] } },
    "GET /auth/me": { body: me },
    "GET /employees/e-1": { body: { employee: PERSON, plant_history: [], shift_history: [] } },
    "GET /employees/e-1/timeline": { body: [] },
    "GET /employees/e-1/qr-cards": { body: { cards: [] } },
    "GET /employees/e-1/face": { body: faceBody },
    "GET /face/consent-texts/face-consent-v1": (call: RecordedCall) => ({
      body: {
        version: "face-consent-v1",
        language: call.path.includes("language=mr") ? "mr" : "en",
        text: call.path.includes("language=mr")
          ? "**फेस हजेरी**\n\nमराठी मजकूर."
          : "**Face attendance – your consent**\n\nEnglish text.",
        text_sha256: "x".repeat(64),
      },
    }),
    ...extra,
  };
}

async function openPanel() {
  renderRoute("/admin/employees/e-1");
  return screen.findByRole("heading", { name: "Face recognition" });
}

beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(camera)) mock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("face panel", () => {
  it("shows the enrolled state with date, person, model and five shots", async () => {
    mockApi(
      answers({ faceBody: face({ face_state: "enrolled", consent: AGREED, template: TEMPLATE }) }),
    );
    await openPanel();
    expect(await screen.findByText(/model buffalo_s · 5 shots/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-enrol face" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete face data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw consent" })).toBeInTheDocument();
  });

  it("opens the consent dialog by itself when Ctrl+K sent the Super Admin here to enrol", async () => {
    mockApi(answers({}));
    renderRoute("/admin/employees/e-1?face=enrol");

    expect(await screen.findByRole("dialog", { name: "Face attendance consent" })).toBeVisible();
  });

  it("does not open the dialog for the Corporate Head, who cannot enrol", async () => {
    mockApi(answers({ me: { ...SUPER_ADMIN, role: "corporate_head" } }));
    renderRoute("/admin/employees/e-1?face=enrol");

    await screen.findByRole("heading", { name: "Face recognition" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows 'Old model' only when the server says the stored model differs", async () => {
    mockApi(
      answers({
        faceBody: face({
          face_state: "old_model",
          consent: AGREED,
          template: { ...TEMPLATE, model_id: "buffalo_l" },
        }),
      }),
    );
    await openPanel();
    expect(await screen.findByText(/older face model/)).toBeInTheDocument();
    expect(screen.getByText(/older model buffalo_l/)).toBeInTheDocument();
  });

  it("shows the re-enrol hint with its reason", async () => {
    mockApi(
      answers({
        faceBody: face({
          face_state: "enrolled",
          consent: AGREED,
          template: TEMPLATE,
          reenrol_suggested: true,
          reenrol_reason: "falling_scores",
        }),
      }),
    );
    await openPanel();
    expect(await screen.findByText(/match scores are falling/)).toBeInTheDocument();
  });

  it("is read-only for the Corporate Head", async () => {
    mockApi(
      answers({
        me: CORPORATE_HEAD,
        faceBody: face({ face_state: "enrolled", consent: AGREED, template: TEMPLATE }),
      }),
    );
    await openPanel();
    expect(await screen.findByText(/5 shots/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enrol face/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw consent" })).not.toBeInTheDocument();
  });

  it("offers a QR card after the employee switched to QR", async () => {
    mockApi(
      answers({
        faceBody: face({
          punch_method: "qr",
          face_state: "withdrawn",
          consent: { ...AGREED, withdrawn_at: "2026-10-23T05:00:00Z", withdraw_kind: "withdrawn" },
        }),
      }),
    );
    await openPanel();
    expect(await screen.findByText(/now punches with a QR card/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Issue QR card" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change to face" })).toHaveAttribute(
      "href",
      "/admin/employees/e-1/edit",
    );
  });

  it("withdraws consent with the pre-filled reason", async () => {
    const calls = mockApi(
      answers({
        faceBody: face({ face_state: "enrolled", consent: AGREED, template: TEMPLATE }),
        extra: { "POST /employees/e-1/face/consent/withdraw": { body: {} } },
      }),
    );
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw consent" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw consent" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path.endsWith("/withdraw"))?.body).toEqual({
        reason: "Employee asked to withdraw consent.",
      }),
    );
  });

  it("deleting face data needs a reason", async () => {
    const calls = mockApi(
      answers({
        faceBody: face({ face_state: "enrolled", consent: AGREED, template: TEMPLATE }),
        extra: { "POST /employees/e-1/face/template/delete": { body: { template_deleted: true } } },
      }),
    );
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Delete face data" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Delete face data" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Bad enrolment");
    await userEvent.click(submit);
    await waitFor(() =>
      expect(calls.find((call) => call.path.endsWith("/template/delete"))?.body).toEqual({
        reason: "Bad enrolment",
      }),
    );
  });
});

describe("consent dialog", () => {
  it("shows the text in the chosen language and keeps the camera off", async () => {
    mockApi(answers({}));
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Enrol face" }));
    expect(await screen.findByText("Face attendance – your consent")).toBeInTheDocument();
    expect(screen.getByText("Camera off")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "मराठी" }));
    expect(await screen.findByText("फेस हजेरी")).toBeInTheDocument();
    expect(camera.startFaceCamera).not.toHaveBeenCalled();
  });

  it("'No, I prefer a QR card' records the choice and offers a card", async () => {
    const calls = mockApi(
      answers({
        extra: {
          "POST /employees/e-1/face/consent": { status: 201, body: { punch_method: "qr" } },
        },
      }),
    );
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Enrol face" }));
    await userEvent.click(await screen.findByRole("button", { name: "No, I prefer a QR card" }));
    expect(await screen.findByText("QR card chosen")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      text_version: "face-consent-v1",
      language: "en",
      choice: "declined",
    });
    expect(camera.startFaceCamera).not.toHaveBeenCalled();
  });

  it("tells the Super Admin to fill in Settings when the privacy contact is missing", async () => {
    mockApi(
      answers({
        extra: {
          "GET /face/consent-texts/face-consent-v1": apiError(409, "PRIVACY_CONTACT_MISSING"),
        },
      }),
    );
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Enrol face" }));
    expect(
      await screen.findByText("Set the privacy contact in Settings first."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I agree" })).toBeDisabled();
  });
});

describe("enrolment wizard", () => {
  // Five shots: the server accepts each and names the next pose; one retake on the way.
  function wizardAnswers(finish: unknown) {
    let shotsTaken = 0;
    const order = ["left", "right", "up", "down", null];
    return answers({
      faceBody: face({ consent: AGREED }),
      extra: {
        "POST /employees/e-1/face/enrolment-sessions": {
          status: 201,
          body: {
            session_id: "s-1",
            expires_at: "2026-10-24T12:00:00Z",
            model_id: "buffalo_s",
            poses: ["straight", "left", "right", "up", "down"],
          },
        },
        "POST /face/enrolment-sessions/s-1/shots": () => {
          shotsTaken += 1;
          if (shotsTaken === 2) {
            return {
              body: {
                accepted: false,
                reason_code: "ENROL_BLURRY",
                shots_done: 1,
                next_pose: "left",
              },
            };
          }
          const done = shotsTaken === 1 ? 1 : shotsTaken - 1;
          return {
            body: {
              accepted: true,
              reason_code: null,
              shots_done: done,
              next_pose: order[done - 1],
            },
          };
        },
        "POST /face/enrolment-sessions/s-1/finish": finish,
        "POST /face/enrolment-sessions/s-1/cancel": { status: 204 },
      },
    });
  }

  async function takeAllShots() {
    await userEvent.click(await screen.findByRole("button", { name: "Enrol face" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(camera.startFaceCamera).toHaveBeenCalled(); // on in the wizard, after consent
    await userEvent.click(await screen.findByRole("button", { name: "Take shot" }));
    // Shot 2 is refused once: plain reason, then "Retake".
    await screen.findByText(/Turn your head slightly to your left/);
    await userEvent.click(screen.getByRole("button", { name: "Take shot" }));
    expect(await screen.findByText("The picture is blurry. Hold still.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retake" }));
    for (const pose of ["left", "right", "up", "down"]) {
      await userEvent.click(await screen.findByRole("button", { name: "Take shot" }));
      if (pose !== "down") await screen.findByText(/Shot \d of 5/);
    }
  }

  it("goes from consent straight to the camera, takes five shots and saves", async () => {
    const calls = mockApi(
      wizardAnswers({ status: 201, body: { template: TEMPLATE, replaced_previous: false } }),
    );
    await openPanel();
    await takeAllShots();
    expect(await screen.findByText("Face enrolled for Sunita Jadhav")).toBeInTheDocument();
    expect(calls.filter((call) => call.path.endsWith("/shots"))).toHaveLength(6);
    expect(calls.find((call) => call.path.endsWith("/shots"))?.body).toEqual({
      pose: "straight",
      image_jpeg: "SHOT",
    });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    // A finished session is not cancelled.
    expect(calls.some((call) => call.path.endsWith("/cancel"))).toBe(false);
    await waitFor(() => expect(camera.stopFaceCamera).toHaveBeenCalled());
  });

  it("asks for a reason before enrolling a face that looks like someone else", async () => {
    let finishCalls = 0;
    const calls = mockApi(
      wizardAnswers(() => {
        finishCalls += 1;
        return finishCalls === 1
          ? apiError(409, "FACE_DUPLICATE_FOUND", {
              matches: [
                {
                  employee_id: "e-9",
                  employee_code: "EMP-0457",
                  name: "Ramesh Patil",
                  plant_code: "TP1",
                },
              ],
            })
          : { status: 201, body: { template: TEMPLATE, replaced_previous: false } };
      }),
    );
    await openPanel();
    await takeAllShots();
    expect(
      await screen.findByText("This face looks like EMP-0457 (Ramesh Patil, TP1). Enrol anyway?"),
    ).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Enrol anyway" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason to enrol anyway/), "Twins, checked with HR");
    await userEvent.click(confirm);
    expect(await screen.findByText("Face enrolled for Sunita Jadhav")).toBeInTheDocument();
    expect(calls.filter((call) => call.path.endsWith("/finish")).at(-1)?.body).toEqual({
      duplicate_override_reason: "Twins, checked with HR",
    });
  });

  it("closing the wizard cancels the open session", async () => {
    const calls = mockApi(wizardAnswers({ status: 201, body: {} }));
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Enrol face" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("button", { name: "Take shot" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel enrolment" }));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/cancel"))).toBe(true));
  });

  it("goes back to the camera check quietly when the server closed the session", async () => {
    mockApi(
      answers({
        faceBody: face({ consent: AGREED }),
        extra: {
          "POST /employees/e-1/face/enrolment-sessions": {
            status: 201,
            body: { session_id: "s-1", expires_at: "x", model_id: "buffalo_s", poses: [] },
          },
          "POST /face/enrolment-sessions/s-1/shots": apiError(409, "ENROLMENT_SESSION_EXPIRED"),
        },
      }),
    );
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Enrol face" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await userEvent.click(await screen.findByRole("button", { name: "Take shot" }));
    expect(await screen.findByText(/earlier enrolment was closed/)).toBeInTheDocument();
    expect(screen.queryByText(/took too long/)).not.toBeInTheDocument();
  });
});
