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
const timeout = setTimeout(() => { console.error('Stella check timed out'); app.exit(1); }, 25000);
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
            let lit = 0, maskPx = 0, stray = 0, badSeed = 0;
            for (let i = 0; i < bp.length; i += 4) {
              if (bp[i + 3] > 0) lit++;
              if (mp[i + 3] > 0) { maskPx++; if (bp[i + 3] === 0) stray++; }
            }
            const frac = lit / (s * s);
            check(frac > 0.04, 's=' + s + ' body coverage ' + frac.toFixed(3) + ' <= 4%');
            check(maskPx > 0, 's=' + s + ' mask empty');
            check(stray === 0, 's=' + s + ' mask pixels without body: ' + stray);
            // mask encoding: opaque pixels carry seed 0..7 in B and u in G
            for (let i = 0; i < mp.length; i += 4) if (mp[i + 3] === 255 && mp[i + 2] > 255) badSeed++;
            const hist = new Set();
            for (let i = 0; i < mp.length; i += 4) if (mp[i + 3] === 255) hist.add(Math.round(mp[i + 2] * 8 / 255));
            check(hist.size === 8, 's=' + s + ' expected 8 seed ids in mask, got ' + [...hist]);
            notes.push('s=' + s + ' body=' + (frac * 100).toFixed(1) + '% mask=' + maskPx + 'px seeds=' + hist.size);
            files['body-' + s + '.png'] = await png(body);
            files['mask-' + s + '.png'] = await png(mask);
            if (s === 360) { files['body.png'] = files['body-360.png']; files['mask.png'] = files['mask-360.png']; }
          }
          return notes.join('; ');
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
