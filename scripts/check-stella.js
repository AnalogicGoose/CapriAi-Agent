'use strict';
// Isolated Stella renderer check: hidden window, no main app, model or profile.
// node_modules/electron/dist/electron.exe scripts/check-stella.js
// Sections are named; each returns {name, ok, notes}. Add new sections to SECTIONS in the page.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.caprigpt-local', 'stella-check');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const timeout = setTimeout(() => { console.error('Stella check timed out'); app.exit(1); }, 60000);
const fail = message => { console.error('Stella check failed: ' + message); app.exit(1); };

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
          let t = 1;
          for (let i = 0; i < frames; i++) { blend.step(1 / 60); clock.step(1 / 60, blend, null, motions, {aim}); t += 1 / 60; }
          return {scene: buildScene({s: size, t, clock, blend, idle: null, motions, aim}), t};
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
