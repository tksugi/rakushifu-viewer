import asyncio
import json
import types
import unittest
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import Mock, patch

import jwt

from app import create_app
from app.application.session import ActiveSession
from app.application.use_cases import ShiftUseCases
from app.domain.models import Viewer
from app.infrastructure.durable_sessions import DurableSessionStore
from app.infrastructure.memory_sessions import MemorySessionStore
from test_shift_architecture import FakeAuthenticator
from test_security_regressions import FakeStorage, load_worker


DAYS_30 = 30 * 24 * 60 * 60
START = 1800000000


@contextmanager
def clock(elapsed=0):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromtimestamp(START + elapsed, tz)
    with patch('time.time', return_value=START + elapsed), \
            patch('time.monotonic', return_value=1000 + elapsed), \
            patch('jwt.api_jwt.datetime', Clock):
        yield


class SessionLifetimeTests(unittest.TestCase):
    def setUp(self):
        self.sessions = MemorySessionStore()
        self.cases = ShiftUseCases(FakeAuthenticator(), self.sessions)
        self.app = create_app({'APP_ENV': 'test', 'TESTING': True}, self.cases)
        self.client = self.app.test_client()

    def login(self):
        return self.client.post('/login', json={
            'employee_code': '0000000001', 'password': 'test-password'})

    def test_one_hour_access_and_30_day_refresh_use_separate_jwt_claims(self):
        with clock():
            self.assertEqual(self.login().status_code, 200)
            access = self.client.get_cookie('app_access')
            refresh = self.client.get_cookie('app_refresh')
            for cookie, kind, lifetime in ((access, 'access', 3600), (refresh, 'refresh', DAYS_30)):
                self.assertEqual(cookie.max_age, lifetime)
                self.assertTrue(cookie.http_only)
                self.assertEqual(cookie.same_site, 'Lax')
                self.assertEqual(cookie.path, '/')
                claims = jwt.decode(cookie.value, options={'verify_signature': False})
                self.assertEqual(set(claims), {'iss', 'aud', 'sub', 'iat', 'exp', 'jti', 'token_use'})
                self.assertEqual(claims['token_use'], kind)
                self.assertEqual(claims['exp'] - claims['iat'], lifetime)
            self.assertIsNone(self.client.get_cookie('app_session'))
            self.assertEqual(self.client.get('/api/session').json['expires_in'], DAYS_30)

    def test_expired_access_refreshes_without_extending_30_day_deadline(self):
        with clock():
            self.login()
            original_refresh = self.client.get_cookie('app_refresh').value
        with clock(3600):
            self.assertEqual(self.client.get('/api/session').status_code, 401)
            # A document reload can reach the shell and refresh before private APIs.
            self.assertEqual(self.client.get('/').status_code, 200)
            response = self.client.post('/api/auth/refresh', json={})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self.client.get_cookie('app_access').max_age, 3600)
            self.assertEqual(self.client.get_cookie('app_refresh').value, original_refresh)
            self.assertEqual(self.client.get('/api/session').json['expires_in'], DAYS_30 - 3600)
        with clock(DAYS_30 - 1):
            self.assertEqual(self.client.post('/api/auth/refresh', json={}).status_code, 200)
            self.assertEqual(self.client.get_cookie('app_access').max_age, 1)
            self.assertEqual(self.client.get('/api/session').json['expires_in'], 1)
        with clock(DAYS_30):
            self.assertEqual(self.client.post('/api/auth/refresh', json={}).status_code, 401)
            self.assertIsNone(self.client.get_cookie('app_access'))
            self.assertIsNone(self.client.get_cookie('app_refresh'))

    def test_production_cookie_keeps_security_attributes(self):
        app = create_app({'APP_ENV': 'production', 'TESTING': True}, self.cases, worker_runtime=True)
        app.extensions['login_limiter'] = Mock(allow=Mock(return_value=True))
        client = app.test_client()
        with clock():
            response = client.post('/login', json={'employee_code': '0000000001', 'password': 'test-password'})
        self.assertEqual(response.status_code, 200)
        for name in ('app_access', 'app_refresh'):
            cookie = client.get_cookie(name)
            self.assertTrue(cookie.secure)
            self.assertTrue(cookie.http_only)
            self.assertEqual(cookie.same_site, 'Lax')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_logout_revokes_both_jwts_even_if_they_are_replayed(self):
        with clock():
            self.login()
            access = self.client.get_cookie('app_access').value
            refresh = self.client.get_cookie('app_refresh').value
            self.client.delete_cookie('app_access')
            self.client.post('/logout')
            self.assertIsNone(self.client.get_cookie('app_refresh'))
            self.client.set_cookie('app_access', access)
            self.client.set_cookie('app_refresh', refresh)
            self.assertEqual(self.client.get('/api/session').status_code, 401)
            self.assertEqual(self.client.post('/api/auth/refresh', json={}).status_code, 401)

    def test_invalid_jwts_and_wrong_purpose_are_rejected(self):
        with clock():
            self.login()
            access = self.client.get_cookie('app_access').value
            refresh = self.client.get_cookie('app_refresh').value
            for encoded in ('invalid', access + 'invalid', refresh):
                self.client.set_cookie('app_access', encoded)
                self.assertEqual(self.client.get('/api/session').status_code, 401)
            self.client.set_cookie('app_refresh', access)
            self.assertEqual(self.client.post('/api/auth/refresh', json={}).status_code, 401)

    def test_signed_jwts_require_the_expected_issuer_audience_type_and_claims(self):
        from app.web.tokens import _key
        with clock():
            self.login()
            encoded = self.client.get_cookie('app_access').value
            original = jwt.decode(encoded, options={'verify_signature': False})
            secret, _ = self.cases.token_context(original['sub'])
            variations = []
            for field, value in (('iss', 'other'), ('aud', 'other'),
                                 ('token_use', 'refresh'), ('exp', START + 3601),
                                 ('iat', START + 1)):
                claims = dict(original)
                claims[field] = value
                variations.append((claims, 'access+jwt', 'HS256'))
            for field in ('exp', 'iat', 'iss', 'aud', 'sub', 'jti', 'token_use'):
                claims = dict(original)
                del claims[field]
                variations.append((claims, 'access+jwt', 'HS256'))
            variations.extend([(original, 'refresh+jwt', 'HS256'),
                               (original, 'access+jwt', 'HS384')])
            for claims, token_type, algorithm in variations:
                test_key = _key(secret, 'access')
                if algorithm == 'HS384':
                    test_key = test_key * 2
                invalid = jwt.encode(claims, test_key,
                                     algorithm=algorithm, headers={'typ': token_type})
                self.client.set_cookie('app_access', invalid)
                self.assertEqual(self.client.get('/api/session').status_code, 401)

    def test_refresh_rejects_cross_origin_forms_and_oversized_requests(self):
        with clock():
            self.login()
            for headers in ({'Origin': 'https://other.invalid'}, {'Origin': 'null'},
                            {'Sec-Fetch-Site': 'cross-site'}, {'Origin': 'http://['}):
                response = self.client.post('/api/auth/refresh', json={}, headers=headers)
                self.assertEqual(response.status_code, 403)
            self.assertEqual(self.client.post('/api/auth/refresh', data={}).status_code, 403)
            self.assertEqual(self.client.post('/api/auth/refresh', json=[]).status_code, 403)
            self.assertEqual(self.client.post('/api/auth/refresh', data='x' * 9000, content_type='application/json').status_code, 413)
            self.assertEqual(self.client.post('/api/auth/refresh', json={}, headers={'Origin': 'http://localhost'}).status_code, 200)

    def test_legacy_cookie_cannot_authenticate_or_refresh(self):
        with clock():
            token = self.cases.login('0000000001', 'test-password')
            self.client.set_cookie('app_session', token)
            self.assertEqual(self.client.get('/api/session').status_code, 401)
            self.assertEqual(self.client.post('/api/auth/refresh', json={}).status_code, 401)
            self.login()
            self.client.delete_cookie('app_refresh')
            self.assertEqual(self.client.post('/api/auth/refresh', json={}).status_code, 401)

    def test_relogin_revokes_previous_pair_and_preserves_user_separation(self):
        with clock():
            self.login()
            access = self.client.get_cookie('app_access').value
            refresh = self.client.get_cookie('app_refresh').value
            self.login()
            other = self.app.test_client()
            other.post('/login', json={'employee_code': '0000000002', 'password': 'test-password'})
            other_info = other.get('/api/session').json
            self.client.set_cookie('app_access', access)
            self.client.set_cookie('app_refresh', refresh)
            self.assertEqual(self.client.get('/api/session').status_code, 401)
            self.assertEqual(self.client.post('/api/auth/refresh', json={}).status_code, 401)
            self.assertEqual(other.get('/api/session').json, other_info)

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
            session_id = store.create(active)
        deadline = 10000000 + DAYS_30
        self.assertEqual(json.loads(storage.data['session'])['jwt_key'], active.jwt_key)
        self.assertEqual(storage.alarm_at, deadline * 1000)
        self.assertEqual(json.loads(storage.data['session'])['expires_at'], deadline)
        recreated = worker.SessionObject(ctx, None)
        with patch.object(store, '_stub', return_value=recreated), \
                patch('app.infrastructure.durable_sessions._run', side_effect=asyncio.run), \
                patch('time.time', return_value=10000000):
            self.assertEqual(store.get(session_id).jwt_key, active.jwt_key)
            cases = ShiftUseCases(Mock(), store)
            self.assertEqual(cases.token_context(session_id), (active.jwt_key, deadline))
        for now in (10000000 + 3601, deadline - 1):
            with patch('time.time', return_value=now):
                self.assertEqual(json.loads(asyncio.run(recreated.read()))['expires_at'], deadline)
                asyncio.run(recreated.alarm())
                self.assertEqual(storage.alarm_at, deadline * 1000)
        with patch('time.time', return_value=deadline):
            self.assertIsNone(asyncio.run(recreated.read()))
        self.assertEqual(storage.data, {})
        self.assertIsNone(storage.alarm_at)
