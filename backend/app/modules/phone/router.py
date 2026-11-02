"""The phone pages' endpoints: sign-in, "me", notice, stop, proofs, password, passkeys, punches and
the employee's own attendance (M4b spec §5.1, §5.1b, §5.2, §5.3). Identity = the `ups_phone` cookie
only; the admin cookie never works here."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.client_ip import get_client_ip
from app.core.db import get_session
from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.modules.face.engine_provider import get_face_engine
from app.modules.phone import (
    history,
    passkey_service,
    proof_service,
    punch_service,
    sign_in_service,
    views,
)
from app.modules.phone.access_service import stop_by_employee
from app.modules.phone.dependencies import (
    PhoneEmployee,
    clear_phone_cookie,
    require_phone_employee,
    set_phone_cookie,
)
from app.modules.phone.notice import accept_notice, current_notice
from app.modules.phone.schemas import (
    CardProofRequest,
    FaceProofChallengeRequest,
    FaceProofChallengeResponse,
    FaceProofRequest,
    LoginRequest,
    MeResponse,
    MyAttendanceResponse,
    NoticeAcceptRequest,
    NoticeAcceptResponse,
    NoticeResponse,
    PasskeyAdded,
    PasskeyItem,
    PasskeyLoginOptionsRequest,
    PasskeyLoginRequest,
    PasskeyOptionsResponse,
    PasskeyRegisterRequest,
    PhoneChallengeResponse,
    PhoneEarlyOutConfirmRequest,
    PhoneFacePunchRequest,
    PhoneGateCodePunchRequest,
    PhonePunchResponse,
    ProofResponse,
    ProvenEmployee,
    SetPasswordRequest,
    SignInResponse,
    StopRequest,
    TodayPunchesResponse,
)
from app.modules.phone.sign_in_service import SignedIn
from app.modules.punches.photo_check import SessionMaker, check_face_in_photo, get_task_sessions

router = APIRouter(prefix="/phone", tags=["phone"])


def _signed_in(session: Session, response: Response, result: SignedIn) -> SignInResponse:
    set_phone_cookie(response, result.sign_in.token, result.sign_in.max_age_seconds)
    return SignInResponse(
        employee=views.signed_in_employee(session, result.employee),
        notice_required=result.notice_required,
    )


# --- Sign-in and session --------------------------------------------------------------------------


@router.post("/login", response_model=SignInResponse)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> SignInResponse:
    result = sign_in_service.sign_in_with_password(
        session,
        code=body.employee_code,
        password=body.password,
        ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return _signed_in(session, response, result)


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> None:
    sign_in_service.sign_out(session, caller)
    clear_phone_cookie(response)


@router.get("/me", response_model=MeResponse)
def me(
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> MeResponse:
    return views.me(session, caller.employee)


@router.get("/notice", response_model=NoticeResponse)
def notice(
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> NoticeResponse:
    shown = current_notice(session)
    return NoticeResponse(
        version=shown.version,
        language=shown.language,
        text=shown.text,
        text_sha256=shown.text_sha256,
    )


@router.post("/notice/accept", status_code=201, response_model=NoticeAcceptResponse)
def notice_accept(
    body: NoticeAcceptRequest,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> NoticeAcceptResponse:
    accepted_at = accept_notice(session, caller, version=body.version, text_sha256=body.text_sha256)
    return NoticeAcceptResponse(accepted_at=accepted_at)


@router.post("/stop", status_code=204)
def stop(
    body: StopRequest,
    response: Response,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> None:
    stop_by_employee(session, caller.actor, caller.employee)
    clear_phone_cookie(response)


# --- Proofs and password (no sign-in needed) ------------------------------------------------------


@router.post("/proof/face/challenge", response_model=FaceProofChallengeResponse)
def face_proof_challenge(
    body: FaceProofChallengeRequest,
    request: Request,
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> FaceProofChallengeResponse:
    given = proof_service.issue_face_challenge(
        session, employee_code=body.employee_code, ip=get_client_ip(request), engine=engine
    )
    return FaceProofChallengeResponse(
        proof_id=given.proof_id,
        challenge_nonce=given.challenge_nonce,
        challenge=given.challenge,  # type: ignore[arg-type]
        expires_at=given.expires_at,
        server_time=given.server_time,
        capture=given.capture,
    )


def _proof_answer(passed: proof_service.PassedProof) -> ProofResponse:
    return ProofResponse(
        proof_token=passed.token,
        expires_at=passed.expires_at,
        employee=ProvenEmployee(
            code=passed.employee.employee_code, first_name=views.first_name(passed.employee)
        ),
    )


@router.post("/proof/face", response_model=ProofResponse)
def face_proof(
    body: FaceProofRequest,
    request: Request,
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> ProofResponse:
    passed = proof_service.prove_face(session, body, ip=get_client_ip(request), engine=engine)
    return _proof_answer(passed)


@router.post("/proof/card", response_model=ProofResponse)
def card_proof(
    body: CardProofRequest, request: Request, session: Session = Depends(get_session)
) -> ProofResponse:
    return _proof_answer(proof_service.prove_card(session, body, ip=get_client_ip(request)))


@router.post("/password", response_model=SignInResponse)
def set_password(
    body: SetPasswordRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> SignInResponse:
    result = proof_service.set_password(
        session,
        proof_token=body.proof_token,
        new_password=body.new_password,
        ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return _signed_in(session, response, result)


# --- Punches (spec §5.3) --------------------------------------------------------------------------
# The body limits (384 KB face punch, 64 KB gate-code punch, 16 KB the rest) are enforced earlier by
# BodyLimitMiddleware (app/core/body_limit.py).


@router.post("/punch/challenge", response_model=PhoneChallengeResponse)
def punch_challenge(
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> PhoneChallengeResponse:
    """The head turn for one phone face punch. The server chooses it, for this sign-in only."""
    return punch_service.issue_challenge(session, caller, engine)


@router.post("/punch/face", response_model=PhonePunchResponse)
def punch_face(
    body: PhoneFacePunchRequest,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> PhonePunchResponse:
    return punch_service.record_face_punch(session, caller, body, engine)


@router.post("/punch/gate-code", response_model=PhonePunchResponse)
def punch_gate_code(
    body: PhoneGateCodePunchRequest,
    background: BackgroundTasks,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
    task_sessions: SessionMaker = Depends(get_task_sessions),
) -> PhonePunchResponse:
    def check_photo_later(snapshot_id: uuid.UUID, jpeg: bytes) -> None:
        # F-30, after the answer is sent: never slows the phone or changes the decision.
        background.add_task(check_face_in_photo, snapshot_id, jpeg, engine, task_sessions)

    return punch_service.record_gate_code_punch(
        session, caller, body, after_photo=check_photo_later
    )


@router.post("/punch/early-out/confirm", response_model=PhonePunchResponse)
def punch_early_out_confirm(
    body: PhoneEarlyOutConfirmRequest,
    background: BackgroundTasks,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
    task_sessions: SessionMaker = Depends(get_task_sessions),
) -> PhonePunchResponse:
    """Agree at the early-OUT alert (decision 0036 lines 77 and 88): the OUT is stored now."""

    def check_photo_later(snapshot_id: uuid.UUID, jpeg: bytes) -> None:
        background.add_task(check_face_in_photo, snapshot_id, jpeg, engine, task_sessions)

    return punch_service.confirm_early_out(session, caller, body, after_photo=check_photo_later)


@router.get("/punches/today", response_model=TodayPunchesResponse)
def punches_today(
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> TodayPunchesResponse:
    return history.today_punches(session, caller.employee, utc_now())


@router.get("/attendance", response_model=MyAttendanceResponse)
def my_attendance(
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> MyAttendanceResponse:
    """F-73: the last 31 days of the signed-in employee. No id parameter, so nobody else's."""
    return history.my_attendance(session, caller.employee, utc_now())


# --- Passkeys (F-80) ------------------------------------------------------------------------------


@router.get("/passkeys", response_model=list[PasskeyItem])
def list_passkeys(
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> list[PasskeyItem]:
    return views.passkey_items(passkey_service.active_passkeys(session, caller.employee.id))


@router.post("/passkeys/register/options", response_model=PasskeyOptionsResponse)
def passkey_register_options(
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> PasskeyOptionsResponse:
    return PasskeyOptionsResponse(options=passkey_service.registration_options(session, caller))


@router.post("/passkeys/register", status_code=201, response_model=PasskeyAdded)
def passkey_register(
    body: PasskeyRegisterRequest,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> PasskeyAdded:
    passkey = passkey_service.register(session, caller, body.credential)
    return PasskeyAdded(id=passkey.id, label=passkey.label)


@router.delete("/passkeys/{passkey_id}", status_code=204)
def passkey_remove(
    passkey_id: uuid.UUID,
    caller: PhoneEmployee = Depends(require_phone_employee),
    session: Session = Depends(get_session),
) -> None:
    passkey_service.remove_own(session, caller, passkey_id)


@router.post("/passkeys/login/options", response_model=PasskeyOptionsResponse)
def passkey_login_options(
    body: PasskeyLoginOptionsRequest, request: Request, session: Session = Depends(get_session)
) -> PasskeyOptionsResponse:
    options = passkey_service.login_options(
        session, employee_code=body.employee_code, ip=get_client_ip(request)
    )
    return PasskeyOptionsResponse(options=options)


@router.post("/passkeys/login", response_model=SignInResponse)
def passkey_login(
    body: PasskeyLoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> SignInResponse:
    result = passkey_service.login(
        session,
        employee_code=body.employee_code,
        credential=body.credential,
        ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return _signed_in(session, response, result)
