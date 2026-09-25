"""Read-only implants (spec/105): the registry `access` flag, and what it changes
on the tool surface — brain_write redirects, brain_overview lists it.

Access is a fact about THIS mount, never inferred from the repo: an implant the
agent cannot push to must stay a mirror of upstream, and the knowledge the
agent wanted to record must be sent somewhere, not stranded.
"""
import shutil

from brainpick.federation import (
    READ_ONLY,
    READ_WRITE,
    Brain,
    BrainSet,
    load_registry,
    register_brain,
    resolve_brain_set,
)
from brainpick.mcp_server import overview_payload, write_payload

from conftest import FIXTURE_BUNDLES

NEW_DOC = (
    "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n"
    "# Uusi kivi\n\nNear [Kuu](kuu.md).\n"
)


def copy_bundle(tmp_path, name, under=None):
    dst = tmp_path / (under or name)
    shutil.copytree(FIXTURE_BUNDLES / name, dst)
    return dst


def make_set(tmp_path, access=READ_ONLY):
    a = copy_bundle(tmp_path, "kotiaurinko")
    k = copy_bundle(tmp_path, "kotikirja")
    (a / "brainpick.toml").write_text('[bundle]\nid = "abcdefghijklmnopqrstu"\n', encoding="utf-8")
    return BrainSet([Brain(alias="aurinko", root=a, role="implant", access=access),
                     Brain(alias="kirja", root=k, role="cortex")])


# -- the registry ----------------------------------------------------------------------


def test_register_read_only_round_trips_after_role(tmp_path):
    registry = tmp_path / "brains.toml"
    root = copy_bundle(tmp_path, "kotiaurinko")
    entry = register_brain(root, registry, alias="a", role="implant", access=READ_ONLY)
    assert entry["access"] == READ_ONLY
    text = registry.read_text(encoding="utf-8")
    assert text.index('role = "implant"') < text.index('access = "read-only"')
    assert load_registry(registry)[0]["access"] == READ_ONLY
    # --read-write clears it: the default is not written, so an old registry reads the same
    register_brain(root, registry, access=READ_WRITE)
    assert "access" not in load_registry(registry)[0]


def test_absent_or_unknown_access_reads_as_read_write(tmp_path):
    registry = tmp_path / "brains.toml"
    root = copy_bundle(tmp_path, "kotiaurinko")
    registry.write_text(
        f'[[brain]]\nid = "x"\nrepo = "{root}"\nbundle_path = ""\nport = 4750\n'
        f'enabled = true\nhost = "127.0.0.1"\nalias = "a"\nrole = "implant"\naccess = "banana"\n',
        encoding="utf-8")
    brain_set = resolve_brain_set([], cwd=tmp_path, registry_path=registry)
    assert brain_set.by_alias("a").access == READ_WRITE
    assert Brain(alias="b", root=root).access == READ_WRITE


# -- what read-only changes ------------------------------------------------------------


def test_write_to_a_read_only_implant_refuses_with_a_redirect(tmp_path):
    brain_set = make_set(tmp_path)
    result = write_payload(brain_set, "aurinko:uusi-kivi", NEW_DOC)
    assert result["ok"] is False
    assert result["brain"] == "aurinko" and result["access"] == READ_ONLY
    # the cross-brain link is pre-computed: slug-then-id, then the bundle path (spec/85)
    assert result["brain_link"] == "brain://aurinko-abcdefghijklmnopqrstu/uusi-kivi.md"
    # both routes named, the cortex by alias, the verb by name
    assert "brain_write 'kirja:" in result["instruction"]
    assert "brain_contribute" in result["instruction"]
    assert not (brain_set.by_alias("aurinko").root / "uusi-kivi.md").exists()


def test_brain_link_is_null_without_a_bundle_id(tmp_path):
    brain_set = make_set(tmp_path)
    (brain_set.by_alias("aurinko").root / "brainpick.toml").unlink()
    result = write_payload(brain_set, "aurinko:uusi-kivi", NEW_DOC)
    assert result["ok"] is False and result["brain_link"] is None


def test_read_write_implant_still_writes(tmp_path):
    brain_set = make_set(tmp_path, access=READ_WRITE)
    result = write_payload(brain_set, "aurinko:uusi-kivi", NEW_DOC)
    assert result["ok"] is True


def test_overview_lists_access_and_hints_the_redirect(tmp_path):
    brain_set = make_set(tmp_path)
    result = overview_payload(brain_set)
    listing = {b["alias"]: b for b in result["brains"]}
    assert listing["aurinko"]["access"] == READ_ONLY
    assert listing["kirja"]["access"] == READ_WRITE
    assert "aurinko" in result["hint"] and "read-only" in result["hint"]
    assert "brain_contribute" in result["hint"]

    uniform = overview_payload(make_set(tmp_path / "rw", access=READ_WRITE))
    assert "read-only" not in uniform["hint"]


# -- the cortex overlay: cross-brain backlinks ----------------------------------------


NOTE = (
    "---\ntype: Concept\ntitle: Kuu, corrected\ndescription: My note on the implant's kuu page.\n---\n\n"
    "# Kuu, corrected\n\nThe implant's page brain://aurinko-abcdefghijklmnopqrstu/kuu.md "
    "cites the wrong figure. See [Kahvi](kahvi.md).\n"
)


def test_read_surfaces_annotations_from_other_brains(tmp_path):
    from brainpick.mcp_server import read_payload

    brain_set = make_set(tmp_path)
    (brain_set.by_alias("kirja").root / "kuu-note.md").write_text(NOTE, encoding="utf-8")
    result = read_payload(brain_set, "aurinko:kuu.md")
    assert result["annotations"] == [
        {"brain": "kirja", "path": "kirja:kuu-note.md", "title": "Kuu, corrected"}]
    assert "annotations" in result["hint"]
    # absent when nothing points here, and never on the doc that holds the link itself
    assert "annotations" not in read_payload(brain_set, "aurinko:maa.md")
    assert "annotations" not in read_payload(brain_set, "kirja:kuu-note.md")


def test_cli_register_read_only_marks_the_entry(tmp_path, monkeypatch, capsys):
    from brainpick.cli import main

    registry = tmp_path / "brains.toml"
    monkeypatch.setenv("BRAINPICK_REGISTRY", str(registry))
    root = copy_bundle(tmp_path, "kotiaurinko")
    assert main(["register", str(root), "--implant", "--alias", "a", "--read-only"]) == 0
    assert "(read-only)" in capsys.readouterr().out
    assert load_registry(registry)[0]["access"] == READ_ONLY
    assert main(["register"]) == 0
    assert "(read-only)" in capsys.readouterr().out
    assert main(["register", str(root), "--read-write"]) == 0
    assert "access" not in load_registry(registry)[0]
