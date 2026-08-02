---
type: article
about: thing
title: Shareable views
description: The address bar is the view — doc, cosmos/brain, layer, lens and time moment as query params, so a copy-pasted URL replicates what the sender sees; the share button chooses which dimensions the link prescribes.
tags: [ui]
timestamp: 2026-08-03T00:30:00Z
---

# Shareable views

Every view of the brain has an address. As you click around, the address bar
mirrors what you see as query parameters — the selected doc (`?doc=`), the
view (`view=cosmos|brain`), the graph layer (`layer=`), the active lens
(`lens=orphans`, `lens=tag:…`, `lens=about:…`), the ghost toggle, and the
[time machine](time-machine.md)'s moment (`commit=`). Copy the URL mid-thought
and the recipient lands in that exact view: same doc open, same lens burning,
same commit of history. One module owns the whole query string — a single
writer, so features never fight over the bar — and the view mode is always
pinned in it, because defaults differ per device and a link is only a link if
it replicates.

The **share** button (beside the brain pill) adds intent. Each dimension of
the current view is a checkbox, all checked by default — the link says
exactly what the sender sees. Unchecking one drops its parameter, so the
recipient gets their own default for that dimension: share the doc but let
their device pick cosmos or brain, or share a lens over the whole graph with
no doc prescribed. The preview updates live and copy lands the link on the
clipboard.

A deep-linked view outranks the operator's `default_mode` policy from the
[configuration reference](reference-config.md) — the link promised a specific
view, for the same reason a live [presentation](presentations.md) is never
yanked back by the static default. And because the whole scheme is
client-side query parameters, links work identically against a live engine
and the [static snapshot](static-snapshot.md) — a URL into the hosted demo is
the cheapest possible "look at this".
