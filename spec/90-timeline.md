# Timeline — the history dimension

The bundle is a git repository, so it has a past. `timeline.json` distills
that past into a form the UI can travel through — the Time Machine: scrub
back and watch the brain shrink to its younger self, scrub forward and watch
it grow.

`timeline.json` is **advisory**: git history differs across clones, is absent
in a non-repo bundle, and is not bundle content — so it is never byte-golden
or conformance-tested for content. Its **layout is normative** (both engines
emit the same shape; the UI and `/api/timeline` read it). A bundle that is
not a git repository, or whose history is unreadable, simply has no
`t1/timeline.json` and the feature hides.

## Generation

At compile time, when the bundle is inside a git work tree, the engine runs a
single `git log` over the bundle path and distills it — it does NOT recompile
past commits (that would be O(commits × compile)). One log call, parsed:

```
git log -c core.quotePath=false --diff-filter=AMDR --name-status -M \
  --format=%x01%H%x1f%aI%x1f%an%x1f%s -- <bundle-root>
```

The filter MUST include `R`: with `-M` on, git reclassifies a rename as `R`,
and an `R` absent from `--diff-filter` drops the change entirely (the rename
would vanish, not split). `core.quotePath=false` keeps non-ASCII paths raw.

- Scope to the bundle root; map repo-relative paths to bundle-relative
  (strip the bundle-root prefix), keep only files matching the bundle
  include globs (default `*.md`), and exclude the reserved generated docs
  (`index.md`, `log.md`) and the configured excludes — so the timeline
  tracks knowledge docs (the graph's nodes), not build output.
- Renames (`R…`) are recorded as a delete of the old path + an add of the
  new (v1 simplicity; the UI treats them as such).
- Uncommitted working-tree changes are not history — they belong to the live
  `seq`, not the timeline.

## t1/timeline.json (normative layout, advisory content)

```json
{
  "commits": [
    {"added": ["aurinko.md", "kuu.md"], "author": "Tom", "date": "2026-07-02T20:41:00Z",
     "deleted": [], "message": "Founding commit", "modified": [], "sha": "c043533"}
  ],
  "docs": {
    "aurinko.md": {"created": "2026-07-02T20:41:00Z", "deleted": null,
                   "modified": ["2026-07-03T09:12:00Z"]}
  },
  "span": {"commits": 27, "first": "2026-07-02T20:41:00Z", "last": "2026-07-06T14:03:00Z"}
}
```

- `commits` — chronological, OLDEST first. Each: `sha` (short), ISO-8601-UTC
  `date`, `author`, `message` (first line), and the bundle-relative
  `added`/`modified`/`deleted` doc paths at that commit (each sorted). Merge
  commits with no bundle changes are omitted.
- `docs` — per-doc lifecycle derived from `commits` (convenience for the UI):
  `created` = first add's date, `modified` = later change dates (sorted),
  `deleted` = the delete date or `null` if the doc still exists.
- `span` — `{commits, first, last}` summary.

Canonical JSON serialization (spec/10) applies. `date`s are the commit's
author date normalized to UTC `Z`.

## Reconstructing a moment (normative UI semantics)

The graph "as of" an instant T is derived without any recompile:

- **Nodes present at T**: docs whose `created ≤ T` and (`deleted` is null OR
  `deleted > T`).
- **Edges present at T**: from the CURRENT `t1/graph.json` edge set, keep an
  edge when both endpoints are present at T. (This approximates history —
  the exact links at a past commit would need that commit's content; a v2
  refinement. It is honest for growth/shrink animation and stated as an
  approximation.)
- **Activity at T**: a doc `modified` at a commit whose date is near T may
  render a firing pulse (reusing the live-delta pulse path).

## /api/timeline (spec/50)

`GET /api/timeline` returns `timeline.json` (or `{"commits": [], "docs": {},
"span": null}` when the bundle has no git history). ETag by manifest `seq`.

## Tier

Timeline generation runs within T1 (deterministic given the repo state, but
advisory because git state is external to the bundle). It never blocks T1
artifacts: a git failure logs and omits `timeline.json`.

`timeline.json` is (re)written only by an artifact-changing compile, not by a
no-op compile on an already-fresh bundle — and this is self-consistent: a
commit that earns a timeline entry necessarily adds/edits/removes a bundle
doc, which changes the manifest and forces that recompile; a commit touching
no bundle doc is omitted from the timeline regardless. (Migration edge: a
bundle compiled before this feature only gains `timeline.json` on its next
artifact-changing compile or a `--full`.)
