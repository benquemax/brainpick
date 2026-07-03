"""Optional auth (spec/80): salted scrypt tokens + a password in .brainpick-auth.json.

Secrets never live in config or .brainpick/ — artifacts are disposable and
henxels hunts secrets. The file sits at the bundle root, holds salted hashes
only (scrypt N=16384 r=8 p=1, 32-byte key, 16-byte salt — identical in both
engines), is written 0600, and every CLI command that touches it teaches the
repo .gitignore the filename. Open-by-default stays first-class: no file, no
gate — and stdio MCP is never gated, it is local by construction.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from brainpick.core.fs import atomic_write
from brainpick.detect import find_repo_root

AUTH_FILE = ".brainpick-auth.json"

SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_KEY_LEN = 32
SCRYPT_SALT_LEN = 16
_SCRYPT_MAXMEM = 64 * 1024 * 1024  # headroom over the 16 MiB the parameters need

SESSION_COOKIE = "bp_session"
SESSION_TTL_SECONDS = 12 * 60 * 60  # spec/80: sessions expire after 12 h

AUTH_REQUIRED_ERROR = (
    "authentication required — send Authorization: Bearer <token> "
    "(create one: brainpick token create) or log in"
)
CORRUPT_AUTH_ERROR = f"{AUTH_FILE} is not valid JSON — fix or delete it, then rerun"

# The password gate for humans (spec/50): dark, on-brand, zero dependencies —
# it must render even when the auth gate withholds every other static asset.
LOGIN_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>brainpick — log in</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #04060c; color: #eaf6ff; font-family: system-ui, sans-serif; }
  form { width: min(20rem, 90vw); padding: 2rem; border: 1px solid rgba(75, 225, 255, 0.25);
         border-radius: 0.75rem; background: rgba(12, 20, 36, 0.55); text-align: center; }
  .mark { color: #4be1ff; letter-spacing: 0.2em; margin-bottom: 0.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
  p { color: #8ba3bd; font-size: 0.85rem; margin: 0 0 1.25rem; }
  input { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; margin-bottom: 0.75rem;
          border: 1px solid rgba(75, 225, 255, 0.35); border-radius: 0.5rem;
          background: rgba(4, 8, 16, 0.85); color: #eaf6ff; font-size: 1rem; }
  button { width: 100%; padding: 0.6rem; border: 0; border-radius: 0.5rem; background: #4be1ff;
           color: #04060c; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .error { color: #ff6b7a; margin: 0.75rem 0 0; display: none; }
</style></head>
<body>
<form id="login">
  <div class="mark">◉ ─── ◉ ─── ◉</div>
  <h1>brainpick</h1>
  <p>this brain asks for a password</p>
  <input type="password" name="password" placeholder="password" autocomplete="current-password" autofocus>
  <button type="submit">log in</button>
  <p class="error">wrong password — try again</p>
</form>
<script>
document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = event.target.elements.password.value;
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (response.status === 204) { location.reload(); return; }
  document.querySelector(".error").style.display = "block";
});
</script>
</body></html>
"""


@dataclass
class AuthStore:
    tokens: list[dict] = field(default_factory=list)
    password: dict | None = None
    session_secret: str = ""
    corrupt: bool = False  # unreadable file → fail closed, never silently open


def auth_path(root: str | Path) -> Path:
    return Path(root) / AUTH_FILE


def scrypt_hash(secret: str, salt: bytes) -> bytes:
    """The one KDF both engines share — parameters are part of the spec (spec/80)."""
    return hashlib.scrypt(secret.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R,
                          p=SCRYPT_P, maxmem=_SCRYPT_MAXMEM, dklen=SCRYPT_KEY_LEN)


def _hash_record(secret: str) -> dict:
    salt = secrets.token_bytes(SCRYPT_SALT_LEN)
    return {"algo": "scrypt", "salt": salt.hex(), "hash": scrypt_hash(secret, salt).hex()}


def _verify_hash(secret: str, record: object) -> bool:
    if not isinstance(record, dict) or record.get("algo") != "scrypt":
        return False
    try:
        salt = bytes.fromhex(str(record.get("salt", "")))
        expected = bytes.fromhex(str(record.get("hash", "")))
    except ValueError:
        return False
    if len(expected) != SCRYPT_KEY_LEN or not salt:
        return False
    return hmac.compare_digest(scrypt_hash(secret, salt), expected)


def load_auth(root: str | Path) -> AuthStore | None:
    """None when the file is absent (open); raises ValueError when it is corrupt."""
    path = auth_path(root)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(AUTH_FILE)
        tokens = data.get("tokens", [])
        password = data.get("password")
        if not isinstance(tokens, list) or (password is not None and not isinstance(password, dict)):
            raise ValueError(AUTH_FILE)
        return AuthStore(
            tokens=[record for record in tokens if isinstance(record, dict)],
            password=password,
            session_secret=str(data.get("session_secret", "")),
        )
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError(CORRUPT_AUTH_ERROR) from error


def save_auth(root: str | Path, store: AuthStore) -> None:
    """Atomic write, 0600 where meaningful; session_secret is minted on first save."""
    if not store.session_secret:
        store.session_secret = secrets.token_hex(32)
    data: dict = {"version": 1}
    if store.password is not None:
        data["password"] = store.password
    data["tokens"] = store.tokens
    data["session_secret"] = store.session_secret
    path = auth_path(root)
    atomic_write(path, (json.dumps(data, indent=2) + "\n").encode("utf-8"))
    if os.name == "posix":
        os.chmod(path, 0o600)


def auth_active(store: AuthStore | None) -> bool:
    """Enforcement switches on once tokens or a password exist (spec/80)."""
    return store is not None and bool(store.corrupt or store.tokens or store.password)


def _load_or_new(root: str | Path) -> AuthStore:
    return load_auth(root) or AuthStore()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def create_token(root: str | Path, name: str | None = None) -> tuple[str, str]:
    """Mint a token; returns (id, secret) — the secret is shown once, never stored."""
    store = _load_or_new(root)
    secret = "bp_" + secrets.token_hex(16)
    existing = {record.get("id") for record in store.tokens}
    token_id = "tk_" + secrets.token_hex(4)
    while token_id in existing:  # pragma: no cover - a 4-byte collision
        token_id = "tk_" + secrets.token_hex(4)
    record = {"id": token_id, "name": name, **_hash_record(secret), "created": _utc_now_iso()}
    store.tokens.append(record)
    save_auth(root, store)
    return token_id, secret


def list_tokens(root: str | Path) -> list[dict]:
    store = load_auth(root)
    return list(store.tokens) if store is not None else []


def revoke_token(root: str | Path, token_id: str) -> bool:
    store = load_auth(root)
    if store is None:
        return False
    kept = [record for record in store.tokens if record.get("id") != token_id]
    if len(kept) == len(store.tokens):
        return False
    store.tokens = kept
    save_auth(root, store)
    return True


def set_password(root: str | Path, password: str) -> None:
    store = _load_or_new(root)
    store.password = _hash_record(password)
    save_auth(root, store)


def clear_password(root: str | Path) -> bool:
    store = load_auth(root)
    if store is None or store.password is None:
        return False
    store.password = None
    save_auth(root, store)
    return True


def verify_token(store: AuthStore | None, secret: str) -> bool:
    """True when the secret matches any stored token hash."""
    if store is None or not secret:
        return False
    return any(_verify_hash(secret, record) for record in store.tokens)


def verify_password(store: AuthStore | None, password: str) -> bool:
    if store is None or store.password is None or not isinstance(password, str):
        return False
    return _verify_hash(password, store.password)


# -- sessions (HMAC-signed cookie, no server-side state) -----------------------------


def _session_mac(session_secret: str, expiry: int) -> str:
    key = bytes.fromhex(session_secret)
    return hmac.new(key, str(expiry).encode("ascii"), hashlib.sha256).hexdigest()


def make_session_cookie(store: AuthStore, now: float | None = None) -> str:
    """`<expiry>.<hexmac>` — expiry is unix seconds, MAC is HMAC-SHA256(session_secret)."""
    if not store.session_secret:
        raise ValueError("the auth store has no session_secret — save it once first")
    expiry = int(time.time() if now is None else now) + SESSION_TTL_SECONDS
    return f"{expiry}.{_session_mac(store.session_secret, expiry)}"


def verify_session(store: AuthStore | None, value: str, now: float | None = None) -> bool:
    if store is None or not store.session_secret or not value:
        return False
    expiry_text, sep, mac = value.partition(".")
    if not sep or not expiry_text.isascii() or not expiry_text.isdigit():
        return False
    expiry = int(expiry_text)
    if expiry <= int(time.time() if now is None else now):
        return False
    return hmac.compare_digest(_session_mac(store.session_secret, expiry), mac)


def session_cookie_header(store: AuthStore, now: float | None = None) -> str:
    value = make_session_cookie(store, now)
    return f"{SESSION_COOKIE}={value}; Max-Age={SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax"


def clear_session_cookie_header() -> str:
    return f"{SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"


class AuthProvider:
    """Reads .brainpick-auth.json lazily and reloads when the file changes, so
    token create/revoke takes effect on a running server without a restart."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self._sig: object = ("unset",)
        self._store: AuthStore | None = None

    def current(self) -> AuthStore | None:
        path = auth_path(self.root)
        try:
            st = path.stat()
            sig: object = (st.st_mtime_ns, st.st_size)
        except OSError:
            sig = None
        if sig != self._sig:
            self._sig = sig
            try:
                self._store = load_auth(self.root)
            except ValueError:
                self._store = AuthStore(corrupt=True)  # fail closed, never silently open
        return self._store


# -- gitignore hygiene ----------------------------------------------------------------


def ensure_gitignored(root: str | Path) -> Path | None:
    """Append .brainpick-auth.json to the repo .gitignore (when one exists) —
    secrets must never enter git. Returns the path it edited, or None."""
    repo = find_repo_root(root)
    if repo is None:
        return None
    gitignore = repo / ".gitignore"
    if not gitignore.is_file():
        return None
    text = gitignore.read_text(encoding="utf-8", errors="replace")
    if AUTH_FILE in text:
        return None
    glue = "" if text == "" or text.endswith("\n") else "\n"
    gitignore.write_text(text + glue + AUTH_FILE + "\n", encoding="utf-8")
    return gitignore


# -- CLI runners (henxels family voice: plain lines, every error an instruction) ------


def _resolve_bundle_root(root: str | Path) -> Path:
    """--root resolved the way serve resolves it: through [bundle] root (spec/80)."""
    from brainpick.config import load_config

    root = Path(root).resolve()
    config = load_config(root)
    return (root / config.bundle.root).resolve()


def _note_gitignore(root: Path) -> None:
    path = ensure_gitignored(root)
    if path is not None:
        print(f"gitignore: {AUTH_FILE} added to {path} (secrets stay off the record)")


def run_token_create(root: str | Path, name: str | None = None) -> int:
    root = _resolve_bundle_root(root)
    try:
        token_id, secret = create_token(root, name)
    except ValueError as error:
        print(error)
        return 1
    print(f"token created: {token_id} ({name if name else 'unnamed'})")
    print()
    print(f"  {secret}")
    print()
    print("store it now — only a salted hash is kept; the secret never prints again")
    _note_gitignore(root)
    return 0


def run_token_list(root: str | Path) -> int:
    root = _resolve_bundle_root(root)
    try:
        tokens = list_tokens(root)
    except ValueError as error:
        print(error)
        return 1
    if not tokens:
        print("no tokens yet — mint one: brainpick token create")
    for record in tokens:
        print(f"{record.get('id')}  {record.get('created')}  {record.get('name') or 'unnamed'}")
    _note_gitignore(root)
    return 0


def run_token_revoke(root: str | Path, token_id: str) -> int:
    root = _resolve_bundle_root(root)
    try:
        revoked = revoke_token(root, token_id)
    except ValueError as error:
        print(error)
        return 1
    if not revoked:
        print(f"no token '{token_id}' here — brainpick token list shows the ids")
        _note_gitignore(root)
        return 1
    print(f"token {token_id} revoked — it stops working immediately")
    _note_gitignore(root)
    return 0


def run_password_set(root: str | Path, use_stdin: bool = False) -> int:
    root = _resolve_bundle_root(root)
    if use_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:  # pragma: no cover - interactive TTY path; pipes use --stdin
        import getpass

        password = getpass.getpass("new password: ")
        if getpass.getpass("repeat it: ") != password:
            print("the two entries differ — nothing changed")
            return 1
    if not password:
        print("a password cannot be empty — nothing changed")
        return 1
    try:
        set_password(root, password)
    except ValueError as error:
        print(error)
        return 1
    print("password set — the web UI now asks for it (undo: brainpick password clear)")
    _note_gitignore(root)
    return 0


def run_password_clear(root: str | Path) -> int:
    root = _resolve_bundle_root(root)
    try:
        cleared = clear_password(root)
    except ValueError as error:
        print(error)
        return 1
    if cleared:
        print("password cleared — the web UI opens without a login")
    else:
        print("no password was set — nothing to clear")
    _note_gitignore(root)
    return 0
