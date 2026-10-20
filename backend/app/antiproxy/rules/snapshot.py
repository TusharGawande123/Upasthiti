"""Rule: a card punch must come with a usable photo (spec M2 §7 rule 4).

The photo is what an admin looks at later when someone suspects a borrowed card, so a punch
without one is refused. The check also runs for test cards; their photo is simply never stored.
"""

from app.antiproxy.context import PunchContext, RuleResult
from app.modules.punches.snapshots import SnapshotInvalidError, inspect_snapshot


def check_snapshot(context: PunchContext) -> RuleResult:
    if not context.snapshot_bytes:
        return RuleResult.rejected("SNAPSHOT_MISSING")
    try:
        context.snapshot = inspect_snapshot(
            context.snapshot_bytes, context.limits.snapshot_dark_threshold
        )
    except SnapshotInvalidError:
        return RuleResult.rejected("SNAPSHOT_INVALID")
    return RuleResult.passed()
