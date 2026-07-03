# Manifest and canonicalization

`.brainpick/manifest.json` is the root of trust: what was compiled, from
which inputs, at which sequence number. It is **normative**.

## Canonical serialization (applies to every normative JSON/JSONL artifact)

- UTF-8, LF line endings, exactly one trailing newline.
- JSON: keys sorted lexicographically (byte order), 2-space indent, no
  trailing whitespace. JSON strings use the minimal escaping of the
  platform's standard serializer with `ensure_ascii` OFF (UTF-8 bytes, not
  `\uXXXX` escapes).
- JSONL: one canonical JSON object per line — same key ordering, but
  compact separators (`,` and `:`, no spaces) and no indentation. Lines
  sorted by the section's named primary key.
- Paths: bundle-relative, POSIX separators, no leading `./`.
- Timestamps: ISO 8601 UTC with `Z` suffix, second precision.

## manifest.json

```json
{
  "bundle_root": ".",
  "compiled_at": "2026-07-02T20:41:00Z",
  "files": {
    "aurinko.md": {"bytes": 412, "sha256": "…"},
    "index.md": {"bytes": 903, "sha256": "…"}
  },
  "generator": {"impl": "python", "name": "brainpick", "version": "0.1.0"},
  "index_md": {"content_hash": "…", "managed": "section"},
  "seq": 1,
  "spec_version": "0.1",
  "tiers": {"t1": "fresh", "t2": "off", "t3": "off"}
}
```

- `files`: every file matched by the bundle's include/exclude globs
  (default `**/*.md`, excluding `.brainpick/`, `.git/`, `_temp/`,
  `node_modules/` — those four directory names at ANY depth; dotfiles and
  dot-directories are scanned normally), keyed by path. `sha256` is over
  raw file bytes. Freshness text comparisons (index, artifacts) operate on
  newline-normalized text (CRLF → LF), matching Python text mode.
  For the managed `index.md` the recorded hash is of the file as written
  (post-generation).
- `seq`: monotonic compile counter. Starts at 1 on the first compile;
  increments only when a compile changes at least one normative artifact
  or the generated index. A no-op compile MUST NOT bump `seq`.
- `tiers`: each of `t1|t2|t3` is `fresh`, `stale`, or `off`.
- `index_md.managed`: `manage`, `section`, or `off` (see `20-t1-artifacts.md`);
  `content_hash` is the sha256 of the whole `index.md` file as written.

## Volatile fields

Conformance comparisons normalize `compiled_at` (replaced by a fixed
sentinel) and `generator` (removed) before diffing. Everything else is
byte-compared.

## Incrementality

Engines SHOULD compile incrementally by diffing the current scan against
`files` (added / modified / deleted). Incrementality is an optimization,
never an excuse: the resulting artifacts MUST be byte-identical to a full
recompile.

## Freshness check

`brainpick compile --check-fresh` MUST verify, without writing: (1) the
scan's path→sha256 map equals `files`; (2) the generated index block's
stamp matches its content (see `20-t1-artifacts.md`). Exit 0 fresh, exit 1
stale with a one-line instruction naming the command to run.
