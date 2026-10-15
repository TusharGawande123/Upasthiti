"""Contractor endpoints (spec §5.3): everyone logged in reads, the Super Admin changes."""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.contractors import service
from app.modules.contractors.models import Contractor

router = APIRouter(prefix="/contractors", tags=["contractors"])
viewer = require(Capability.VIEW_CONTRACTORS)
manager = require(Capability.MANAGE_CONTRACTORS)


class ContractorResponse(BaseModel):
    id: uuid.UUID
    name: str
    contact_name: str | None
    contact_phone: str | None
    is_active: bool
    active_workers: int


class ContractorRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=20, pattern=r"^[0-9+ -]*$")


class UpdateContractorRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=20, pattern=r"^[0-9+ -]*$")


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


def to_response(session: Session, contractor: Contractor) -> ContractorResponse:
    return ContractorResponse(
        id=contractor.id,
        name=contractor.name,
        contact_name=contractor.contact_name,
        contact_phone=contractor.contact_phone,
        is_active=contractor.is_active,
        active_workers=service.active_worker_count(session, contractor.id),
    )


@router.get("", response_model=list[ContractorResponse])
def list_contractors(
    is_active: bool | None = None,
    _: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[ContractorResponse]:
    return [
        to_response(session, contractor)
        for contractor in service.list_contractors(session, is_active=is_active)
    ]


@router.post("", response_model=ContractorResponse, status_code=201)
def create_contractor(
    body: ContractorRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> ContractorResponse:
    contractor = service.create_contractor(
        session,
        actor=current_user.actor,
        name=body.name,
        contact_name=body.contact_name,
        contact_phone=body.contact_phone,
    )
    return to_response(session, contractor)


@router.patch("/{contractor_id}", response_model=ContractorResponse)
def update_contractor(
    contractor_id: uuid.UUID,
    body: UpdateContractorRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> ContractorResponse:
    contractor = service.update_contractor(
        session,
        actor=current_user.actor,
        contractor=service.get_contractor(session, contractor_id),
        changes=body.model_dump(exclude_unset=True),
    )
    return to_response(session, contractor)


@router.post("/{contractor_id}/deactivate", response_model=ContractorResponse)
def deactivate_contractor(
    contractor_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> ContractorResponse:
    contractor = service.set_contractor_active(
        session,
        actor=current_user.actor,
        contractor=service.get_contractor(session, contractor_id),
        active=False,
        reason=body.reason,
    )
    return to_response(session, contractor)


@router.post("/{contractor_id}/reactivate", response_model=ContractorResponse)
def reactivate_contractor(
    contractor_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> ContractorResponse:
    contractor = service.set_contractor_active(
        session,
        actor=current_user.actor,
        contractor=service.get_contractor(session, contractor_id),
        active=True,
        reason=body.reason,
    )
    return to_response(session, contractor)
