"""GET /api/live — hand-rolled SSE (spec/60): hello, replay or snapshot, then the feed.

A StreamingResponse generator is all SSE needs; no framework dependency, and the
ring-buffer replay rules stay in plain sight.
"""
from __future__ import annotations

import asyncio

from starlette.requests import Request
from starlette.responses import StreamingResponse

from brainpick import SPEC_VERSION
from brainpick.serve.state import _dumps

PING_INTERVAL = 25.0  # spec/60: a heartbeat comment at least every 30 s


def sse_frame(name: str, event_id: int | None, data: str) -> str:
    lines = [f"event: {name}"]
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"data: {data}")
    return "\n".join(lines) + "\n\n"


async def live_endpoint(request: Request) -> StreamingResponse:
    state = request.app.state.brainpick

    async def stream():
        queue = state.subscribe()
        try:
            hello = {"seq": state.seq, "spec_version": SPEC_VERSION, "tiers": state.manifest.get("tiers", {})}
            yield sse_frame("hello", state.seq, _dumps(hello))

            raw = request.headers.get("last-event-id")
            if raw is not None:
                try:
                    last_id = int(raw.strip())
                except ValueError:
                    last_id = -1
                replay = state.replay_events(last_id)
                if replay is None:
                    snapshot = _dumps({"graph": state.graph, "seq": state.seq})
                    yield sse_frame("graph.snapshot", state.seq, snapshot)
                else:
                    for name, event_id, data in replay:
                        yield sse_frame(name, event_id, data)

            # Replay the latest presentation once (spec/95), after the graph
            # snapshot, so a UI joining mid-presentation sees it. No SSE id — it
            # is out of the delta ring, and a cleared presentation replays as the
            # empty shape.
            if state.presentation is not None:
                yield sse_frame("brain.show", None, _dumps(state.presentation))

            while True:
                try:
                    name, event_id, data = await asyncio.wait_for(queue.get(), timeout=PING_INTERVAL)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield sse_frame(name, event_id, data)
        finally:
            state.unsubscribe(queue)

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)
