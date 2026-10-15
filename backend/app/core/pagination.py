"""Paging for list endpoints: ?page=1&page_size=50 → { items, page, page_size, total }."""

from dataclasses import dataclass

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


@dataclass(frozen=True)
class PageParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> PageParams:
    return PageParams(page=page, page_size=page_size)


class Page[ItemType](BaseModel):
    items: list[ItemType]
    page: int
    page_size: int
    total: int


def fetch_page[RowType](
    session: Session, statement: Select[RowType], params: PageParams
) -> tuple[list[RowType], int]:
    """Run `statement` for one page and also count all matching rows."""
    total = session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = list(session.scalars(statement.offset(params.offset).limit(params.page_size)))
    return rows, total or 0
