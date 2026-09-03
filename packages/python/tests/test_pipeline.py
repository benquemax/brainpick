import json

from brainpick.compile.pipeline import check_fresh, run_compile


def read(p):
    return p.read_text(encoding="utf-8")


def test_fresh_compile_writes_everything(kotiaurinko):
    result = run_compile(kotiaurinko)
    assert result.changed is True

    bp = kotiaurinko / ".brainpick"
    manifest = json.loads(read(bp / "manifest.json"))
    assert manifest["seq"] == 1
    assert manifest["spec_version"] == "0.1"
    assert manifest["tiers"] == {"t1": "fresh", "t2": "off", "t3": "fresh"}  # t3: the algorithmic default
    assert "notes.txt" not in manifest["files"]
    assert set(manifest["files"]) == {
        "aurinko.md", "index.md", "komeetta.md", "kuu.md", "log.md",
        "maa.md", "planeetat.md", "saaret/atolli.md", "saaret/laguuni.md",
        "yksinainen.md",
    }

    graph = json.loads(read(bp / "t1" / "graph.json"))
    assert graph["stats"]["docs"] == 10

    # generated section appended to index.md; preamble intact
    idx = read(kotiaurinko / "index.md")
    assert idx.startswith("---\nokf_version:")
    assert "hand-written and must survive" in idx
    assert "<!-- brainpick:begin index (hash:" in idx
    assert idx.rstrip("\n").endswith("<!-- brainpick:end index -->")

    # manifest records the post-write index hash
    assert manifest["index_md"]["managed"] == "section"


def test_recompile_is_noop(kotiaurinko):
    run_compile(kotiaurinko)
    before = {
        p.relative_to(kotiaurinko).as_posix(): p.read_bytes()
        for p in kotiaurinko.rglob("*") if p.is_file()
    }
    result = run_compile(kotiaurinko)
    assert result.changed is False
    after = {
        p.relative_to(kotiaurinko).as_posix(): p.read_bytes()
        for p in kotiaurinko.rglob("*") if p.is_file()
    }
    assert before == after  # byte-stable, seq untouched


def test_edit_bumps_seq_and_updates(kotiaurinko):
    run_compile(kotiaurinko)
    (kotiaurinko / "uusi.md").write_text(
        "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n# Uusi\n\nNear [Kuu](kuu.md).\n",
        encoding="utf-8",
    )
    result = run_compile(kotiaurinko)
    assert result.changed is True

    manifest = json.loads(read(kotiaurinko / ".brainpick" / "manifest.json"))
    assert manifest["seq"] == 2
    assert "uusi.md" in manifest["files"]
    assert "- [Uusi](uusi.md) — New rock." in read(kotiaurinko / "index.md")


def test_check_fresh(kotiaurinko):
    assert check_fresh(kotiaurinko).fresh is False  # never compiled
    run_compile(kotiaurinko)
    assert check_fresh(kotiaurinko).fresh is True

    (kotiaurinko / "kuu.md").write_text("---\ntype: Concept\n---\n\n# Kuu\n", encoding="utf-8")
    verdict = check_fresh(kotiaurinko)
    assert verdict.fresh is False
    assert "brainpick compile" in verdict.reason


def test_full_recompile_matches_incremental(kotiaurinko):
    run_compile(kotiaurinko)
    incremental = (kotiaurinko / ".brainpick" / "t1" / "graph.json").read_bytes()
    run_compile(kotiaurinko, full=True)
    assert (kotiaurinko / ".brainpick" / "t1" / "graph.json").read_bytes() == incremental


# -- [bundle] root (spec/80): config at a repo root, bundle in a subdirectory ---------


def bundle_root_layout(kotiaurinko):
    """A repo whose brainpick.toml points at the fixture bundle one level down,
    plus a repo-root README that must never be scanned into the brain."""
    repo = kotiaurinko.parent
    (repo / "brainpick.toml").write_text('[bundle]\nroot = "kotiaurinko"\n', encoding="utf-8")
    (repo / "README.md").write_text("# not part of the bundle\n", encoding="utf-8")
    return repo


def test_compile_honours_bundle_root(kotiaurinko):
    repo = bundle_root_layout(kotiaurinko)

    result = run_compile(repo)

    assert result.changed is True
    manifest = json.loads(read(kotiaurinko / ".brainpick" / "manifest.json"))
    assert "kuu.md" in manifest["files"]
    assert "README.md" not in manifest["files"]           # the repo root is not the bundle
    assert not (repo / ".brainpick").exists()             # artifacts live with the bundle
    assert not (repo / "index.md").exists()               # so does the generated index
    assert "brainpick:begin index" in read(kotiaurinko / "index.md")


def test_check_fresh_honours_bundle_root(kotiaurinko):
    repo = bundle_root_layout(kotiaurinko)
    assert check_fresh(repo).fresh is False               # never compiled
    run_compile(repo)
    assert check_fresh(repo).fresh is True
    assert check_fresh(kotiaurinko).fresh is True          # --root at the bundle itself still works
