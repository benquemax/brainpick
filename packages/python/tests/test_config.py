"""Config loading (spec/80): defaults, TOML values, layering, env overrides,
unknown-key warnings."""
import pytest

from brainpick.config import config_layers, load_config


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


def test_modules_and_embedding_defaults(tmp_path):
    cfg = load_config(tmp_path)
    assert cfg.modules.vectors == "auto"
    assert cfg.modules.graph == "off"
    assert cfg.modules.ui is True
    assert cfg.models.embedding.kind == ""
    assert cfg.models.embedding.endpoint == ""
    assert cfg.models.embedding.model == ""
    assert cfg.models.embedding.dim == 0


def test_modules_and_embedding_from_toml(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        "[modules]\n"
        'vectors = "on"\n'
        "[models.embedding]\n"
        'kind = "ollama"\n'
        'endpoint = "http://127.0.0.1:11434"\n'
        'model = "nomic-embed-text"\n'
        "dim = 768\n",
        encoding="utf-8",
    )
    cfg = load_config(tmp_path)
    assert cfg.modules.vectors == "on"
    assert cfg.models.embedding.kind == "ollama"
    assert cfg.models.embedding.endpoint == "http://127.0.0.1:11434"
    assert cfg.models.embedding.model == "nomic-embed-text"
    assert cfg.models.embedding.dim == 768


def test_embedding_env_overrides(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        '[models.embedding]\nkind = "ollama"\nmodel = "nomic-embed-text"\n', encoding="utf-8",
    )
    cfg = load_config(tmp_path, env={
        "BRAINPICK_MODULES_VECTORS": "off",
        "BRAINPICK_MODELS_EMBEDDING_KIND": "mock",
    })
    assert cfg.modules.vectors == "off"
    assert cfg.models.embedding.kind == "mock"


def test_unknown_embedding_keys_warn_not_error(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        "[models.embedding]\nturbo = true\n[models.future]\nx = 1\n", encoding="utf-8",
    )
    with pytest.warns(UserWarning):
        cfg = load_config(tmp_path)
    assert cfg.models.embedding.kind == ""


# -- layering: brainpick.local.toml deep-merges over brainpick.toml (spec/80) --------


def test_local_layer_deep_merges_over_shared(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        "[serve]\nport = 5757\n"
        'token = "shared-token"\n'
        "[models.embedding]\n"
        'kind = "ollama"\n'
        "dim = 768\n",
        encoding="utf-8",
    )
    (tmp_path / "brainpick.local.toml").write_text(
        "[serve]\nport = 6868\n"
        "[models.embedding]\n"
        'endpoint = "http://ferocitee:11434"\n'
        'model = "nomic-embed-text"\n',
        encoding="utf-8",
    )
    cfg = load_config(tmp_path)
    assert cfg.serve.port == 6868                      # local scalar replaces shared
    assert cfg.serve.token == "shared-token"           # untouched shared keys survive
    assert cfg.models.embedding.kind == "ollama"       # tables merge recursively
    assert cfg.models.embedding.dim == 768
    assert cfg.models.embedding.endpoint == "http://ferocitee:11434"
    assert cfg.models.embedding.model == "nomic-embed-text"


def test_local_layer_alone_is_enough(tmp_path):
    (tmp_path / "brainpick.local.toml").write_text(
        '[models.embedding]\nkind = "mock"\n', encoding="utf-8",
    )
    cfg = load_config(tmp_path)
    assert cfg.models.embedding.kind == "mock"
    assert cfg.serve.port == 4747  # everything else stays default


def test_local_layer_lists_replace_wholesale(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        '[serve]\ntransports = ["streamable-http"]\n', encoding="utf-8",
    )
    (tmp_path / "brainpick.local.toml").write_text(
        '[serve]\ntransports = ["sse"]\n', encoding="utf-8",
    )
    assert load_config(tmp_path).serve.transports == ["sse"]  # replaced, not extended


def test_env_still_beats_the_local_layer(tmp_path):
    (tmp_path / "brainpick.local.toml").write_text("[serve]\nport = 6868\n", encoding="utf-8")
    cfg = load_config(tmp_path, env={"BRAINPICK_SERVE_PORT": "7979"})
    assert cfg.serve.port == 7979


def test_broken_local_layer_warns_and_shared_still_applies(tmp_path):
    (tmp_path / "brainpick.toml").write_text("[serve]\nport = 5757\n", encoding="utf-8")
    (tmp_path / "brainpick.local.toml").write_text("not = [toml\n", encoding="utf-8")
    with pytest.warns(UserWarning, match="brainpick.local.toml"):
        cfg = load_config(tmp_path)
    assert cfg.serve.port == 5757


def test_config_layers_lists_what_was_found(tmp_path):
    assert config_layers(tmp_path) == []
    (tmp_path / "brainpick.local.toml").write_text("", encoding="utf-8")
    assert [p.name for p in config_layers(tmp_path)] == ["brainpick.local.toml"]
    (tmp_path / "brainpick.toml").write_text("", encoding="utf-8")
    assert [p.name for p in config_layers(tmp_path)] == ["brainpick.toml", "brainpick.local.toml"]


# -- [models.extraction] (spec/80): the chat model that doubles as merge resolver ----


def test_extraction_defaults_empty(tmp_path):
    extraction = load_config(tmp_path).models.extraction
    assert extraction.kind == ""
    assert extraction.endpoint == ""
    assert extraction.model == ""
    assert extraction.api_key_env == ""


def test_extraction_from_toml_and_env(tmp_path):
    (tmp_path / "brainpick.local.toml").write_text(
        "[models.extraction]\n"
        'kind = "openai-compatible"\n'
        'endpoint = "http://127.0.0.1:1234/v1"\n'
        'model = "qwen3.5-4b"\n'
        'api_key_env = "LMSTUDIO_KEY"\n',
        encoding="utf-8",
    )
    extraction = load_config(tmp_path).models.extraction
    assert extraction.kind == "openai-compatible"
    assert extraction.endpoint == "http://127.0.0.1:1234/v1"
    assert extraction.model == "qwen3.5-4b"
    assert extraction.api_key_env == "LMSTUDIO_KEY"
    overridden = load_config(tmp_path, env={"BRAINPICK_MODELS_EXTRACTION_KIND": "mock"})
    assert overridden.models.extraction.kind == "mock"


def test_unknown_extraction_keys_warn_not_error(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        "[models.extraction]\nturbo = true\n", encoding="utf-8",
    )
    with pytest.warns(UserWarning):
        cfg = load_config(tmp_path)
    assert cfg.models.extraction.kind == ""
