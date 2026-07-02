from brainpick.core.bundle import scan


def by_path(docs):
    return {d.path: d for d in docs}


def test_scan_kotiaurinko(kotiaurinko):
    docs = scan(kotiaurinko)
    d = by_path(docs)

    # notes.txt excluded; 10 markdown docs incl. reserved
    assert sorted(d) == [
        "aurinko.md", "index.md", "komeetta.md", "kuu.md", "log.md",
        "maa.md", "planeetat.md", "saaret/atolli.md", "saaret/laguuni.md",
        "yksinainen.md",
    ]

    assert d["index.md"].reserved and d["log.md"].reserved
    assert not d["aurinko.md"].reserved

    # title fallbacks: frontmatter > H1 > stem
    assert d["aurinko.md"].title == "Aurinko"
    assert d["kuu.md"].title == "Kuu"            # H1 fallback (no title key)
    assert d["index.md"].title == "Kotiaurinko"  # H1 fallback on reserved

    # tags coerced to string lists; missing -> []
    assert d["maa.md"].tags == ["planeetta", "koti"]
    assert d["log.md"].tags == []

    # yaml datetime normalized to ISO Z string
    assert d["planeetat.md"].timestamp == "2026-06-01T00:00:00Z"
    assert d["aurinko.md"].timestamp is None

    # description nullability
    assert d["kuu.md"].description is None
    assert d["laguuni.md" if False else "saaret/laguuni.md"].description == "The calm water inside the ring."


def test_link_resolution(kotiaurinko):
    docs = scan(kotiaurinko)
    d = by_path(docs)

    def targets(p):
        return sorted((e.target, e.kind) for e in d[p].links)

    # relative, rooted, wikilink, piped wikilink
    assert targets("planeetat.md") == [("aurinko.md", "link"), ("maa.md", "link")]
    assert targets("maa.md") == [("kuu.md", "link"), ("planeetat.md", "link")]  # /kuu.md rooted
    assert targets("aurinko.md") == [
        ("komeetta.md", "link"), ("kuu.md", "wikilink"), ("planeetat.md", "link"),
    ]
    assert targets("yksinainen.md") == [("aurinko.md", "wikilink")]

    # code-fenced pseudo-link must not appear anywhere
    assert ("ei-ole.md", "link") not in targets("kuu.md")

    # ghost: unresolved relative target recorded as written
    assert [(g.target) for g in d["saaret/laguuni.md"].ghosts] == ["olematon.md"]

    # subdir relative resolution
    assert targets("saaret/atolli.md") == [("saaret/laguuni.md", "link")]
