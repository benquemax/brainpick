from brainpick.core.links import RawLink, extract_links


def links(body: str) -> list[RawLink]:
    return extract_links(body)


def test_markdown_link():
    assert links("see [Maa](maa.md) now") == [RawLink("link", "maa.md", "Maa")]


def test_url_and_fragment_targets_skipped():
    assert links("[x](https://example.com) [y](mailto:a@b.c) [z](#section)") == []


def test_fragment_is_stripped():
    assert links("[Maa](maa.md#tides)") == [RawLink("link", "maa.md", "Maa")]


def test_fenced_code_excluded():
    body = "```\n[ei](ei.md)\n```\nreal [Maa](maa.md)\n"
    assert links(body) == [RawLink("link", "maa.md", "Maa")]


def test_inline_code_excluded():
    assert links("`[ei](ei.md)` and [Maa](maa.md)") == [RawLink("link", "maa.md", "Maa")]


def test_wikilink_plain_and_piped():
    assert links("[[kuu]] and [[aurinko|Aurinko itse]]") == [
        RawLink("wikilink", "kuu", "kuu"),
        RawLink("wikilink", "aurinko", "Aurinko itse"),
    ]


def test_rooted_target_kept_verbatim():
    assert links("[Kuu](/kuu.md)") == [RawLink("link", "/kuu.md", "Kuu")]
