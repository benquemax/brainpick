/** GET /api/live — hand-rolled SSE (spec/60): hello, replay or snapshot, then the feed.
 *
 * A plain res.write pump is all SSE needs; no framework dependency, and the
 * ring-buffer replay rules stay in plain sight. Ports serve/live.py.
 */
import type { Request, Response } from "express";

import { SPEC_VERSION } from "../version";
import { dumps, type ServeState } from "./state";

export const PING_INTERVAL_MS = 25_000; // spec/60: a heartbeat comment at least every 30 s

export function sseFrame(name: string, eventId: number | null, data: string): string {
  const lines = [`event: ${name}`];
  if (eventId !== null) lines.push(`id: ${eventId}`);
  lines.push(`data: ${data}`);
  return lines.join("\n") + "\n\n";
}

export function liveHandler(state: ServeState) {
  return (req: Request, res: Response): void => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const queue = state.subscribe();
    let open = true;
    const finish = (): void => {
      if (!open) return;
      open = false;
      state.unsubscribe(queue);
    };
    res.on("close", finish);

    const hello = { seq: state.seq, spec_version: SPEC_VERSION, tiers: state.tiers() };
    res.write(sseFrame("hello", state.seq, dumps(hello)));

    const raw = req.headers["last-event-id"];
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      const lastId = /^[+-]?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : -1;
      const replay = state.replayEvents(lastId);
      if (replay === null) {
        res.write(sseFrame("graph.snapshot", state.seq, dumps({ graph: state.graph, seq: state.seq })));
      } else {
        for (const [name, eventId, data] of replay) res.write(sseFrame(name, eventId, data));
      }
    }

    void (async () => {
      while (open) {
        const event = await queue.next(PING_INTERVAL_MS);
        if (!open || event === null) break;
        if (event === "timeout") {
          res.write(": ping\n\n");
          continue;
        }
        const [name, eventId, data] = event;
        res.write(sseFrame(name, eventId, data));
      }
    })();
  };
}
