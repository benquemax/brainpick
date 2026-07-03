"""The normative T2 chunker (spec/30): heading sections, packing, overlap, ids.

Byte-golden across engines — these tests pin the exact boundaries, not just shapes.
"""
import hashlib

from brainpick.compile.t2 import MAX_CHUNK, OVERLAP, build_chunks, chunk_document

MAX_CONTENT = MAX_CHUNK - OVERLAP  # what fits into a chunk that carries an overlap prefix


def rec(path: str, text: str, reserved: bool = False) -> dict:
    return {"path": path, "text": text, "reserved": reserved}


def texts(chunks):
    return [c["text"] for c in chunks]


# -- sections and heading paths ------------------------------------------------------


def test_single_heading_section_excludes_the_heading_line():
    chunks = chunk_document(rec("kuu.md", "# Kuu\n\nThe moon pulls the tides.\n"))
    assert len(chunks) == 1
    assert chunks[0]["id"] == "kuu.md#kuu~0"
    assert chunks[0]["heading_path"] == ["Kuu"]
    assert chunks[0]["text"] == "The moon pulls the tides."
    assert chunks[0]["ord"] == 0


def test_preamble_before_first_heading_has_empty_heading_path():
    chunks = chunk_document(rec("a.md", "intro line\n\n# One\n\nbody\n"))
    assert [c["id"] for c in chunks] == ["a.md#~0", "a.md#one~0"]
    assert chunks[0]["heading_path"] == []
    assert chunks[0]["text"] == "intro line"
    assert [c["ord"] for c in chunks] == [0, 1]


def test_heading_path_nests_and_resets_by_level():
    text = (
        "# A\n\na text\n\n## B\n\nb text\n\n### C\n\nc text\n\n"
        "## B2\n\nb2 text\n\n# Z\n\nz text\n"
    )
    chunks = chunk_document(rec("d.md", text))
    assert [c["heading_path"] for c in chunks] == [
        ["A"], ["A", "B"], ["A", "B", "C"], ["A", "B2"], ["Z"],
    ]
    assert [c["id"] for c in chunks] == [
        "d.md#a~0", "d.md#a/b~0", "d.md#a/b/c~0", "d.md#a/b2~0", "d.md#z~0",
    ]
    assert [c["ord"] for c in chunks] == [0, 1, 2, 3, 4]


def test_heading_level_jump_keeps_nearest_enclosing_titles():
    chunks = chunk_document(rec("j.md", "# A\n\na\n\n### C\n\nc\n\n## B\n\nb\n"))
    assert [c["heading_path"] for c in chunks] == [["A"], ["A", "C"], ["A", "B"]]


def test_level_four_headings_are_not_split_points():
    chunks = chunk_document(rec("h4.md", "# A\n\n#### deep\n\nstill in A\n"))
    assert len(chunks) == 1
    assert chunks[0]["heading_path"] == ["A"]
    assert chunks[0]["text"] == "#### deep\n\nstill in A"


def test_hash_without_space_is_not_a_heading():
    chunks = chunk_document(rec("n.md", "#Kuu\n\ntext\n"))
    assert len(chunks) == 1
    assert chunks[0]["heading_path"] == []
    assert chunks[0]["text"] == "#Kuu\n\ntext"


def test_headings_inside_fences_do_not_split():
    text = "# A\n\nbefore\n\n```markdown\n# not a heading\n```\n\nafter\n"
    chunks = chunk_document(rec("f.md", text))
    assert len(chunks) == 1
    assert chunks[0]["heading_path"] == ["A"]
    assert "# not a heading" in chunks[0]["text"]


def test_tilde_fences_guard_headings_too():
    text = "# A\n\n~~~\n## fenced\n~~~\n\ntail\n"
    chunks = chunk_document(rec("t.md", text))
    assert len(chunks) == 1
    assert "## fenced" in chunks[0]["text"]


def test_blank_lines_inside_fences_do_not_split_paragraphs():
    text = "# A\n\n```\nline one\n\nline two\n```\n"
    chunks = chunk_document(rec("g.md", text))
    assert len(chunks) == 1
    assert chunks[0]["text"] == "```\nline one\n\nline two\n```"


def test_empty_sections_produce_no_chunks():
    chunks = chunk_document(rec("e.md", "# Empty\n\n# Full\n\ncontent\n"))
    assert [c["id"] for c in chunks] == ["e.md#full~0"]
    assert chunks[0]["ord"] == 0  # ord numbers surviving chunks
    assert chunk_document(rec("blank.md", "")) == []
    assert chunk_document(rec("ws.md", "   \n\n  \n")) == []


# -- slugs ---------------------------------------------------------------------------


def test_unicode_slugs_keep_letters_and_collapse_symbol_runs():
    chunks = chunk_document(rec("y.md", "# Yksinäinen tähti!!\n\nbody\n"))
    assert chunks[0]["id"] == "y.md#yksinäinen-tähti~0"
    chunks = chunk_document(rec("s.md", "## C++ / Rust_FFI --- notes\n\nbody\n"))
    assert chunks[0]["id"] == "s.md#c-rust-ffi-notes~0"


def test_symbol_only_heading_slugs_to_empty_string():
    chunks = chunk_document(rec("p.md", "# ---\n\nbody\n"))
    assert chunks[0]["id"] == "p.md#~0"
    assert chunks[0]["heading_path"] == ["---"]


# -- packing, overlap, hard splits ---------------------------------------------------


def test_paragraphs_pack_greedily_and_join_with_blank_line():
    text = "# A\n\npara one\n\npara two\n\npara three\n"
    chunks = chunk_document(rec("p.md", text))
    assert texts(chunks) == ["para one\n\npara two\n\npara three"]


def test_overlap_is_exactly_the_last_320_chars_of_the_previous_chunk():
    p1, p2 = "a" * 3000, "b" * 2000
    chunks = chunk_document(rec("o.md", f"# X\n\n{p1}\n\n{p2}\n"))
    assert texts(chunks) == ["a" * 3000, "a" * OVERLAP + "b" * 2000]
    assert chunks[1]["text"][:OVERLAP] == chunks[0]["text"][-OVERLAP:]
    assert all(len(c["text"]) <= MAX_CHUNK for c in chunks)
    assert [c["id"] for c in chunks] == ["o.md#x~0", "o.md#x~1"]


def test_hard_split_boundaries_respect_the_overlap_budget():
    p1, p2, p3 = "a" * 3000, "b" * 3000, "c" * 500
    chunks = chunk_document(rec("h.md", f"# X\n\n{p1}\n\n{p2}\n\n{p3}\n"))
    assert texts(chunks) == [
        "a" * 3000,
        "a" * OVERLAP + "b" * MAX_CONTENT,
        "b" * OVERLAP + "b" * (3000 - MAX_CONTENT) + "\n\n" + "c" * 500,
    ]
    assert all(len(c["text"]) <= MAX_CHUNK for c in chunks)


def test_lone_giant_paragraph_first_slice_is_3200():
    chunks = chunk_document(rec("g.md", "# X\n\n" + "q" * 7000 + "\n"))
    assert len(chunks[0]["text"]) == MAX_CHUNK
    assert chunks[0]["text"] == "q" * MAX_CHUNK
    # second chunk: 320-char prefix + a full 2880 content slice
    assert chunks[1]["text"] == "q" * MAX_CHUNK
    remainder = 7000 - MAX_CHUNK - MAX_CONTENT
    assert chunks[2]["text"] == "q" * (OVERLAP + remainder)
    assert [c["id"] for c in chunks] == ["g.md#x~0", "g.md#x~1", "g.md#x~2"]


def test_chunk_index_n_restarts_per_section_ord_runs_per_doc():
    text = f"# A\n\n{'a' * 3000}\n\n{'b' * 2000}\n\n# B\n\nshort\n"
    chunks = chunk_document(rec("n.md", text))
    assert [c["id"] for c in chunks] == ["n.md#a~0", "n.md#a~1", "n.md#b~0"]
    assert [c["ord"] for c in chunks] == [0, 1, 2]


# -- build_chunks over records -------------------------------------------------------


def test_build_chunks_skips_reserved_and_sorts_by_doc_then_ord():
    records = [
        rec("z.md", "# Z\n\nzzz\n"),
        rec("index.md", "# Index\n\nnever chunked\n", reserved=True),
        rec("a.md", "# A\n\naaa\n\n# B\n\nbbb\n"),
    ]
    chunks = build_chunks(records)
    assert [(c["doc"], c["ord"]) for c in chunks] == [("a.md", 0), ("a.md", 1), ("z.md", 0)]
    assert all("index.md" != c["doc"] for c in chunks)


def test_chunk_sha256_is_over_the_chunk_text():
    chunks = build_chunks([rec("s.md", "# S\n\nsisältö\n")])
    expected = hashlib.sha256("sisältö".encode("utf-8")).hexdigest()
    assert chunks[0]["sha256"] == expected


def test_chunk_record_shape_matches_spec():
    chunks = build_chunks([rec("k.md", "# K\n\nbody\n")])
    assert set(chunks[0]) == {"doc", "heading_path", "id", "ord", "sha256", "text"}
