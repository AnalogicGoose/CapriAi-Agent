'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { migratePcSettings, migrateControlRoom } = require('./settings-migration');
const { voiceSetup } = require('./voice-setup');

const DEFAULTS = {
  gamingMode: false,
  systemAccess: true,
  screenAwareness: true,
  autonomyEnabled: true,
  cognitiveEnabled: true,
  projectCuriosityEnabled: true,
  routinesEnabled: true,
  interestsEnabled: true,
  proactiveEnabled: true,
  proactiveVoice: false,
  checkInReplies: true,
  dailyReviewEnabled: true,
  dailyReviewNotify: false,
  autonomyScreen: true,
  autonomyIntervalSeconds: 90,
  generatedDialogue: true,
  idleAnimations: true,
  cursorInteractions: true,
  personality: true,
  dailyRoutine: true,
  surpriseAnimations: true,
  desktopActions: true,
  preferredBrowser: 'Firefox',
  crunchyrollProfile: 'Gabriel',
  windowTracking: true, // decorative geometry only; restore Capri's window sitting
  agentEnabled: true,
  privacy: {}, // normalized by pc-context; PC awareness defaults on
  rememberRecentChat: false,
  scale: 0.6,        // sprite scale, 0.6 ≈ 250px tall
  muted: false,
  volume: 0.7,
  wakeWordEnabled: true,
  ttsEnabled: false,
  speakTypedReplies: true,
  ttsEngine: 'windows',
  ttsPython: '',
  ttsReference: '',
  ttsReferenceText: '',
  ttsDevice: 'cpu',
  ttsModel: '',
  lang: 'auto',      // 'auto' follows the system language, or 'fr' / 'en'
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  possess: true,     // now and then she dives into the window she sits on and takes it over
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  linked: false,     // a Claude Code event has reached her at least once
  codexExecutable: '',
  codexModel: '',
  codexEffort: 'medium',
  chatModel: 'qwen3.5:9b', // retained only for rollback; runtime uses Codex
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

// A crash or power loss mid-write must not leave a truncated config.json:
// an unreadable file would silently reset every preference on the next start.
function write(data) {
  const target = file(), temp = `${target}.tmp`; // one instance: the single-instance lock owns the profile
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  try { fs.renameSync(temp, target); }
  catch {
    // Sync clients and antivirus can briefly lock the target on Windows.
    fs.writeFileSync(target, JSON.stringify(data, null, 2));
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
  }
}

function load() {
  if (cache) return cache;
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const migrated = voiceSetup(path.resolve(__dirname, '../..'), migrateControlRoom(migratePcSettings(saved)));
    // Keep pause changes in this process, but always begin a fresh run active.
    cache = { ...DEFAULTS, ...migrated, gamingMode: false };
    if (migrated !== saved || saved.gamingMode === true) {
      try { write(cache); }
      catch { console.error('[capri] Could not persist updated PC defaults.'); }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Keep the unreadable file for recovery before defaults replace it.
      try { fs.copyFileSync(file(), `${file()}.unreadable`); } catch { /* nothing to keep */ }
      console.error('[capri] config.json was unreadable; defaults loaded and a copy kept as config.json.unreadable.');
    }
    cache = { ...DEFAULTS, ...voiceSetup(path.resolve(__dirname, '../..'), migrateControlRoom(migratePcSettings())) };
    if (cache.ttsSetupId) {
      try { write(cache); }
      catch { console.error('[capri] Could not persist prepared voice settings.'); }
    }
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    write(cache);
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
  return cache;
}

module.exports = { load, save, DEFAULTS };
