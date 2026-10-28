// Builds dist/waking-up-on-time.pdf: one page per slide, for sending ahead of the talk where email filters
// block .html. The offline HTML's ?print layout is printed once in headless Chrome, so text stays vector and
// searchable and slide titles become bookmarks; interactive demos appear in their default state.
// Usage: npm run pdf            (set SKIP_HTML=1 to reuse an existing dist/waking-up-on-time.html)
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = join(root, 'dist', 'waking-up-on-time.html');
const target = join(root, 'dist', 'waking-up-on-time.pdf');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9347;
const W = 1600; // the deck's stage, in CSS px
const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.env.SKIP_HTML !== '1') execSync('npm run html', { cwd: root, stdio: 'inherit' });

const work = mkdtempSync(join(tmpdir(), 'deck-pdf-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore' },
);

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  wsUrl = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl).catch(() => undefined);
}
if (!wsUrl) throw new Error('Chrome did not start');
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let nextId = 1;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const evaluate = async (session, expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)).result?.value;

try {
  const { targetId } = await send('Target.createTarget', { url: `${pathToFileURL(html).href}?print` });
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, s);
  await send('Page.enable', {}, s);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false }, s);
  await send('Emulation.setEmulatedMedia', { media: 'screen' }, s);
  await sleep(1000);
  await evaluate(s, 'document.fonts.ready.then(() => true)');
  // Every slide is live at once: give the demos time to settle (the medial axis steps auto-play for 3 s).
  await sleep(4500);
  const slides = await evaluate(s, "document.querySelectorAll('.print-deck .stage').length");
  if (!slides) throw new Error('The ?print layout did not render');

  const { data } = await send(
    'Page.printToPDF',
    {
      paperWidth: W / 96,
      paperHeight: H / 96,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    },
    s,
  );
  if (errors.length) throw new Error(`JavaScript errors while printing:\n${errors.join('\n')}`);
  writeFileSync(target, Buffer.from(data, 'base64'));
  const pages = (readFileSync(target, 'latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
  if (pages !== slides) throw new Error(`Expected ${slides} pages, got ${pages}: a slide overflowed its page`);
  console.log(`Built: ${target} (${pages} pages, ${(statSync(target).size / 1024).toFixed(0)} KB)`);
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  rmSync(work, { recursive: true, force: true });
}
