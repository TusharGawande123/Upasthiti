"""Compares embeddings: 1:N against a plant's gallery, 1:1 for a typed code (spec M3 §7 rule 7).

All embeddings and templates are L2-normalised, so the cosine similarity of two of them is their
dot product: about 1 for the same face, about 0 for strangers. The decision uses two numbers:
the best score and how far it is ahead of the second best (the "margin"), so two similar people
(twins) are sent to the code pad instead of being guessed.
"""

import enum
import uuid
from dataclasses import dataclass

import numpy as np

from app.face.embedder import EMBEDDING_SIZE, normalise


class MatchKind(enum.StrEnum):
    MATCHED = "matched"  # sure: this employee
    UNSURE = "unsure"  # close to someone, but not sure enough: ask for the employee code
    NO_MATCH = "no_match"  # nobody in the gallery looks like this face


@dataclass(frozen=True)
class MatchThresholds:
    match: float  # face_match_threshold
    margin: float  # face_match_margin
    code_offer_floor: float  # face_code_offer_floor


@dataclass(frozen=True)
class MatchResult:
    kind: MatchKind
    employee_id: uuid.UUID | None  # set only when matched
    best_score: float | None
    second_best_score: float | None


class Gallery:
    """The templates of one plant as one matrix (N × 512), so 1:N is one multiplication."""

    def __init__(self, employee_ids: list[uuid.UUID], templates: np.ndarray) -> None:
        if templates.shape != (len(employee_ids), EMBEDDING_SIZE):
            raise ValueError("one template of 512 numbers per employee is needed")
        self.employee_ids = employee_ids
        self.templates = templates.astype(np.float32)

    def __len__(self) -> int:
        return len(self.employee_ids)

    @classmethod
    def empty(cls) -> Gallery:
        return cls([], np.zeros((0, EMBEDDING_SIZE), dtype=np.float32))


def cosine(first: np.ndarray, second: np.ndarray) -> float:
    """Similarity of two normalised vectors, -1..1."""
    return float(np.dot(first, second))


def match_one_to_many(
    embedding: np.ndarray, gallery: Gallery, thresholds: MatchThresholds
) -> MatchResult:
    if len(gallery) == 0:
        return MatchResult(MatchKind.NO_MATCH, None, None, None)
    scores = gallery.templates @ embedding
    order = np.argsort(-scores)
    best = float(scores[order[0]])
    second = float(scores[order[1]]) if len(order) > 1 else None
    kind = decide_match(best, second, thresholds)
    employee_id = gallery.employee_ids[order[0]] if kind is MatchKind.MATCHED else None
    return MatchResult(kind, employee_id, best, second)


def decide_match(best: float, second: float | None, thresholds: MatchThresholds) -> MatchKind:
    """The 1:N rule on the two best scores (also used by the accuracy tool, S-32)."""
    # With one person in the gallery there is no second best; the margin then counts from 0.
    ahead_by = best - (second if second is not None else 0.0)
    if best >= thresholds.match and ahead_by >= thresholds.margin:
        return MatchKind.MATCHED
    if best >= thresholds.code_offer_floor:
        return MatchKind.UNSURE
    return MatchKind.NO_MATCH


def mean_template(embeddings: list[np.ndarray]) -> np.ndarray:
    """The "average face" of the enrolment shots: mean of normalised vectors, normalised again."""
    if not embeddings:
        raise ValueError("no embeddings")
    return normalise(np.mean(np.stack([normalise(vector) for vector in embeddings]), axis=0))
