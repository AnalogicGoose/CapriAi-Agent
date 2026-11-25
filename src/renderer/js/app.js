import { SpeechPlayer } from './speech-output.js';
import { Stella } from './stella/stella.js';
import { isPoint } from './stella/focus.js';
import { clampToView } from './stella/wander.js';
import { Companion } from './companion.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { Mission } from './mission.js';
import { Chat } from './chat.js';
import { TalkMenu } from './talk-menu.js';
import { IntegrationCompanion } from './integration.js';
import { FullscreenPresence } from './fullscreen-presence.js';
import { PointerRecovery } from './pointer-recovery.js';
import { Dictation } from './dictation.js';
import { WakeListener } from './wake-listener.js';
import { CommandListener } from './command-listener.js';
import { VoiceCall } from './voice-call.js';
import { LINES } from './lines.js';
import { reducedMotion } from './util.js';
import { ReminderCards } from './reminder-cards.js';

const host = window.host;

// The demo's captions for Stella's part (brain.t.showcase keeps the stow and closing lines).
const SHOWCASE = {
  fr: { open: 'J’ouvre ce dont tu as besoin.', search: 'Je cherche pour toi.', think: 'Je réfléchis…', memory: 'Et je m’en souviendrai.' },
  en: { open: 'I open what you need.', search: 'I search for you.', think: 'Thinking…', memory: 'And I’ll remember it.' },
  es: { open: 'Abro lo que necesitas.', search: 'Busco por ti.', think: 'Pensando…', memory: 'Y lo recordaré.' },
  pt: { open: 'Abro o que você precisa.', search: 'Eu pesquiso para você.', think: 'Pensando…', memory: 'E vou me lembrar disso.' },
  ru: { open: 'Открою то, что нужно.', search: 'Поищу для тебя.', think: 'Думаю…', memory: 'И я это запомню.' },
};
// Stella has no cursor greetings or surprise flourishes: those companion options stay off whatever the settings say.
const companionConfig = cfg => ({ ...cfg, cursorInteractions: false, surpriseAnimations: false });
const sameAnchor = (a, b) => (isPoint(a) && isPoint(b) ? a.x === b.x && a.y === b.y : !isPoint(a) && !isPoint(b));

async function boot() {
  const [config] = await Promise.all([
    host.getConfig(),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  document.documentElement.lang = config.lang;

  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));
// Build the audio context while idle (silent), so the first fold never waits on it.
(globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(() => { try { voice.ensure(); } catch {} }, { timeout: 5000 });

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: LINES[config.lang] || LINES.fr,
  });

  // Stella (stella/stella.js), still called `capri` here and by the modules it is handed to. With no renderer
  // given she builds her own StellaRenderer, and without WebGL2 keeps working undrawn instead of failing boot.
  let knownAnchor = isPoint(config.stellaAnchor) ? { x: config.stellaAnchor.x, y: config.stellaAnchor.y } : null;
  const capri = new Stella({
    root: document.getElementById('stella'),
    canvas: document.getElementById('stella-canvas'),
    voice,
    reduced: () => reducedMotion.matches,
    anchor: knownAnchor,
    wander: config.wander,
    saveAnchor: p => { knownAnchor = { x: Math.round(p.x), y: Math.round(p.y) }; host.setConfig({ stellaAnchor: knownAnchor }); },
  });
  if (globalThis.stellaCheck) globalThis.stellaCheck.capri = capri; // scripts/check-stella.js (stub host) only
  capri.gaming = Boolean(config.gamingMode);
  capri.setScale(config.scale);
  let companionStorage;
  try { companionStorage = window.localStorage; } catch {}
  capri.companion = new Companion({ capri, host, storage: companionStorage });
  capri.companion.configure(companionConfig(config));

  const mission = new Mission();
  const brain = new Brain({ capri, panel, voice, host, mission, lang: config.lang, generatedDialogue: config.generatedDialogue !== false });
  new IntegrationCompanion({ capri, panel, voice, host, brain });

  // Click-through everywhere except on her body, the panel and her biochip.
  let talkMenu, wakeListener, voiceCall, commandListener;
  let interactive = false;
  let mouse = null;
  let pointerRevision = 0;
  const setInteractive = (on, force = false) => {
    if (!force && on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  const refreshHit = (force = false) => {
    if (capri.fullscreen && !wakeListener?.session) return setInteractive(false, force);
    if (capri.pointerHeld || capri.dragging) return setInteractive(true, force);
    if (!mouse) return setInteractive(false, force);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    const indicator = document.getElementById('voice-indicator');
    const ir = !indicator.hidden && indicator.getBoundingClientRect();
    const onWakeIndicator = ir && mouse.x >= ir.left && mouse.x <= ir.right && mouse.y >= ir.top && mouse.y <= ir.bottom;
    document.body.style.cursor = onChip() ? 'pointer' : '';
    return setInteractive(Boolean(onPanel || onWakeIndicator || talkMenu?.contains(mouse.x, mouse.y) || capri.hit(mouse.x, mouse.y) || onChip()), force);
  };
  // Her biochip: her eyes on it follow the pointer over it, and she comes out when you click it
  // (only then, so the pointer passing through that corner doesn't call her back).
  // Her mask, asleep: the pointer coming over it stirs her, and a moment of that wakes her up.
  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true }); // the tray and Ctrl+Alt+C follow
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };
  const pointerRecovery = new PointerRecovery({ host,
    eligible: () => !document.hidden && !capri.gaming && (!capri.fullscreen || Boolean(wakeListener?.session)),
    held: () => capri.pointerHeld || capri.dragging, revision: () => pointerRevision,
    update: point => { mouse = point; refreshHit(true); hoverChip(); },
  });
  window.addEventListener('beforeunload', () => pointerRecovery.close());
  window.addEventListener('mousemove', (e) => {
    pointerRecovery.observed();
    pointerRevision++;
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
  });
  document.addEventListener('mouseleave', () => {
    pointerRevision++;
    mouse = null;
    refreshHit();
    hoverChip();
  });
  window.addEventListener('contextmenu', (e) => {
    // Let Chromium reach the main-process spelling/edit menu for the composer.
    if (e.target.closest?.('.panel__input')) return;
    e.preventDefault();
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) host.openMenu();
  });
  window.addEventListener('click', (e) => {
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) comeOut();
  });

  // wiring
  capri.onPointerHold = () => {
    refreshHit();
    if (!capri.pointerHeld && !capri.dragging && !talkMenu?.visible && !(panel.visible && panel.current?.chat)) host.focusOverlay(false);
  };
  capri.onMove = (head) => {
    // pointing at something: the panel goes on her other side, so it doesn't cover it
    panel.setAnchor({ ...head, lean: capri.pointing ? -capri.pointing.dir : 0 }, capri.view);
    talkMenu?.place(head, capri.view);
    voiceCall?.place(head, capri.view);
    // she may have moved out from under a still pointer: never leave a dead click zone behind
    refreshHit();
  };
  capri.onTeleport = (phase) => { if (wakeListener?.session) return; if (phase === 'start') talkMenu?.hide(); return phase === 'start' ? panel.suspend() : panel.resume(); };
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    talkMenu?.hide();
    chip.setMode(capri.mode);
    chip.show();
  };
  capri.onUnstow = () => chip.hide();
  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  // Waiting on a permission (integration.js / brain.js set 'alert'): her approval ring holds and she comes a
  // little closer; leaving alert lets it go. approval() ignores a repeat, so this is safe to call on every change.
  capri.onMode = (mode, prev) => {
    chip.setMode(mode, prev);
    if (mode === 'alert' || prev === 'alert') capri.approval(mode === 'alert');
  };
  host.onAgentActivity?.(e => capri.agentActivity(e));
  host.onGuideFocus?.(f => capri.guideFocus(f));
  capri.onClick = () => {
    voiceCall?.end();
    if (panel.visible) panel.hide('user'); // the user clicked it away (a reminder card is dismissed, not re-queued)
    talkMenu?.show();
  };
  panel.onChar = (kind) => {
    const spoken = voice.spoken?.enabled && (chat.speaksReplies || panel.current?.voiceUntil > Date.now());
    if (!spoken) voice.play('blip', { mood: kind });
  };
  panel.onTalk = (talking) => talking && capri.mode !== 'sleep'
    && !capri.act?.player.name.startsWith('idle') && capri.perform('talk');
  panel.onFocus = () => host.focusOverlay(true); // Restore typing after a fullscreen exit, only on a user click.
  capri.onMenu = () => host.openMenu();

  voice.spoken = new SpeechPlayer({ host, voice,
    onPlayback: active => voiceCall?.playback(active),
    onLevel: level => {
      capri.speechLevel = level;
      if (level > 0.015 && !capri.act && capri.mode !== 'sleep') capri.perform('talk');
    },
    onError: error => {
      if (voiceCall?.active) { voiceCall.end(); return; }
      if (!chat?.open) return;
      const status = panel.el.querySelector('.panel__dictation-status'); status.textContent = `Voice: ${error}`; status.hidden = false;
    },
  });
  voice.spoken.configure(config);
  // Walkthrough lines from main, each with a one-time voice grant (it may speak while she is hidden in a fullscreen
  // game, never when voice is off or muted). Wait for her current reply to finish speaking instead of cutting it off;
  // a newer line replaces one still waiting.
  let guideSay = 0;
  host.onGuideSay?.(async message => {
    const text = message?.text;
    if (typeof text !== 'string' || !text || text.length > 320) return;
    const mine = ++guideSay, until = Date.now() + 20000;
    const busy = () => voice.spoken.pending || voice.spoken.playing || voice.spoken.response;
    while (busy() && Date.now() < until) { await new Promise(resolve => setTimeout(resolve, 250)); if (mine !== guideSay) return; }
    if (mine === guideSay) voice.spoken.speak(text, undefined, typeof message.grant === 'string' ? message.grant : undefined);
  });
  host.onFullscreenState(state => {
    if (!state.active) return;
    if (voiceCall?.checkIn) voiceCall.end();
    if (!wakeListener?.session) voice.spoken.stop();
  });
  const chat = new Chat({ capri, panel, voice, host, brain });
  capri.onIdleWave = () => {}; // A wave is an animation; speech comes from Codex.
  const publishCompanionState = () => {
    if (voiceCall?.active) capri.nextMove = capri.nextGaze = performance.now() + 60000;
    return host.companionState?.({ mood: capri.companion.mood,
    routine: capri.companion.options.dailyRoutine ? (new Date().getHours() < 6 ? 'night' : new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') : '',
    chatOpen: chat.open || Boolean(voiceCall?.active && !voiceCall.checkIn), voiceActive: Boolean(voiceCall?.active), canSpeak: !voiceCall?.active && !wakeListener?.session && !talkMenu?.visible && !capri.busy && capri.mode !== 'alert' && !['alert', 'error', 'report'].includes(panel.current?.kind) });
  };
  setInterval(publishCompanionState, 15000);
  host.onBodyAction?.(async ({ id, action }) => {
    let result;
    try {
      if (action === 'mood' || action === 'help') { // the companion has the words; she plays the motion (none for help)
        result = await capri.companion.request(action);
        void capri.bodyAction(action);
      } else {
        // come: to the pointer when it's on her display, else toward the middle
        const cursor = action === 'come' ? await host.cursor?.()?.catch(() => null) : null;
        result = await capri.bodyAction(action, { cursor: cursor && cursor.inside !== false ? cursor : undefined });
      }
    }
    catch (error) { result = `Action failed: ${error.message}`; }
    host.bodyResult({ id, result }); publishCompanionState();
  });
  const dictation = new Dictation({ panel, host, language: () => brain.lang,
    canListen: () => chat.open && (!capri.gaming && !capri.fullscreen || wakeListener?.session),
    beforeStart: async () => { voiceCall?.end(); voice.spoken.stop(); wakeListener?.pause(); commandListener?.pause(); } });
  let restoreStowed = false;
  voiceCall = new VoiceCall({ host, speaker: voice.spoken, history: chat,
    indicator: document.getElementById('voice-indicator'),
    onThinking: on => capri.setChatThinking(on),
    onStart: async checkIn => {
      if (!voice.spoken.enabled) throw Error('Enable spoken replies in Sound settings first.');
      commandListener?.pause();
      if (checkIn) {
        wakeListener.pause();
        voiceCall.place(capri.head(), capri.view); publishCompanionState(); refreshHit(true);
        return;
      }
      dictation.cancel(); chat.close(); panel.hide(); panel.setTicker(null); talkMenu?.hide();
      wakeListener.session = true; document.body.classList.add('voice-session');
      restoreStowed = capri.stowed; if (capri.stowed) await capri.unstow();
      capri.wake(); capri.nextMove = capri.nextGaze = performance.now() + 60000;
      voiceCall.place(capri.head(), capri.view); publishCompanionState(); refreshHit(true);
    },
    onPromote: () => {
      wakeListener.session = true; document.body.classList.add('voice-session');
      panel.hide(); publishCompanionState(); refreshHit(true);
    },
    onEnd: () => {
      wakeListener.session = false; document.body.classList.remove('voice-session');
      if (restoreStowed) capri.stowNow(); restoreStowed = false;
      publishCompanionState(); refreshHit(true);
    } });
  chat.onStart = () => voiceCall.end();
  talkMenu = new TalkMenu({ el: document.getElementById('talk-menu'), capri, host,
    language: () => brain.lang, onChange: () => refreshHit(),
    onChoose: async (mode, greeting) => {
      if (mode === 'voice') { wakeListener.pause(); commandListener.pause(); await voiceCall.start(); return; }
      voiceCall.end();
      await chat.start(false, greeting, { mode });
    } });
  brain.onTalk = () => { voiceCall.end(); talkMenu.hide({ keepFocus: true }); return chat.start(); };
  // Commands-only listening (walkthrough / reminder window, opened by main): the local commands, no wake word needed.
  commandListener = new CommandListener({ host, indicator: document.getElementById('voice-indicator'), name: () => config.displayName,
    blocked: () => Boolean(voiceCall.active || dictation.id), ownsIndicator: () => !voiceCall.active,
    place: () => voiceCall.place(capri.head(), capri.view), beforeStart: () => wakeListener?.pause(),
    onWake: (event) => wakeListener.adopt(event, event.capture) }); // "Hey <name>" heard while commands own the microphone
  wakeListener = new WakeListener({ host, indicator: document.getElementById('wake-indicator'),
    blocked: () => Boolean(voiceCall.active || dictation.id || voice.spoken.pending || voice.spoken.source || commandListener.active),
    onSessionEnd: () => { if (voiceCall.fromWake) voiceCall.end(false); document.body.classList.remove('voice-session'); refreshHit(true); },
    onWake: async event => {
      capri.wakeHeard();
      await voiceCall.start(event);
    } });
  chat.onClose = () => { if (!voiceCall.active && !panel.leaving && !wakeListener.transferring) wakeListener.endSession(); };
  panel.onHidden = () => { if (!voiceCall.active && !chat.open && !wakeListener.transferring) wakeListener.endSession(); };
  wakeListener.configure(config);
  // Reminders from main (reminder-controller.js): cards queue in ReminderCards (reminder-cards.js) and wait while a
  // chat, voice call, permission prompt or her menu has your attention. A line may carry a one-time voice grant (spoken
  // even while she is hidden in a fullscreen game; never with voice off or muted).
  const sayReminder = async (line, grant) => {
    const until = Date.now() + 20000, busy = () => voice.spoken.pending || voice.spoken.playing || voice.spoken.response;
    while (busy() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 250));
    voice.spoken.speak(line, undefined, grant);
  };
  // A card actually shown (main is told through reminderShown): her chime, and a small drift toward the middle.
  const reminderHost = {
    reminderShown: (...args) => { capri.remind(); return host.reminderShown?.(...args); },
    reminderAction: (...args) => host.reminderAction(...args),
  };
  const reminderCards = new ReminderCards({ panel, host: reminderHost, speak: (line, grant) => void sayReminder(line, grant),
    blocked: () => Boolean(chat?.open || voiceCall?.active || talkMenu?.visible || wakeListener?.session
      || [...brain.sessions.values()].some(s => s.waiting)) });
  host.onReminderDue?.(message => reminderCards.receive(message));
  host.reminderReady?.();
  if (config.wakeWordEnabled || (config.proactiveVoice && config.checkInReplies)) voiceCall.prepare().catch(() => {});
  // The demo's second half, after its fake Claude session: everything she does on her own, one
  // after the other, a line before each.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (done, max = 15000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await wait(100);
  };
  const free = () => !capri.busy && !capri.act;
  brain.onShowcase = async () => {
    const t = brain.t.showcase, s = SHOWCASE[brain.lang] || SHOWCASE.en;
    const caption = (line) => panel.say({ kind: 'info', line, hold: 2200 });
    capri.nextMove = capri.nextGaze = performance.now() + 120000; // nothing of her own in between
    if (capri.stowed) await capri.unstow();
    if (capri.dormant) capri.wake();
    await until(free);
    panel.hide();
    // one of her functions after the other, a caption before each
    for (const [line, motion] of [[s.open, 'flare'], [s.search, 'radar']]) {
      caption(line);
      await wait(900);
      await capri.play(motion);
      await wait(700);
    }
    caption(s.think);
    capri.reactToAction('think'); // her think state, 2 s
    await wait(2600);
    caption(s.memory);
    await wait(900);
    await capri.play('swirlIn');
    await wait(900);

    caption(t.chip);
    await wait(1600);
    panel.hide();
    await capri.stow();
    await wait(3500);
    await capri.unstow();
    await wait(600);
    void capri.celebrate();
    panel.say({ kind: 'info', line: t.end, hold: 5000 });
  };

  host.onAgentSuggestion(text => {
    if (wakeListener.session) return;
    if (typeof text !== 'string' || capri.gaming || capri.fullscreen || chat.turn || talkMenu.visible) return;
    if (chat.open) panel.stream(text, { done: true });
    else if (panel.visible && ['alert', 'error', 'report'].includes(panel.current?.kind)) return;
    else panel.say({ kind: 'info', face: 'look', line: text, hold: 10000 });
  });
  host.onConversation?.(message => {
    const { text, voiceUntil, mood, replyTo, canBuild } = typeof message === 'string' ? { text: message } : (message || {});
    const available = () => !document.hidden && !wakeListener.session && !chat.open &&
      !talkMenu.visible && !capri.gaming && !capri.fullscreen;
    if (!available() || voiceCall.active || panel.visible ||
        typeof text !== 'string' || text.length > 320) return;
    const es = brain.lang === 'es';
    const face = mood === 'curious' ? 'grin' : mood === 'pleased' ? 'calm' : 'look';
    let replyWindow;
    panel.say({ kind: 'info', face, line: text, voiceUntil, hold: voiceUntil ? 35_000 : 20_000,
      onLeave: () => {
        if (replyWindow && voiceCall.checkIn?.options === replyWindow) voiceCall.end();
        voice.spoken.stopProactive();
      },
      actions: [{ id: 'reply', label: es ? 'Responder' : 'Reply', primary: true },
        ...(canBuild ? [{ id: 'build', label: es ? 'Crear juntos' : 'Build together' }] : []),
        { id: 'quiet', label: es ? 'Silenciar charlas' : 'Pause check-ins' }],
      onAction: async id => {
        voice.spoken?.stop(); panel.hide();
        if (id === 'reply' || id === 'build') await chat.start(false, text, { replyTo });
        if (id === 'build' && chat.open) await chat.send(es ? 'Hagámoslo juntos.' : 'Let’s build that together.');
        if (id === 'quiet') await host.personalRoute('/companion off');
      },
    });
    capri.perform('curious'); // a little pulse as she speaks up
    const checkIn = panel.current;
    if (voiceUntil && checkIn?.line === text) {
      const canPlay = () => available() && panel.visible && panel.current === checkIn;
      if (voice.spoken.enabled && voice.volume > 0 && voice.spoken.config?.checkInReplies) {
        replyWindow = { text, deadline: voiceUntil, available: canPlay, mood, replyTo };
        void voiceCall.startCheckIn(replyWindow);
      } else voice.spoken.speakProactive(text, voiceUntil, canPlay, mood);
    }
  });
  new FullscreenPresence({ capri, host, onChange: () => {
    ++pointerRevision;
    // Main can override click-through during a transition; resend even when
    // the renderer cache thinks nothing changed, including rapid reversals.
    refreshHit(true);
    if (capri.fullscreen) { talkMenu.hide(); if (!dictation.fromWake) dictation.cancel(); }
    else if (!capri.gaming) pointerRecovery.sample(true);
  } });
  host.onWindows((data) => {
    capri.setWindows(data);
    capri.companion.desktop(data);
    brain.onWindows(data);
  });
  // the windows as they are now: the watcher only speaks again when something changes
  host.windowsNow().then((data) => data && capri.setWindows(data));

  host.onResize(({ width, height }) => {
    chip.place(width, height);
    capri.setView(width, height);
  });
  window.addEventListener('resize', () => {
    chip.place(innerWidth, innerHeight);
    capri.setView(innerWidth, innerHeight);
  });

  host.onConfig((cfg) => {
    if ((!cfg.wakeWordEnabled && voiceCall.fromWake) || !cfg.ttsEnabled || cfg.muted ||
        (voiceCall.checkIn && (!cfg.checkInReplies || !cfg.proactiveVoice || !cfg.proactiveEnabled || cfg.volume === 0 ||
          cfg.gamingMode || cfg.visible === false))) voiceCall.end();
    capri.companion.configure(companionConfig(cfg));
    wakeListener.configure(cfg);
    voice.configure(cfg);
    voice.spoken.configure(cfg);
    capri.gaming = Boolean(cfg.gamingMode);
    if (capri.gaming || cfg.visible === false) { talkMenu.hide(); if (!dictation.fromWake) dictation.cancel(); }
    capri.wander = cfg.wander !== false;
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    // Her anchor only when it changed elsewhere (a reset, another window); her own drops echo back unchanged.
    if (!sameAnchor(cfg.stellaAnchor, knownAnchor)) {
      knownAnchor = isPoint(cfg.stellaAnchor) ? { x: cfg.stellaAnchor.x, y: cfg.stellaAnchor.y } : null;
      capri.anchor = knownAnchor ? clampToView(knownAnchor, capri.radius, capri.view) : capri.firstAnchor();
    }
    if (cfg.lang !== brain.lang) {
      brain.lang = cfg.lang;
      panel.labels = LINES[cfg.lang] || LINES.fr;
      document.documentElement.lang = cfg.lang;
    }
  });

  host.onCommand(async (cmd) => {
    const t = brain.t;
    switch (cmd.name) {
      case 'gamingDeparture':
        voiceCall.end();
        chat.close();
        panel.hide();
        try {
          await capri.gamingDeparture();
        } finally {
          host.gamingAnimationReady();
        }
        break;
      case 'gamingPrepareReturn':
        try { capri.prepareGamingReturn(); }
        finally { host.gamingAnimationReady(); }
        break;
      case 'gamingArrival':
        await capri.gamingArrival();
        break;
      case 'teleport':
        capri.glideTo(capri.spot('random'));
        break;
      case 'status':
        brain.status();
        break;
      case 'chat': voiceCall.end(); talkMenu.hide({ keepFocus: true }); // "Talk to her" in her menu
        chat.start();
        break;
      case 'memory':
        chat.start(true);
        break;
      case 'interests':
        talkMenu.hide({ keepFocus: true });
        await chat.start(true);
        await chat.send('/interests list');
        break;
      case 'reviews':
        talkMenu.hide({ keepFocus: true });
        await chat.start(true);
        await chat.send('/review today');
        break;
      case 'initiative':
        talkMenu.hide({ keepFocus: true });
        await chat.start(true);
        await chat.send('/companion trial report');
        break;
      case 'curiosity':
        talkMenu.hide({ keepFocus: true });
        await chat.start(true);
        await chat.send('/curiosity list');
        break;
      case 'routines':
        talkMenu.hide({ keepFocus: true });
        await chat.start(false);
        await chat.send('/routines list');
        break;
      case 'report': // "Mission report" in her menu
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (brain.report()) capri.perform('curious', capri.towardCenter());
        break;
      case 'fakeClaude': { // --dev: the topmost window (the test window) is where a prompt was typed, and you're elsewhere
        const win = capri.windows.wins[0];
        if (win) {
          brain.sessions.set('dev', { id: 'dev', project: 'dev', taskStart: Date.now(), count: 0, files: new Set(), log: [], working: true, waiting: false, window: win.id, seen: Date.now() });
          capri.windows = { ...capri.windows, fg: -1 };
        }
        break;
      }
      case 'stow': // Ctrl+Alt+C: into her biochip, or back out
        if (cmd.on) voiceCall.end();
        if (cmd.on) dictation.cancel();
        if (cmd.on) capri.stow();
        else capri.unstow();
        break;
      case 'satellite': // tray: out of her biochip if put away, awake, a curious pulse
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        capri.perform('curious');
        break;
      // --dev helpers
      case 'intro': // her entrance again, as when she starts
        panel.hide();
        await capri.materialize(capri.spot('post'));
        break;
      case 'pose':
        if (cmd.still) capri.nextMove = capri.nextGaze = Infinity; // no wandering off mid-test
        if (cmd.hush) {
          panel.setTicker(null);
          panel.hide();
        }
        if (cmd.scale) capri.setScale(cmd.scale);
        if (cmd.at) capri.pos = cmd.at;
        capri.drawFrame();
        break;
      case 'config': // a setting, as if changed from her menu
        host.setConfig(cmd.patch || {});
        break;
      case 'focus': // as if window `fg` had come to the front
        capri.windows = { ...capri.windows, fg: cmd.fg };
        brain.onWindows(capri.windows);
        break;
      case 'freeze':
        capri.hidden = Boolean(cmd.on);
        break;
      case 'act':
        // her methods by name (celebrate, remind, pulse, wakeHeard...) or motions / acts by name
        if (typeof capri[cmd.act] === 'function') capri[cmd.act](...(cmd.args || []));
        else capri.perform(cmd.act, cmd.dir || 0);
        break;
      default:
        break;
    }
  });

  // entrance: she unfolds where she was left (first run: her post); put away last time, she starts in her biochip
  if (config.visible === false) capri.stowNow();
  else await capri.materialize(knownAnchor ? capri.anchor : capri.spot('post'));
  if (!config.welcomed) host.setConfig({ welcomed: true });
  publishCompanionState();
  host.companionEvent?.('startup');
  document.documentElement.dataset.caprigptReady = 'true';

  // In the evening, after a real day's work, she brings you her report card once, on her own,
  // at a quiet moment.
  setInterval(() => {
    const day = mission.day;
    const quiet = !brain.busySessions.length && !panel.visible && !capri.busy && !capri.act;
    if (!capri.companion.options.dailyRoutine || capri.gaming || capri.fullscreen) return;
    if (new Date().getHours() < 18 || day.reported || day.missions < 3 || !quiet) return;
    if (capri.stowed || capri.dormant || capri.mode === 'sleep') return;
    if (brain.report()) {
      mission.markReported();
      capri.perform('curious', capri.towardCenter());
    }
  }, 60000);
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
