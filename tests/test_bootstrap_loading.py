from html.parser import HTMLParser
from unittest import TestCase
from unittest.mock import Mock

from app import create_app


class InitialPage(HTMLParser):
    """Inspect what can be painted before any JavaScript executes."""

    def __init__(self):
        super().__init__()
        self.stack = []
        self.visible_text = []
        self.status_labels = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if attributes.get("role") == "status":
            self.status_labels.append(attributes.get("aria-label", ""))
        if tag not in {"meta", "link", "input", "br", "hr", "img"}:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.stack:
            while self.stack.pop() != tag:
                pass

    def handle_data(self, value):
        if ("body" in self.stack
                and not {"noscript", "script", "style"}.intersection(self.stack)
                and value.strip()):
            self.visible_text.append(value.strip())


class BootstrapLoadingTests(TestCase):
    def test_initial_html_only_shows_a_loader_before_react_in_both_modes(self):
        for environment in ("test", "production"):
            for path in ("/sample", "/login", "/"):
                with self.subTest(environment=environment, path=path):
                    cases = Mock()
                    cases.authenticated.return_value = path == "/"
                    app = create_app(
                        {"APP_ENV": environment, "TESTING": True}, cases,
                        worker_runtime=True,
                    )
                    response = app.test_client().get(path)
                    self.assertEqual(response.status_code, 200)
                    page = InitialPage()
                    page.feed(response.get_data(as_text=True))
                    self.assertEqual(page.visible_text, [])
                    self.assertTrue(page.status_labels)
                    self.assertTrue(all(page.status_labels))
