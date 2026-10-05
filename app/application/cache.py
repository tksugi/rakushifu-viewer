"""Request-local cache observations, independent of the HTTP framework."""

from contextlib import contextmanager
from contextvars import ContextVar
import secrets
import time


_observation = ContextVar("month_cache_observation", default=None)


def cache_metadata(seconds):
    now = time.time()
    return {"fetched_at": now, "expires_at": now + seconds,
            "revision": secrets.token_hex(16)}


def observe_month(active, metadata):
    observation = _observation.get()
    if observation is not None:
        observation.update(metadata, scope=active.cache_scope)


@contextmanager
def capture_month():
    observation = {}
    token = _observation.set(observation)
    try:
        yield observation
    finally:
        _observation.reset(token)
