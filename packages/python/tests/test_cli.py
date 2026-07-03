"""CLI wiring: the serve/mcp/compile subcommands exist and describe themselves."""
import pytest

from brainpick.cli import main


@pytest.mark.parametrize("argv", [["serve", "--help"], ["mcp", "--help"], ["compile", "--help"]])
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
    assert "--watch" in capsys.readouterr().out
