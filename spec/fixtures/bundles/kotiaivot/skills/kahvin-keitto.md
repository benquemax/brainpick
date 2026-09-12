---
type: skill
title: Kahvin keitto
description: Use when brewing the morning coffee — the whole procedure, kettle to cup.
tags: [kahvi]
timestamp: 2026-07-01T07:10:00Z
depends_on: [skills/veden-keitto.md]
tools: [tools/keita]
---

# Kahvin keitto

## Trigger

Every morning; whenever someone asks for coffee.

## Steps

1. Boil water — [Veden keitto](veden-keitto.md).
2. Run `tools/keita` — it grinds, doses and pours; do not do this by hand.
3. Serve. See [Kahvi](../knowledge/kahvi.md) for what you just made.

## Gotchas

- The grinder jams on oily beans; `keita` retries once.

## Evaluation log

- 2026-07-01: first run, the pour step was manual — demoted to `keita`.
