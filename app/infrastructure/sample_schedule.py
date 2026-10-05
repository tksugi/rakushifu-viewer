"""Invented data only: no credentials, storage, or upstream communication."""
from calendar import monthrange
from datetime import date
from random import Random

from app.domain.models import Shift, ShiftMonth, Staff, TimeOfDay, Viewer

SAMPLE_STORE_ID = 999999
SAMPLE_STAFF_COUNT = 60
SAMPLE_FIRST_ID = 9999990001
SAMPLE_VIEWER = Viewer("sample", SAMPLE_FIRST_ID, SAMPLE_STORE_ID, 1)
SURNAMES = ("青空", "若葉", "星野", "花園", "海原", "春風", "秋月", "雪原", "朝日", "虹川")
GIVEN_NAMES = ("ひかり", "そら", "あおい", "はる", "みのり", "ゆう")


def _time(minutes):
    return TimeOfDay(*divmod(minutes, 60))


def _sample_shift(target, index):
    # Stable seeds keep reloads/API calls consistent without shared state.
    week_year, week, weekday = target.isocalendar()
    weekly = Random(f"sample-week:{week_year}:{week}:{index}")
    working_days = weekly.sample(range(1, 8), 3 + index % 4)
    if weekday not in working_days:
        return None
    daily = Random(f"sample-shift:{target.isoformat()}:{index}")
    # Early, daytime and evening availability; quarter-hour variations.
    earliest, latest = ((6, 10), (9, 14), (15, 20))[
        (index + daily.randrange(3)) % 3]
    start = daily.randint(earliest * 4, latest * 4) * 15
    end = min(24 * 60, start + daily.randint(16, 32) * 15)
    duration = end - start
    breaks = ()
    if duration >= 7 * 60 and daily.randrange(3) == 0:
        breaks = ((start + 120, start + 150), (start + 300, start + 330))
    elif duration >= 6 * 60:
        rest_start = start + daily.randint(8, 12) * 15
        breaks = ((rest_start, rest_start + daily.choice((30, 45, 60))),)
    return Shift(target, SAMPLE_FIRST_ID + index, SAMPLE_STORE_ID,
                 _time(start), _time(end),
                 tuple((_time(a), _time(b)) for a, b in breaks))


class SampleConnection:
    viewer = SAMPLE_VIEWER

    def fetch(self, year, month, store_id, genre_id):
        if store_id != SAMPLE_STORE_ID or genre_id != self.viewer.genre_id:
            raise ValueError("Sample scope is fixed")
        staff = {}
        for index in range(SAMPLE_STAFF_COUNT):
            user_id = SAMPLE_FIRST_ID + index
            birth_year = 1975 + index % 30
            birth_month, birth_day = index % 12 + 1, index % 28 + 1
            age = year - birth_year - ((month, 1) < (birth_month, birth_day))
            staff[user_id] = Staff(
                id=user_id,
                name=f"{SURNAMES[index % 10]} {GIVEN_NAMES[index // 10]}（架空）",
                age=max(0, age), rank=("リーダー", "ホール", "キッチン")[index % 3],
                birthday=f"{birth_year}-{birth_month:02d}-{birth_day:02d}",
                employee_code=str(user_id), belonging_store_id=SAMPLE_STORE_ID,
            )
        shifts = []
        for day in range(1, monthrange(year, month)[1] + 1):
            for index in range(SAMPLE_STAFF_COUNT):
                shift = _sample_shift(date(year, month, day), index)
                if shift is not None:
                    shifts.append(shift)
        return ShiftMonth(year, month, staff, tuple(shifts))

    def close(self):
        pass
