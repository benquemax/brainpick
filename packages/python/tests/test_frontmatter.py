from brainpick.core.frontmatter import split_frontmatter


def test_basic_frontmatter():
    meta, body = split_frontmatter("---\ntitle: Kuu\ntags: [a, b]\n---\n\n# Kuu\n")
    assert meta == {"title": "Kuu", "tags": ["a", "b"]}
    assert body == "\n# Kuu\n"


def test_no_frontmatter():
    meta, body = split_frontmatter("# Just a heading\n")
    assert meta == {}
    assert body == "# Just a heading\n"


def test_unparseable_yaml_is_tolerated():
    meta, body = split_frontmatter("---\n: [unbalanced\n---\nbody\n")
    assert meta == {}
    assert body == "body\n"


def test_non_mapping_yaml_is_tolerated():
    meta, body = split_frontmatter("---\n- just\n- a list\n---\nbody\n")
    assert meta == {}
    assert body == "body\n"


def test_constructor_invalid_timestamp_is_tolerated():
    # resolver says timestamp, constructor raises ValueError (day out of range)
    meta, body = split_frontmatter("---\ntimestamp: 2026-02-31T00:00:00Z\n---\nbody\n")
    assert meta == {}
    assert body == "body\n"


def test_unterminated_frontmatter_is_body():
    meta, body = split_frontmatter("---\ntitle: x\nno end fence\n")
    assert meta == {}
    assert body == "---\ntitle: x\nno end fence\n"


def test_crlf_normalized():
    meta, body = split_frontmatter("---\r\ntitle: x\r\n---\r\nbody\r\n")
    assert meta == {"title": "x"}
    assert body == "body\n"
