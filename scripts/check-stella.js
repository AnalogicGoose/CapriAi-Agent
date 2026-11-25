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
        await section('renderer', async () => {
          const {StellaRenderer} = await import('${url('renderer.js')}');
          const {MOTIONS} = await import('${url('motions.js')}');
          R3 = new StellaRenderer(rcv); R3.setSize(S, 1); G3 = rcv.getContext('webgl2');
          check(G3, 'no webgl2 context');
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
          return names.length + ' tiles ok; idle t vs t+0.5s differs in ' + diff + ' channels';
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
