import asyncio
import json
import time
import types
import threading
import unittest
from unittest.mock import patch, Mock

from app import create_app
from app.application.use_cases import ShiftUseCases
from app.infrastructure.memory_sessions import MemorySessionStore
from app.infrastructure.durable_sessions import DurableSessionStore, DurableConnection
from app.infrastructure.worker_state import month_to_json
from app.domain.models import ShiftMonth
from test_shift_architecture import FakeAuthenticator
from test_security_regressions import FakeStorage, load_worker


class CacheMetadataTests(unittest.TestCase):
    def setUp(self):
        self.auth = FakeAuthenticator()
        self.sessions = MemorySessionStore()
        self.cases = ShiftUseCases(self.auth, self.sessions)
        self.app = create_app({"APP_ENV": "test", "TESTING": True}, self.cases)
        self.client = self.app.test_client()
        self.client.post('/login', json={
            'employee_code': '0000000001', 'password': 'test-password'})

    def test_cached_views_keep_original_freshness_and_revision(self):
        with patch('app.application.cache.time.time', return_value=1000):
            first = self.client.get('/api/calendar?year=2026&month=6')
        with patch('app.application.cache.time.time', return_value=1030):
            second = self.client.get('/api/staff?year=2026&month=6')
        self.assertEqual(first.headers['X-Shift-Fetched-At'], '1000')
        self.assertEqual(second.headers['X-Shift-Fetched-At'], '1000')
        self.assertEqual(first.headers['X-Shift-Revision'], second.headers['X-Shift-Revision'])
        self.assertEqual(float(first.headers['X-Shift-Remaining-Seconds']), 120)
        self.assertEqual(float(second.headers['X-Shift-Remaining-Seconds']), 90)
        self.assertEqual(first.headers['Cache-Control'], 'no-store')

    def test_expired_month_gets_a_new_revision(self):
        with patch('app.application.use_cases.time.monotonic', return_value=1000):
            first = self.client.get('/api/calendar?year=2026&month=6')
        with patch('app.application.use_cases.time.monotonic', return_value=1121):
            second = self.client.get('/api/calendar?year=2026&month=6')
        self.assertNotEqual(first.headers['X-Shift-Revision'], second.headers['X-Shift-Revision'])

    def test_session_info_is_private_and_scoped_to_each_login(self):
        first = self.client.get('/api/session')
        self.assertEqual(set(first.get_json()), {'scope', 'user_id', 'expires_in'})
        self.assertEqual(first.headers['Cache-Control'], 'no-store')
        self.assertGreater(first.get_json()['expires_in'], 0)
        other = self.app.test_client()
        other.post('/login', json={'employee_code': '0000000002', 'password': 'test-password'})
        self.assertNotEqual(first.get_json()['scope'], other.get('/api/session').get_json()['scope'])
        self.client.post('/logout')
        self.assertEqual(self.client.get('/api/session').status_code, 401)

    def test_public_sample_has_consistent_freshness_without_real_sessions(self):
        with patch.object(self.cases, 'session_info', side_effect=AssertionError('real session')):
            with patch('app.application.sample.time.time', return_value=1000):
                calendar = self.app.test_client().get('/sample/api/calendar?year=2026&month=6')
                staff = self.app.test_client().get('/sample/api/staff?year=2026&month=6')
                session = self.app.test_client().get('/sample/api/session')
        self.assertEqual(calendar.headers['X-App-Scope'], 'sample')
        self.assertEqual(calendar.headers['X-Shift-Revision'], staff.headers['X-Shift-Revision'])
        self.assertEqual(session.get_json()['expires_in'], None)

    def test_local_expiry_during_fetch_does_not_cache_or_return_private_data(self):
        token = self.cases.login('0000000001', 'test-password')
        active = self.sessions.get(token)

        def expire(*args):
            active.expires_at = time.time() - 1
            return ShiftMonth(2026, 6, {}, ())

        with patch.object(active.connection, 'fetch', side_effect=expire):
            from app.application.errors import SessionExpired
            with self.assertRaises(SessionExpired):
                self.cases.calendar(2026, 6, token)
        self.assertNotIn((2026, 6), active.cache)

    def test_worker_shares_month_fetch_and_preserves_original_metadata(self):
        worker = load_worker()

        async def run():
            obj = worker.SessionObject(types.SimpleNamespace(storage=FakeStorage()), None)
            state = {'viewer': {'account_id': 'FIXTURE', 'staff_id': 1,
                                'store_id': 10, 'genre_id': 2},
                     'cookies': [], 'csrf_token': '', 'expires_at': time.time() + 3600}
            await obj.create(json.dumps(state), '', '[]', 120, 3)
            calls = []

            class Connection:
                viewer = types.SimpleNamespace(store_id=10, genre_id=2)

                async def fetch_async(self, *args):
                    calls.append(args)
                    await asyncio.sleep(0)
                    return ShiftMonth(2026, 6, {}, ())

                def export_state(self):
                    return {'cookies': [], 'csrf_token': ''}

                def close(self):
                    pass

            with patch.object(worker.WorkerRakushifuConnection, 'from_state', return_value=Connection()):
                first, second = await asyncio.gather(obj.month(2026, 6), obj.month(2026, 6))
                third = await obj.month(2026, 6)
            self.assertEqual(len(calls), 1)
            self.assertEqual(json.loads(first)['cache_metadata'], json.loads(second)['cache_metadata'])
            self.assertEqual(json.loads(first)['cache_metadata'], json.loads(third)['cache_metadata'])

        asyncio.run(run())

    def test_local_logout_during_fetch_discards_the_result(self):
        token = self.cases.login('0000000001', 'test-password')
        active = self.sessions.get(token)
        started, release = threading.Event(), threading.Event()
        outcome = []

        def fetch(*args):
            started.set()
            release.wait(5)
            return ShiftMonth(2026, 6, {}, ())

        def read():
            try:
                self.cases.calendar(2026, 6, token)
                outcome.append('returned')
            except Exception as error:
                outcome.append(type(error).__name__)

        with patch.object(active.connection, 'fetch', side_effect=fetch):
            reader = threading.Thread(target=read)
            reader.start()
            self.assertTrue(started.wait(2))
            logout = threading.Thread(target=lambda: self.cases.logout(token))
            logout.start()
            try:
                deadline = time.monotonic() + 2
                while not active.closed and time.monotonic() < deadline:
                    time.sleep(0.001)
                self.assertTrue(active.closed)
            finally:
                release.set()
                reader.join(2)
                logout.join(2)
        self.assertEqual(outcome, ['SessionExpired'])
        self.assertIsNone(self.sessions.get(token))
        self.assertEqual(active.cache, {})

    def test_worker_initial_cache_keeps_login_fetch_time(self):
        worker = load_worker()

        async def run():
            obj = worker.SessionObject(types.SimpleNamespace(storage=FakeStorage()), None)
            metadata = {'fetched_at': time.time() - 30, 'expires_at': time.time() + 90,
                        'revision': 'fixture-login-fetch'}
            await obj.create(json.dumps({'expires_at': time.time() + 3600}),
                             'fixture-month', '[2026,6]', 120, 3, json.dumps(metadata))
            result = json.loads(await obj.month(2026, 6))
            self.assertEqual(result['cache_metadata'], metadata)

        asyncio.run(run())

    def test_old_worker_sessions_restore_without_a_scope_field(self):
        stub = Mock()
        stub.read.return_value = json.dumps({
            'viewer': {'account_id': 'FIXTURE', 'staff_id': 1, 'store_id': 10, 'genre_id': 2},
            'cookies': [], 'csrf_token': '', 'expires_at': time.time() + 3600})
        store = DurableSessionStore()
        with patch.object(store, '_stub', return_value=stub), \
                patch('app.infrastructure.durable_sessions._run', side_effect=lambda result: result):
            first = store.get('A' * 43)
            second = store.get('A' * 43)
            other = store.get('B' * 43)
        self.assertEqual(first.cache_scope, second.cache_scope)
        self.assertNotEqual(first.cache_scope, other.cache_scope)
        self.assertNotEqual(first.cache_scope, 'A' * 43)
        self.assertGreater(first.expires_at, time.time())

    def test_worker_adapter_uses_object_freshness_instead_of_new_request_time(self):
        stub = Mock()
        metadata = {'fetched_at': time.time() - 90, 'expires_at': time.time() + 30,
                    'revision': 'fixture-object-fetch'}
        stub.month.return_value = json.dumps({
            'error': 'ok', 'month': month_to_json(ShiftMonth(2026, 6, {}, ())),
            'cache_metadata': metadata})
        connection = DurableConnection(stub, Mock())
        with patch('app.infrastructure.durable_sessions._run', side_effect=lambda result: result):
            connection.fetch(2026, 6, 10, 2)
        self.assertEqual(connection.cache_metadata, metadata)
