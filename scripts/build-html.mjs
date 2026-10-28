// Builds dist/waking-up-on-time.html: the whole deck in one self-contained file that opens from
// disk in any modern browser, offline. JavaScript is bundled with esbuild; the CSS (with fonts
// embedded as data URIs) is the exact stylesheet Next.js compiled for out/.
// Usage: npm run html            (set SKIP_EXPORT=1 to reuse an existing out/ folder)
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
const target = join(root, 'dist', 'waking-up-on-time.html');

if (process.env.SKIP_EXPORT !== '1') execSync('npm run export', { cwd: root, stdio: 'inherit' });

const exported = readFileSync(join(out, 'index.html'), 'utf8');
const htmlClass = exported.match(/<html[^>]*\bclass="([^"]*)"/)?.[1] ?? '';
const title = exported.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Waking Up On Time';
const description = exported.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
const cssHrefs = [...new Set([...exported.matchAll(/href="(\/_next\/static\/css\/[^"]+\.css)"/g)].map((m) => m[1]))];
if (!cssHrefs.length) throw new Error('No stylesheet found in out/index.html');

const FONT_TYPES = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
const inlineAssets = (css) =>
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q, ref) => {
    if (ref.startsWith('data:') || !ref.includes('/media/')) return whole;
    const file = join(out, '_next', 'static', 'media', basename(ref.split(/[?#]/)[0]));
    const type = FONT_TYPES[file.split('.').pop()] ?? 'application/octet-stream';
    return `url(data:${type};base64,${readFileSync(file).toString('base64')})`;
  });
const css = cssHrefs.map((href) => inlineAssets(readFileSync(join(out, href), 'utf8'))).join('\n');

const bundle = await build({
  entryPoints: [join(root, 'standalone', 'main.tsx')],
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});
// Keep the bundle from ending the inline <script> early.
const js = bundle.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1');

const html = `<!doctype html>
<html lang="en" class="${htmlClass}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, html);
console.log(`Built: ${target} (${(statSync(target).size / 1024).toFixed(0)} KB)`);
