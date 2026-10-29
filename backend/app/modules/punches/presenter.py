"""Turns punch rows into punch-log answers, with the viewer's rules applied (spec M2 §4.10, §5.3):
- a viewer limited to some plants (Plant Head) never sees the name or code of an employee of
  another plant; that row says "Card of another plant" (nothing of other plants leaks);
- only the Super Admin learns whether a photo is dark (F-31);
- the storage key, the IP address and the photo itself are never part of these answers;
- (M4) every role sees the review mark of a punch; only the Super Admin sees the review
  reasons and who reviewed (spec M4 §5.4, decision 0025 item 11).
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Plant
from app.modules.punches.counting import latest_reviews, review_state
from app.modules.punches.models import Punch, PunchReview, PunchSnapshot, ReviewAction
from app.modules.punches.schemas import (
    PunchDetail,
    PunchFaceDetail,
    PunchFaceEmployee,
    PunchLocation,
    PunchLogEmployee,
    PunchLogItem,
    PunchLogPlace,
    PunchLogSnapshot,
    PunchReviewer,
    PunchReviewOut,
)
from app.modules.users.models import User


@dataclass(frozen=True)
class Viewer:
    only_plant_ids: frozenset[uuid.UUID] | None  # None = every plant
    sees_dark_photos: bool  # the Super Admin
    sees_face_scores: bool = False  # the Super Admin (spec M3 §7 rule 1)
    sees_review_reasons: bool = False  # the Super Admin (spec M4 §5.4)


@dataclass(frozen=True)
class _Related:
    employees: dict[uuid.UUID, Employee]
    kiosks: dict[uuid.UUID, KioskDevice]
    plants: dict[uuid.UUID, Plant]
    snapshots: dict[uuid.UUID, PunchSnapshot]
    followers: dict[uuid.UUID, uuid.UUID]  # "asked for code" row -> the row that followed it
    reviews: dict[uuid.UUID, PunchReview]  # punch id -> its latest review


def _load_related(session: Session, punches: Sequence[Punch]) -> _Related:
    """Everything the rows refer to, in a few queries for the whole page."""

    def by_id(model: type, ids: set[uuid.UUID]) -> dict:
        if not ids:
            return {}
        return {row.id: row for row in session.scalars(select(model).where(model.id.in_(ids)))}

    snapshots = (
        {
            row.punch_id: row
            for row in session.scalars(
                select(PunchSnapshot).where(PunchSnapshot.punch_id.in_([p.id for p in punches]))
            )
        }
        if punches
        else {}
    )
    asked = [p.id for p in punches if p.decision == "needs_code"]
    followers = (
        {
            origin_id: punch_id
            for punch_id, origin_id in session.execute(
                select(Punch.id, Punch.follows_punch_id).where(Punch.follows_punch_id.in_(asked))
            )
            if origin_id is not None
        }
        if asked
        else {}
    )
    reviews = latest_reviews(
        session, [p.id for p in punches if p.decision in ("flagged", "rejected")]
    )
    # The people on the page: who punched, and whom an approved review counts a punch for.
    people = {p.employee_id for p in punches if p.employee_id}
    people |= {r.employee_id for r in reviews.values() if _counts_by_approval(r) and r.employee_id}
    return _Related(
        employees=by_id(Employee, people),
        kiosks=by_id(KioskDevice, {p.kiosk_id for p in punches}),
        plants=by_id(Plant, {p.plant_id for p in punches}),
        snapshots=snapshots,
        followers=followers,
        reviews=reviews,
    )


def _counts_by_approval(review: PunchReview) -> bool:
    return review.action == ReviewAction.APPROVED.value


def _counted_for(punch: Punch, related: _Related, viewer: Viewer) -> PunchLogEmployee | None:
    """Whom an approved review counts this rejected punch for, when the row itself names nobody
    (for example a code that was typed but a face that did not match). counting.py counts it for
    the review's employee, so the log must say so too (compliance review of M4, decision 0029).
    A viewer limited to some plants never learns the name of a person of another plant."""
    review = related.reviews.get(punch.id)
    if punch.employee_id is not None or review is None or not _counts_by_approval(review):
        return None
    person = related.employees.get(review.employee_id) if review.employee_id else None
    if person is None:
        return None
    if viewer.only_plant_ids is not None and person.plant_id not in viewer.only_plant_ids:
        return None
    return PunchLogEmployee(id=person.id, code=person.employee_code, name=person.full_name)


def _employee(
    punch: Punch, related: _Related, viewer: Viewer
) -> tuple[PunchLogEmployee | None, bool]:
    employee = related.employees.get(punch.employee_id) if punch.employee_id else None
    if employee is None:
        return None, False
    if viewer.only_plant_ids is not None and employee.plant_id not in viewer.only_plant_ids:
        return None, True
    return PunchLogEmployee(
        id=employee.id, code=employee.employee_code, name=employee.full_name
    ), False


def _snapshot(punch: Punch, related: _Related, viewer: Viewer) -> PunchLogSnapshot:
    snapshot = related.snapshots.get(punch.id)
    if snapshot is None:
        return PunchLogSnapshot(state="none")
    return PunchLogSnapshot(
        state=snapshot.state,  # type: ignore[arg-type]
        is_dark=snapshot.is_dark if viewer.sees_dark_photos else None,
        expires_at=snapshot.expires_at,
        purged_at=snapshot.purged_at,
        face_found=snapshot.face_found if viewer.sees_dark_photos else None,
    )


def offline_delay_seconds(punch: Punch) -> int | None:
    """How long an offline punch waited on the gate device before the server received it."""
    if not punch.was_offline or punch.offline_punch_time is None:
        return None
    return max(0, round((punch.server_received_at - punch.offline_punch_time).total_seconds()))


def _item(punch: Punch, related: _Related, viewer: Viewer) -> PunchLogItem:
    employee, hidden = _employee(punch, related, viewer)
    plant = related.plants[punch.plant_id]
    kiosk = related.kiosks[punch.kiosk_id]
    review = related.reviews.get(punch.id)
    approved = review is not None and review.action == ReviewAction.APPROVED.value
    return PunchLogItem(
        id=punch.id,
        server_received_at=punch.server_received_at,
        employee=employee,
        employee_hidden=hidden,
        plant=PunchLogPlace(id=plant.id, name=plant.name, code=plant.code),
        kiosk=PunchLogPlace(id=kiosk.id, name=kiosk.name),
        method=punch.method,
        direction=punch.direction,  # type: ignore[arg-type]
        decision=punch.decision,
        reason_codes=list(punch.reason_codes),
        snapshot=_snapshot(punch, related, viewer),
        match_mode=punch.match_mode,
        follows_punch_id=punch.follows_punch_id,
        followed_by_punch_id=related.followers.get(punch.id),
        punch_time=punch.punch_time,
        was_offline=punch.was_offline,
        offline_delay_seconds=offline_delay_seconds(punch),
        review_state=review_state(punch, review),  # type: ignore[arg-type]
        review_direction=review.direction if approved else None,  # type: ignore[union-attr]
        counted_for=_counted_for(punch, related, viewer),
    )


def punch_items(session: Session, punches: Sequence[Punch], viewer: Viewer) -> list[PunchLogItem]:
    related = _load_related(session, punches)
    return [_item(punch, related, viewer) for punch in punches]


def review_history(session: Session, punch_id: uuid.UUID, full: bool) -> list[PunchReviewOut]:
    """The reviews of one punch, newest first. `full` = the Super Admin's view (reasons and
    reviewers); the other roles get only the latest action and direction."""
    reviews = list(
        session.scalars(
            select(PunchReview)
            .where(PunchReview.punch_id == punch_id)
            .order_by(PunchReview.reviewed_at.desc(), PunchReview.id)
        )
    )
    if not reviews:
        return []
    if not full:
        replaced = {r.supersedes_review_id for r in reviews if r.supersedes_review_id}
        latest = next(r for r in reviews if r.id not in replaced)
        return [PunchReviewOut(action=latest.action, direction=latest.direction)]  # type: ignore[arg-type]
    shown = review_outputs(session, reviews)
    return [shown[review.id] for review in reviews]


def review_outputs(
    session: Session, reviews: Sequence[PunchReview]
) -> dict[uuid.UUID, PunchReviewOut]:
    """The Super Admin's full view of each review (with the reviewer's name), by review id."""
    if not reviews:
        return {}
    names = {
        user.id: user.name
        for user in session.scalars(
            select(User).where(User.id.in_({r.reviewed_by for r in reviews}))
        )
    }
    return {
        review.id: PunchReviewOut(
            id=review.id,
            action=review.action,  # type: ignore[arg-type]
            direction=review.direction,  # type: ignore[arg-type]
            reason=review.reason,
            reviewed_by=PunchReviewer(
                id=review.reviewed_by, name=names.get(review.reviewed_by, "")
            ),
            reviewed_at=review.reviewed_at,
            supersedes_review_id=review.supersedes_review_id,
        )
        for review in reviews
    }


def punch_detail(session: Session, punch: Punch, viewer: Viewer) -> PunchDetail:
    item = punch_items(session, [punch], viewer)[0]
    location = (
        PunchLocation(
            lat=float(punch.lat),
            lon=float(punch.lon),
            accuracy_m=float(punch.accuracy_m) if punch.accuracy_m is not None else None,
        )
        if punch.lat is not None and punch.lon is not None
        else None
    )
    return PunchDetail(
        **item.model_dump(),
        app_version=punch.app_version,
        device_time=punch.device_claimed_at,
        location=location,
        face=_face_detail(session, punch) if viewer.sees_face_scores else None,
        time_proof=punch.time_proof,  # type: ignore[arg-type]
        geofence_distance_m=_number(punch.geofence_distance_m),
        location_age_s=punch.location_age_s,
        related_punch_id=punch.related_punch_id,
        reviews=review_history(session, punch.id, viewer.sees_review_reasons),
    )


def _number(value: object) -> float | None:
    return None if value is None else float(value)  # type: ignore[arg-type]


def _face_detail(session: Session, punch: Punch) -> PunchFaceDetail | None:
    if punch.method != "face":
        return None
    claimed = (
        session.get(Employee, punch.claimed_employee_id) if punch.claimed_employee_id else None
    )
    return PunchFaceDetail(
        match_score=_number(punch.match_score),
        second_best_score=_number(punch.second_best_score),
        antispoof_score=_number(punch.antispoof_score),
        yaw_degrees=_number(punch.yaw_degrees),
        challenge=punch.challenge,
        model_id=punch.face_model_id,
        match_mode=punch.match_mode,
        claimed_employee=PunchFaceEmployee(
            id=claimed.id, code=claimed.employee_code, name=claimed.full_name
        )
        if claimed
        else None,
    )
