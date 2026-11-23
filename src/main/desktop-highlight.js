'use strict';
const path = require('node:path');

const markerPage = path.join(__dirname, '..', 'renderer', 'desktop-highlight.html');
const padding = 8;
const labelHeight = 24;
const labelGap = 5;

function markerLayout(target, display, label) {
  const displayRight = display.x + display.width;
  const displayBottom = display.y + display.height;
  const x = Math.max(target.x, display.x);
  const y = Math.max(target.y, display.y);
  const right = Math.min(target.x + target.width, displayRight);
  const bottom = Math.min(target.y + target.height, displayBottom);
  if (right <= x || bottom <= y) throw Error('This control is outside the visible display.');

  const frameLeft = Math.max(display.x, x - 3);
  const frameTop = Math.max(display.y, y - 3);
  const frameRight = Math.min(displayRight, right + 3);
  const frameBottom = Math.min(displayBottom, bottom + 3);
  let left = Math.max(display.x, frameLeft - padding);
  let top = Math.max(display.y, frameTop - padding);
  let edgeRight = Math.min(displayRight, frameRight + padding);
  let edgeBottom = Math.min(displayBottom, frameBottom + padding);

  const captionWidth = Math.min(200, display.width - 8);
  const captionLeft = Math.max(display.x + 4, Math.min(frameLeft, displayRight - captionWidth - 4));
  let captionTop;
  if (label && captionWidth >= 72) {
    if (frameTop - labelGap - labelHeight >= display.y) captionTop = frameTop - labelGap - labelHeight;
    else if (frameBottom + labelGap + labelHeight <= displayBottom) captionTop = frameBottom + labelGap;
  }
  if (captionTop !== undefined) {
    left = Math.max(display.x, Math.min(left, captionLeft - padding));
    top = Math.max(display.y, Math.min(top, captionTop - padding));
    edgeBottom = Math.min(displayBottom, Math.max(edgeBottom, captionTop + labelHeight + padding));
    edgeRight = Math.min(displayRight, Math.max(edgeRight, captionLeft + captionWidth + padding));
  }
  return {
    window: { x: left, y: top, width: edgeRight - left, height: edgeBottom - top },
    frame: { x: frameLeft - left, y: frameTop - top, width: frameRight - frameLeft, height: frameBottom - frameTop },
    caption: captionTop === undefined ? null : { x: captionLeft - left, y: captionTop - top, width: captionWidth, label },
  };
}

function desktopHighlight({ BrowserWindow, screen, foreground, enabled, onError }) {
  let active;
  function clear() {
    const current = active;
    active = null;
    if (!current) return;
    clearInterval(current.watch);
    if (!current.marker.isDestroyed()) current.marker.destroy();
  }
  return {
    clear,
    async show(bounds, window, check, label = '') {
      const stillVisible = () => {
        const now = foreground();
        return enabled() && now?.id === window.id && now.pid === window.pid &&
          ['x', 'y', 'width', 'height'].every(key => now[key] === window[key]);
      };
      if (!stillVisible()) throw Error('The window moved or lost focus. Inspect it again.');
      if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) || bounds.width <= 0 || bounds.height <= 0) {
        throw Error('This control has no visible position.');
      }
      const native = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)]));
      const target = screen.screenToDipRect(null, native);
      const display = screen.getDisplayMatching(target).bounds;
      const caption = typeof label === 'string' ? label.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 160) : '';
      const layout = markerLayout(target, display, caption);
      clear();
      const marker = new BrowserWindow({ ...layout.window,
        frame: false, transparent: true, show: false, focusable: false, skipTaskbar: true,
        alwaysOnTop: true, hasShadow: false, resizable: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
      marker.setIgnoreMouseEvents(true);
      marker.setContentProtection(true);
      marker.setAlwaysOnTop(true, 'screen-saver');
      const deadline = Date.now() + 8000;
      const watch = setInterval(() => {
        try { if (Date.now() >= deadline || !stillVisible()) clear(); }
        catch (error) { clear(); onError?.(error); }
      }, 200);
      active = { marker, watch };
      try {
        await marker.loadFile(markerPage, { query: { layout: JSON.stringify({ frame: layout.frame, caption: layout.caption }) } });
        check();
        if (active?.marker !== marker || !stillVisible()) throw Error('The window changed before the highlight appeared.');
        marker.showInactive();
      } catch (error) {
        if (active?.marker === marker) clear();
        throw error;
      }
    },
  };
}

module.exports = { desktopHighlight, markerLayout };
