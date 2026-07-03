"""CLI wiring: the serve/mcp/compile/init/doctor subcommands exist and describe themselves."""
import pytest

from brainpick.cli import main


@pytest.mark.parametrize("argv", [
    ["serve", "--help"], ["mcp", "--help"], ["compile", "--help"],
    ["init", "--help"], ["doctor", "--help"],
])
def test_subcommand_help_exits_clean(argv, capsys):
    with pytest.raises(SystemExit) as excinfo:
        main(argv)
    assert excinfo.value.code == 0


def test_flags_are_registered(capsys):
    with pytest.raises(SystemExit):
        main(["serve", "--help"])
    serve_help = capsys.readouterr().out
    for flag in ("--root", "--port", "--host", "--no-watch", "--open"):
        assert flag in serve_help
    with pytest.raises(SystemExit):
        main(["compile", "--help"])
    compile_help = capsys.readouterr().out
    assert "--watch" in compile_help
    assert "--only" in compile_help
    with pytest.raises(SystemExit):
        main(["init", "--help"])
    init_help = capsys.readouterr().out
    for flag in ("--root", "--yes", "--dry-run"):
        assert flag in init_help
    with pytest.raises(SystemExit):
        main(["doctor", "--help"])
    assert "--root" in capsys.readouterr().out


def test_cli_init_runs_the_choreography(kotiaurinko, monkeypatch, capsys):
    monkeypatch.setattr("brainpick.scaffold.probe_backends", lambda env: [])
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert main(["init", "--root", str(kotiaurinko), "--yes"]) == 0
    assert "your brain, compiled" in capsys.readouterr().out


def test_cli_doctor_renders_the_table(kotiaurinko, monkeypatch, capsys):
    monkeypatch.setattr("brainpick.scaffold.probe_backends", lambda env: [])
    assert main(["doctor", "--root", str(kotiaurinko)]) == 1  # never compiled yet
    assert "artifacts" in capsys.readouterr().out
