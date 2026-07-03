"""Auth (spec/80): scrypt token/password store, HMAC session cookies, gitignore hygiene.

The pinned scrypt vector is the cross-engine contract: packages/node/test/auth.test.ts
asserts the SAME hex — one KDF, two runtimes, byte-identical hashes.
"""
import json
import os
import stat

import pytest

from brainpick.auth import (
    AUTH_FILE,
    AuthProvider,
    AuthStore,
    auth_path,
    auth_active,
    clear_password,
    create_token,
    ensure_gitignored,
    list_tokens,
    load_auth,
    make_session_cookie,
    revoke_token,
    scrypt_hash,
    set_password,
    verify_password,
    verify_session,
    verify_token,
)

# Computed once with hashlib.scrypt AND node:crypto scryptSync (N=16384 r=8 p=1,
# dklen=32) — pinned literally in both suites so the engines can never drift.
PINNED_SCRYPT_PASSWORD = "kotiaurinko"
PINNED_SCRYPT_SALT_HEX = "000102030405060708090a0b0c0d0e0f"
PINNED_SCRYPT_HEX = "80608aa957eedae8f1b922e3bf1ed3ede04db92345065a02ea4cf7081d2ece06"


def test_scrypt_pinned_vector_matches_both_engines():
    salt = bytes.fromhex(PINNED_SCRYPT_SALT_HEX)
    assert scrypt_hash(PINNED_SCRYPT_PASSWORD, salt).hex() == PINNED_SCRYPT_HEX


def test_token_create_round_trip(tmp_path):
    token_id, secret = create_token(tmp_path, name="hermes")
    assert token_id.startswith("tk_") and len(token_id) == 11
    assert secret.startswith("bp_") and len(secret) == 35

    data = json.loads(auth_path(tmp_path).read_text(encoding="utf-8"))
    assert data["version"] == 1
    (record,) = data["tokens"]
    assert record["id"] == token_id
    assert record["name"] == "hermes"
    assert record["algo"] == "scrypt"
    assert len(record["salt"]) == 32 and len(record["hash"]) == 64  # hex16 salt, hex32 key
    assert secret not in json.dumps(data)  # only the salted hash is stored
    assert record["created"].endswith("Z")

    store = load_auth(tmp_path)
    assert verify_token(store, secret)
    assert not verify_token(store, "bp_" + "0" * 32)
    assert not verify_token(store, "")


def test_token_verify_checks_all_stored_tokens(tmp_path):
    _, first = create_token(tmp_path, name="eka")
    _, second = create_token(tmp_path)
    store = load_auth(tmp_path)
    assert len(store.tokens) == 2
    assert verify_token(store, first)
    assert verify_token(store, second)


def test_token_revoke(tmp_path):
    first_id, first_secret = create_token(tmp_path, name="eka")
    _, second_secret = create_token(tmp_path, name="toka")
    assert revoke_token(tmp_path, first_id)
    assert [record["name"] for record in list_tokens(tmp_path)] == ["toka"]
    store = load_auth(tmp_path)
    assert not verify_token(store, first_secret)  # revoked stops working immediately
    assert verify_token(store, second_secret)
    assert not revoke_token(tmp_path, first_id)  # already gone
    assert not revoke_token(tmp_path, "tk_olematon")


def test_password_set_verify_clear(tmp_path):
    set_password(tmp_path, "kotiaurinko")
    store = load_auth(tmp_path)
    assert store.password is not None
    assert verify_password(store, "kotiaurinko")
    assert not verify_password(store, "väärä")
    assert not verify_password(store, "")
    assert clear_password(tmp_path)
    assert load_auth(tmp_path).password is None
    assert not verify_password(load_auth(tmp_path), "kotiaurinko")
    assert not clear_password(tmp_path)  # nothing left to clear


def test_session_cookie_expiry_and_tamper(tmp_path):
    set_password(tmp_path, "kotiaurinko")
    store = load_auth(tmp_path)
    value = make_session_cookie(store, now=1_000_000)
    expiry_text, _, mac = value.partition(".")
    assert expiry_text == str(1_000_000 + 12 * 3600)  # 12 h expiry (spec/80)
    assert len(mac) == 64

    assert verify_session(store, value, now=1_000_000)
    assert not verify_session(store, value, now=1_000_000 + 12 * 3600)  # expired
    assert not verify_session(store, f"{expiry_text}.{'0' * 64}", now=1_000_000)  # tampered
    assert not verify_session(store, f"{int(expiry_text) + 1}.{mac}", now=1_000_000)
    for garbage in ("", "kissa", "123", "123.", ".abc", "12a3.ffff"):
        assert not verify_session(store, garbage, now=1_000_000)
    assert not verify_session(None, value, now=1_000_000)
    assert not verify_session(AuthStore(), value, now=1_000_000)  # no session_secret


def test_session_secret_minted_once_and_stable(tmp_path):
    create_token(tmp_path)
    first = load_auth(tmp_path).session_secret
    assert len(first) == 64  # hex32
    set_password(tmp_path, "salasana")
    assert load_auth(tmp_path).session_secret == first  # stable across saves


def test_auth_active_semantics(tmp_path):
    assert not auth_active(None)
    assert not auth_active(AuthStore())
    assert auth_active(AuthStore(tokens=[{"id": "tk_x"}]))
    assert auth_active(AuthStore(password={"algo": "scrypt"}))
    assert auth_active(AuthStore(corrupt=True))  # unreadable file fails closed
    # a fully emptied store (all tokens revoked, password cleared) opens back up
    token_id, _ = create_token(tmp_path)
    revoke_token(tmp_path, token_id)
    assert not auth_active(load_auth(tmp_path))


def test_load_auth_absent_and_corrupt(tmp_path):
    assert load_auth(tmp_path) is None
    auth_path(tmp_path).write_text("not json {", encoding="utf-8")
    with pytest.raises(ValueError):
        load_auth(tmp_path)


@pytest.mark.skipif(os.name != "posix", reason="POSIX file modes")
def test_auth_file_is_owner_only(tmp_path):
    create_token(tmp_path)
    mode = stat.S_IMODE(auth_path(tmp_path).stat().st_mode)
    assert mode == 0o600


def test_provider_reloads_on_change(tmp_path):
    provider = AuthProvider(tmp_path)
    assert provider.current() is None
    token_id, secret = create_token(tmp_path)
    assert verify_token(provider.current(), secret)  # picked up without a restart
    revoke_token(tmp_path, token_id)
    assert not verify_token(provider.current(), secret)
    auth_path(tmp_path).write_text("broken {", encoding="utf-8")
    assert provider.current().corrupt  # fail closed, never silently open


def test_ensure_gitignored_appends_once(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    gitignore = repo / ".gitignore"
    gitignore.write_text("node_modules/", encoding="utf-8")  # no trailing newline
    bundle = repo / "wiki"
    bundle.mkdir()
    assert ensure_gitignored(bundle) == gitignore
    assert gitignore.read_text(encoding="utf-8") == f"node_modules/\n{AUTH_FILE}\n"
    assert ensure_gitignored(bundle) is None  # idempotent
    assert gitignore.read_text(encoding="utf-8") == f"node_modules/\n{AUTH_FILE}\n"


def test_ensure_gitignored_without_repo_or_file(tmp_path):
    lone = tmp_path / "lone"
    lone.mkdir()
    assert ensure_gitignored(lone) is None
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    assert ensure_gitignored(repo) is None  # a repo without .gitignore is left alone
