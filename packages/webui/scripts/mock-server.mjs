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
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  BASE_SEQ,
  applyDeltaToGraph,
  bigGraph,
  entityGraph,
  entityNeighbors,
  initialGraph,
  mockDocs,
  nextDelta,
  timeline,
} from './mock-data.mjs';

const RING_LIMIT = 256;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Collect a request body stream into one Buffer. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

/** A deliberately small frontmatter reader (mirrors the client + engine). */
function splitFrontmatter(text) {
  const t = String(text).replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return { data: {}, body: t };
  const end = t.indexOf('\n---\n', 3);
  if (end === -1) return { data: {}, body: t };
  const raw = t.slice(4, end);
  const body = t.slice(end + 5);
  const data = {};
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    } else {
      data[key] = val.replace(/^"(.*)"$/, '$1');
    }
  }
  return { data, body };
}

/** Resolve a link href against a doc path to a bundle-relative path. */
function resolveHref(fromPath, href) {
  const h = String(href).split('#')[0];
  if (h === '' || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // external / scheme
  const parts = h.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  for (const seg of h.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Outbound markdown links from a body that point at bundle .md docs. */
function outboundMdLinks(body, fromPath) {
  const out = [];
  const re = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const resolved = resolveHref(fromPath, m[1]);
    if (resolved && /\.md$/.test(resolved)) out.push(resolved);
  }
  return out;
}

/** Synthesize a doc's full content (frontmatter + body) for a stable base_sha. */
function synthFullContent(doc) {
  const fm = ['---'];
  if (doc.type) fm.push(`type: ${doc.type}`);
  fm.push(`title: ${doc.title}`);
  if (doc.description) fm.push(`description: ${doc.description}`);
  if (doc.tags && doc.tags.length > 0) fm.push(`tags: [${doc.tags.join(', ')}]`);
  if (doc.timestamp) fm.push(`timestamp: ${doc.timestamp}`);
  fm.push('---', '');
  return `${fm.join('\n')}\n${doc.text.replace(/^\n+/, '')}`;
}
// T3 is fresh in the mock so the entity/overlay layers are developable offline.
const TIERS = { t1: 'fresh', t2: 'off', t3: 'fresh' };
// MOCK_BIG serves a 66-doc synthetic brain instead of the 10-doc kotiaurinko —
// used to make the holographic brain's VOLUME obvious in manual/screenshot review.
const START_GRAPH = process.env.MOCK_BIG ? bigGraph() : initialGraph();

/** A calm sci-fi placeholder image for an embedded asset (dev only). */
function assetPlaceholderSvg(name) {
  const label = String(name).replace(/[<&>]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a1830"/><stop offset="1" stop-color="#161033"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0" stop-color="#4be1ff" stop-opacity="0.4"/><stop offset="1" stop-color="#4be1ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="320" fill="url(#g)"/>
  <rect width="640" height="320" fill="url(#glow)"/>
  <g fill="none" stroke="#4be1ff" stroke-opacity="0.18">
    ${Array.from({ length: 9 }, (_, i) => `<line x1="${i * 80}" y1="0" x2="${i * 80}" y2="320"/>`).join('')}
    ${Array.from({ length: 5 }, (_, i) => `<line x1="0" y1="${i * 80}" x2="640" y2="${i * 80}"/>`).join('')}
  </g>
  <circle cx="320" cy="132" r="42" fill="none" stroke="#4be1ff" stroke-width="2" stroke-opacity="0.7"/>
  <circle cx="320" cy="132" r="6" fill="#4be1ff"/>
  <text x="320" y="222" font-family="ui-monospace, monospace" font-size="20" fill="#9fdcff" text-anchor="middle" opacity="0.9">${label}</text>
  <text x="320" y="250" font-family="ui-monospace, monospace" font-size="12" fill="#6d7f96" text-anchor="middle">embedded image · mock</text>
</svg>`;
}

function sseFrame(event, data, id) {
  let out = `event: ${event}\n`;
  if (id !== undefined) out += `id: ${id}\n`;
  out += `data: ${JSON.stringify(data)}\n\n`;
  return out;
}

export function createMockServer({ stepMs = 6000 } = {}) {
  let seq = BASE_SEQ;
  let graph = START_GRAPH;
  let step = 0;
  /** @type {{seq: number, delta: object}[]} */
  const ring = [];
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  const docs = new Map(mockDocs().map((d) => [d.path, d]));
  /** path -> sha256 of its full content — the editor's base_sha (spec/50 follow-up). */
  const contentShas = new Map();
  let stepTimer = null;
  let pingTimer = null;

  function currentSha(path) {
    if (contentShas.has(path)) return contentShas.get(path);
    const doc = docFor(path);
    if (!doc) return null;
    const s = sha256(synthFullContent(doc));
    contentShas.set(path, s);
    return s;
  }

  const nodeTitle = (id) => graph.nodes.find((n) => n.id === id)?.title ?? id;

  function broadcast(text) {
    for (const res of clients) res.write(text);
  }

  function tickMutation() {
    // The scripted cycle mutates kotiaurinko nodes; skip it for the big synthetic
    // brain (MOCK_BIG), which has none of them — the brain simply stays static.
    if (!graph.nodes.some((n) => n.id === 'kuu.md')) return;
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
    // `sha` is the editor's base_sha. The reference engine doesn't emit it on GET
    // yet (a spec/50 follow-up) — the mock leads so the guarded-save flow is fully
    // developable and the 409 conflict path is demoable offline.
    sendJson(res, 200, { path, frontmatter, title: doc.title, text: doc.text, neighbors, sha: currentSha(path) });
  }

  /** PUT /api/docs/{path} — the guarded save, mirroring spec/50 status codes. */
  async function handleDocWrite(req, res, path) {
    const raw = await readBody(req);
    if (!path.endsWith('.md')) {
      sendJson(res, 400, { ok: false, instruction: 'the editor writes .md docs — target a path ending in .md' });
      return;
    }
    let body = null;
    try {
      body = JSON.parse(raw.toString('utf-8'));
    } catch {
      body = null;
    }
    if (!body || typeof body.content !== 'string') {
      sendJson(res, 400, { error: 'send JSON: {content, base_sha?, mode?}' });
      return;
    }
    const content = body.content;
    const mode = typeof body.mode === 'string' ? body.mode : 'replace';
    const baseSha = typeof body.base_sha === 'string' ? body.base_sha : null;
    const existed = graph.nodes.some((n) => n.id === path) || docs.has(path);

    if (mode === 'create' && existed) {
      sendJson(res, 422, { ok: false, instruction: `'${path}' already exists — open it and use Save to replace it` });
      return;
    }
    // Optimistic concurrency: a stale base_sha means someone changed it first.
    if (baseSha && existed) {
      const current = currentSha(path);
      if (current && baseSha !== current) {
        sendJson(res, 409, {
          ok: false,
          conflict: true,
          current_sha: current,
          theirs: synthFullContent(docFor(path) ?? { title: path, text: '', type: null, tags: [] }),
          instruction: 'the doc changed since you opened it — reconcile against theirs, then save again with the new base_sha',
          merged: { content, strategy: 'three-way' },
        });
        return;
      }
    }
    // The henxels referee, mocked: the two lessons the brain teaches a writer.
    const { data, body: bodyMd } = splitFrontmatter(content);
    if (!data.type) {
      sendJson(res, 422, { ok: false, instruction: 'type is required — one of Concept, Reference, Decision, Playbook' });
      return;
    }
    if (outboundMdLinks(bodyMd, path).length === 0) {
      sendJson(res, 422, {
        ok: false,
        instruction:
          'a concept is a node in the knowledge graph, not an orphan — link out to at least one neighbouring page (henxels: min_outbound_links)',
      });
      return;
    }
    const newSha = sha256(content);
    applySave(path, data, bodyMd, existed);
    contentShas.set(path, newSha);
    sendJson(res, 200, { ok: true, path, seq, sha: newSha });
  }

  /** Apply a save to the docs map + graph and broadcast the live delta. */
  function applySave(path, data, bodyMd, existed) {
    const now = typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const tags = Array.isArray(data.tags) ? data.tags : [];
    docs.set(path, {
      path,
      title: data.title || path,
      description: data.description || null,
      type: data.type || null,
      tags,
      timestamp: now,
      reserved: false,
      text: bodyMd,
    });
    seq += 1;
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const targets = [...new Set(outboundMdLinks(bodyMd, path))].filter((t) => nodeIds.has(t) && t !== path);
    const delta = {
      seq,
      added: { nodes: [], edges: [] },
      removed: { nodes: [], edges: [] },
      updated: { nodes: [] },
      stats: { ...graph.stats },
      cause: { paths: [path], tier: 't1' },
    };
    const existingNode = graph.nodes.find((n) => n.id === path);
    if (existed && existingNode) {
      delta.updated.nodes.push({
        ...existingNode,
        title: data.title || existingNode.title,
        description: data.description ?? existingNode.description,
        type: data.type ?? existingNode.type,
        tags,
        timestamp: now,
      });
    } else {
      delta.added.nodes.push({
        id: path,
        title: data.title || path,
        description: data.description || null,
        type: data.type || 'Concept',
        tags,
        timestamp: now,
        in: 0,
        out: targets.length,
        orphan: targets.length === 0,
        reserved: false,
      });
      for (const t of targets) delta.added.edges.push({ source: path, target: t, kind: 'link', label: null, count: 1 });
      for (const t of targets) {
        const tn = graph.nodes.find((n) => n.id === t);
        if (tn) delta.updated.nodes.push({ ...tn, in: tn.in + 1 });
      }
      delta.stats = { ...graph.stats, docs: graph.stats.docs + 1, edges: graph.stats.edges + targets.length };
    }
    graph = applyDeltaToGraph(graph, delta);
    ring.push({ seq, delta });
    while (ring.length > RING_LIMIT) ring.shift();
    broadcast(sseFrame('graph.delta', delta, seq));
    broadcast(sseFrame('compile.status', { seq, state: 'done', tier: 't1' }));
  }

  /** POST /api/assets — accept an image and return its bundle-relative path. */
  async function handleAssetUpload(req, res) {
    const raw = await readBody(req);
    const head = raw.subarray(0, 4096).toString('latin1');
    const nameMatch = /filename="([^"]+)"/i.exec(head);
    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const rawName = nameMatch ? nameMatch[1] : '';
    const ct = (ctMatch ? ctMatch[1] : '').trim().toLowerCase();
    const looksImage = ct.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(rawName);
    if (!looksImage) {
      sendJson(res, 400, { error: 'assets must be png, jpeg, webp, gif, or svg images' });
      return;
    }
    if (raw.length > MAX_ASSET_BYTES) {
      sendJson(res, 413, { error: `asset is ${raw.length} bytes — the cap is ${MAX_ASSET_BYTES} (raise [serve] max_asset_bytes)` });
      return;
    }
    let name = (rawName || `image-${Date.now()}.png`)
      .toLowerCase()
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/[^a-z0-9._-]+/g, '-');
    if (!/\.(png|jpe?g|webp|gif|svg)$/.test(name)) name += '.png';
    sendJson(res, 201, { path: `assets/${name}`, sha: sha256(raw), bytes: raw.length });
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

    // The write surface (spec/50): guarded doc save + image upload.
    if (req.method === 'PUT' && path.startsWith('/api/docs/')) {
      void handleDocWrite(req, res, path.slice('/api/docs/'.length));
      return;
    }
    if (req.method === 'POST' && path === '/api/assets') {
      void handleAssetUpload(req, res);
      return;
    }

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
        // spec/50: the editor's gate. The mock is writable so the whole editor is
        // developable offline; a real engine defaults to "guarded" as well.
        writes: 'guarded',
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
    } else if (path === '/api/timeline') {
      // The advisory git-history timeline (spec/90). ETag by seq like /api/graph;
      // the synthetic history is static (it is the past, not the live seq).
      const etag = `"${seq}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'access-control-allow-origin': '*' });
        res.end();
        return;
      }
      sendJson(res, 200, timeline(), { etag });
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
    } else if (path.startsWith('/assets/')) {
      // Dev convenience: render a themed placeholder for any embedded image so an
      // uploaded `![alt](assets/x.png)` shows in the editor (the real engine serves
      // the actual bytes from the bundle's assets/ folder).
      const name = path.slice('/assets/'.length) || 'image';
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' });
      res.end(assetPlaceholderSvg(name));
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
