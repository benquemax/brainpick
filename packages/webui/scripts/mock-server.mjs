#!/usr/bin/env node
/**
 * Standalone mock of the brainpick REST + SSE surface (spec/50, spec/60) so
 * the web UI is fully developable with no backend. Plain node:http, no
 * dependencies. Data: scripts/mock-data.mjs (kotiaurinko-derived).
 *
 * Serves: /api/health /api/status /api/graph /api/docs/{path} /api/search
 * /api/live — the live stream emits a scripted delta every few seconds and
 * supports Last-Event-ID replay from a ring buffer, snapshot resync when
 * the id fell out of the buffer, and `: ping` heartbeats.
 *
 *   node scripts/mock-server.mjs          # 127.0.0.1:4747
 *   MOCK_PORT=5050 MOCK_STEP_MS=2000 node scripts/mock-server.mjs
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  BASE_SEQ,
  applyDeltaToGraph,
  entityGraph,
  entityNeighbors,
  initialGraph,
  mockDocs,
  nextDelta,
} from './mock-data.mjs';

const RING_LIMIT = 256;
// T3 is fresh in the mock so the entity/overlay layers are developable offline.
const TIERS = { t1: 'fresh', t2: 'off', t3: 'fresh' };

function sseFrame(event, data, id) {
  let out = `event: ${event}\n`;
  if (id !== undefined) out += `id: ${id}\n`;
  out += `data: ${JSON.stringify(data)}\n\n`;
  return out;
}

export function createMockServer({ stepMs = 6000 } = {}) {
  let seq = BASE_SEQ;
  let graph = initialGraph();
  let step = 0;
  /** @type {{seq: number, delta: object}[]} */
  const ring = [];
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  const docs = new Map(mockDocs().map((d) => [d.path, d]));
  let stepTimer = null;
  let pingTimer = null;

  const nodeTitle = (id) => graph.nodes.find((n) => n.id === id)?.title ?? id;

  function broadcast(text) {
    for (const res of clients) res.write(text);
  }

  function tickMutation() {
    broadcast(sseFrame('compile.status', { seq, state: 'running', tier: 't1' }));
    setTimeout(() => {
      const delta = nextDelta(graph, seq + 1, step);
      step += 1;
      seq = delta.seq;
      graph = applyDeltaToGraph(graph, delta);
      ring.push({ seq, delta });
      while (ring.length > RING_LIMIT) ring.shift();
      broadcast(sseFrame('graph.delta', delta, seq));
      broadcast(sseFrame('compile.status', { seq, state: 'done', tier: 't1' }));
    }, 350);
  }

  function docFor(path) {
    const base = docs.get(path);
    if (base && graph.nodes.some((n) => n.id === path)) return base;
    // dynamic doc for the scripted uusi.md while it exists in the graph
    if (path === 'uusi.md' && graph.nodes.some((n) => n.id === 'uusi.md')) {
      return {
        path: 'uusi.md',
        title: 'Uusi',
        description: 'A freshly discovered rock.',
        type: 'Concept',
        tags: ['uusi'],
        timestamp: '2026-07-02T09:00:00Z',
        reserved: false,
        text: '# Uusi\n\nIt circles close to [Kuu](kuu.md).\n',
      };
    }
    return undefined;
  }

  function handleDocs(path, res) {
    const doc = docFor(path);
    if (!doc) {
      const suggestions = [...graph.nodes.map((n) => n.id)]
        .filter((id) => id.includes(path.split('/').pop()?.replace(/\.md$/, '') ?? path))
        .slice(0, 5);
      sendJson(res, 404, { error: `no document at '${path}' — pick one of the suggestions`, suggestions });
      return;
    }
    const frontmatter = {};
    if (doc.type !== null) frontmatter.type = doc.type;
    if (doc.description !== null) frontmatter.description = doc.description;
    if (doc.tags.length > 0) frontmatter.tags = doc.tags;
    if (doc.timestamp !== null) frontmatter.timestamp = doc.timestamp;
    const neighbors = {
      in: graph.edges.filter((e) => e.target === path).map((e) => ({ path: e.source, title: nodeTitle(e.source) })),
      out: graph.edges.filter((e) => e.source === path).map((e) => ({ path: e.target, title: nodeTitle(e.target) })),
    };
    sendJson(res, 200, { path, frontmatter, title: doc.title, text: doc.text, neighbors });
  }

  function handleSearch(url, res) {
    const q = url.searchParams.get('q') ?? '';
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? '8') || 8));
    // Mode handling mirrors the engine's query router on a T2-less bundle
    // (TIERS.t2 is 'off' here): keyword answers everything, and semantic/auto/
    // graph honestly report what they degraded from. Unknown modes -> auto.
    const requested = url.searchParams.get('mode') ?? 'auto';
    const mode = ['auto', 'keyword', 'semantic', 'graph'].includes(requested) ? requested : 'auto';
    const degradedFrom = mode === 'keyword' ? null : mode === 'graph' ? 'graph' : 'semantic';
    const tokens = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const hits = [];
    if (tokens.length > 0) {
      for (const node of graph.nodes) {
        const doc = docFor(node.id);
        if (!doc || doc.reserved) continue; // reserved docs are excluded from search
        const title = doc.title.toLowerCase();
        const desc = (doc.description ?? '').toLowerCase();
        const text = doc.text.toLowerCase();
        let score = 0;
        let firstIdx = -1;
        for (const token of tokens) {
          if (title.includes(token)) score += 3;
          if (desc.includes(token)) score += 2;
          const idx = text.indexOf(token);
          if (idx >= 0) {
            score += 1;
            if (firstIdx < 0 || idx < firstIdx) firstIdx = idx;
          }
        }
        if (score > 0) {
          let snippet = null;
          if (firstIdx >= 0) {
            const start = Math.max(0, firstIdx - 60);
            snippet = doc.text.slice(start, start + 240).replace(/\s+/g, ' ').trim();
          }
          hits.push({
            path: node.id,
            title: doc.title,
            description: doc.description,
            score: Number((score / tokens.length).toFixed(3)),
            snippet,
            source: 'keyword',
          });
        }
      }
      hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    }
    sendJson(res, 200, { hits: hits.slice(0, limit), used_modes: ['keyword'], degraded_from: degradedFrom });
  }

  function handleLive(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
      'x-accel-buffering': 'no',
    });
    res.write(sseFrame('hello', { seq, spec_version: '0.1', tiers: TIERS }, seq));

    const lastHeader = req.headers['last-event-id'];
    const last = typeof lastHeader === 'string' ? Number.parseInt(lastHeader, 10) : NaN;
    if (Number.isFinite(last) && last < seq) {
      const floor = ring.length > 0 ? ring[0].seq : Infinity;
      if (last + 1 >= floor) {
        for (const entry of ring) {
          if (entry.seq > last) res.write(sseFrame('graph.delta', entry.delta, entry.seq));
        }
      } else {
        res.write(sseFrame('graph.snapshot', { graph, seq }, seq));
      }
    }

    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  function sendJson(res, status, body, extraHeaders = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      ...extraHeaders,
    });
    res.end(payload);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);

    if (path === '/api/health') {
      sendJson(res, 200, { impl: 'mock', name: 'brainpick', spec_version: '0.1', version: '0.1.0' });
    } else if (path === '/api/status') {
      sendJson(res, 200, {
        seq,
        tiers: TIERS,
        docs: graph.stats.docs,
        edges: graph.stats.edges,
        ghosts: graph.stats.ghosts,
        orphans: graph.stats.orphans,
        bundle_root: '/mock/kotiaurinko',
        watching: true,
      });
    } else if (path === '/api/graph') {
      const layer = url.searchParams.get('layer') ?? 'links';
      if (layer !== 'links' && layer !== 'entities') {
        sendJson(res, 404, { error: `layer '${layer}' is not compiled — use layer=links or layer=entities` });
        return;
      }
      const etag = `"${seq}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'access-control-allow-origin': '*' });
        res.end();
        return;
      }
      sendJson(res, 200, layer === 'entities' ? entityGraph() : graph, { etag });
    } else if (path === '/api/neighbors') {
      const center = url.searchParams.get('id') ?? '';
      const layer = url.searchParams.get('layer') ?? 'links';
      const depth = Math.max(1, Math.min(3, Number(url.searchParams.get('depth') ?? '1') || 1));
      if (!graph.nodes.some((n) => n.id === center)) {
        sendJson(res, 404, { error: `no node '${center}' in the graph`, suggestions: [] });
        return;
      }
      if (layer === 'entities' || layer === 'both') {
        const kg = entityNeighbors(center, depth);
        const nodes = layer === 'both' ? kg.nodes.map((n) => ({ ...n, layer: 'entities' })) : kg.nodes;
        const edges = layer === 'both' ? kg.edges.map((e) => ({ ...e, layer: 'entities' })) : kg.edges;
        sendJson(res, 200, { center, nodes, edges });
      } else {
        sendJson(res, 200, { center, nodes: [], edges: [] });
      }
    } else if (path.startsWith('/api/docs/')) {
      handleDocs(path.slice('/api/docs/'.length), res);
    } else if (path === '/api/search') {
      handleSearch(url, res);
    } else if (path === '/api/live') {
      handleLive(req, res);
    } else {
      sendJson(res, 404, { error: `no route for ${path} — this is the mock API server` });
    }
  });

  return {
    server,
    start(port = 4747, host = '127.0.0.1') {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          stepTimer = setInterval(tickMutation, stepMs);
          pingTimer = setInterval(() => broadcast(': ping\n\n'), 25_000);
          resolve(server.address());
        });
      });
    },
    stop() {
      if (stepTimer) clearInterval(stepTimer);
      if (pingTimer) clearInterval(pingTimer);
      for (const res of clients) res.end();
      clients.clear();
      server.close();
    },
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.MOCK_PORT ?? '4747');
  const stepMs = Number(process.env.MOCK_STEP_MS ?? '6000');
  const mock = createMockServer({ stepMs });
  mock.start(port).then((addr) => {
    console.log(`[mock] brainpick mock API on http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`);
    console.log(`[mock] scripted graph.delta every ${stepMs} ms (MOCK_STEP_MS to change)`);
  });
  process.on('SIGINT', () => {
    mock.stop();
    process.exit(0);
  });
}
