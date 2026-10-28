// Opens dist/waking-up-on-time.html from disk in a throwaway headless Chrome, snapshots slides,
// checks that P no longer opens a presenter window, and reports any JavaScript errors.
// Usage: node scripts/check-html-chrome.mjs [outDir] [slide...]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(root, 'build', 'html-chrome'));
const slides = process.argv.slice(3).map(Number);
const fileUrl = pathToFileURL(join(root, 'dist', 'waking-up-on-time.html')).href;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'deck-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  wsUrl = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl).catch(() => undefined);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let nextId = 1;
const pending = new Map();
const errors = [];
const created = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Target.targetCreated' && msg.params.targetInfo.type === 'page') {
    created.push(msg.params.targetInfo);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const id = nextId++;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const evaluate = async (session, expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true }, session)).result?.result?.value;
const press = (session, key, code, keyCode) =>
  ['keyDown', 'keyUp'].reduce(
    (p, type) => p.then(() => send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, text: type === 'keyDown' && key.length === 1 ? key : undefined }, session)),
    Promise.resolve(),
  );
const attach = async (targetId) => {
  const { result } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, result.sessionId);
  await send('Page.enable', {}, result.sessionId);
  return result.sessionId;
};
const shot = async (session, name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' }, session);
  writeFileSync(join(outDir, name), Buffer.from(result.data, 'base64'));
};

try {
  await send('Target.setDiscoverTargets', { discover: true });
  const created0 = await send("Target.createTarget", { url: `${fileUrl}#1` });
  if (!created0.result) throw new Error(`createTarget failed: ${JSON.stringify(created0.error)}`);
  const { result } = created0;
  const main = await attach(result.targetId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, main);
  await sleep(2500);
  console.log('page:', await evaluate(main, "[navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0], location.protocol, document.title, document.querySelectorAll('.stage').length].join(' | ')"));

  for (const n of slides) {
    await evaluate(main, `location.hash = '#${n}'`);
    await sleep(1200);
    await shot(main, `slide-${n}.png`);
  }

  // The public deck has no presenter view: pressing P must not open a window. A popup would start
  // at about:blank before navigating, so match any new page by its opener.
  const before = created.length;
  await press(main, 'p', 'KeyP', 80);
  await sleep(1500);
  const popup = created.slice(before).find((t) => t.openerId === result.targetId);
  if (popup) errors.push('pressing P opened a window');
  console.log(`presenter view: ${popup ? 'opened (unexpected)' : 'none (expected)'}`);
  console.log(errors.length ? `js errors:\n${errors.join('\n')}` : 'js errors: none');
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(errors.length ? 1 : 0);
