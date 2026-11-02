"""The "Explain this day" sentences (M5 spec §4.6, §7 rule 28, F-61).

Built on the server from the SAME computed result the register shows, so the words always match the
numbers (nothing is calculated again). Every sentence is a translation key plus values
(`attendance.explain.<key>`), so Marathi and Hindi can be added later. Durations are given as whole
minutes; the screen writes them as "7 h 20 m".
"""

from datetime import datetime, timedelta
from typing import Any

from app.core.time import to_ist
from app.modules.attendance.compute import shift_moments
from app.modules.attendance.schemas import Day
from app.modules.org.shift_rules_service import ShiftRules

Sentence = dict[str, Any]


def _clock(moment: datetime) -> str:
    return f"{to_ist(moment):%H:%M}"


def hours_and_minutes(minutes: int) -> str:
    """455 -> "7 h 35 m", 480 -> "8 h", 40 -> "40 m" (the same on every screen and language)."""
    hours, rest = divmod(minutes, 60)
    if hours and rest:
        return f"{hours} h {rest} m"
    return f"{hours} h" if hours else f"{rest} m"


def _sentence(key: str, **values: Any) -> Sentence:
    return {"key": key, "values": values}


def explain_day(day: Day, rules: ShiftRules | None) -> list[Sentence]:
    """Two to five short sentences for one day. `rules` are the rules the day was computed with."""
    if day.status == "not_employed":
        return []
    if day.leave is not None and day.first_in is None:
        return [_sentence("leave", paid=bool(day.leave.is_paid))]
    if day.day_kind == "holiday" and day.first_in is None:
        return [_sentence("holiday", name=day.holiday.name if day.holiday else "")]
    if day.day_kind == "weekly_off" and day.first_in is None:
        return [_sentence("weeklyOff")]
    if day.first_in is None:
        return [_sentence("noPunch", status=day.status)]

    sentences = [_in_sentence(day, day.first_in, rules), _out_sentence(day)]
    sentences.extend(_status_sentences(day))
    sentences.extend(_overtime_sentences(day, rules))
    if day.extra_punch_count:
        sentences.append(_sentence("extraPunches", count=day.extra_punch_count))
    if day.is_corrected:
        sentences.append(_sentence("corrected"))
    return sentences


def _in_sentence(day: Day, first_in_moment: datetime, rules: ShiftRules | None) -> Sentence:
    first_in = _clock(first_in_moment)
    if rules is None:
        return _sentence("inAt", time=first_in)
    start, _ = shift_moments(day.date, rules)
    on_time_until = _clock(start + timedelta(minutes=rules.grace_min))
    if day.late_min > 0:
        return _sentence(
            "late",
            time=first_in,
            minutes=day.late_min,
            duration=hours_and_minutes(day.late_min),
            until=on_time_until,
        )
    return _sentence("onTime", time=first_in, until=on_time_until)


def _out_sentence(day: Day) -> Sentence:
    if day.last_out is None:
        return _sentence("noOut")
    return _sentence("outAt", time=_clock(day.last_out))


def _status_sentences(day: Day) -> list[Sentence]:
    sentences: list[Sentence] = []
    if day.last_out is not None and day.early_exit_min > 0:
        sentences.append(
            _sentence(
                "earlyExit",
                minutes=day.early_exit_min,
                duration=hours_and_minutes(day.early_exit_min),
            )
        )
    if day.employee_type == "temporary":
        sentences.append(
            _sentence(
                "payable", minutes=day.payable_min, duration=hours_and_minutes(day.payable_min)
            )
        )
    elif day.status_min is not None and day.shift_length_min:
        sentences.append(
            _sentence(
                "workedForStatus",
                minutes=day.status_min,
                worked=hours_and_minutes(day.status_min),
                full=hours_and_minutes(day.shift_length_min),
                status=day.status,
            )
        )
    return sentences


def _overtime_sentences(day: Day, rules: ShiftRules | None) -> list[Sentence]:
    if day.last_out is None or rules is None:
        return []
    if day.overtime_min > 0:
        return [
            _sentence(
                "overtimeReached",
                minutes=day.overtime_min,
                duration=hours_and_minutes(day.overtime_min),
            )
        ]
    _, end = shift_moments(day.date, rules)
    after_end = int((to_ist(day.last_out) - end).total_seconds() // 60)
    if after_end > 0:
        return [
            _sentence(
                "overtimeNotReached",
                minutes=after_end,
                duration=hours_and_minutes(after_end),
                minimum=hours_and_minutes(rules.overtime_min_minutes),
                end=f"{end:%H:%M}",
            )
        ]
    return [_sentence("noOvertime", end=f"{end:%H:%M}")]
