"""Card printing endpoints (spec §5.1): one card as a CR80 PDF, or many cards on A4 sheets.

Super Admin only. The PDF is built in memory and sent straight back; it is never stored and
never reachable through a link.
"""

import uuid

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.printing import service
from app.modules.printing.service import PrintedPdf, PrintLayout

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
