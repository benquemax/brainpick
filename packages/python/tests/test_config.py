"""Config loading (spec/80): defaults, TOML values, env overrides, unknown-key warnings."""
import pytest

from brainpick.config import load_config


def test_defaults_when_absent(tmp_path):
    cfg = load_config(tmp_path)
    assert cfg.spec == "0.1"
    assert cfg.bundle.root == "."
    assert cfg.bundle.include == ["**/*.md"]
    assert cfg.bundle.exclude == []
    assert cfg.index.mode == "section"
    assert cfg.index.file == "index.md"
    assert cfg.serve.host == "127.0.0.1"
    assert cfg.serve.port == 4747
    assert cfg.serve.transports == ["streamable-http"]
    assert cfg.serve.watch is True
    assert cfg.serve.writes == "guarded"
    assert cfg.serve.token == ""
    assert cfg.validate.henxels == "auto"


def test_toml_values_override_defaults(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        'spec = "0.1"\n'
        "[serve]\n"
        "port = 5757\n"
        "watch = false\n"
        'writes = "off"\n'
        'transports = ["streamable-http", "sse"]\n'
        "[validate]\n"
        'henxels = "never"\n',
        encoding="utf-8",
    )
    cfg = load_config(tmp_path)
    assert cfg.serve.port == 5757
    assert cfg.serve.watch is False
    assert cfg.serve.writes == "off"
    assert cfg.serve.transports == ["streamable-http", "sse"]
    assert cfg.validate.henxels == "never"
    assert cfg.serve.host == "127.0.0.1"  # untouched keys keep their defaults


def test_env_overrides_beat_toml(tmp_path):
    (tmp_path / "brainpick.toml").write_text("[serve]\nport = 5757\n", encoding="utf-8")
    cfg = load_config(tmp_path, env={
        "BRAINPICK_SERVE_PORT": "6868",
        "BRAINPICK_SERVE_WATCH": "false",
        "BRAINPICK_SERVE_TOKEN": "s3cret",
        "BRAINPICK_SERVE_TRANSPORTS": "streamable-http,sse",
    })
    assert cfg.serve.port == 6868
    assert cfg.serve.watch is False
    assert cfg.serve.token == "s3cret"
    assert cfg.serve.transports == ["streamable-http", "sse"]


def test_unknown_keys_warn_not_error(tmp_path):
    (tmp_path / "brainpick.toml").write_text("[serve]\nfancy = true\n[future]\nx = 1\n", encoding="utf-8")
    with pytest.warns(UserWarning):
        cfg = load_config(tmp_path)
    assert cfg.serve.port == 4747  # the file still loads and serves defaults


def test_bundle_root_indirection(tmp_path):
    (tmp_path / "brainpick.toml").write_text('[bundle]\nroot = "docs"\n', encoding="utf-8")
    cfg = load_config(tmp_path)
    assert cfg.bundle.root == "docs"
