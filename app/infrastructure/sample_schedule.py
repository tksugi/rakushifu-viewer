"""Invented data only: no credentials, storage, or upstream communication."""
from calendar import monthrange
from datetime import date

from app.domain.models import Shift, ShiftMonth, Staff, TimeOfDay, Viewer

SAMPLE_STORE_ID = 999999
SAMPLE_STAFF_COUNT = 60
SAMPLE_FIRST_ID = 9999990001
SAMPLE_VIEWER = Viewer("sample", SAMPLE_FIRST_ID, SAMPLE_STORE_ID, 1)
SURNAMES = ("青空", "若葉", "星野", "花園", "海原", "春風", "秋月", "雪原", "朝日", "虹川")
GIVEN_NAMES = ("ひかり", "そら", "あおい", "はる", "みのり", "ゆう")
PATTERNS = (
    (6, 0, 12, 0, ((9, 0, 9, 30),)),
    (9, 0, 18, 0, ((12, 0, 13, 0),)),
    (10, 30, 19, 30, ((13, 0, 13, 30), (16, 0, 16, 30))),
    (12, 0, 21, 0, ((16, 0, 17, 0),)),
    (17, 0, 22, 0, ()),
    (18, 0, 25, 0, ((21, 0, 21, 30),)),
    (21, 0, 29, 0, ((24, 0, 24, 45),)),
    (22, 0, 29, 0, ((25, 0, 25, 45),)),
)


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
                if (day + index) % 7 >= 5:
                    continue
                sh, sm, eh, em, breaks = PATTERNS[(day + index // 7) % len(PATTERNS)]
                shifts.append(Shift(
                    date(year, month, day), SAMPLE_FIRST_ID + index, SAMPLE_STORE_ID,
                    TimeOfDay(sh, sm), TimeOfDay(eh, em),
                    tuple((TimeOfDay(bsh, bsm), TimeOfDay(beh, bem))
                          for bsh, bsm, beh, bem in breaks),
                ))
        return ShiftMonth(year, month, staff, tuple(shifts))

    def close(self):
        pass
