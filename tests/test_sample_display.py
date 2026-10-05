import unittest
from calendar import monthrange
from unittest.mock import Mock

from app import create_app
from app.infrastructure.sample_schedule import (
    SAMPLE_FIRST_ID, SAMPLE_STAFF_COUNT, SAMPLE_VIEWER, SampleConnection,
)


class SampleDisplayTests(unittest.TestCase):
    def setUp(self):
        # Fail if a public sample request touches any real use case/session.
        self.real = Mock()
        self.real.authenticated.side_effect = AssertionError("Real session accessed")
        self.app = create_app({"APP_ENV": "test", "TESTING": True}, self.real)
        self.client = self.app.test_client()

    def sample_get(self, path):
        response = self.client.get("/sample/api/" + path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("Set-Cookie", response.headers)
        return response.get_json()

    def test_sample_is_public_and_never_reads_real_session_in_both_environments(self):
        for environment in ("test", "production"):
            with self.subTest(environment=environment):
                app = create_app({"APP_ENV": environment, "TESTING": True},
                                 self.real, worker_runtime=True)
                client = app.test_client()
                client.set_cookie("app_session", "unrelated-session")
                page = client.get("/sample")
                self.assertEqual(page.status_code, 200)
                self.assertIn("すべて架空のデータ".encode(), page.data)
                self.assertIn(b'data-api-prefix="/sample"', page.data)
                self.assertNotIn(b'action="/logout"', page.data)
                self.assertNotIn("Set-Cookie", page.headers)
                self.assertEqual(client.get("/sample/api/calendar?year=2026&month=10").status_code, 200)
                self.assertEqual(client.get("/sample/api/staff?year=2026&month=10").status_code, 200)
                self.assertEqual(client.get(f"/sample/api/staff/{SAMPLE_FIRST_ID}?year=2026&month=10").status_code, 200)
                self.assertEqual(client.get("/sample/api/shifts?date=2026-10-01").status_code, 200)
                self.assertEqual(client.post("/sample/api/pay/estimate", json={
                    "year": 2026, "month": 10, "hourly_wage": 1200,
                    "night_bonus_percent": 25,
                }).status_code, 200)
        self.assertEqual(self.real.mock_calls, [])

    def test_full_synthetic_roster_and_schedules_for_arbitrary_months(self):
        for year, month in ((2026, 10), (2026, 12), (2027, 1), (2028, 2)):
            with self.subTest(year=year, month=month):
                data = SampleConnection().fetch(year, month, SAMPLE_VIEWER.store_id, 1)
                self.assertEqual(list(data.staff), list(range(SAMPLE_FIRST_ID, SAMPLE_FIRST_ID + SAMPLE_STAFF_COUNT)))
                self.assertGreater(len(data.shifts), 800)
                self.assertEqual({shift.date.day for shift in data.shifts}, set(range(1, monthrange(year, month)[1] + 1)))
                for user_id, staff in data.staff.items():
                    self.assertEqual(staff.employee_code, str(user_id))
                    self.assertIn("架空", staff.name)
                    self.assertIsNotNone(staff.birthday)
                    personal = [s for s in data.shifts if s.user_id == user_id]
                    self.assertGreaterEqual(len(personal), 10)
                    self.assertGreater(len({(s.start, s.end) for s in personal}), 5)
                    self.assertGreater(len({s.date.weekday() for s in personal}), 3)
                    full_weeks = {}
                    for shift in personal:
                        week_start = shift.date.day - shift.date.weekday()
                        if 1 <= week_start <= monthrange(year, month)[1] - 6:
                            full_weeks.setdefault(week_start, set()).add(shift.date.weekday())
                    self.assertTrue(all(3 <= len(days) <= 6 for days in full_weeks.values()))
                    self.assertGreater(len({tuple(sorted(days)) for days in full_weeks.values()}), 1)
                self.assertTrue(all(6 * 60 <= s.start.minutes < s.end.minutes <= 24 * 60
                                    for s in data.shifts))
                self.assertTrue(any(s.end.minutes == 24 * 60 for s in data.shifts))
                self.assertGreater(len({s.start for s in data.shifts}), 20)
                self.assertGreater(len({s.end for s in data.shifts}), 20)
                self.assertGreater(len({s.work_minutes for s in data.shifts}), 10)
                self.assertTrue(all(s.duration_minutes <= 8 * 60 and s.work_minutes > 0
                                    for s in data.shifts))
                self.assertTrue(all(s.start.minutes <= start.minutes < end.minutes <= s.end.minutes
                                    for s in data.shifts for start, end in s.rests))
                self.assertTrue(any(len(s.rests) > 1 for s in data.shifts))
                self.assertTrue(any(not s.rests for s in data.shifts))
                self.assertEqual(data, SampleConnection().fetch(year, month, SAMPLE_VIEWER.store_id, 1))

    def test_calendar_day_search_staff_and_pay_use_consistent_data(self):
        calendar = self.sample_get("calendar?year=2026&month=10")
        self.assertEqual(len(calendar), 31)
        self.assertTrue(any(not day["has_me"] for day in calendar.values()))
        my_day = next(key for key, value in calendar.items() if value["has_me"])
        day = self.sample_get(f"shifts?date={my_day}")
        self.assertEqual(day["count"], calendar[my_day]["total_count"])
        self.assertTrue(day["has_my_shift"])
        self.assertTrue(any(w["is_overlapping"] for w in day["workers"]))
        self.assertTrue(any(w["is_same_end"] for w in day["workers"]))
        self.assertTrue(any(w["rest_times"] for w in day["workers"]))
        roster = self.sample_get("staff?year=2026&month=10")
        self.assertEqual(len(roster), SAMPLE_STAFF_COUNT - 1)
        self.assertEqual(roster[0]["employee_code"], "9999990002")
        matches = self.sample_get("staff?year=2026&month=10&q=9999990060")
        self.assertEqual(len(matches), 1)
        matches = self.sample_get("staff?year=2026&month=10&q=青空")
        self.assertTrue(matches)
        for user_id in (SAMPLE_FIRST_ID, SAMPLE_FIRST_ID + 59):
            detail = self.sample_get(f"staff/{user_id}?year=2026&month=10")
            self.assertGreaterEqual(len(detail["schedules"]), 10)
            self.assertEqual(detail["total_work_minutes"], sum(s["duration_minutes"] for s in detail["schedules"]))
        response = self.client.post("/sample/api/pay/estimate", json={
            "year": 2026, "month": 10, "hourly_wage": 1200, "night_bonus_percent": 25,
        })
        self.assertEqual(response.status_code, 200)
        pay = response.get_json()
        self.assertEqual(pay["user_id"], SAMPLE_FIRST_ID)
        self.assertGreater(pay["estimated_yen"], 0)
        self.assertGreater(pay["night_minutes"], 0)
        self.assertGreater(pay["break_minutes"], 0)
        self.assertEqual(pay["worked_minutes"], self.sample_get(f"staff/{SAMPLE_FIRST_ID}?year=2026&month=10")["total_work_minutes"])

    def test_sample_validation_and_real_authentication_remain_separate(self):
        for path, status in (
            ("calendar?year=2026&month=13", 400),
            ("calendar", 400), ("shifts?date=2026-02-30", 400),
            ("staff?year=2026&month=10&q=" + "a" * 101, 400),
            ("staff/1?year=2026&month=10", 404),
            ("staff/9999990061?year=2026&month=10", 404),
        ):
            self.assertEqual(self.client.get("/sample/api/" + path).status_code, status)
        self.assertEqual(self.client.post("/sample/api/pay/estimate", json={
            "year": 2026, "month": 10, "hourly_wage": -1, "night_bonus_percent": 25,
        }).status_code, 400)
        self.real.authenticated.side_effect = None
        self.real.authenticated.return_value = False
        self.assertEqual(self.client.get("/api/calendar?year=2026&month=10&sample=1").status_code, 401)
        page = self.client.get("/login")
        self.assertIn(b'href="/sample"', page.data)
        self.assertLess(page.data.index(b'id="btnLogin"'), page.data.index(b'href="/sample"'))
        self.assertEqual(self.client.get("/").status_code, 302)
        self.assertEqual(self.client.get("/sample/api/login").status_code, 404)
        self.assertEqual(self.client.post("/sample/api/pay/estimate", data=b"x" * 20000,
                                         content_type="application/json").status_code, 413)


if __name__ == "__main__":
    unittest.main()
