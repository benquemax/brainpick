"""init/doctor choreography (docs/onboarding.md): detect, propose, compile, glow —
config written once and never clobbered, every error an instruction, dry-run inert."""
import warnings
from pathlib import Path

from brainpick.config import load_config
from brainpick.detect import Backend
from brainpick.scaffold import run_doctor, run_init

NO_BACKENDS = [("ollama", None), ("lm studio", None), ("llama.cpp", None)]
OLLAMA_FOUND = [
    ("ollama", Backend("ollama", "http://127.0.0.1:11434", "nomic-embed-text:latest")),
    ("lm studio", None),
    ("llama.cpp", None),
]


def typed_bundle(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    for name in ("yksi", "kaksi", "kolme"):
        (root / f"{name}.md").write_text(
            f"---\ntype: Concept\ntitle: {name}\ndescription: doc {name}\n---\n\n"
            f"# {name}\n\nSee [yksi](yksi.md).\n",
            encoding="utf-8",
        )
    return root


# -- init --------------------------------------------------------------------------


def test_init_full_choreography(kotiaurinko, capsys):
    assert run_init(kotiaurinko, env={}, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out

    config_path = kotiaurinko / "brainpick.toml"
    assert config_path.is_file()
    config_text = config_path.read_text(encoding="utf-8")
    assert 'vectors = "auto"' in config_text
    assert "[models.embedding]" not in config_text
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        load_config(kotiaurinko)
    assert caught == []  # the template must be fully known to the loader

    assert (kotiaurinko / ".brainpick" / "manifest.json").is_file()
    assert (kotiaurinko / ".brainpick" / "t1" / "graph.json").is_file()
    assert "10 docs" in out
    assert "your brain, compiled" in out

    import brainpick.scaffold as scaffold_module

    project = Path(scaffold_module.__file__).resolve().parents[2]
    assert str(project) in out  # the MCP snippet points at this checkout
    assert str(kotiaurinko.resolve()) in out
    assert "claude mcp add brainpick" in out
    assert '"mcpServers"' in out
    assert '"type": "local"' in out  # the opencode block
    assert "uvx brainpick mcp" in out  # the once-published note
    assert "Serve the brain:" in out
    assert "--open" in out


def test_init_never_clobbers_an_existing_config(kotiaurinko, capsys):
    marker = '# hand-tuned\nspec = "0.1"\n'
    (kotiaurinko / "brainpick.toml").write_text(marker, encoding="utf-8")
    assert run_init(kotiaurinko, env={}, probes=OLLAMA_FOUND) == 0
    out = capsys.readouterr().out
    assert (kotiaurinko / "brainpick.toml").read_text(encoding="utf-8") == marker
    assert "left untouched" in out
    # the machine-local layer is independent: the detected backend still lands there
    local = (kotiaurinko / "brainpick.local.toml").read_text(encoding="utf-8")
    assert 'kind = "ollama"' in local


def test_init_never_clobbers_an_existing_local_config(kotiaurinko, capsys):
    marker = '# hand-tuned\n[models.embedding]\nkind = "mock"\n'
    (kotiaurinko / "brainpick.local.toml").write_text(marker, encoding="utf-8")
    assert run_init(kotiaurinko, env={}, probes=OLLAMA_FOUND) == 0
    out = capsys.readouterr().out
    assert (kotiaurinko / "brainpick.local.toml").read_text(encoding="utf-8") == marker
    assert "brainpick.local.toml exists" in out
    assert "pin the detected backend yourself" in out


def test_init_dry_run_writes_nothing(kotiaurinko, capsys):
    index_before = (kotiaurinko / "index.md").read_text(encoding="utf-8")
    assert run_init(kotiaurinko, dry_run=True, env={}, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out
    assert "dry run" in out
    assert not (kotiaurinko / "brainpick.toml").exists()
    assert not (kotiaurinko / ".brainpick").exists()
    assert (kotiaurinko / "index.md").read_text(encoding="utf-8") == index_before


def test_init_empty_dir_hands_the_scaffold_to_henxels(tmp_path, capsys):
    empty = tmp_path / "tyhja"
    empty.mkdir()
    assert run_init(empty, env={}, probes=NO_BACKENDS) == 1
    out = capsys.readouterr().out
    assert "uv tool install henxels" in out
    assert "henxels init --template okf-llm-wiki --wiki-dir ." in out
    assert list(empty.iterdir()) == []  # never reimplement the wiki template


def test_init_missing_root_is_an_instruction(tmp_path, capsys):
    assert run_init(tmp_path / "olematon", env={}, probes=NO_BACKENDS) == 1
    assert "olematon" in capsys.readouterr().out


def test_init_records_a_detected_backend_in_the_local_layer(kotiaurinko, capsys):
    assert run_init(kotiaurinko, env={}, probes=OLLAMA_FOUND) == 0
    out = capsys.readouterr().out
    # personal endpoints never land in the shared, committable file (spec/80)
    shared = (kotiaurinko / "brainpick.toml").read_text(encoding="utf-8")
    assert "[models.embedding]" not in shared
    assert "http://127.0.0.1:11434" not in shared
    local = (kotiaurinko / "brainpick.local.toml").read_text(encoding="utf-8")
    assert "[models.embedding]" in local
    assert 'kind = "ollama"' in local
    assert 'endpoint = "http://127.0.0.1:11434"' in local
    assert 'model = "nomic-embed-text:latest"' in local
    assert "nomic-embed-text" in out
    assert "brainpick.local.toml" in out
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        cfg = load_config(kotiaurinko)
    assert caught == []  # both templates must be fully known to the loader
    assert cfg.models.embedding.kind == "ollama"  # the layers merge into one config


def test_init_offers_the_pull_when_ollama_is_modelless(kotiaurinko, capsys):
    probes = [("ollama", Backend("ollama", "http://127.0.0.1:11434", None)),
              ("lm studio", None), ("llama.cpp", None)]
    assert run_init(kotiaurinko, env={}, probes=probes) == 0
    out = capsys.readouterr().out
    assert "ollama pull nomic-embed-text" in out
    assert "[models.embedding]" not in (kotiaurinko / "brainpick.toml").read_text(encoding="utf-8")
    assert not (kotiaurinko / "brainpick.local.toml").exists()  # nothing local to record


def test_init_openai_key_stays_opt_in_without_yes(kotiaurinko, capsys):
    env = {"OPENAI_API_KEY": "sk-test"}
    assert run_init(kotiaurinko, env=env, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out
    assert "OPENAI_API_KEY" in out
    assert "--yes" in out  # the instruction to opt in
    assert "[models.embedding]" not in (kotiaurinko / "brainpick.toml").read_text(encoding="utf-8")
    assert not (kotiaurinko / "brainpick.local.toml").exists()


def test_init_openai_key_recorded_with_yes(kotiaurinko):
    env = {"OPENAI_API_KEY": "sk-test"}
    assert run_init(kotiaurinko, yes=True, env=env, probes=NO_BACKENDS) == 0
    assert "[models.embedding]" not in (kotiaurinko / "brainpick.toml").read_text(encoding="utf-8")
    local = (kotiaurinko / "brainpick.local.toml").read_text(encoding="utf-8")
    assert 'kind = "openai"' in local


def test_init_suggests_gitignore_lines_without_editing(tmp_path, capsys):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    gitignore = repo / ".gitignore"
    gitignore.write_text("node_modules/\n", encoding="utf-8")
    bundle = typed_bundle(repo / "wiki")
    assert run_init(bundle, env={}, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out
    assert ".brainpick/" in out
    assert "brainpick.local.toml" in out  # the machine-local layer stays personal
    assert gitignore.read_text(encoding="utf-8") == "node_modules/\n"  # suggested, not edited


def test_init_suggests_only_the_missing_gitignore_line(tmp_path, capsys):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / ".gitignore").write_text(".brainpick/\n", encoding="utf-8")
    bundle = typed_bundle(repo / "wiki")
    assert run_init(bundle, env={}, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out
    assert "brainpick.local.toml" in out
    assert ".brainpick/" not in out  # only the missing line is suggested


def test_init_skips_gitignore_suggestion_when_covered(tmp_path, capsys):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / ".gitignore").write_text(".brainpick/\n**/brainpick.local.toml\n", encoding="utf-8")
    bundle = typed_bundle(repo / "wiki")
    assert run_init(bundle, env={}, probes=NO_BACKENDS) == 0
    assert ".gitignore" not in capsys.readouterr().out


def test_init_prints_the_henxels_freshness_gate(kotiaurinko, capsys):
    (kotiaurinko / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    assert run_init(kotiaurinko, env={}, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out
    assert "run_before_commit:" in out
    assert "why:" in out
    assert "compile --check-fresh" in out
    assert (kotiaurinko / "henxels.yaml").read_text(encoding="utf-8") == "henxels: []\n"


# -- doctor ------------------------------------------------------------------------


def test_doctor_happy_table_exits_zero(kotiaurinko, capsys):
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out
    assert "✗" not in out
    assert "config: brainpick.toml parses" in out
    assert "bundle: OKF (10 docs)" in out
    assert "artifacts: fresh (seq 1)" in out
    assert "ollama: not reachable" in out
    assert "node engine" in out  # either the sibling checkout or the arrives-in-M2 note


def test_doctor_vectors_line_walks_the_states(kotiaurinko, capsys):
    from brainpick.compile.pipeline import run_compile

    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    capsys.readouterr()
    run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS)
    assert "vectors: no [models.embedding]" in capsys.readouterr().out

    (kotiaurinko / "brainpick.toml").write_text('[models.embedding]\nkind = "mock"\n',
                                                encoding="utf-8")
    run_compile(kotiaurinko)
    capsys.readouterr()
    run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS)
    out = capsys.readouterr().out
    assert "vectors: t2 fresh" in out
    assert "mock" in out


def test_doctor_vectors_line_names_the_missing_extra(kotiaurinko, capsys, monkeypatch):
    monkeypatch.setattr("brainpick.scaffold.lancedb_available", lambda: False)
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    (kotiaurinko / "brainpick.toml").write_text('[models.embedding]\nkind = "mock"\n',
                                                encoding="utf-8")
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 0  # optional, never a failure
    assert "brainpick[vectors]" in capsys.readouterr().out


def test_doctor_reports_every_config_layer(kotiaurinko, capsys):
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    (kotiaurinko / "brainpick.local.toml").write_text(
        '[models.embedding]\nkind = "mock"\n', encoding="utf-8",
    )
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 0
    out = capsys.readouterr().out
    assert "config: brainpick.toml parses" in out
    assert "brainpick.local.toml parses" in out
    assert "machine-local" in out


def test_doctor_broken_local_layer_fails_with_instruction(kotiaurinko, capsys):
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    (kotiaurinko / "brainpick.local.toml").write_text("not = [toml\n", encoding="utf-8")
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 1
    out = capsys.readouterr().out
    assert "config: brainpick.toml parses" in out  # the healthy layer still reports
    assert "✗ config: brainpick.local.toml" in out


def test_doctor_defaults_apply_without_config(kotiaurinko, capsys):
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    (kotiaurinko / "brainpick.toml").unlink()
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 0
    assert "defaults apply" in capsys.readouterr().out


def test_doctor_missing_artifacts_is_an_instruction(kotiaurinko, capsys):
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 1
    out = capsys.readouterr().out
    assert "✗ artifacts: never compiled" in out
    assert "brainpick compile" in out


def test_doctor_stale_artifacts_fail(kotiaurinko, capsys):
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    kuu = kotiaurinko / "kuu.md"
    kuu.write_text(kuu.read_text(encoding="utf-8") + "\nUutta tekstiä.\n", encoding="utf-8")
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 1
    assert "✗ artifacts: stale" in capsys.readouterr().out


def test_doctor_broken_toml_fails_with_instruction(kotiaurinko, capsys):
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    (kotiaurinko / "brainpick.toml").write_text("not = [toml\n", encoding="utf-8")
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=NO_BACKENDS) == 1
    out = capsys.readouterr().out
    assert "✗ config" in out


def test_doctor_reports_found_backends(kotiaurinko, capsys):
    run_init(kotiaurinko, env={}, probes=NO_BACKENDS)
    capsys.readouterr()
    assert run_doctor(kotiaurinko, env={}, probes=OLLAMA_FOUND) == 0
    out = capsys.readouterr().out
    assert "✓ ollama: nomic-embed-text:latest at http://127.0.0.1:11434" in out
    assert "lm studio: not reachable" in out
