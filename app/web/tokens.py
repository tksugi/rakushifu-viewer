"""First-party JWT cookies. Signing keys remain in the revocable server session."""

import hashlib
import hmac
import re
import secrets
import time

import jwt
from flask import current_app, request

from app.application.errors import SessionExpired


ISSUER = "rakushifu-viewer"
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{43}$")


def _cases():
    return current_app.extensions["shift_use_cases"]


def _key(secret, kind):
    # Separate keys as well as audiences/types prevent token substitution.
    return hmac.digest(secret.encode(), ("jwt:" + kind).encode(), hashlib.sha256)


def cookie_name(kind):
    return current_app.config[f"APP_{kind.upper()}_COOKIE_NAME"]


def verify(kind):
    encoded = request.cookies.get(cookie_name(kind), "")
    if not encoded or len(encoded) > 4096:
        return ""
    try:
        # Untrusted subject is only a bounded lookup hint, never authorization.
        hint = jwt.decode(encoded, options={"verify_signature": False})
        subject = hint.get("sub")
        if not isinstance(subject, str) or not SESSION_ID.fullmatch(subject):
            return ""
        secret, deadline = _cases().token_context(subject)
        claims = jwt.decode(
            encoded, _key(secret, kind), algorithms=["HS256"],
            issuer=ISSUER, audience=f"{ISSUER}:{kind}",
            options={"require": ["sub", "iss", "aud", "iat", "exp", "jti", "token_use"]},
        )
        if (jwt.get_unverified_header(encoded).get("typ") != f"{kind}+jwt"
                or claims["token_use"] != kind
                or type(claims["iat"]) is not int or type(claims["exp"]) is not int
                or claims["exp"] <= claims["iat"] or claims["exp"] > int(deadline)):
            return ""
        maximum = (current_app.config["APP_ACCESS_SECONDS"] if kind == "access"
                   else current_app.config["APP_SESSION_SECONDS"])
        if claims["exp"] - claims["iat"] > maximum:
            return ""
        return subject
    except (jwt.InvalidTokenError, SessionExpired, TypeError, ValueError):
        return ""


def issue_access(response, subject):
    secret, deadline = _cases().token_context(subject)
    _issue(response, subject, secret, deadline, "access")


def issue_pair(response, subject):
    secret, deadline = _cases().token_context(subject)
    _issue(response, subject, secret, deadline, "access")
    _issue(response, subject, secret, deadline, "refresh")
    # Old opaque cookies are not accepted as access or refresh credentials.
    response.delete_cookie(current_app.config["APP_COOKIE_NAME"], path="/")


def _issue(response, subject, secret, deadline, kind):
    now = int(time.time())
    expires = int(deadline)
    if kind == "access":
        expires = min(expires, now + current_app.config["APP_ACCESS_SECONDS"])
    if expires <= now:
        raise SessionExpired("ログインが必要です")
    encoded = jwt.encode({
        "sub": subject, "iss": ISSUER, "aud": f"{ISSUER}:{kind}",
        "iat": now, "exp": expires, "jti": secrets.token_urlsafe(24), "token_use": kind,
    }, _key(secret, kind), algorithm="HS256", headers={"typ": f"{kind}+jwt"})
    response.set_cookie(
        cookie_name(kind), encoded, max_age=expires - now,
        httponly=True, secure=current_app.config["APP_COOKIE_SECURE"],
        samesite="Lax", path="/",
    )


def clear(response):
    for name in (cookie_name("access"), cookie_name("refresh"),
                 current_app.config["APP_COOKIE_NAME"]):
        response.delete_cookie(name, path="/", httponly=True,
                               secure=current_app.config["APP_COOKIE_SECURE"], samesite="Lax")
    return response
