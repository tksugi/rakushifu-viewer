from .session import ActiveSession
from .use_cases import ShiftUseCases


class SampleUseCases(ShiftUseCases):
    """Reuse viewing/calculation with fresh synthetic data and no session store."""

    def __init__(self, connection_factory):
        super().__init__(authenticator=None, sessions=None)
        self.connection_factory = connection_factory

    def _active(self, token):
        connection = self.connection_factory()
        return ActiveSession(viewer=connection.viewer, connection=connection)
