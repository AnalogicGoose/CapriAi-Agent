'use strict';
// Real-desktop check (npm run test:windows-desktop): shows fixture windows on every display, runs the real
// highlight overlay, real screen capture and real Windows OCR, and asserts alignment. Needs an interactive session.
const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
const assert = require('node:assert/strict');
const { desktopHighlight } = require('../src/main/desktop-highlight');
const { runWindowsOcr } = require('../src/main/windows-accessibility');
const native = require('../src/main/native-windows');

class VisibleWindow extends BrowserWindow { setContentProtection() {} } // protection would hide the marker from capture
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = `<body style="margin:0;background:#fff"><button id=button style="position:absolute;left:100px;top:80px;width:160px;height:40px">Save changes</button>
<div id=text style="position:absolute;left:100px;top:200px;font:11px 'Segoe UI'">Quarterly Report</div></body>`;

async function grab(display, size) {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size, fetchWindowIcons: false });
  return sources.find(row => row.display_id === String(display.id)).thumbnail;
}
function changedBox(a, b, near) {
  const A = a.toBitmap(), B = b.toBitmap(), { width, height } = a.getSize();
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = Math.max(0, near.y - 40); y < Math.min(height, near.y + near.height + 40); y++) {
    for (let x = Math.max(0, near.x - 40); x < Math.min(width, near.x + near.width + 40); x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 60) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
const elementRect = (win, id) => win.webContents.executeJavaScript(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
  .then(r => { const c = win.getContentBounds(); return screen.dipToScreenRect(null, { x: c.x + r.x, y: c.y + r.y, width: r.width, height: r.height }); });

async function checkDisplay(display) {
  const b = display.bounds, label = `display ${display.id} @${display.scaleFactor}x`;
  const win = new BrowserWindow({ x: b.x + 200, y: b.y + 150, width: 600, height: 400, backgroundColor: '#fff' });
  try {
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(`document.body.outerHTML = ${JSON.stringify(page)}`);
    win.focus();
    await sleep(2500);
    const foreground = native.foregroundBounds();
    assert.equal(foreground.pid, process.pid, `${label}: fixture is not the foreground window`);
    const full = screen.dipToScreenRect(null, b);
    const pixels = { width: full.width, height: full.height };

    // Highlight: the marker must surround the button within the frame (3 DIP) plus shadow (2 DIP).
    const target = await elementRect(win, 'button');
    const highlight = desktopHighlight({ BrowserWindow: VisibleWindow, screen, foreground: () => foreground, enabled: () => true });
    const expected = { x: target.x - full.x, y: target.y - full.y, width: target.width, height: target.height };
    await sleep(1000);
    const before = await grab(display, pixels);
    const started = Date.now();
    await highlight.show(target, foreground, () => {}, '');
    const showMs = Date.now() - started;
    await sleep(500);
    const box = changedBox(before, await grab(display, pixels), expected);
    highlight.clear();
    assert.ok(box, `${label}: highlight not visible`);
    const slack = 3 * display.scaleFactor, shadow = 2 * display.scaleFactor;
    assert.ok(Math.abs(expected.x - box.x - slack) <= 1 && Math.abs(expected.y - box.y - slack) <= 1, `${label}: highlight offset ${JSON.stringify({ box, expected })}`);
    assert.ok(box.width - expected.width <= 2 * slack + shadow + 2 && box.height - expected.height <= 2 * slack + shadow + 2, `${label}: highlight size ${JSON.stringify({ box, expected })}`);

    // OCR: capture the window at native resolution exactly as main.js does, then find the 11 px text.
    const truth = await elementRect(win, 'text');
    const area = full, bounds = screen.dipToScreenRect(null, win.getBounds());
    const image = await grab(display, { width: Math.min(8192, area.width), height: Math.min(8192, area.height) });
    const size = image.getSize(), scaleX = area.width / size.width, scaleY = area.height / size.height;
    const left = Math.ceil((bounds.x - area.x) / scaleX), top = Math.ceil((bounds.y - area.y) / scaleY);
    const cropped = image.crop({ x: left, y: top, width: Math.floor(bounds.width / scaleX), height: Math.floor(bounds.height / scaleY) });
    const timer = Date.now();
    const { matches } = await runWindowsOcr({ image: cropped.toJPEG(90).toString('base64'), query: 'Quarterly Report' });
    const ocrMs = Date.now() - timer;
    assert.equal(matches.length, 1, `${label}: OCR did not find the text`);
    const hit = { x: area.x + left * scaleX + matches[0].bounds.x * scaleX, y: area.y + top * scaleY + matches[0].bounds.y * scaleY,
      width: matches[0].bounds.width * scaleX, height: matches[0].bounds.height * scaleY };
    assert.ok(hit.x >= truth.x - 3 && hit.y >= truth.y - 3 && hit.x + hit.width <= truth.x + truth.width + 3 && hit.y + hit.height <= truth.y + truth.height + 3,
      `${label}: OCR box ${JSON.stringify(hit)} not inside ${JSON.stringify(truth)}`);
    console.log(`ok ${label}: highlight shown in ${showMs} ms, OCR ${ocrMs} ms`);
  } finally { win.destroy(); }
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let code = 0;
  try { for (const display of screen.getAllDisplays()) await checkDisplay(display); }
  catch (error) { console.error(error.message); code = 1; }
  app.exit(code);
});
