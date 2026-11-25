'use strict';
// Isolated Stella renderer check: hidden window, no main app, model or profile.
// node_modules/electron/dist/electron.exe scripts/check-stella.js
// Sections are named; each returns {name, ok, notes}. Page sections run in one window; app-boot
// (below) loads the real overlay page in a second window with a stub host.
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.caprigpt-local', 'stella-check');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const timeout = setTimeout(() => { console.error('Stella check timed out'); app.exit(1); }, 60000);
const fail = message => { console.error('Stella check failed: ' + message); app.exit(1); };
// The overlay page is served as in the app (capri://app/... -> this repo), so its CSP and modules behave the same.
protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.whenReady().then(async () => {
  try {
    const url = name => pathToFileURL(path.join(root, 'src', 'renderer', 'js', 'stella', name)).href;
    const html = `<!doctype html><meta charset="utf-8"><body><script type="module">
      window.stellaResult = (async () => {
        const results = [], files = {};
        const section = async (name, fn) => {
          try { const notes = await fn(); results.push({name, ok: true, notes}); }
          catch (e) { results.push({name, ok: false, notes: String(e && e.stack || e)}); }
        };
        const check = (c, m) => { if (!c) throw Error(m); };
        const png = async c => {
          const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
          const x = cv.getContext('2d'); x.fillStyle = '#12101c'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
          return cv.toDataURL('image/png');
        };
        const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;

        // ---- section: painter ----
        await section('painter', async () => {
          const {BodyPainter} = await import('${url('body-painter.js')}');
          const {buildScene, SceneClock} = await import('${url('scene.js')}');
          const {StateBlend} = await import('${url('blend.js')}');
          const notes = [];
          for (const s of [360, 96]) {
            const clock = new SceneClock(), blend = new StateBlend();
            for (let i = 0; i < 30; i++) { blend.step(1 / 60); clock.step(1 / 60, blend, null, {}); }
            const scene = buildScene({s, t: 1.0, clock, blend, idle: null});
            const painter = new BodyPainter(s);
            const {body, mask} = painter.paint(scene);
            check(body.width === s && mask.width === s, 'canvas size ' + s);
            const bp = pixels(body), mp = pixels(mask);
            let lit = 0, maskPx = 0, solid = 0, solidLit = 0;
            const gMin = Array(8).fill(255), gMax = Array(8).fill(0), seeds = new Set();
            for (let i = 0; i < bp.length; i += 4) {
              if (bp[i + 3] > 0) lit++;
              if (mp[i + 3] > 0) maskPx++;
              if (mp[i + 3] === 255) {
                solid++;
                if (bp[i + 3] > 127) solidLit++;
                const id = Math.round(mp[i + 2] * 8 / 255);
                check(id >= 0 && id < 8, 'bad seed id ' + id);
                seeds.add(id); gMin[id] = Math.min(gMin[id], mp[i + 1]); gMax[id] = Math.max(gMax[id], mp[i + 1]);
              }
            }
            const frac = lit / (s * s);
            check(frac > 0.04, 's=' + s + ' body coverage ' + frac.toFixed(3) + ' <= 4%');
            check(maskPx > 0 && solid > 0, 's=' + s + ' mask empty');
            check(solidLit / solid >= 0.95, 's=' + s + ' only ' + (100 * solidLit / solid).toFixed(1) + '% of solid mask px have body alpha > 0.5');
            check(seeds.size === 8, 's=' + s + ' expected 8 seed ids in mask, got ' + [...seeds]);
            for (let id = 0; id < 8; id++) check(gMin[id] <= (s >= 200 ? 30 : 60) && gMax[id] >= (s >= 200 ? 230 : 150), 's=' + s + ' seed ' + id + ' u range ' + gMin[id] + '..' + gMax[id]);
            // With the ambient glow off, every mask pixel must sit on drawn body.
            const bare = painter.paint({...scene, ambient: 0});
            const bp2 = pixels(bare.body), mp2 = pixels(bare.mask);
            let stray = 0;
            for (let i = 0; i < mp2.length; i += 4) if (mp2[i + 3] > 0 && bp2[i + 3] === 0) stray++;
            check(stray === 0, 's=' + s + ' mask pixels without body (ambient off): ' + stray);
            notes.push('s=' + s + ' body=' + (frac * 100).toFixed(1) + '% mask=' + maskPx + 'px solidLit=' + (100 * solidLit / solid).toFixed(1) + '% seeds=' + seeds.size);
            painter.paint(scene);
            files['body-' + s + '.png'] = await png(body);
            files['mask-' + s + '.png'] = await png(mask);
            if (s === 360) { files['body.png'] = files['body-360.png']; files['mask.png'] = files['mask-360.png']; }
          }
          return notes.join('; ');
        });

        // ---- section: renderer (gallery at s=150, errors, center, animation) ----
        const S = 150, rcv = document.createElement('canvas');
        document.body.appendChild(rcv);
        let R3 = null, G3 = null;
        const MODES3 = ['listen', 'think', 'speak', 'rest'];
        // Steps a fresh clock for N frames in the given state/motion, then draws.
        const render = async (name, frames = 40, size = S) => {
          const {buildScene, SceneClock} = await import('${url('scene.js')}');
          const {StateBlend} = await import('${url('blend.js')}');
          const {MOTIONS} = await import('${url('motions.js')}');
          const clock = new SceneClock(), blend = new StateBlend();
          const mode = MODES3.includes(name) ? name : 'idle';
          blend.setMode(mode); if (mode === 'speak') blend.setVoice(0.7);
          const motions = MOTIONS[name] ? {[name]: 1} : {}, aim = name === 'aim' ? 0.3 : null;
          const trailAngle = name === 'trail' ? 0.3 : null;
          let t = 1;
          for (let i = 0; i < frames; i++) { blend.step(1 / 60); clock.step(1 / 60, blend, null, motions, {aim}); t += 1 / 60; }
          return {scene: buildScene({s: size, t, clock, blend, idle: null, motions, aim, trailAngle}), t};
        };
        // Draws and copies the WebGL canvas synchronously (no await between).
        const snap = (scene, t) => {
          R3.draw(scene, t);
          const err = G3.getError();
          const c = document.createElement('canvas'); c.width = rcv.width; c.height = rcv.height;
          c.getContext('2d').drawImage(rcv, 0, 0);
          return {c, err};
        };
        const centerAlpha = c => {
          const n = 10, d = c.getContext('2d').getImageData(c.width / 2 - n / 2, c.height / 2 - n / 2, n, n).data;
          let m = 0; for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]); return m;
        };
        // Share of pixels with alpha > 40 in the annulus 0.2s..0.46s: blades, sticks,
        // dots and LED glow only (the globe never reaches it), so a blank finish fails.
        const outerLit = c => {
          const w = c.width, d = c.getContext('2d').getImageData(0, 0, w, w).data;
          let n = 0, lit = 0;
          for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
            const r = Math.hypot(x + 0.5 - w / 2, y + 0.5 - w / 2) / w;
            if (r < 0.2 || r > 0.46) continue;
            n++; if (d[(y * w + x) * 4 + 3] > 40) lit++;
          }
          return lit / n;
        };
        await section('renderer', async () => {
          const {StellaRenderer} = await import('${url('renderer.js')}');
          const {MOTIONS} = await import('${url('motions.js')}');
          R3 = new StellaRenderer(rcv); R3.setSize(S, 1); G3 = rcv.getContext('webgl2');
          check(G3, 'no webgl2 context');
          let minOuter = 1;
          const names = ['idle', ...MODES3, ...Object.keys(MOTIONS)], cols = 6, lab = 14;
          const gal = document.createElement('canvas');
          gal.width = cols * S; gal.height = Math.ceil(names.length / cols) * (S + lab);
          const gx = gal.getContext('2d'); gx.fillStyle = '#12101c'; gx.fillRect(0, 0, gal.width, gal.height);
          gx.font = '11px sans-serif'; gx.fillStyle = '#9a96b8';
          for (let i = 0; i < names.length; i++) {
            const {scene, t} = await render(names[i]);
            const {c, err} = snap(scene, t);
            check(err === G3.NO_ERROR, names[i] + ': gl error ' + err);
            const ca = centerAlpha(c);
            check(ca > 40, names[i] + ': center region transparent (max alpha ' + ca + ')');
            const ol = outerLit(c); minOuter = Math.min(minOuter, ol);
            check(ol > 0.08, names[i] + ': finish pass looks blank off-center (lit ' + (100 * ol).toFixed(1) + '%)');
            const x = (i % cols) * S, y = Math.floor(i / cols) * (S + lab);
            gx.drawImage(c, x, y + lab); gx.fillText(names[i], x + 4, y + 11);
          }
          files['gallery.png'] = await png(gal);
          R3.setSize(360, 1);
          for (const n of ['idle', 'speak']) { const big = await render(n, 40, 360); files['finish-360-' + n + '.png'] = await png(snap(big.scene, big.t).c); }
          R3.setSize(S, 1);
          const a = await render('idle', 40), b = await render('idle', 70);
          const pa = pixels(snap(a.scene, a.t).c), pb = pixels(snap(b.scene, b.t).c);
          let diff = 0; for (let i = 0; i < pa.length; i++) if (Math.abs(pa[i] - pb[i]) > 8) diff++;
          check(diff > pa.length * 0.005, 'idle frames t and t+0.5s barely differ: ' + diff);
          // Long sessions: shader phases are wrapped on the CPU and must match the unwrapped math.
          const {sheenPhases} = await import('${url('finish.js')}');
          const {wrapPhase} = await import('${url('gl.js')}');
          const ph = new Float64Array(3), sh = {speed: 0.45, stepped: false};
          for (const T of [1.25, 3600.7, 86400 * 3 + 0.31, 1e7 + 0.123]) {
            sheenPhases(T, sh, ph);
            check(ph[0] >= 0 && ph[0] < 2 * Math.PI && ph[2] >= 0 && ph[2] < 1.4, 'phase out of range at ' + T);
            const f = Math.fround;
            check(Math.abs(Math.sin(f(ph[0])) - Math.sin(23 * T)) < 1e-5, 'sin 23t mismatch at ' + T);
            check(Math.abs(Math.sin(f(ph[1])) - Math.sin(3.1 * T)) < 1e-5, 'sin 3.1t mismatch at ' + T);
            const pos = (T * 0.45) % 1.4;
            check(Math.abs(f(ph[2]) - pos) < 1e-5 || Math.abs(Math.abs(f(ph[2]) - pos) - 1.4) < 1e-5, 'sheen pos mismatch at ' + T);
            check(Math.abs(Math.sin(f(wrapPhase(3 * T, 2 * Math.PI))) - Math.sin(3 * T)) < 1e-5, 'sin 3t mismatch at ' + T);
          }
          // A frame 30 days in still draws cleanly, and shifting the ripple by whole
          // turns (2pi*1e6) leaves the frame unchanged, so the wrap is seamless.
          const far = await render('idle');
          far.scene.globe.ripple += 2 * Math.PI * 1e6;
          const fs = snap(far.scene, 86400 * 30 + far.t);
          check(fs.err === G3.NO_ERROR && outerLit(fs.c) > 0.08 && centerAlpha(fs.c) > 40, 'far-future frame (t=30 days) broken');
          const near = snap(far.scene, far.t);
          const ripA = pixels(near.c);
          far.scene.globe.ripple -= 2 * Math.PI * 1e6;
          const ripB = pixels(snap(far.scene, far.t).c);
          let rd = 0; for (let i = 0; i < ripA.length; i++) if (Math.abs(ripA[i] - ripB[i]) > 2) rd++;
          check(rd < ripA.length * 0.001, 'ripple wrap by 2pi changed the frame: ' + rd + ' channels');
          return names.length + ' tiles ok (min off-center lit ' + (100 * minOuter).toFixed(1) + '%); idle t vs t+0.5s differs in ' + diff + ' channels; phase wrap ok at t up to 1e7 s; ripple+2pi*1e6 frame matches';
        });

        // ---- section: trail (capri_draw: LED dots stream out toward the drawing) ----
        await section('trail', async () => {
          check(R3, 'renderer missing');
          const {buildScene, SceneClock} = await import('${url('scene.js')}');
          const {StateBlend} = await import('${url('blend.js')}');
          const frame = (motions, trailAngle) => {
            const clock = new SceneClock(), blend = new StateBlend();
            let t = 1;
            for (let i = 0; i < 30; i++) { blend.step(1 / 60); clock.step(1 / 60, blend, null, motions); t += 1 / 60; }
            const {c, err} = snap(buildScene({s: S, t, clock, blend, idle: null, motions, trailAngle}), t);
            check(err === G3.NO_ERROR, 'gl error ' + err);
            return c;
          };
          // Lit pixels (bright light, not the dark halo) in a wedge toward \`angle\`, 0.25..0.47 of her size from the center.
          const wedge = (c, angle) => {
            const d = pixels(c); let n = 0;
            for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
              const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2, r = Math.hypot(dx, dy) / S;
              const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - angle), Math.cos(Math.atan2(dy, dx) - angle)));
              const i = (y * S + x) * 4, light = Math.max(d[i], d[i + 1], d[i + 2]) * d[i + 3] / 255;
              if (r >= 0.25 && r <= 0.47 && off < 0.3 && light > 60) n++;
            }
            return n;
          };
          const notes = [];
          for (const angle of [0.3, 2.2, -1.9]) {
            const idle = frame({}, null), trail = frame({trail: 1}, angle);
            const toward = wedge(trail, angle) - wedge(idle, angle), away = wedge(trail, angle + Math.PI) - wedge(idle, angle + Math.PI);
            check(toward >= 12 && toward > 2 * Math.max(away, 0) + 6, 'angle ' + angle + ': trail adds ' + toward + ' lit px toward it, ' + away + ' away');
            notes.push(angle + ': +' + toward + ' toward / +' + away + ' away');
            if (angle === 0.3) files['trail.png'] = await png(trail);
          }
          return 'trail lit through the LED finish ' + notes.join('; ');
        });

        // ---- section: halo (midnight halo: dark frame behind her light, for light backgrounds) ----
        await section('halo', async () => {
          check(R3, 'renderer missing');
          const {buildScene, SceneClock} = await import('${url('scene.js')}');
          const {StateBlend} = await import('${url('blend.js')}');
          const shot = fold => {
            const clock = new SceneClock(), blend = new StateBlend();
            for (let i = 0; i < 30; i++) { blend.step(1 / 60); clock.step(1 / 60, blend, null, {}); }
            const {c, err} = snap(buildScene({s: S, t: 1.5, clock, blend, idle: null, motions: {}, fold}), 1.5);
            check(err === G3.NO_ERROR, 'gl error ' + err);
            return c;
          };
          const c = shot(0), d = pixels(c);
          const at = (r, a) => { const x = Math.round(S / 2 + Math.cos(a) * r * S), y = Math.round(S / 2 + Math.sin(a) * r * S); return d.slice((y * S + x) * 4, (y * S + x) * 4 + 4); };
          // In the gap between a blade and a stick, outside the ring: the halo alone, dark and fairly opaque.
          const on = bg => { const k = document.createElement('canvas'); k.width = k.height = S; const x = k.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, S, S); x.drawImage(c, 0, 0); return k.toDataURL('image/png'); };
          files['halo-on-white.png'] = on('#ffffff'); files['halo-on-light.png'] = on('#e8edf5'); files['halo-on-dark.png'] = on('#12101c');
          const gap = at(0.3, Math.PI / 8);   // unpremultiplied (2D canvas readback)
          check(gap[3] > 0.4 * 255, 'halo too faint in the gap: alpha ' + gap[3]);
          check(Math.max(gap[0], gap[1], gap[2]) < 120, 'halo not dark in the gap: ' + Array.from(gap));
          const corner = d.slice(0, 4);
          check(corner[3] < 8, 'halo reaches the canvas corner: alpha ' + corner[3]);
          const folded = pixels(shot(1)), gapFolded = folded[(Math.round(S / 2 + Math.sin(Math.PI / 8) * 0.3 * S) * S + Math.round(S / 2 + Math.cos(Math.PI / 8) * 0.3 * S)) * 4 + 3];
          check(gapFolded < 10, 'halo stays when folded away: alpha ' + gapFolded);
          return 'gap alpha ' + gap[3] + ' rgb ' + Array.from(gap.slice(0, 3)) + '; corner ' + corner[3] + '; folded ' + gapFolded;
        });

        // ---- section: perf (300 idle frames at s=150) ----
        await section('perf', async () => {
          check(R3, 'renderer missing');
          const {buildScene, SceneClock} = await import('${url('scene.js')}');
          const {StateBlend} = await import('${url('blend.js')}');
          const clock = new SceneClock(), blend = new StateBlend(), px = new Uint8Array(4);
          let t = 1;
          for (let i = 0; i < 20; i++) { blend.step(1 / 60); clock.step(1 / 60, blend, null, {}); R3.draw(buildScene({s: S, t, clock, blend, idle: null}), t); t += 1 / 60; }
          G3.readPixels(0, 0, 1, 1, G3.RGBA, G3.UNSIGNED_BYTE, px);
          const t0 = performance.now();
          for (let i = 0; i < 300; i++) {
            blend.step(1 / 60); clock.step(1 / 60, blend, null, {});
            R3.draw(buildScene({s: S, t, clock, blend, idle: null}), t); t += 1 / 60;
          }
          G3.readPixels(0, 0, 1, 1, G3.RGBA, G3.UNSIGNED_BYTE, px);
          const ms = (performance.now() - t0) / 300;
          check(ms <= 4, 'mean idle frame ' + ms.toFixed(3) + ' ms > 4 ms');
          return 'mean idle frame ' + ms.toFixed(3) + ' ms at s=150';
        });

        // ---- section: context loss ----
        await section('context-loss', async () => {
          check(R3, 'renderer missing');
          const ext = G3.getExtension('WEBGL_lose_context');
          check(ext, 'no WEBGL_lose_context');
          const wait = (type, ms) => new Promise((res, rej) => {
            const to = setTimeout(() => rej(Error('no ' + type + ' event')), ms);
            rcv.addEventListener(type, () => { clearTimeout(to); res(); }, {once: true});
          });
          const lostEv = wait('webglcontextlost', 3000);
          ext.loseContext();
          check(R3.lost, 'renderer.lost false after loseContext');
          const {scene, t} = await render('idle');
          R3.draw(scene, t);
          await lostEv;
          R3.draw(scene, t);
          // A restore that fails (context still lost) keeps lost=true and logs once.
          const errs = [], origErr = console.error;
          console.error = (...a) => errs.push(a);
          try { R3.onRestored(); R3.onRestored(); } finally { console.error = origErr; }
          check(R3.lost, 'renderer not lost after a failed restore');
          check(errs.length === 1, 'failed restore logged ' + errs.length + ' times, expected 1');
          R3.warned = false;
          const back = wait('webglcontextrestored', 3000);
          ext.restoreContext();
          await back;
          check(!R3.lost, 'renderer still lost after restore');
          const {c, err} = snap(scene, t);
          check(err === G3.NO_ERROR, 'gl error after restore ' + err);
          const ca = centerAlpha(c);
          check(ca > 40, 'blank frame after restore (center alpha ' + ca + ')');
          files['restored.png'] = await png(c);
          return 'lost -> no-op draw -> restored, center alpha ' + ca;
        });

        return {results, files};
      })();
    </script>`;
    const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, sandbox: false } });
    const page = path.join(output, 'page.html');
    fs.writeFileSync(page, html);
    await win.loadFile(page);
    const {results, files} = await win.webContents.executeJavaScript('window.stellaResult');
    results.push(await appBoot(files)); // before the first window goes: the last window closing quits the app
    win.destroy();
    for (const [name, data] of Object.entries(files)) {
      fs.writeFileSync(path.join(output, name), Buffer.from(data.split(',')[1], 'base64'));
    }
    let bad = 0;
    for (const r of results) {
      console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' - ' + r.notes);
      if (!r.ok) bad++;
    }
    clearTimeout(timeout);
    app.exit(bad ? 1 : 0);
  } catch (error) { fail(error.stack || error); }
});

// ---- section: app-boot ----
// The real overlay page (src/renderer/index.html) in its own hidden window, with a stub
// `window.host` instead of the main process: every on* is recorded and never fires on its own,
// getConfig returns the defaults (stellaAnchor null, wake word off so no microphone), setConfig
// records patches. The page hands its Stella to window.stellaCheck once built.
async function appBoot(files) {
  const name = 'app-boot';
  let win = null;
  try {
    const { DEFAULTS } = require('../src/main/config.js');
    const config = { ...DEFAULTS, lang: 'en', stellaAnchor: null, wakeWordEnabled: false };
    const preload = path.join(output, 'host-stub.js');
    fs.writeFileSync(preload, `'use strict';
const config = ${JSON.stringify(config)};
const patches = [], listeners = {};
const known = {
  getConfig: async () => ({ ...config }),
  setConfig: async patch => { patches.push(patch); Object.assign(config, patch); return { ...config }; },
  listSounds: async () => [],
  windowsNow: async () => null,
  cursor: async () => null,
  fullscreenState: async () => ({ active: false, revision: 0 }),
};
window.stellaCheck = { patches, listeners, capri: null };
window.host = new Proxy({}, { get(_, key) {
  if (typeof key !== 'string') return undefined;
  if (Object.hasOwn(known, key)) return known[key];
  if (/^on[A-Z]/.test(key)) return fn => { (listeners[key] ||= []).push(fn); return () => {}; };
  return () => Promise.resolve(null);
} });
`);
    win = new BrowserWindow({ show: false, width: 900, height: 700,
      webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(60); // offscreen rendering: frames (and requestAnimationFrame) run without ever showing a window
    const errors = [];
    win.webContents.on('console-message', e => { if (e.level === 'error') errors.push(String(e.message)); });
    win.webContents.on('preload-error', (_e, _p, error) => errors.push('preload: ' + error));
    win.webContents.on('render-process-gone', (_e, d) => errors.push('renderer gone: ' + d.reason));
    if (!protocol.isProtocolHandled('capri')) {
      protocol.handle('capri', request => {
        const url = new URL(request.url);
        const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (url.host !== 'app' || !target.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
        return net.fetch(pathToFileURL(target).toString());
      });
    }
    await win.loadURL('capri://app/src/renderer/index.html');
    let r;
    try { r = await win.webContents.executeJavaScript(`(async () => {
      const S = window.stellaCheck, wait = ms => new Promise(res => setTimeout(res, ms));
      const check = (c, m) => { if (!c) throw Error(m); };
      const until = async (done, ms, what) => {
        for (const t0 = performance.now(); !done();) { if (performance.now() - t0 > ms) throw Error('timed out: ' + what); await wait(20); }
      };
      await until(() => S.capri, 5000, 'Stella built by the page');
      const c = S.capri, canvas = document.getElementById('stella-canvas'), notes = [];
      // non-blank pixels within 2 s (drawn and copied in one task, before the buffer is presented)
      const copy = () => {
        const k = document.createElement('canvas'); k.width = canvas.width; k.height = canvas.height;
        const x = k.getContext('2d'); x.drawImage(canvas, 0, 0);
        const d = x.getImageData(0, 0, k.width, k.height).data;
        let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) lit++;
        return { k, lit };
      };
      let shot = null;
      for (const t0 = performance.now(); performance.now() - t0 < 2000; await wait(50)) {
        c.drawFrame(performance.now());
        shot = copy();
        if (shot.lit > 200) break;
      }
      check(shot && shot.lit > 200, 'stella-canvas still blank after 2 s (' + (shot ? shot.lit : 0) + ' lit px; hidden=' + document.hidden + ' drawn=' + Boolean(c.drawn) + ' fold=' + c.fold + ' renderer=' + Boolean(c.renderer) + ' size=' + canvas.width + ')');
      notes.push('first lit frame ' + shot.lit + ' px');
      await until(() => document.documentElement.dataset.caprigptReady === 'true', 5000, 'boot finished');
      await until(() => c.fold === 0, 2000, 'materialized');
      c.drawFrame(performance.now());
      const full = copy();
      check(full.lit > canvas.width * canvas.height * 0.1, 'materialized frame mostly blank (' + full.lit + ' lit px)');
      notes.push('materialized ' + full.lit + ' px');
      check(c.hit(c.pos.x, c.pos.y), 'capri.hit false at her center');
      // her own agent searching the web: radar
      const act = S.listeners.onAgentActivity || [];
      check(act.length, 'no onAgentActivity listener');
      for (const f of act) f({ tool: 'capri_apps', op: 'search_web', phase: 'start' });
      check(c.act && c.act.player.name === 'radar', 'agent search_web start: act ' + (c.act && c.act.player.name));
      for (const f of act) f({ tool: 'capri_apps', op: 'search_web', phase: 'end', ok: true });
      notes.push('agent search_web -> radar');
      // a drag with synthetic pointer events moves her and saves the anchor
      const root = document.getElementById('stella'), from = { ...c.pos };
      const ev = (type, x, y) => root.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0,
        buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, isPrimary: true, clientX: x, clientY: y }));
      ev('pointerdown', from.x, from.y);
      for (let i = 1; i <= 10; i++) { ev('pointermove', from.x - 15 * i, from.y - 10 * i); await wait(30); }
      ev('pointerup', from.x - 150, from.y - 100);
      await wait(900);
      const moved = Math.hypot(c.pos.x - from.x, c.pos.y - from.y);
      check(moved > 100, 'drag moved her only ' + moved.toFixed(1) + ' px');
      const patch = S.patches.find(p => p && p.stellaAnchor);
      check(patch && Number.isFinite(patch.stellaAnchor.x) && Number.isFinite(patch.stellaAnchor.y), 'no stellaAnchor patch: ' + JSON.stringify(S.patches));
      notes.push('drag moved ' + moved.toFixed(0) + ' px, anchor ' + Math.round(patch.stellaAnchor.x) + ',' + Math.round(patch.stellaAnchor.y));
      // A chat panel keeps the edge next to her in place while its text grows (Stella stands still,
      // so nothing but the panel itself can notice it grew).
      for (const f of S.listeners.onCommand || []) f({ name: 'chat' });
      const panelEl = document.getElementById('panel');
      await until(() => panelEl.classList.contains('is-chat') && !panelEl.hidden, 3000, 'chat panel opens');
      await wait(1500); // greeting decoded
      const edge = () => { const r = panelEl.querySelector('.panel__frame').getBoundingClientRect(); return panelEl.dataset.below === 'true' ? r.top : r.bottom; };
      const before = edge(), heightBefore = panelEl.offsetHeight;
      for (const f of S.listeners.onAgentSuggestion || []) f('A much longer reply that wraps across several lines so the panel has to grow taller than it was when the conversation opened, which is exactly what happens while an answer streams in.');
      await wait(100);
      check(panelEl.offsetHeight > heightBefore + 10, 'panel did not grow (' + heightBefore + ' -> ' + panelEl.offsetHeight + ')');
      check(Math.abs(edge() - before) <= 2, 'panel edge next to her moved ' + (edge() - before).toFixed(1) + ' px when its text grew');
      notes.push('chat panel grows away from her (' + heightBefore + ' -> ' + panelEl.offsetHeight + ' px)');
      return { notes: notes.join('; '), png: full.k.toDataURL('image/png') };
    })()`); } catch (error) {
      throw Error(String(error && error.message || error) + (errors.length ? ' [console errors: ' + errors.join(' | ') + ']' : ''));
    }
    files['app-boot.png'] = r.png;
    if (errors.length) throw Error('console errors: ' + errors.join(' | '));
    return { name, ok: true, notes: r.notes + '; no console errors' };
  } catch (error) {
    return { name, ok: false, notes: String(error && error.stack || error) };
  } finally {
    win?.destroy();
  }
}
