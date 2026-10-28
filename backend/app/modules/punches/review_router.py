"""The Super Admin's "Needs review" endpoints (spec M4 §5.3). Every route needs REVIEW_PUNCHES:
the Corporate Head and the Plant Head get FORBIDDEN (spec M4 §7 rule 1)."""

import uuid
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, fetch_page, page_params
from app.core.time import today_ist, utc_now
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.punches import review_service
from app.modules.punches.review_schemas import (
    ReviewContext,
    ReviewCreated,
    ReviewDigest,
    ReviewListItem,
    ReviewRequest,
    ReviewSummary,
)

router = APIRouter(tags=["reviews"])
reviewer = require(Capability.REVIEW_PUNCHES)


def review_filters(
    tab: Literal["to_check", "rejected", "reviewed"] = "to_check",
    date_from: date | None = None,
    date_to: date | None = None,
    plant_id: uuid.UUID | None = None,
    kiosk_id: uuid.UUID | None = None,
    code: str | None = Query(default=None, max_length=40),
    method: Literal["qr", "face"] | None = None,
    was_offline: bool | None = None,
    employee_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=60),
    names_employee: bool | None = None,
    include_cooldown: bool = False,
) -> review_service.ReviewFilters:
    default_from, default_to = review_service.default_dates()
    date_from, date_to = date_from or default_from, date_to or default_to
    review_service.check_range(date_from, date_to)
    return review_service.ReviewFilters(
        tab=tab,
        date_from=date_from,
        date_to=date_to,
        plant_id=plant_id,
        kiosk_id=kiosk_id,
        code=code,
        method=method,
        was_offline=was_offline,
        employee_id=employee_id,
        search=q or None,
        names_employee=names_employee,
        include_cooldown=include_cooldown,
    )


@router.get("/reviews", response_model=Page[ReviewListItem])
def list_reviews(
    _: CurrentUser = Depends(reviewer),  # first, so other roles get FORBIDDEN before any check
    params: PageParams = Depends(page_params),
    filters: review_service.ReviewFilters = Depends(review_filters),
    session: Session = Depends(get_session),
) -> Page[ReviewListItem]:
    rows, total = fetch_page(session, review_service.review_list_statement(filters), params)
    return Page(
        items=review_service.review_items(session, rows),
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.get("/reviews/summary", response_model=ReviewSummary)
def reviews_summary(
    plant_id: uuid.UUID | None = None,
    _: CurrentUser = Depends(reviewer),
    session: Session = Depends(get_session),
) -> ReviewSummary:
    return review_service.review_summary(session, plant_id, utc_now())


@router.get("/reviews/digest", response_model=ReviewDigest)
def reviews_digest(
    _: CurrentUser = Depends(reviewer),
    day: date | None = Query(default=None, alias="date"),
    session: Session = Depends(get_session),
) -> ReviewDigest:
    day = day or today_ist() - timedelta(days=1)
    review_service.check_digest_day(day)
    return review_service.review_digest(session, day, utc_now())


@router.get("/punches/{punch_id}/review-context", response_model=ReviewContext)
def punch_review_context(
    punch_id: uuid.UUID,
    _: CurrentUser = Depends(reviewer),
    session: Session = Depends(get_session),
) -> ReviewContext:
    punch = review_service.get_punch_or_404(session, punch_id)
    return review_service.review_context(session, punch)


@router.post("/punches/{punch_id}/reviews", response_model=ReviewCreated, status_code=201)
def review_punch(
    punch_id: uuid.UUID,
    body: ReviewRequest,
    current_user: CurrentUser = Depends(reviewer),
    session: Session = Depends(get_session),
) -> ReviewCreated:
    review = review_service.add_review(session, punch_id, body, current_user.id, current_user.actor)
    return ReviewCreated(review=review)
