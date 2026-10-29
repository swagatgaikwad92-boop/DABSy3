// Dev/static server: builds (dev mode) then serves dist/. `--dist` serves an existing build without rebuilding.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildApp } from './build.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.map': 'application/json',
};

export function createStaticServer(root = DIST) {
  return http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, path.normalize(p));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      await stat(file);
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5173);
  if (!process.argv.includes('--dist')) {
    await buildApp({ dev: true });
    let t;
    for (const dir of ['src', 'public']) {
      watch(path.join(ROOT, dir), { recursive: true }, () => {
        clearTimeout(t);
        t = setTimeout(() => buildApp({ dev: true }).then(() => console.log('rebuilt')).catch((e) => console.error(e.message)), 150);
      });
    }
  }
  createStaticServer().listen(port, '0.0.0.0', () => console.log(`DABSy dev server → http://localhost:${port}`));
}
