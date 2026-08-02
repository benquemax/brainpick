#!/usr/bin/env node
/**
 * A deliberately dumb static file server for the static-export e2e — GitHub
 * Pages semantics: files served verbatim, query strings dropped, no SPA
 * fallback, no API, no SSE. If the snapshot needs anything smarter than
 * this, the export is broken.
 *
 * Usage: node static-server.mjs <dir> <port>
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [dir, port] = [resolve(process.argv[2] ?? '.'), Number(process.argv[3] ?? 0)];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

createServer((req, res) => {
  const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(dir, pathname));
  if (!file.startsWith(dir + sep) && file !== dir) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`static-server: ${dir} on http://127.0.0.1:${port}`);
});
