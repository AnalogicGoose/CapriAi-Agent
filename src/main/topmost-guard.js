'use strict';

// Windows can strip her overlay's always-on-top flag, or another app can launch as a topmost window
// (some apps do this to force themselves in front, e.g. WhatsApp Desktop). Either way other apps
// end up over her until she is clicked. On each foreground change (and once more shortly after,
// since apps often turn topmost a moment after they appear) this restores her flag, or lifts her
// back above a topmost foreground app. It never activates or focuses her.
function createTopmostGuard({ shouldBeOnTop, isTopmost, restore, raise, ownPid = process.pid,
  now = Date.now, settleMs = 1200 }) {
  let lastId, recheckAt = 0;
  return {
    check(window) {
      if (!window || window.pid === ownPid) return;
      const changed = window.id !== lastId;
      if (changed) { lastId = window.id; recheckAt = now() + settleMs; }
      else if (!recheckAt || now() < recheckAt) return;
      else recheckAt = 0;
      if (!shouldBeOnTop()) return;
      if (!isTopmost()) restore();
      else if (window.topmost) raise();
    },
  };
}

module.exports = { createTopmostGuard };
