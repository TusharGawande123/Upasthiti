"""Helpers that keep big reports light on memory (M5c, S-50).

A year of a plant is hundreds of people times hundreds of days. Two rules keep the memory flat:
people are read in small batches (never more than `BATCH_SIZE` at a time, each batch is let go
before the next), and an Excel file is written row by row into a temporary file on disk, then sent
from disk and removed. The same code needs no more memory on a bigger server.
"""

import contextlib
import os
import tempfile
from collections.abc import Iterator, Sequence
from dataclasses import dataclass

import xlsxwriter

BATCH_SIZE = 100


def batches[ItemType](
    items: Sequence[ItemType], size: int = BATCH_SIZE
) -> Iterator[list[ItemType]]:
    """The items in lists of at most `size`."""
    for start in range(0, len(items), size):
        yield list(items[start : start + size])


@dataclass
class TempWorkbook:
    """An Excel file being written in XlsxWriter's low-memory mode into a temporary file.

    Rows of each worksheet must be written in order (a limit of the low-memory mode). Call
    `finish()` when all rows are written; `discard()` removes the file if something fails or
    after it has been sent.
    """

    path: str
    workbook: xlsxwriter.Workbook

    @classmethod
    def create(cls) -> TempWorkbook:
        handle, path = tempfile.mkstemp(prefix="upasthiti-report-", suffix=".xlsx")
        os.close(handle)
        workbook = xlsxwriter.Workbook(
            path, {"constant_memory": True, "strings_to_formulas": False}
        )
        return cls(path, workbook)

    def finish(self) -> str:
        self.workbook.close()
        return self.path

    def discard(self) -> None:
        delete_file(self.path)


def delete_file(path: str) -> None:
    """Remove a temporary report file; a missing file is fine."""
    with contextlib.suppress(FileNotFoundError):
        os.remove(path)
