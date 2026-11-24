'use strict';
const { guideLine } = require('./guide-lines');

// Exclusive fullscreen (spec 5.1, section 7). A DXGI/Direct3D exclusive-mode game owns the display: DWM is bypassed, so
// the always-on-top guide window can't appear over it even though its z-order and IsWindowVisible say it is on top.
// Detection asks the shell instead: SHQueryUserNotificationState reports QUNS_RUNNING_D3D_FULL_SCREEN for a Direct3D
// exclusive-mode app. It is only probed while the fullscreen watch already sees a fullscreen window in front.
const QUNS_RUNNING_D3D_FULL_SCREEN = 3;

// Refuses guides over an exclusive-fullscreen game. Her line suggesting borderless window mode is spoken once per game
// session; the session resets when the fullscreen watch reports fullscreen ended. A failed probe never refuses.
class ExclusiveFullscreenGate {
  constructor({ fullscreen, exclusive, speak, lang = () => 'en' }) {
    Object.assign(this, { fullscreen, exclusive, speak, lang });
    this.said = false;
  }

  onFullscreen(active) { if (!active) this.said = false; }

  blocked() {
    try { return Boolean(this.fullscreen()) && this.exclusive() === true; } catch { return false; }
  }

  // Throws (for the tool result) when a guide can't be drawn; speaks the suggestion the first time in this game session.
  check() {
    if (!this.blocked()) return;
    if (!this.said) {
      this.said = true;
      try { this.speak(guideLine('exclusive-fullscreen', this.lang())); } catch { /* speech is best effort */ }
      throw Error('The game is in exclusive fullscreen, so on-screen guides cannot appear over it. Capri has just said aloud '
        + 'that borderless window mode would let her draw; do not repeat it. Help in words only.');
    }
    throw Error('The game is in exclusive fullscreen, so on-screen guides cannot appear over it. Help in words only; '
      + 'do not suggest borderless again.');
  }
}

// Native probe (Windows only; loaded lazily). Returns the QUERY_USER_NOTIFICATION_STATE value.
let probe;
function userNotificationState() {
  if (process.platform !== 'win32') return 0;
  if (!probe) {
    const ffi = require('koffi');
    const path = require('node:path');
    const shell = ffi.load(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'shell32.dll'));
    probe = shell.func('__stdcall', 'SHQueryUserNotificationState', 'int32', ['void *']);
  }
  const out = Buffer.alloc(4);
  if (probe(out) !== 0) throw Error('Notification state unavailable.');
  return out.readInt32LE(0);
}

const exclusiveFullscreen = () => userNotificationState() === QUNS_RUNNING_D3D_FULL_SCREEN;

module.exports = { ExclusiveFullscreenGate, QUNS_RUNNING_D3D_FULL_SCREEN, userNotificationState, exclusiveFullscreen };
