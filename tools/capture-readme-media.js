'use strict';
// Renders the README pictures from the real Stella code: no main app, model or profile.
//   node_modules/electron/dist/electron.exe tools/capture-readme-media.js
//   python tools/build-readme-gif.py          (needs Pillow; turns the frames into docs/media/stella.gif)
// Writes .stella-local/readme-media/frames/*.png, docs/media/states.png, docs/media/chat.png and
// docs/media/social-preview.png. The Control room picture comes from `npm run test:settings`
// (captures/settings-home.png).
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const work = path.join(root, '.stella-local', 'readme-media');
const frames = path.join(work, 'frames');
const media = path.join(root, 'docs', 'media');
fs.rmSync(frames, { recursive: true, force: true });
for (const dir of [frames, media]) fs.mkdirSync(dir, { recursive: true });
app.setPath('userData', path.join(work, 'profile'));
const timeout = setTimeout(() => { console.error('capture timed out'); app.exit(1); }, 120000);

protocol.registerSchemesAsPrivileged([
  { scheme: 'stella', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const BG = '#100d1d';
const fileUrl = rel => pathToFileURL(path.join(root, rel)).href;
const stellaUrl = name => fileUrl(`src/renderer/js/stella/${name}`);
const fontUrl = file => fileUrl(`node_modules/@fontsource/${file}`);
const savePng = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

// Shared page code: fonts, a starry midnight backdrop and a scene stepper over the real renderer.
const pageLib = `
  const fonts = [
    new FontFace('Chakra Petch', 'url(${fontUrl('chakra-petch/files/chakra-petch-latin-700-normal.woff2')})', { weight: '700' }),
    new FontFace('Chakra Petch', 'url(${fontUrl('chakra-petch/files/chakra-petch-latin-600-normal.woff2')})', { weight: '600' }),
    new FontFace('JetBrains Mono', 'url(${fontUrl('jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2')})', { weight: '400' }),
  ];
  for (const f of fonts) document.fonts.add(await f.load());
  const {StellaRenderer} = await import('${stellaUrl('renderer.js')}');
  const {buildScene, SceneClock} = await import('${stellaUrl('scene.js')}');
  const {StateBlend} = await import('${stellaUrl('blend.js')}');
  let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const backdrop = (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b0a18'); g.addColorStop(0.55, '${BG}'); g.addColorStop(1, '#1a1233');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    seed = 7;
    for (let i = 0; i < w * h / 2600; i++) {
      x.globalAlpha = 0.15 + rand() * 0.45; x.fillStyle = rand() > 0.8 ? '#f2d7a6' : '#b9c4ff';
      const r = rand() * 1.1 + 0.3; x.beginPath(); x.arc(rand() * w, rand() * h, r, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
  };
  const glow = (x, cx, cy, r) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(120,110,255,0.20)'); g.addColorStop(1, 'rgba(120,110,255,0)');
    x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  };
  const rcv = document.createElement('canvas'); document.body.appendChild(rcv);
  const R = new StellaRenderer(rcv);
  const stepper = () => {
    const clock = new SceneClock(), blend = new StateBlend(); let t = 1;
    return (mode, voice, dt, size) => {
      blend.setMode(mode); blend.setVoice(voice);
      blend.step(dt); clock.step(dt, blend, null, {}, {aim: null}); t += dt;
      R.draw(buildScene({s: size, t, clock, blend, idle: null, motions: {}, aim: null, trailAngle: null}), t);
      return rcv;
    };
  };
`;

async function capturePages() {
  const win = new BrowserWindow({ show: false, width: 400, height: 300,
    webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(60);
  const page = path.join(work, 'page.html'); // a file page, so it may import the renderer's file modules
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><body style="margin:0">');
  await win.loadFile(page);
  const out = await win.webContents.executeJavaScript(`(async () => {
    ${pageLib}
    const result = { frames: [] };

    // ---- hero banner: idle -> listen -> think -> speak -> idle, 15 fps ----
    const W = 900, H = 300, S = 280, FPS = 15, SUB = 4;
    R.setSize(S, 1);
    const hero = document.createElement('canvas'); hero.width = W; hero.height = H;
    const hx = hero.getContext('2d');
    const base = document.createElement('canvas'); base.width = W; base.height = H;
    const bx = base.getContext('2d');
    backdrop(bx, W, H); glow(bx, 200, H / 2, 190);
    bx.fillStyle = '#f4f1ff'; bx.font = '700 72px "Chakra Petch"'; bx.fillText('Stella', 390, 140);
    const ring = bx.createLinearGradient(390, 0, 840, 0);
    ring.addColorStop(0, '#f2d27e'); ring.addColorStop(0.5, '#e9a3c4'); ring.addColorStop(1, '#a9a2ff');
    bx.fillStyle = ring; bx.fillRect(392, 160, 200, 2);
    bx.fillStyle = '#c9c3ea'; bx.font = '400 19px "JetBrains Mono"';
    bx.fillText('A living AI companion', 392, 200);
    bx.fillText('for your Windows desktop.', 392, 228);
    const timeline = [['idle', 1.8], ['listen', 1.4], ['think', 1.6], ['speak', 2.2], ['idle', 1.4]];
    const step = stepper(); let n = 0;
    for (let i = 0; i < 40 * SUB; i++) step('idle', 0, 1 / 60, S); // settle first
    for (const [mode, secs] of timeline) {
      for (let f = 0; f < Math.round(secs * FPS); f++, n++) {
        let c;
        for (let k = 0; k < SUB; k++) {
          const voice = mode === 'speak' ? 0.35 + 0.35 * Math.abs(Math.sin(n * 0.9 + k)) : 0;
          c = step(mode, voice, 1 / 60, S);
        }
        hx.drawImage(base, 0, 0); hx.drawImage(c, 200 - S / 2, H / 2 - S / 2);
        result.frames.push(hero.toDataURL('image/png'));
      }
    }

    // ---- states strip ----
    const SS = 220, labels = [['idle', 'Idle'], ['listen', 'Listening'], ['think', 'Thinking'], ['speak', 'Speaking']];
    R.setSize(SS, 1);
    const strip = document.createElement('canvas'); strip.width = SS * 4; strip.height = SS + 44;
    const sx = strip.getContext('2d'); backdrop(sx, strip.width, strip.height);
    sx.textAlign = 'center'; sx.font = '600 17px "Chakra Petch"'; sx.fillStyle = '#d9d4f5';
    labels.forEach(([mode, label], i) => {
      const s = stepper(); let c;
      for (let k = 0; k < 70; k++) c = s(mode, mode === 'speak' ? 0.7 : 0, 1 / 60, SS);
      glow(sx, i * SS + SS / 2, SS / 2, 150); sx.drawImage(c, i * SS, 0); sx.fillStyle = '#d9d4f5'; sx.fillText(label, i * SS + SS / 2, SS + 28);
    });
    result.states = strip.toDataURL('image/png');

    // ---- social preview 1280x640 ----
    const PW = 1280, PH = 640, PS = 460;
    R.setSize(PS, 1);
    const pv = document.createElement('canvas'); pv.width = PW; pv.height = PH;
    const px = pv.getContext('2d'); backdrop(px, PW, PH); glow(px, 340, PH / 2, 330);
    const ps = stepper(); let pc; for (let k = 0; k < 70; k++) pc = ps('idle', 0, 1 / 60, PS);
    px.drawImage(pc, 340 - PS / 2, PH / 2 - PS / 2);
    px.fillStyle = '#f4f1ff'; px.font = '700 120px "Chakra Petch"'; px.fillText('Stella', 640, 300);
    const pr = px.createLinearGradient(640, 0, 1200, 0);
    pr.addColorStop(0, '#f2d27e'); pr.addColorStop(0.5, '#e9a3c4'); pr.addColorStop(1, '#a9a2ff');
    px.fillStyle = pr; px.fillRect(644, 332, 300, 3);
    px.fillStyle = '#c9c3ea'; px.font = '400 30px "JetBrains Mono"';
    px.fillText('A living AI companion', 644, 392); px.fillText('for your Windows desktop.', 644, 434);
    px.fillStyle = '#8f88c0'; px.font = '400 22px "JetBrains Mono"';
    px.fillText('voice · memory · desktop help', 644, 500);
    result.preview = pv.toDataURL('image/png');
    return result;
  })()`);
  out.frames.forEach((d, i) => savePng(path.join(frames, `frame-${String(i).padStart(3, '0')}.png`), d));
  savePng(path.join(media, 'states.png'), out.states);
  savePng(path.join(media, 'social-preview.png'), out.preview);
  win.destroy();
  return out.frames.length;
}

// The real overlay page with a stub host (as in scripts/check-stella.js), a sample conversation open.
async function captureChat() {
  const { DEFAULTS } = require('../src/main/config.js');
  const W = 940, H = 560;
  const config = { ...DEFAULTS, lang: 'en', stellaAnchor: { x: 760, y: 400 }, wander: false, wakeWordEnabled: false };
  const preload = path.join(work, 'host-stub.js');
  fs.writeFileSync(preload, `'use strict';
const config = ${JSON.stringify(config)};
const listeners = {};
const known = {
  getConfig: async () => ({ ...config }),
  setConfig: async patch => { Object.assign(config, patch); return { ...config }; },
  listSounds: async () => [], windowsNow: async () => null, cursor: async () => null,
  fullscreenState: async () => ({ active: false, revision: 0 }),
};
window.stellaCheck = { patches: [], listeners, stella: null };
window.host = new Proxy({}, { get(_, key) {
  if (typeof key !== 'string') return undefined;
  if (Object.hasOwn(known, key)) return known[key];
  if (/^on[A-Z]/.test(key)) return fn => { (listeners[key] ||= []).push(fn); return () => {}; };
  return () => Promise.resolve(null);
} });
`);
  protocol.handle('stella', request => {
    const url = new URL(request.url);
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'app' || !target.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
    if (!fs.existsSync(target)) return new Response('missing', { status: 404 });
    return new Response(fs.readFileSync(target), { headers: { 'content-type': types[path.extname(target)] || 'application/octet-stream' } });
  });
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true,
    webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(60);
  await win.loadURL('stella://app/src/renderer/index.html');
  // insertCSS is not bound by the page's CSP: a night-sky desktop behind her
  await win.webContents.insertCSS('html,body{background:radial-gradient(ellipse at 75% 70%,#2a1f55 0%,#141029 45%,#0b0a18 100%)!important}');
  await win.webContents.executeJavaScript(`(async () => {
    const S = window.stellaCheck, wait = ms => new Promise(res => setTimeout(res, ms));
    for (let i = 0; i < 200 && document.documentElement.dataset.stellaReady !== 'true'; i++) await wait(50);
    for (let i = 0; i < 100 && S.stella?.fold !== 0; i++) await wait(50);
    for (const f of S.listeners.onCommand || []) f({ name: 'chat' });
    await wait(1800);
    const panel = document.getElementById('panel');
    panel.classList.add('has-chat-turn');
    const quote = panel.querySelector('.panel__quote');
    quote.textContent = 'Can you help me plan my week?'; quote.hidden = false;
    panel.querySelector('.panel__line').innerHTML = 'Sure. Let\\u2019s start with the <b>one thing</b> that would make this week feel like a win, then fit the rest around it.';
    document.activeElement?.blur?.();
    S.stella.onMove?.(S.stella.head()); // the panel sits next to her
    await wait(600);
  })()`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(media, 'chat.png'), image.toPNG());
  win.destroy();
}

app.on('window-all-closed', () => {}); // one page closes before the next opens
app.whenReady().then(async () => {
  try {
    const count = await capturePages();
    await captureChat();
    console.log(`frames: ${count} in ${frames}`);
    console.log(`wrote ${['states.png', 'chat.png', 'social-preview.png'].map(f => path.join(media, f)).join(', ')}`);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error && (error.stack || error.message) || JSON.stringify(error));
    app.exit(1);
  }
});
