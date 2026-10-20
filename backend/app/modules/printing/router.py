"""Printing endpoints: ID cards (spec §5.1; one card as a CR80 PDF, or many cards on A4 sheets;
Super Admin only) and the gate poster of a plant (F-34; Super Admin, or a Plant Head for their own
plant). Every PDF is built in memory and sent straight back; it is never stored and never
reachable through a link.
"""

import uuid

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import plant_filter
from app.modules.org.plants_service import get_plant
from app.modules.printing import service
from app.modules.printing.poster_pdf import gate_poster_pdf
from app.modules.printing.service import PrintedPdf, PrintLayout
from app.modules.settings.service import get_int_setting

router = APIRouter(tags=["qr-cards"])
manager = require(Capability.MANAGE_QR_CARDS)


class PrintCardsRequest(BaseModel):
    # More than 200 is refused by the service with PRINT_TOO_LARGE; this cap only stops abuse.
    card_ids: list[uuid.UUID] = Field(min_length=1, max_length=2000)
    layout: PrintLayout = "a4_sheet"


def _pdf_response(printed: PrintedPdf) -> Response:
    return Response(
        content=printed.content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{printed.filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/qr-cards/{card_id}/card.pdf")
def card_pdf(
    card_id: uuid.UUID,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> Response:
    printed = service.print_cards(session, current_user.actor, [card_id], "single_cards")
    session.commit()
    return _pdf_response(printed)


# A POST, because the list of cards is in the body. It changes print counts, so the Origin
# check applies.
@router.post("/qr-cards/print")
def print_cards(
    body: PrintCardsRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> Response:
    printed = service.print_cards(session, current_user.actor, body.card_ids, body.layout)
    session.commit()
    return _pdf_response(printed)


@router.get("/plants/{plant_id}/gate-poster.pdf")
def gate_poster(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(require(Capability.DOWNLOAD_GATE_POSTER)),
    session: Session = Depends(get_session),
) -> Response:
    """The A4 poster for the gate (F-34): how to punch, and the photo notice with the current
    retention period. A plant outside the user's scope looks like it does not exist."""
    allowed = plant_filter(current_user, Capability.DOWNLOAD_GATE_POSTER)
    if allowed is not None and plant_id not in allowed:
        raise ApiError("PLANT_NOT_FOUND", "This plant does not exist.", 404)
    plant = get_plant(session, plant_id)
    content = gate_poster_pdf(
        plant.name, plant.code, get_int_setting(session, "snapshot_retention_days")
    )
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="gate-poster-{plant.code}.pdf"',
            "Cache-Control": "no-store",
        },
    )
