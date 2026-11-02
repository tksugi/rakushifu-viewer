import asyncio
import json
import types
import unittest
from unittest.mock import Mock, patch

from app import create_app
from app.application.session import ActiveSession
from app.application.use_cases import ShiftUseCases
from app.domain.models import Viewer
from app.infrastructure.durable_sessions import DurableSessionStore
from app.infrastructure.memory_sessions import MemorySessionStore
from test_shift_architecture import FakeAuthenticator
from test_security_regressions import FakeStorage, load_worker


DAYS_30 = 30 * 24 * 60 * 60


class SessionLifetimeTests(unittest.TestCase):
    def test_login_cookie_and_session_api_share_a_fixed_30_day_deadline(self):
        sessions = MemorySessionStore()
        cases = ShiftUseCases(FakeAuthenticator(), sessions)
        app = create_app({'APP_ENV': 'test', 'TESTING': True}, cases)
        client = app.test_client()
        with patch('time.time', return_value=10000000), patch('time.monotonic', return_value=1000):
            response = client.post('/login', json={
                'employee_code': '0000000001', 'password': 'test-password'})
            self.assertEqual(response.status_code, 200)
            cookie = client.get_cookie('app_session')
            self.assertEqual(cookie.max_age, DAYS_30)
            self.assertTrue(cookie.http_only)
            self.assertEqual(cookie.same_site, 'Lax')
            self.assertEqual(cookie.path, '/')
            self.assertEqual(app.config['APP_SESSION_SECONDS'], DAYS_30)
            self.assertEqual(client.get('/api/session').json['expires_in'], DAYS_30)
        for elapsed in (3601, DAYS_30 - 1, DAYS_30):
            with self.subTest(elapsed=elapsed), patch('time.time', return_value=10000000 + elapsed), \
                    patch('time.monotonic', return_value=1000 + elapsed):
                response = client.get('/api/session')
                self.assertEqual(response.status_code, 200 if elapsed < DAYS_30 else 401)
                if elapsed < DAYS_30:
                    self.assertEqual(response.json['expires_in'], DAYS_30 - elapsed)

    def test_production_cookie_keeps_security_attributes(self):
        cases = Mock()
        cases.login.return_value = 'synthetic-session'
        app = create_app({'APP_ENV': 'production', 'TESTING': True}, cases, worker_runtime=True)
        app.extensions['login_limiter'] = Mock(allow=Mock(return_value=True))
        client = app.test_client()
        response = client.post('/login', json={'employee_code': 'FIXTURE', 'password': 'fixture'})
        self.assertEqual(response.status_code, 200)
        cookie = client.get_cookie('app_session')
        self.assertEqual(cookie.max_age, DAYS_30)
        self.assertTrue(cookie.secure)
        self.assertTrue(cookie.http_only)
        self.assertEqual(cookie.same_site, 'Lax')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_logout_removes_a_session_before_30_days(self):
        sessions = MemorySessionStore()
        cases = ShiftUseCases(FakeAuthenticator(), sessions)
        client = create_app({'APP_ENV': 'test', 'TESTING': True}, cases).test_client()
        client.post('/login', json={'employee_code': '0000000001', 'password': 'test-password'})
        token = client.get_cookie('app_session').value
        client.post('/logout')
        self.assertIsNone(sessions.get(token))
        self.assertIsNone(client.get_cookie('app_session'))
        self.assertEqual(client.get('/api/session').status_code, 401)

    def test_worker_persists_30_days_across_recreation_and_cleans_up_at_expiry(self):
        worker = load_worker()
        storage = FakeStorage()
        ctx = types.SimpleNamespace(storage=storage)
        obj = worker.SessionObject(ctx, None)
        connection = Mock()
        connection.export_state.return_value = {
            'viewer': {'account_id': 'FIXTURE', 'staff_id': 1, 'store_id': 10, 'genre_id': 2},
            'cookies': [], 'csrf_token': ''}
        active = ActiveSession(Viewer('FIXTURE', 1, 10, 2), connection)
        store = DurableSessionStore()
        with patch.object(store, '_stub', return_value=obj), \
                patch('app.infrastructure.durable_sessions._run', side_effect=asyncio.run), \
                patch('time.time', return_value=10000000):
            store.create(active)
        deadline = 10000000 + DAYS_30
        self.assertEqual(storage.alarm_at, deadline * 1000)
        self.assertEqual(json.loads(storage.data['session'])['expires_at'], deadline)
        recreated = worker.SessionObject(ctx, None)
        for now in (10000000 + 3601, deadline - 1):
            with patch('time.time', return_value=now):
                self.assertEqual(json.loads(asyncio.run(recreated.read()))['expires_at'], deadline)
                asyncio.run(recreated.alarm())
                self.assertEqual(storage.alarm_at, deadline * 1000)
        with patch('time.time', return_value=deadline):
            self.assertIsNone(asyncio.run(recreated.read()))
        self.assertEqual(storage.data, {})
        self.assertIsNone(storage.alarm_at)
