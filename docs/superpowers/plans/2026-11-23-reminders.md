# Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** You set one-off and repeating reminders by voice or text. Capri fires them locally on time, in her voice, with Done and Snooze. Firing uses zero AI calls.

**Architecture:**
- **Schedule math:** a pure module computes the next due time from a structured schedule.
- **Store and timer:** a SQLite store keeps reminders, and a single main-process timer fires the earliest one.
- **Delivery:** a pure policy decides voice, card or hold based on fullscreen, Gaming mode and voice settings.
- **Creating:** Codex turns your words into a structured schedule through the `capri_reminder` tool. Listing, cancelling, completing and snoozing also work offline and by local voice commands.

**Tech Stack:** Electron 44, `node:sqlite`, `node:test`, existing `SpeechOutput` and panel renderer.

**Spec:** `docs/superpowers/specs/2026-11-23-visual-guides-and-reminders-design.md` (sections 5.4, 5.5, 5.6, 8)

## Global Constraints

- Firing, snoozing, completing and listing make **no** AI calls.
- Reminders don't follow memory retention.
- Delivery rules:
  - In a fullscreen app or Gaming mode, voice only, and the card appears once that ends. With voice off or muted, the card is held.
  - Quiet trial and paused check-ins never block reminders.
- Missed reminders (PC asleep or Capri closed): one notice on the next start or resume. A repeating reminder reports only its latest missed time.
- Recurring: "done" completes the current time only; "cancel" ends the series.
- Schedule kinds exactly: `once`, `daily`, `weekdays`, `days`, `interval`, `monthly`. No other rules.
- Snooze presets: **Snooze 10 min** (button), and **Snooze…** offering 15 min, 1 h, and tomorrow 9:00.
- The voice-command window stays open for 30 s after a reminder fires or is shown (requires plan 1, Task 9; without it, card buttons only).
- New user-facing strings use `DISPLAY_NAME` from `src/main/identity.js`. If plan 1 hasn't landed, create that file as `module.exports = { DISPLAY_NAME: 'Capri' }`.
- Languages: en, es, fr, pt, ru.
- The `capri_reminder` description is ≤ 500 bytes.

## Review Focus

1. **Daylight-saving changes:** a 9:00 daily reminder must still fire at 9:00 local time on both sides of a DST switch, never at 8:00 or 10:00. This is pinned in Task 1.
2. **Monthly on day 31 in a 30-day month or February:** it fires on the month's last day and returns to the 31st the next month. This is pinned in Task 1.
3. **The clock jumps (manual change or resume after days asleep):** no burst of repeats. One missed notice, then the next future time. This is pinned in Task 3.
4. **A snooze longer than the gap to the next repeat:** the snoozed copy fires once, and the series continues from its own schedule without duplicates. This is pinned in Task 2.
5. **"Done" pressed on a held card hours later:** it completes the instance that fired, not the next one. This is pinned in Task 2.

---

### Task 1: Schedule math

**Files:**
- Create: `src/main/reminder-schedule.js`
- Test: `tests/reminder-schedule.test.js`

**Interfaces:**
- Produces:
  - `KINDS = ['once','daily','weekdays','days','interval','monthly']`.
  - `validateSchedule(s) -> Schedule`. It throws `Error` naming the field.
    - `Schedule = { kind, at?: 'HH:MM', date?: 'YYYY-MM-DD', days?: number[] /*0=Sun..6*/, every_minutes?: number /*5..10080*/, day_of_month?: number /*1..31*/, start?: ISO string }`.
    - `once` requires `date` + `at`, or `start`.
    - `daily` and `weekdays` require `at`; `days` requires `days` + `at`; `interval` requires `every_minutes`; `monthly` requires `day_of_month` + `at`.
  - `nextDue(schedule, after: Date) -> Date | null`. It returns the first occurrence strictly after `after`, in **local** time, built with `new Date(y, m, d, hh, mm)` so DST is handled by the platform. `once` returns `null` once past.
  - `describe(schedule, lang) -> string`, a short localized repeat label ("Weekdays at 09:00", "Cada 2 horas").

- [ ] **Step 1: Write the failing tests** (`TZ` set to `America/New_York` via `process.env.TZ` at the top of the file, before any Date use):
  - `daily 09:00 stays at 09:00 local across the March and November DST switches`.
  - `weekdays skips Saturday and Sunday`.
  - `days [1,3] fires Monday and Wednesday`.
  - `interval 120 counts from start, not from now`.
  - `monthly 31 falls back to the month's last day and returns to the 31st`: Jan 31, Feb 28, Mar 31.
  - `once in the past returns null`.
  - `validation rejects unknown kinds, 25:00, every_minutes 4, and day_of_month 0`.
  - `describe returns five languages`.
- [ ] **Step 2: Run** `node --test tests/reminder-schedule.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** with the signatures above. No dependency.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/main/reminder-schedule.js tests/reminder-schedule.test.js && git commit -m "Add reminder schedule math"`

### Task 2: Reminder store

**Files:**
- Create: `src/main/reminders.js`
- Test: `tests/reminders.test.js`

**Interfaces:**
- Consumes: `validateSchedule` and `nextDue` (Task 1).
- Produces: `new ReminderStore(file, { now = () => new Date() })`, backed by `reminders.sqlite` in userData (`:memory:` in tests).
  - Table `reminders(id INTEGER PK, text TEXT, schedule TEXT JSON, next_due INTEGER ms, fired_due INTEGER ms NULL, snoozed_until INTEGER ms NULL, created_at INTEGER, last_fired INTEGER NULL, status TEXT CHECK in ('active','done','cancelled'), language TEXT)`.
  - Methods:
    - `add({ text /*1..200 chars*/, schedule, language }) -> Reminder`.
    - `list({ includeInactive = false }) -> Reminder[]`, ordered by the effective due time.
    - `get(id)`, `update(id, { text?, schedule? }) -> Reminder`, `cancel(id) -> boolean`.
    - `due(at: number) -> Reminder[]`: active reminders whose effective due time (`snoozed_until ?? next_due`) is ≤ `at`.
    - `markFired(id, firedDue)`: sets `fired_due` and `last_fired`, clears `snoozed_until`, and advances `next_due` to `nextDue(schedule, firedDue)`, or sets status `done` for `once`.
    - `complete(id, firedDue)`: completes that instance only. For `once` it sets status `done`; for repeats it clears `fired_due` if it equals `firedDue`.
    - `snooze(id, until: number)`.
    - `nextWake() -> number | null`: the earliest effective due time.
    - `close()`.

- [ ] **Step 1: Write the failing tests**:
  - `add validates text length and schedule, and stores the language`.
  - `markFired on a once reminder makes it done; on daily it advances next_due by one day`.
  - `snooze longer than the gap to the next repeat fires once and the series continues without a duplicate`: daily 09:00 snoozed to 09:00 the next day; assert a single `due()` hit at that time and `next_due` the day after.
  - `complete on a held card completes the fired instance, not the next one`.
  - `cancel ends a repeating series`.
  - `retention: reminders survive a MemoryStore prune` (they're in a separate file; assert there's no dependency on MemoryStore).
- [ ] **Step 2: Run** `node --test tests/reminders.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `ReminderStore`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Add local reminder store"`

### Task 3: Scheduler and missed reminders

**Files:**
- Create: `src/main/reminder-scheduler.js`
- Test: `tests/reminder-scheduler.test.js`

**Interfaces:**
- Consumes: `ReminderStore` (Task 2).
- Produces:
  - `new ReminderScheduler({ store, now, setTimer, clearTimer, fire })`.
    - `fire(reminder, { missed: boolean, firedDue })` returns nothing.
  - Methods:
    - `arm()` sets one timer to `nextWake()`, capped at 6 h so clock changes are caught.
    - `check()` fires everything due.
    - `resume()` is called on power `resume`, `unlock-screen` and app start.
  - `MISSED_AFTER_MS = 120000`: a due time more than 2 minutes in the past counts as missed.
  - For each reminder in `check()`, only the **latest** missed occurrence is fired, with `missed:true`, followed by `markFired`. No catch-up burst.

- [ ] **Step 1: Write the failing tests** (fake clock and timers):
  - `arms one timer for the earliest reminder and re-arms after firing`.
  - `after three days asleep, a daily reminder fires once as missed, then schedules tomorrow`.
  - `a clock jump forward of a week fires each reminder at most once`.
  - `timer waits are capped at 6 hours`.
  - `adding, updating or cancelling re-arms`: `store` change events call `arm()`.
- [ ] **Step 2: Run** `node --test tests/reminder-scheduler.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `ReminderScheduler`. `ReminderStore` gains an `onChange(fn)` hook used by `arm`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Fire reminders from a single timer with one missed notice"`

### Task 4: Delivery policy and localized lines

**Files:**
- Create: `src/main/reminder-delivery.js`
- Test: `tests/reminder-delivery.test.js`

**Interfaces:**
- Produces:
  - `deliveryPlan({ fullscreen, gaming, overlayAvailable, voiceOn }) -> { speak: boolean, card: 'now' | 'held' }`. `overlayAvailable` means the overlay exists and isn't destroyed; she may be stowed in her biochip.
    - Fullscreen or Gaming mode, voice on: `{ speak:true, card:'held' }`.
    - Fullscreen or Gaming mode, voice off: `{ speak:false, card:'held' }`.
    - Otherwise: `{ speak: voiceOn, card: overlayAvailable ? 'now' : 'held' }`.
  - `reminderLine(reminder, { missed, lang, name }) -> string`, in en/es/fr/pt/ru.
    - Normal: "Reminder: {text}". Missed: "You missed: {text} at {HH:MM}". The spoken form uses her warm short style.
    - `name` comes from `DISPLAY_NAME` and is used only in Control room copy.
  - `class HeldReminders { add(r), flush(fn) }`: held cards are shown once fullscreen and Gaming mode end, oldest first, at most 5 cards (with "and N more" on the last).

- [ ] **Step 1: Write the failing tests**:
  - `fullscreen and gaming are voice-only when voice is on and hold the card`.
  - `muted or voice off holds the card silently`.
  - `quiet trial and paused check-ins do not appear in the policy inputs`: assert `deliveryPlan.length === 1` and that the function never reads `proactiveEnabled`.
  - `lines exist in five languages for normal and missed`.
  - `held cards flush oldest first and collapse beyond five`.
- [ ] **Step 2: Run** `node --test tests/reminder-delivery.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Decide reminder delivery for fullscreen, gaming and muted voice"`

### Task 5: Creating and managing reminders (Codex tool and offline commands)

**Files:**
- Modify: `src/main/codex-tools.js` (TOOLS entry `capri_reminder` ≤ 500 bytes; execute branch)
- Create: `src/main/reminder-commands.js`
- Test: `tests/reminder-commands.test.js`

**Interfaces:**
- Consumes: `ReminderStore`, `validateSchedule`, `describe`.
- Produces:
  - Tool `capri_reminder` with arguments `{ operation: 'add'|'list'|'update'|'cancel', id: number /*0 when unused*/, text: string, schedule: string /*JSON or ''*/ }`.
    - The result for `add` and `update` is `{ id, text, next: 'YYYY-MM-DD HH:MM' (local), repeat: describe(...) }`, so Codex confirms the exact time in her voice.
    - The tool's instruction line (≤ 200 bytes, appended when available) tells Codex to compute the schedule in the user's local time and to repeat the exact time back.
  - `routeReminderCommand(text, store, lang) -> { handled: true, text } | null` handles:
    - `/remind list`, `/remind cancel <id>`, `/remind done <id>`;
    - "what are my reminders", "¿qué recordatorios tengo?", "quels sont mes rappels", "quais são meus lembretes", "какие у меня напоминания".

- [ ] **Step 1: Write the failing tests**:
  - `add through the tool returns the exact next local time and repeat label`.
  - `invalid schedule JSON returns a plain error, not a crash`.
  - `offline list, cancel and done work without Codex in five languages`.
  - `capri_reminder description is at most 500 bytes`.
- [ ] **Step 2: Run** `node --test tests/reminder-commands.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the tool branch and `routeReminderCommand`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Create and manage reminders by voice, text and slash commands"`

### Task 6: Wiring, reminder card and voice replies

**Files:**
- Modify:
  - `src/main/main.js`:
    - construct the store and scheduler after `app.whenReady`;
    - `fire` → `deliveryPlan` → `overlay.webContents.send('reminder:due', {...})`, or hold;
    - flush held cards when `onFullscreen(false)` or Gaming mode is turned off;
    - `resume`, `unlock-screen` and start call `scheduler.resume()`;
    - route `routeReminderCommand` early in `personal:route`;
    - the TTS grant is `tts.grant('reminder')` when plan 1 Task 9 exists, otherwise speak only when `tts.allowed()`;
    - open a 30 s commands window after each fire or card shown (when plan 1 Task 9 exists).
  - `src/preload.js`: `onReminderDue: on('reminder:due')`, `reminderAction: (id, action, firedDue, minutes) => ipcRenderer.invoke('reminder:action', ...)`.
  - `src/renderer/js/app.js`:
    - show the card with `panel.say({ kind:'alert', line, actions:[{id:'done',label},{id:'snooze10',label},{id:'snooze',label}] })`;
    - "Snooze…" shows a second set: 15 min, 1 h, tomorrow 9:00;
    - speak with the received grant through `host.ttsSpeak`.
- Test: `tests/reminder-wiring.test.js` (main-side helpers extracted into `reminder-delivery.js` where needed, so they're testable without Electron)

**Interfaces:**
- `reminder:action` accepts only the overlay sender. Arguments are `id`, `action: 'done'|'snooze'`, `firedDue` (number), and `minutes` (number or `'tomorrow'`, meaning 09:00 the next local day).
- Voice commands `done` / `snooze N` from plan 1's commands mode apply to the **most recently shown** reminder card within its 30 s window.

- [ ] **Step 1: Write the failing tests**:
  - `snooze tomorrow means 09:00 next local day`.
  - `actions from a non-overlay sender are rejected`.
  - `a reminder firing during fullscreen speaks with a grant and shows its card after fullscreen ends`.
  - `voice done applies to the last shown card only within 30 s`.
- [ ] **Step 2: Run** `node --test tests/reminder-wiring.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring and the renderer card.
- [ ] **Step 4: Run** `npm test`. Expected: all pass. Then manually: set "remind me in 2 minutes to test". Expected: card and voice on time; Snooze 10 min reschedules; in a borderless fullscreen game you hear it, and the card appears after you exit.
- [ ] **Step 5: Commit**: `git commit -m "Deliver reminders as Capri cards and voice with snooze"`

### Task 7: Control room Reminders list

**Files:**
- Modify:
  - `src/main/settings-window.js` (allow actions `reminder-cancel` and `reminder-move`)
  - `src/main/main.js` (`settingsState().reminders = store.list().map(...)`; `settingsAction` cases)
  - `src/renderer/settings.html` (nav button `data-page="reminders"`)
  - `src/renderer/js/settings.js` (page rendering)
- Test: `tests/reminder-settings.test.js`

**Interfaces:**
- `settingsState().reminders: [{ id, text, next /*local string*/, repeat }]`.
- `settings:action('reminder-cancel', id:number)`.
- `settings:action('reminder-move', { id, at: 'HH:MM', date?: 'YYYY-MM-DD' })`. For a repeating reminder it changes `at`; for a one-time reminder it changes the date and time.

- [ ] **Step 1: Write the failing tests**:
  - `settings actions validate reminder ids and times`: rejects a non-integer id and `'25:00'`.
  - `moving a once reminder changes its next due; moving a daily one changes its time of day`.
- [ ] **Step 2: Run** `node --test tests/reminder-settings.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the page using the existing `heading`/`card`/`row`/`button` helpers in `settings.js`, with copy using the companion name from state.
- [ ] **Step 4: Run** `npm test`. Expected: all pass. Run `npm run test:settings` and check the new page in `captures/`.
- [ ] **Step 5: Commit**: `git commit -m "List, move and cancel reminders in the Control room"`
