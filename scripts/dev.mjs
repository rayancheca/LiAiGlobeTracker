// scripts/dev.mjs — zero-dependency local dev server.
// Serves the static frontend and mounts the two /api functions with a small
// Vercel-compatible (req.query / res.status().json()) shim, plus the same
// security headers vercel.json ships in production, so local === deployed.
//
//   node scripts/dev.mjs        # http://localhost:3000
//   PORT=8080 node scripts/dev.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // loopback only unless overridden

const vercelCfg = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const securityHeaders = (vercelCfg.headers || []).flatMap((h) => h.headers || []);

const API = {
  '/api/quotes': require(join(root, 'api/quotes.js')),
  '/api/news': require(join(root, 'api/news.js')),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function shim(req, res) {
  const url = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  return url.pathname;
}

http.createServer(async (req, res) => {
  for (const { key, value } of securityHeaders) res.setHeader(key, value);
  const pathname = shim(req, res);

  const fn = API[pathname];
  if (fn) {
    try { await fn(req, res); }
    catch (err) {
      console.error(pathname, err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
    return;
  }

  const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\]|\.\.)+/, '');
  if (rel.split(/[/\\]/).some((seg) => seg.startsWith('.'))) { // no dotfiles (.git, .env, …)
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  try {
    const body = await readFile(join(root, rel));
    res.setHeader('Content-Type', MIME[extname(rel)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`trackAImarket dev server → http://localhost:${PORT}`);
});
