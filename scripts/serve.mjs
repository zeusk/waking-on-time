// Serves the exported deck in out/ with no dependencies, so it runs offline with just Node.
// Usage: node scripts/serve.mjs [port] [--no-open]   (default 3000; opens the browser on macOS)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../out', import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 3000);
const noOpen = args.includes('--no-open') || Boolean(process.env.NO_OPEN);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file).catch(() => readFile(`${file}.html`));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/html; charset=utf-8' }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}/`;
  console.log(`Deck running at ${url}  (press P in the browser for presenter view, Ctrl+C here to stop)`);
  if (process.platform === 'darwin' && !noOpen) exec(`open ${url}`);
});
