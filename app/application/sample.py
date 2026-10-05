from .session import ActiveSession
from .use_cases import ShiftUseCases
from .cache import observe_month
import time


class SampleUseCases(ShiftUseCases):
    """Reuse viewing/calculation with fresh synthetic data and no session store."""

    def __init__(self, connection_factory, cache_seconds=120):
        super().__init__(authenticator=None, sessions=None, cache_seconds=cache_seconds)
        self.connection_factory = connection_factory

    def _active(self, token):
        connection = self.connection_factory()
        return ActiveSession(viewer=connection.viewer, connection=connection,
                             cache_scope="sample")

    def session_info(self, token):
        return {"scope": "sample", "user_id": self._active(token).viewer.staff_id,
                "expires_in": None}

    def _month(self, active, year, month):
        result = super()._month(active, year, month)
        # Synthetic data is deterministic; share a freshness window across APIs
        # without introducing a session store or touching real account state.
        seconds = self.cache_seconds
        fetched = (time.time() // seconds * seconds) if seconds > 0 else time.time()
        observe_month(active, {"fetched_at": fetched, "expires_at": fetched + seconds,
                               "revision": f"sample-{year}-{month}-{fetched}"})
        return result
