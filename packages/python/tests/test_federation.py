"""Federation (spec/75): many brains behind one MCP server — the registry, the
brain set, aliases, qualified paths, scope, merged search, routed reads."""
import json
import shutil
import subprocess

import pytest

from brainpick.federation import (
    Brain,
    BrainSet,
    alias_for,
    discover_here,
    load_registry,
    parse_scope,
    qualify,
    register_brain,
    resolve_brain_set,
    split_qualified,
    unregister_brain,
)
from brainpick.mcp_server import (
    neighbors_payload,
    overview_payload,
    read_payload,
    search_payload,
    show_payload,
    write_payload,
)

from conftest import FIXTURE_BUNDLES

NEW_DOC = (
    "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n"
    "# Uusi kivi\n\nNear [Kuu](kuu.md).\n"
)


def copy_bundle(tmp_path, name, under=None):
    dst = (tmp_path / (under or name))
    shutil.copytree(FIXTURE_BUNDLES / name, dst)
    return dst


def make_set(tmp_path, here=None):
    a = copy_bundle(tmp_path, "kotiaurinko")
    k = copy_bundle(tmp_path, "kotikirja")
    brains = [Brain(alias="aurinko", root=a, here=(here == "aurinko")),
              Brain(alias="kirja", root=k, role="cortex", here=(here == "kirja"))]
    return BrainSet(brains)


# -- qualified paths -------------------------------------------------------------------


def test_split_qualified_and_qualify():
    assert split_qualified("acme:docs/a.md") == ("acme", "docs/a.md")
    assert split_qualified("docs/a.md") == (None, "docs/a.md")
    assert split_qualified("c:\\weird") == (None, "c:\\weird")  # a backslash is not a path
    assert qualify("acme", "a.md") == "acme:a.md"


# -- aliases ---------------------------------------------------------------------------


def test_alias_is_repo_name_when_inside_a_git_repo(tmp_path):
    repo = tmp_path / "acme"
    (repo / "docs").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    assert alias_for(repo / "docs") == "acme"


def test_alias_is_directory_name_outside_a_repo(tmp_path):
    root = tmp_path / "My Brain!"
    root.mkdir()
    assert alias_for(root) == "my-brain"


def test_brain_set_dedupes_aliases_and_reserved_words(tmp_path):
    roots = []
    for name in ("all", "x", "x"):
        (tmp_path / name).mkdir(exist_ok=True)
        roots.append(tmp_path / name)
    brains = BrainSet([Brain(alias=None, root=r) for r in roots]).brains
    assert [b.alias for b in brains] == ["all-2", "x", "x-2"]


# -- the registry ----------------------------------------------------------------------


def test_register_writes_canonical_toml_and_round_trips(tmp_path):
    registry = tmp_path / "brains.toml"
    root = copy_bundle(tmp_path, "kotiaurinko")
    entry = register_brain(root, registry, alias="aurinko", user=False)
    text = registry.read_text(encoding="utf-8")
    assert text.startswith("[[brain]]\n")
    assert text.index("id = ") < text.index("repo = ") < text.index("bundle_path = ") < text.index("alias = ")
    assert 'role = "user"' not in text
    assert entry["repo"] == str(root.resolve())

    loaded = load_registry(registry)
    assert [b["alias"] for b in loaded] == ["aurinko"]
    # registering the same root again updates in place — never a duplicate
    register_brain(root, registry, alias="sun", user=True)
    loaded = load_registry(registry)
    # --user is the deprecated spelling: accepted on the way in, written as cortex
    assert len(loaded) == 1 and loaded[0]["alias"] == "sun" and loaded[0]["role"] == "cortex"


def test_legacy_user_role_still_reads_as_the_cortex(tmp_path):
    """A registry written before the rename keeps working, unmigrated (spec/75)."""
    a = copy_bundle(tmp_path, "kotiaurinko")
    k = copy_bundle(tmp_path, "kotikirja")
    legacy = BrainSet([Brain(alias="aurinko", root=a),
                       Brain(alias="kirja", root=k, role="user")])
    assert legacy.cortex is not None and legacy.cortex.alias == "kirja"
    assert parse_scope(legacy, "me")[0] == [legacy.by_alias("kirja")]
    # and an unqualified write falls back to it, exactly as a "cortex" entry would
    assert write_payload(legacy, "uusi-kivi", NEW_DOC)["path"] == "kirja:uusi-kivi.md"


def test_one_cortex_only_newest_claim_wins(tmp_path):
    registry = tmp_path / "brains.toml"
    first = copy_bundle(tmp_path, "kotiaurinko", under="first")
    second = copy_bundle(tmp_path, "kotikirja", under="second")
    register_brain(first, registry, alias="first", role="cortex")
    register_brain(second, registry, alias="second", role="cortex")
    loaded = load_registry(registry)
    assert [e.get("role") for e in loaded] == [None, "cortex"]


def test_implant_role_round_trips_and_allows_many(tmp_path):
    registry = tmp_path / "brains.toml"
    a = copy_bundle(tmp_path, "kotiaurinko", under="a")
    b = copy_bundle(tmp_path, "kotikirja", under="b")
    register_brain(a, registry, alias="a", role="implant")
    register_brain(b, registry, alias="b", role="implant")
    loaded = load_registry(registry)
    assert [e.get("role") for e in loaded] == ["implant", "implant"]
    assert 'role = "implant"' in registry.read_text(encoding="utf-8")


def test_register_uses_the_bundle_id_when_it_has_one(tmp_path):
    registry = tmp_path / "brains.toml"
    root = copy_bundle(tmp_path, "kotiaurinko")
    (root / "brainpick.toml").write_text('[bundle]\nid = "abc123"\n', encoding="utf-8")
    entry = register_brain(root, registry)
    assert entry["id"] == "abc123"


def test_registry_drops_malformed_entries_and_keeps_unknown_keys(tmp_path):
    registry = tmp_path / "brains.toml"
    registry.write_text(
        '[[brain]]\nid = "a"\nrepo = "/nope"\nbundle_path = ""\nport = 4750\nenabled = true\n'
        'host = "127.0.0.1"\nextra = "kept"\n\n[[brain]]\nrepo = 5\n',
        encoding="utf-8",
    )
    loaded = load_registry(registry)
    assert len(loaded) == 1 and loaded[0]["extra"] == "kept"
    assert load_registry(tmp_path / "missing.toml") == []


def test_unregister_removes_by_root(tmp_path):
    registry = tmp_path / "brains.toml"
    root = copy_bundle(tmp_path, "kotiaurinko")
    register_brain(root, registry)
    assert unregister_brain(root, registry) is True
    assert load_registry(registry) == []
    assert unregister_brain(root, registry) is False


# -- the brain set ---------------------------------------------------------------------


def test_discover_here_walks_up_to_a_bundle_root(tmp_path):
    root = copy_bundle(tmp_path, "kotiaurinko")
    (root / "brainpick.toml").write_text("", encoding="utf-8")
    assert discover_here(root / "saaret") == root.resolve()
    assert discover_here(tmp_path) is None


def test_explicit_roots_win_and_take_alias_prefixes(tmp_path):
    a = copy_bundle(tmp_path, "kotiaurinko")
    k = copy_bundle(tmp_path, "kotikirja")
    brains = resolve_brain_set([f"sun={a}", str(k)], cwd=tmp_path, registry_path=tmp_path / "none.toml").brains
    assert [(b.alias, b.root) for b in brains] == [("sun", a.resolve()), ("kotikirja", k.resolve())]


def test_registry_union_here_orders_here_then_user_then_rest(tmp_path):
    registry = tmp_path / "brains.toml"
    here = copy_bundle(tmp_path, "kotiaurinko", under="here")
    (here / "brainpick.toml").write_text("", encoding="utf-8")
    me = copy_bundle(tmp_path, "kotikirja", under="me")
    other = copy_bundle(tmp_path, "kotikirja", under="other")
    register_brain(other, registry, alias="other")
    register_brain(me, registry, alias="mine", role="cortex")
    gone = tmp_path / "gone"
    gone.mkdir()
    register_brain(gone, registry, alias="gone")
    shutil.rmtree(gone)

    brains = resolve_brain_set([], cwd=here / "saaret", registry_path=registry).brains
    assert [b.alias for b in brains] == ["here-2", "mine", "other"]  # 'here' is reserved → suffixed
    assert brains[0].here is True and brains[1].role == "cortex"


def test_here_matching_a_registered_brain_is_not_duplicated(tmp_path):
    registry = tmp_path / "brains.toml"
    here = copy_bundle(tmp_path, "kotiaurinko")
    register_brain(here, registry, alias="sun")
    brains = resolve_brain_set([], cwd=here / "saaret", registry_path=registry).brains
    assert [(b.alias, b.here) for b in brains] == [("sun", True)]


def test_empty_set_falls_back_to_cwd(tmp_path):
    root = copy_bundle(tmp_path, "kotiaurinko")
    brain_set = resolve_brain_set([], cwd=root, registry_path=tmp_path / "none.toml")
    assert [b.root for b in brain_set.brains] == [root.resolve()]
    assert brain_set.federated is False


def test_disabled_registry_brains_are_skipped(tmp_path):
    registry = tmp_path / "brains.toml"
    a = copy_bundle(tmp_path, "kotiaurinko")
    register_brain(a, registry, alias="a")
    text = registry.read_text(encoding="utf-8").replace("enabled = true", "enabled = false")
    registry.write_text(text, encoding="utf-8")
    assert resolve_brain_set([], cwd=tmp_path, registry_path=registry).brains[0].root == tmp_path.resolve()


# -- scope -----------------------------------------------------------------------------


def test_parse_scope(tmp_path):
    brain_set = make_set(tmp_path, here="aurinko")
    assert [b.alias for b in parse_scope(brain_set, "all")[0]] == ["aurinko", "kirja"]
    assert [b.alias for b in parse_scope(brain_set, "here")[0]] == ["aurinko"]
    assert [b.alias for b in parse_scope(brain_set, "me")[0]] == ["kirja"]
    chosen, dropped = parse_scope(brain_set, "kirja, nope")
    assert [b.alias for b in chosen] == ["kirja"] and dropped == ["nope"]
    chosen, dropped = parse_scope(brain_set, "nope")
    assert [b.alias for b in chosen] == ["aurinko", "kirja"] and dropped == ["nope"]


# -- federated search ------------------------------------------------------------------


def test_federated_search_qualifies_and_merges(tmp_path):
    brain_set = make_set(tmp_path)
    result = search_payload(brain_set, "kuu", mode="keyword")
    paths = {h["path"] for h in result["hits"]}
    assert paths == {"aurinko:kuu.md", "aurinko:maa.md", "aurinko:aurinko.md",
                     "kirja:kuu-muistio.md", "kirja:kahvi.md"}
    assert result["hits"][0]["brain"] == "aurinko"
    assert result["searched"] == ["aurinko", "kirja"]
    assert result["contributing"] == ["aurinko", "kirja"]
    assert result["used_modes"] == ["keyword"]
    assert "brain_read 'aurinko:kuu.md'" in result["hint"]


def test_federated_search_merges_by_rank_not_score(tmp_path):
    """Scores are not commensurable across brains (spec/75): a T2-fresh brain
    scores RRF fractions (~0.03), a T1-only brain raw BM25 (~4.0). Merging by
    score would bury the fresh brain entirely; the merge interleaves RANKS."""
    brain_set = make_set(tmp_path)
    (brain_set.brains[0].root / "brainpick.local.toml").write_text(
        '[models.embedding]\nkind = "mock"\n', encoding="utf-8")  # aurinko gets T2, kirja stays T1
    result = search_payload(brain_set, "kuu", mode="auto")
    assert result["used_modes"] == ["keyword", "semantic"]
    brains = [h["brain"] for h in result["hits"]]
    assert brains[:4] == ["aurinko", "kirja", "aurinko", "kirja"]  # rank 1s, then rank 2s
    assert result["hits"][0]["score"] < result["hits"][1]["score"]  # native scores kept as-is
    assert result["hits"][1]["path"] == "kirja:kuu-muistio.md"


def test_federated_search_scope_and_unknown_alias_note(tmp_path):
    brain_set = make_set(tmp_path)
    result = search_payload(brain_set, "kuu", mode="keyword", scope="kirja,nope")
    assert {h["brain"] for h in result["hits"]} == {"kirja"}
    assert result["searched"] == ["kirja"]
    assert "nope" in result["hint"]


def test_federated_search_limit_and_budget(tmp_path):
    brain_set = make_set(tmp_path)
    result = search_payload(brain_set, "kuu", mode="keyword", limit=2)
    assert len(result["hits"]) == 2
    tight = search_payload(brain_set, "kuu", mode="keyword", budget_tokens=60)
    assert tight["truncated"] is True and len(tight["hits"]) >= 1


def test_single_brain_set_emits_the_plain_payload(tmp_path):
    root = copy_bundle(tmp_path, "kotiaurinko")
    brain_set = BrainSet([Brain(alias="sun", root=root)])
    result = search_payload(brain_set, "kuu", mode="keyword")
    assert result["hits"][0]["path"] == "kuu.md"
    assert "brain" not in result["hits"][0] and "searched" not in result
    # …but a qualified doc is still accepted
    assert read_payload(brain_set, "sun:kuu.md")["path"] == "kuu.md"


# -- federated overview ----------------------------------------------------------------


def test_federated_overview_lists_brains_and_focuses_here(tmp_path):
    brain_set = make_set(tmp_path, here="kirja")
    result = overview_payload(brain_set)
    assert [b["alias"] for b in result["brains"]] == ["aurinko", "kirja"]
    kirja = result["brains"][1]
    assert kirja["here"] is True and kirja["role"] == "cortex" and kirja["docs"] == 3
    assert kirja["tiers"]["t1"] == "fresh"
    assert result["bundle"] == "kirja"
    assert result["counts"]["docs"] == 3  # index.md counts, as in the single-brain overview
    assert result["tree"][0]["docs"][0]["path"].startswith("kirja:")
    assert "scope" in result["hint"]


def test_federated_overview_scope_picks_focus_and_survives_budget(tmp_path):
    brain_set = make_set(tmp_path)
    result = overview_payload(brain_set, scope="aurinko", budget_tokens=80)
    assert result["bundle"] == "aurinko"
    assert len(result["brains"]) == 2  # never trimmed
    assert result["truncated"] is True


# -- routed read / neighbors / write / show --------------------------------------------


def test_read_routes_qualified_and_unqualified_docs(tmp_path):
    brain_set = make_set(tmp_path)
    result = read_payload(brain_set, "kirja:kahvi.md")
    assert result["path"] == "kirja:kahvi.md" and result["brain"] == "kirja"
    assert result["neighbors"]["out"][0]["path"] == "kirja:kuu-muistio.md"
    assert "brain_neighbors 'kirja:kahvi.md'" in result["hint"]
    # unqualified, unique across the set → resolved
    assert read_payload(brain_set, "kahvi")["path"] == "kirja:kahvi.md"


def test_read_disambiguates_across_brains_and_suggests_qualified(tmp_path):
    brain_set = make_set(tmp_path)
    # "kuu" is a stem only in aurinko → unique across the set → resolved
    assert read_payload(brain_set, "kuu")["path"] == "aurinko:kuu.md"
    # the same stem in two brains → a disambiguation listing qualified paths
    twin = BrainSet([Brain(alias="a", root=copy_bundle(tmp_path / "t", "kotiaurinko", under="a")),
                     Brain(alias="b", root=copy_bundle(tmp_path / "t", "kotiaurinko", under="b"))])
    result = read_payload(twin, "kuu")
    assert {d["path"] for d in result["disambiguation"]} == {"a:kuu.md", "b:kuu.md"}
    miss = read_payload(brain_set, "zzzz-nothing")
    # an EXACT hit in one brain beats a FUZZY title in another (spec/75, tier by tier):
    # "kuu-muistio" is a stem in kirja; aurinko's titles ("Kuu", …) never enter the race
    assert read_payload(brain_set, "kuu-muistio")["path"] == "kirja:kuu-muistio.md"
    brain_set = make_set(tmp_path / "again")
    (brain_set.brains[0].root / "kuu-muistio-notes.md").write_text(  # fuzzy-matches "kuu-muistio"
        "---\ntype: Concept\ntitle: Kuu-muistio notes\ndescription: Fuzzy twin.\n---\n"
        "# Kuu-muistio notes\nSee [Kuu](kuu.md).\n", encoding="utf-8")
    (brain_set.brains[0].root / "porch-moon-diary.md").write_text(
        "---\ntype: Concept\ntitle: Porch moon diary\ndescription: Only fuzzily reachable.\n---\n"
        "# Porch moon diary\nSee [Kuu](kuu.md).\n", encoding="utf-8")
    assert read_payload(brain_set, "kuu-muistio")["path"] == "kirja:kuu-muistio.md"
    # the fuzzy tier still runs when no brain has an exact match
    assert read_payload(brain_set, "porch moon diaries")["path"] == "aurinko:porch-moon-diary.md"
    assert "error" in miss and all(":" in s for s in miss["suggestions"])
    unknown = read_payload(brain_set, "nope:kuu.md")
    assert "error" in unknown and "nope" in unknown["error"]


def test_neighbors_are_qualified(tmp_path):
    brain_set = make_set(tmp_path)
    result = neighbors_payload(brain_set, "aurinko:kuu.md")
    assert result["center"] == "aurinko:kuu.md" and result["brain"] == "aurinko"
    assert all(n["path"].startswith("aurinko:") for n in result["nodes"])
    assert all(e["source"].startswith("aurinko:") and e["target"].startswith("aurinko:")
               for e in result["edges"])


def test_write_targets_here_then_cortex_then_declines(tmp_path):
    # no here → the cortex takes the write rather than declining (spec/75)
    brain_set = make_set(tmp_path)
    fell_back = write_payload(brain_set, "uusi-kivi", NEW_DOC)
    assert fell_back["ok"] is True and fell_back["path"] == "kirja:uusi-kivi.md"

    written = write_payload(brain_set, "aurinko:toinen-kivi", NEW_DOC)
    assert written["ok"] is True and written["path"] == "aurinko:toinen-kivi.md"
    assert (brain_set.by_alias("aurinko").root / "toinen-kivi.md").is_file()

    # here wins over the cortex
    with_here = make_set(tmp_path / "second", here="aurinko")
    result = write_payload(with_here, "uusi-kivi", NEW_DOC)
    assert result["ok"] is True and result["path"] == "aurinko:uusi-kivi.md"


def test_write_declines_with_neither_here_nor_cortex(tmp_path):
    # implants only: nothing to fall back to, so a write never guesses (spec/75)
    brain_set = make_set(tmp_path)
    for brain in brain_set.brains:
        brain.role = "implant"
    declined = write_payload(brain_set, "uusi-kivi", NEW_DOC)
    assert declined["ok"] is False and "aurinko" in declined["instruction"]


def test_implants_are_writable(tmp_path):
    brain_set = make_set(tmp_path)
    brain_set.by_alias("aurinko").role = "implant"
    written = write_payload(brain_set, "aurinko:implantti", NEW_DOC)
    assert written["ok"] is True and written["path"] == "aurinko:implantti.md"
    assert (brain_set.by_alias("aurinko").root / "implantti.md").is_file()
    assert [b.alias for b in brain_set.implants] == ["aurinko"]


def test_show_targets_one_brain_and_drops_the_rest(tmp_path, monkeypatch):
    # no running `brainpick serve` here — pin brain_show to its local fallback so
    # this doesn't silently depend on whatever happens to be on :4747 (spec/95 follow-up)
    monkeypatch.setattr("brainpick.cli.post_show",
                        lambda base_url, body, token=None: (None, "no server", True))
    brain_set = make_set(tmp_path)
    result = show_payload(brain_set, nodes=["kirja:kahvi.md", "aurinko:kuu.md"])
    assert result["shown"] == 1 and result["dropped"] == ["aurinko:kuu.md"]
    assert result["brain"] == "kirja"


# -- the MCP server wires scope --------------------------------------------------------


def test_create_mcp_server_exposes_scope(tmp_path):
    import asyncio

    from brainpick.mcp_server import create_mcp_server

    server = create_mcp_server(make_set(tmp_path))
    tools = {t.name: t for t in asyncio.run(server.list_tools())}
    assert "scope" in tools["brain_search"].inputSchema["properties"]
    assert "scope" in tools["brain_overview"].inputSchema["properties"]
    assert "aurinko" in server.instructions and "kirja" in server.instructions


@pytest.mark.parametrize("name", ["aurinko", "kirja"])
def test_brain_set_loads_lazily(tmp_path, name):
    brain_set = make_set(tmp_path)
    brain = brain_set.by_alias(name)
    assert brain.loaded is False
    state = brain_set.state_for(brain)
    assert brain.loaded is True and (brain.root / ".brainpick" / "manifest.json").is_file()
    assert json.loads((brain.root / ".brainpick" / "manifest.json").read_text())["seq"] == state.seq


# -- migrating per-project host entries (spec/75 --from-hosts) ------------------------


def write_hosts(home, roots):
    """The pre-federation shape in every known host: one `mcp --root DIR` per project."""
    a, b, gone = roots
    (home / ".claude.json").write_text(json.dumps({
        "mcpServers": {"brainpick": {"command": "uvx", "args": ["brainpick", "mcp", "--root", str(a)]},
                       "other": {"command": "npx", "args": ["some-server"]}},
        "projects": {str(b): {"mcpServers": {"brainpick": {"command": "brainpick", "args": ["mcp", f"--root={b}"]}}}},
    }), encoding="utf-8")
    (home / ".config" / "opencode").mkdir(parents=True)
    (home / ".config" / "opencode" / "opencode.json").write_text(json.dumps({
        "mcp": {"brainpick": {"type": "local", "command": ["uv", "run", "brainpick", "mcp", "--root", str(a)]},
                "remote": {"type": "remote", "url": "http://x/sse"}}}), encoding="utf-8")
    (home / ".codex").mkdir()
    (home / ".codex" / "config.toml").write_text(
        f"[mcp_servers.brainpick]\ncommand = 'brainpick'\nargs = ['mcp', '--root', '{gone}']\n", encoding="utf-8")
    (home / ".cursor").mkdir()
    (home / ".cursor" / "mcp.json").write_text(json.dumps({
        "mcpServers": {"bp": {"command": "brainpick", "args": ["serve", "--root", str(a)]}}}), encoding="utf-8")


def test_scan_hosts_finds_every_per_project_root(tmp_path):
    from brainpick.federation import scan_hosts

    home = tmp_path / "home"
    home.mkdir()
    a = copy_bundle(tmp_path, "kotiaurinko")
    b = copy_bundle(tmp_path, "kotikirja")
    gone = tmp_path / "gone"
    write_hosts(home, (a, b, gone))
    found = scan_hosts({"HOME": str(home)})
    # distinct roots, in discovery order; `serve --root` is not an mcp entry
    assert [f.root for f in found] == [a, b, gone]
    assert found[0].hosts == ["claude-code", "opencode"]
    assert found[1].hosts == ["claude-code"] and found[2].hosts == ["codex"]
    assert scan_hosts({"HOME": str(tmp_path / "nohome")}) == []


def test_register_from_hosts_registers_bundles_and_reports_the_rest(tmp_path, capsys):
    from brainpick.cli import main

    home = tmp_path / "home"
    home.mkdir()
    a = copy_bundle(tmp_path, "kotiaurinko")
    b = copy_bundle(tmp_path, "kotikirja")
    gone = tmp_path / "gone"
    write_hosts(home, (a, b, gone))
    registry = tmp_path / "brains.toml"
    env = {"HOME": str(home), "BRAINPICK_REGISTRY": str(registry)}

    assert main(["register", "--from-hosts", "--dry-run"], env=env) == 0
    out = capsys.readouterr().out
    assert "kotiaurinko" in out and "kotikirja" in out and "gone" in out and "dry run" in out
    assert not registry.exists()

    assert main(["register", "--from-hosts"], env=env) == 0
    out = capsys.readouterr().out
    assert "registered kotiaurinko" in out and "registered kotikirja" in out
    assert "skipped" in out and str(gone) in out
    assert "claude mcp add brainpick --scope user" in out
    # roots are stored canonical (TOML-escaped on Windows) — compare identities, not spellings
    from brainpick.federation import entry_root, load_registry

    assert [entry_root(e, env) for e in load_registry(registry)] == [a.resolve(), b.resolve()]
    assert gone.name not in registry.read_text(encoding="utf-8")

    # idempotent: a second run leaves the registry alone
    before = registry.read_text(encoding="utf-8")
    assert main(["register", "--from-hosts"], env=env) == 0
    assert registry.read_text(encoding="utf-8") == before
    assert "already registered" in capsys.readouterr().out

    # nothing to find is a report, not a failure
    assert main(["register", "--from-hosts"], env={"HOME": str(tmp_path / "empty"), "BRAINPICK_REGISTRY": str(registry)}) == 0
    assert "no per-project" in capsys.readouterr().out


def test_qualify_paths_reaches_skill_payloads():
    """spec/75 meets spec/70: the skills list in brain_overview and the `skill`
    block in brain_read carry paths too — depends_on/tools are plain string
    lists, dependents are {path,title} entries."""
    from brainpick.federation import qualify_paths

    overview = {"skills": [{"path": "skills/a.md", "title": "A", "description": None,
                            "depends_on": ["skills/b.md"], "tools": ["tools/x"]}]}
    assert qualify_paths("me", overview) == {"skills": [{
        "path": "me:skills/a.md", "title": "A", "description": None,
        "depends_on": ["me:skills/b.md"], "tools": ["me:tools/x"]}]}
    read = {"path": "skills/b.md", "skill": {
        "depends_on": [{"path": "skills/c.md", "title": "C"}],
        "dependents": [{"path": "skills/a.md", "title": "A"}],
        "tools": [{"path": "tools/x", "exists": True}]}}
    assert qualify_paths("me", read)["skill"] == {
        "depends_on": [{"path": "me:skills/c.md", "title": "C"}],
        "dependents": [{"path": "me:skills/a.md", "title": "A"}],
        "tools": [{"path": "me:tools/x", "exists": True}]}
