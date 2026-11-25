// What the control room shows, as data. settings.js draws it; settings-policy.js (main) still decides
// what may be saved. Every row is one line; `tip` is a short tooltip, never a paragraph.
//
// Row: { id, label (string | state => string), tip?, control, key?, action?, options?, get?(state),
//        visible?(state), deeper?: sub-view id, buttons?: [{ label, action, danger?, visible? }], toggles?: [...] }
// parse?: turns a <select> string back into the saved value
// control: 'switch' (key, or action for main-side switches), 'segment', 'select', 'slider', 'text',
//          'buttons', 'toggles', 'reminders', 'preview', 'status', 'info'

const pct = value => `${Math.round((value ?? 0) * 100)}%`;
const memoryOn = s => s.config.privacy?.memoryEnabled === true;
const isQwen = s => (s.config.ttsEngine || 'windows') === 'qwen';

export const QUICK = [
  { id: 'gaming', label: 'Gaming mode', tip: 'Hide her and pause anything proactive', control: 'switch', action: 'gaming',
    get: s => s.config.gamingMode === true },
  { id: 'size', label: 'Size', control: 'segment', key: 'scale', options: [[0.45, 'S'], [0.6, 'M'], [0.8, 'L']] },
  { id: 'desktop', label: 'Desktop', tip: 'Ctrl + Alt + C', control: 'buttons',
    buttons: [{ label: s => s.config.visible === false ? 'Bring back' : 'Put away', action: 'visibility', value: s => s.config.visible === false }] },
];

const sound = {
  id: 'sound', label: 'Sound & voice', icon: 'sound',
  summary: s => s.config.muted ? 'Muted' : `${pct(s.config.volume)} · voice ${s.config.ttsEnabled ? 'on' : 'off'}`,
  deepers: { 'voice-files': 'Voice engine & files' },
  rows: [
    { id: 'volume', label: 'Volume', control: 'slider', key: 'volume', mute: 'muted' },
    { id: 'wake', label: 'Hey Stella', tip: 'Wake her by voice; listening stays on this PC', control: 'switch', key: 'wakeWordEnabled' },
    { id: 'tts', label: 'Spoken replies', control: 'switch', key: 'ttsEnabled' },
    { id: 'speak-typed', label: 'Speak typed replies', control: 'switch', key: 'speakTypedReplies' },
    { id: 'speak-checkins', label: 'Speak check-ins', control: 'switch', key: 'proactiveVoice' },
    { id: 'checkin-replies', label: 'Reply to check-ins', tip: 'Listen a few seconds after she speaks first', control: 'switch', key: 'checkInReplies' },
    { id: 'preview', label: 'Try her voice', control: 'preview', action: 'voice-preview',
      options: [['neutral', 'Neutral'], ['playful', 'Playful'], ['comforting', 'Comforting'], ['pleased', 'Pleased'], ['curious', 'Curious']] },
    { id: 'engine', label: 'Voice engine', control: 'select', key: 'ttsEngine', deeper: 'voice-files',
      options: [['qwen', 'Qwen (local)'], ['windows', 'Windows voice'], ['chatterbox', 'Chatterbox'], ['f5', 'F5-TTS']] },
    { id: 'model', label: 'Model folder', tip: 'Your downloaded Qwen Base model', control: 'text', key: 'ttsModel', deeper: 'voice-files', visible: isQwen },
    { id: 'device', label: 'Processing', control: 'select', key: 'ttsDevice', deeper: 'voice-files', visible: s => !isQwen(s),
      options: [['cpu', 'CPU'], ['cuda', 'NVIDIA GPU']] },
    { id: 'python', label: 'Python', tip: 'Local neural voice runtime', control: 'text', key: 'ttsPython', deeper: 'voice-files' },
    { id: 'reference', label: 'Reference WAV', tip: 'The recording that defines her voice', control: 'text', key: 'ttsReference', deeper: 'voice-files' },
    { id: 'reference-text', label: 'Reference words', tip: 'Exactly what the reference recording says', control: 'text', key: 'ttsReferenceText', deeper: 'voice-files' },
    { id: 'sounds', label: 'Custom sounds', control: 'buttons', deeper: 'voice-files', buttons: [{ label: 'Open folder', action: 'sounds-folder' }] },
  ],
};

const memorySub = row => ({ ...row, visible: memoryOn });
const memory = {
  id: 'memory', label: 'Memory', icon: 'memory',
  summary: s => memoryOn(s) ? 'On' : 'Off',
  rows: [
    { id: 'recent', label: 'Remember recent chats', tip: 'Up to 12 exchanges for 7 days; off clears them', control: 'switch', action: 'remember-chat',
      get: s => s.config.rememberRecentChat === true },
    { id: 'personal', label: 'Personal memory', tip: 'Details and preferences, kept on this PC', control: 'switch', key: 'privacy.memoryEnabled' },
    memorySub({ id: 'learn', label: 'Learn from conversation', control: 'switch', key: 'privacy.memoryLearn' }),
    memorySub({ id: 'confirm', label: 'Review requested changes', control: 'switch', key: 'privacy.memoryConfirmChanges' }),
    memorySub({ id: 'candidates', label: 'Offer to remember', tip: 'Each save asks first', control: 'switch', key: 'privacy.memoryCandidates' }),
    memorySub({ id: 'recall', label: 'Recall in conversation', control: 'switch', key: 'privacy.memoryRecall' }),
    memorySub({ id: 'retention', label: 'Keep for', control: 'select', key: 'privacy.retentionDays', parse: Number,
      options: [[30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'Until I delete']] }),
    { id: 'memory-actions', label: 'Your memories', control: 'buttons',
      buttons: [{ label: 'Review', action: 'memory-open' }, { label: 'Export', action: 'memory-export' }] },
    { id: 'memory-clear', label: 'Clear', control: 'buttons',
      buttons: [{ label: 'Recent chats', action: 'clear-recent-chat', danger: true }, { label: 'All memories', action: 'memory-delete', danger: true }] },
  ],
};

const reminders = {
  id: 'reminders', label: 'Reminders', icon: 'reminders',
  summary: s => s.reminders?.length ? `${s.reminders.length} upcoming` : 'None',
  rows: [{ id: 'reminder-list', label: 'Upcoming', control: 'reminders', actions: ['reminder-move', 'reminder-cancel'] }],
};

const trial = s => s.initiative?.phase || 'live';
const behavior = {
  id: 'behavior', label: 'Behavior & awareness', icon: 'behavior',
  summary: s => s.config.autonomyEnabled || s.config.proactiveEnabled !== false ? 'Chatty' : 'Quiet',
  deepers: { initiative: 'Her initiative' },
  rows: [
    { id: 'wander', label: 'Wander around', control: 'switch', key: 'wander' },
    { id: 'idle', label: 'Idle gestures', control: 'switch', key: 'idleAnimations', get: s => s.config.idleAnimations !== false },
    { id: 'personality', label: 'Mood & personality', tip: 'Her energy shapes gestures and chat tone', control: 'switch', key: 'personality',
      get: s => s.config.personality !== false },
    { id: 'window-tracking', label: 'Notice window changes', tip: 'Follow which window is in front', control: 'switch', key: 'windowTracking' },
    { id: 'evening', label: 'Evening recap card', control: 'switch', key: 'dailyRoutine', get: s => s.config.dailyRoutine !== false },
    { id: 'start-conversations', label: 'Start conversations', tip: 'A short opening when you seem free', control: 'switch', key: 'proactiveEnabled',
      get: s => s.config.proactiveEnabled !== false },
    { id: 'companion', label: 'Companion check-ins', tip: 'Waits 5–15 minutes between chances; quiet when busy', control: 'switch', key: 'autonomyEnabled' },
    { id: 'see', label: 'She can see', tip: 'Read locally; only what a request needs is sent', control: 'toggles', toggles: [
      { label: 'App', key: 'privacy.contextForeground' }, { label: 'Titles', key: 'privacy.contextTitles' },
      { label: 'Processes', key: 'privacy.contextProcesses' }, { label: 'Activity', key: 'privacy.contextEvents' },
      { label: 'Time', key: 'privacy.contextTime' }, { label: 'Power', key: 'privacy.contextPower' },
      { label: 'Performance', key: 'privacy.contextPerformance' }] },
    { id: 'system', label: 'System tools', tip: 'Shell, file and web tools for your requests', control: 'switch', key: 'systemAccess' },
    { id: 'vision', label: 'Screen vision', tip: 'Screenshots for your requests; sent, never saved', control: 'switch', key: 'screenAwareness' },
    { id: 'reflect', label: 'Reflect on open questions', tip: 'At most twice an hour; never starts actions', control: 'switch', key: 'cognitiveEnabled', deeper: 'initiative' },
    { id: 'trial', label: s => trial(s) === 'running' ? 'Quiet trial running' : 'Quiet trial', tip: 'One day of check-ins you review instead of hear',
      control: 'buttons', deeper: 'initiative', buttons: [
        { label: 'Start', action: 'initiative-start', visible: s => trial(s) === 'live' },
        { label: 'Review', action: 'initiative-open', visible: s => trial(s) !== 'live' || s.initiative?.startedAt != null },
        { label: 'Resume check-ins', action: 'initiative-resume', visible: s => trial(s) === 'review' }] },
    { id: 'routines', label: 'Named routines', tip: 'Teach steps once, ask by name', control: 'switch', key: 'routinesEnabled', deeper: 'initiative',
      get: s => s.config.routinesEnabled !== false, buttons: [{ label: 'Review', action: 'routines-open' }] },
    { id: 'curiosity', label: 'Learn from project evidence', control: 'switch', key: 'projectCuriosityEnabled', deeper: 'initiative',
      get: s => s.config.projectCuriosityEnabled !== false, buttons: [{ label: 'Review', action: 'curiosity-open' }] },
    { id: 'daily-review', label: 'Daily review', tip: 'A quiet summary after 6 pm', control: 'switch', key: 'dailyReviewEnabled', deeper: 'initiative',
      get: s => s.config.dailyReviewEnabled !== false, buttons: [{ label: 'Review', action: 'reviews-open' }] },
    { id: 'daily-recap', label: 'Offer the daily recap', control: 'switch', key: 'dailyReviewNotify', deeper: 'initiative' },
    { id: 'interests', label: 'Ongoing interests', tip: 'She picks one creative interest a day', control: 'switch', key: 'interestsEnabled', deeper: 'initiative',
      buttons: [{ label: 'Review', action: 'interests-open' }] },
  ],
};

const codex = {
  id: 'codex', label: 'Codex & project', icon: 'codex',
  summary: s => s.integration?.lastSeen ? 'Connected' : 'Waiting',
  deepers: { 'codex-advanced': 'Advanced' },
  rows: [
    { id: 'codex-status', label: 'Codex', tip: 'Approvals stay in Codex; her desktop actions ask separately', control: 'status',
      value: s => s.integration?.lastSeen ? 'Connected' : 'Waiting for activity' },
    { id: 'project', label: s => s.project ? `Project · ${s.project.name}` : 'Project', tip: 'The folder she works in for you', control: 'buttons',
      buttons: [{ label: s => s.project ? 'Change' : 'Choose', action: 'project-choose' },
        { label: 'Use home', action: 'project-off', visible: s => Boolean(s.project) }] },
    { id: 'codex-model', label: 'Model', tip: 'Empty uses your account default', control: 'text', key: 'codexModel' },
    { id: 'codex-effort', label: 'Reasoning effort', control: 'select', key: 'codexEffort',
      options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high']] },
    { id: 'codex-exe', label: 'Codex path', tip: 'Empty finds codex.exe automatically', control: 'text', key: 'codexExecutable', deeper: 'codex-advanced' },
  ],
};

const app = {
  id: 'app', label: 'App', icon: 'app',
  summary: s => s.runtime?.currentSource === false ? 'Restart ready' : `v${s.runtime?.version ?? ''}`,
  deepers: { 'app-more': 'More' },
  rows: [
    { id: 'restart', label: s => s.runtime?.currentSource === false ? 'New changes ready' : `Version ${s.runtime?.version ?? ''}`, control: 'buttons',
      buttons: [{ label: 'Check', action: 'refresh' }, { label: 'Restart', action: 'restart', primary: true }] },
    { id: 'display', label: 'Display', control: 'select', key: 'displayId', get: s => s.config.displayId ?? '', parse: v => v === '' ? null : Number(v),
      options: s => [['', 'Primary'], ...(s.displays || []).map((d, i) => [d.id, `Screen ${i + 1} · ${d.width}×${d.height}`])] },
    { id: 'browser', label: 'Preferred browser', control: 'select', key: 'preferredBrowser', get: s => s.config.preferredBrowser || 'Firefox',
      options: [['Firefox', 'Firefox'], ['system', 'Windows default'], ['Google Chrome', 'Chrome'], ['Microsoft Edge', 'Edge'], ['Brave', 'Brave']] },
    { id: 'lang', label: 'Language', control: 'select', key: 'lang', get: s => s.config.langSetting || 'auto',
      options: [['auto', 'Follow Windows'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['ru', 'Русский']] },
    { id: 'startup', label: 'Start with Windows', control: 'switch', action: 'startup', get: s => s.startup === true },
    { id: 'crunchyroll', label: 'Crunchyroll profile', tip: 'The profile to pick; empty asks each time', control: 'text', key: 'crunchyrollProfile', deeper: 'app-more' },
    { id: 'build', label: 'Build', control: 'info', deeper: 'app-more', value: s => `${s.runtime?.build ?? ''} · ${s.runtime?.root ?? ''}` },
  ],
};

export const SECTIONS = [sound, memory, reminders, behavior, codex, app];

const rows = [...QUICK, ...SECTIONS.flatMap(section => section.rows)];
export const KEYS_USED = rows.flatMap(row => [row.key, row.mute, ...(row.toggles || []).map(t => t.key)]).filter(Boolean);
export const ACTIONS_USED = [...new Set([...rows.flatMap(row => [row.action, ...(row.buttons || []).map(b => b.action), ...(row.actions || [])]), 'quit'].filter(Boolean))];
