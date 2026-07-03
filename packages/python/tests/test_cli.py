"""CLI wiring: the serve/mcp/compile/init/doctor subcommands exist and describe themselves."""
import io

import pytest

from brainpick.cli import main


@pytest.mark.parametrize("argv", [
    ["serve", "--help"], ["mcp", "--help"], ["compile", "--help"],
    ["init", "--help"], ["doctor", "--help"],
    ["token", "--help"], ["token", "create", "--help"], ["token", "list", "--help"],
    ["token", "revoke", "--help"], ["password", "--help"], ["password", "set", "--help"],
    ["password", "clear", "--help"],
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


# -- auth commands (spec/80): the secret prints once, list never leaks, revoke bites --


def test_cli_token_create_prints_the_secret_once(kotiaurinko, capsys):
    from brainpick.auth import load_auth, verify_token

    assert main(["token", "create", "--root", str(kotiaurinko), "--name", "hermes"]) == 0
    out = capsys.readouterr().out
    assert "token created: tk_" in out
    assert "(hermes)" in out
    assert "store it now" in out
    secrets_shown = [word for word in out.split() if word.startswith("bp_")]
    assert len(secrets_shown) == 1  # shown exactly once, right here
    assert verify_token(load_auth(kotiaurinko), secrets_shown[0])


def test_cli_token_list_never_prints_secrets(kotiaurinko, capsys):
    assert main(["token", "list", "--root", str(kotiaurinko)]) == 0
    assert "no tokens yet" in capsys.readouterr().out
    main(["token", "create", "--root", str(kotiaurinko), "--name", "hermes"])
    capsys.readouterr()
    assert main(["token", "list", "--root", str(kotiaurinko)]) == 0
    out = capsys.readouterr().out
    assert "tk_" in out
    assert "hermes" in out
    assert "bp_" not in out  # ids and names — never secrets


def test_cli_token_revoke(kotiaurinko, capsys):
    main(["token", "create", "--root", str(kotiaurinko), "--name", "hermes"])
    capsys.readouterr()
    token_id = next(word for word in _list_output(kotiaurinko, capsys).split() if word.startswith("tk_"))
    assert main(["token", "revoke", token_id, "--root", str(kotiaurinko)]) == 0
    assert "revoked" in capsys.readouterr().out
    assert main(["token", "revoke", token_id, "--root", str(kotiaurinko)]) == 1
    assert "token list shows the ids" in capsys.readouterr().out


def _list_output(root, capsys) -> str:
    main(["token", "list", "--root", str(root)])
    return capsys.readouterr().out


def test_cli_password_set_stdin_and_clear(kotiaurinko, monkeypatch, capsys):
    from brainpick.auth import load_auth, verify_password

    monkeypatch.setattr("sys.stdin", io.StringIO("kotiaurinko\n"))
    assert main(["password", "set", "--stdin", "--root", str(kotiaurinko)]) == 0
    assert "password set" in capsys.readouterr().out
    assert verify_password(load_auth(kotiaurinko), "kotiaurinko")

    monkeypatch.setattr("sys.stdin", io.StringIO("\n"))
    assert main(["password", "set", "--stdin", "--root", str(kotiaurinko)]) == 1
    assert "cannot be empty" in capsys.readouterr().out

    assert main(["password", "clear", "--root", str(kotiaurinko)]) == 0
    assert "password cleared" in capsys.readouterr().out
    assert load_auth(kotiaurinko).password is None
    assert main(["password", "clear", "--root", str(kotiaurinko)]) == 0
    assert "nothing to clear" in capsys.readouterr().out


def test_cli_auth_commands_teach_the_repo_gitignore(tmp_path, capsys):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / ".gitignore").write_text(".brainpick/\n", encoding="utf-8")
    bundle = repo / "wiki"
    bundle.mkdir()
    assert main(["token", "create", "--root", str(bundle)]) == 0
    out = capsys.readouterr().out
    assert ".brainpick-auth.json added" in out
    text = (repo / ".gitignore").read_text(encoding="utf-8")
    assert text == ".brainpick/\n.brainpick-auth.json\n"
    main(["token", "list", "--root", str(bundle)])  # every auth command checks — once is enough
    assert (repo / ".gitignore").read_text(encoding="utf-8") == text
