from dataclasses import dataclass, field
from threading import RLock
import secrets
from typing import Dict, Tuple

from app.domain.models import ShiftMonth, Viewer

from .ports import ScheduleConnection


@dataclass
class ActiveSession:
    viewer: Viewer
    connection: ScheduleConnection
    cache: Dict[Tuple[int, int], Tuple[float, ShiftMonth]] = field(default_factory=dict)
    lock: RLock = field(default_factory=RLock)
    month_metadata: dict = field(default_factory=dict)
    cache_scope: str = field(default_factory=lambda: secrets.token_hex(16))
    expires_at: float = 0
    closed: bool = False

    def close(self) -> None:
        # Mark revoked before waiting for a fetch holding the session lock.
        self.closed = True
        with self.lock:
            self.cache.clear()
            self.month_metadata.clear()
            self.connection.close()
