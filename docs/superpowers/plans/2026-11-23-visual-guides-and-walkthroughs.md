# Visual Guides and Walkthroughs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capri can draw validated marks and cards over any app (including borderless games), and can run step-by-step walkthroughs that wait for your click or a spoken command, at about one Codex request per walkthrough.

**Architecture:**
- **Codex tools:** two new tools, `capri_draw` and `capri_walkthrough`. Their arguments are validated by a pure schema module.
- **Target resolution:** targets resolve to native screen rectangles through the existing UI Automation, OCR and snapshot paths.
- **Layout:** a pure layout module turns resolved targets into a per-display scene.
- **Guide layer:** a new click-through, content-protected window per display renders scenes with plain DOM/SVG.
- **Walkthroughs:** a local state machine advances steps by polling the mouse button inside the ring, or by local voice commands from a new `commands` speech mode.

**Tech Stack:** Electron 44 (main + sandboxed renderer), Node 22 `node:test`, koffi (Win32), existing PowerShell UIA/OCR helpers, Whisper server via `SpeechInput`.

**Spec:** `docs/superpowers/specs/2026-11-23-visual-guides-and-reminders-design.md` (sections 5.1–5.3, 5.5, 5.6, 8)

## Global Constraints

- No code, schemas or assets copied from Jarvis/Roamies (AGPL-3.0). Capri is MIT.
- No system-wide mouse or keyboard hook. The pointer and button are polled only while a `click` step is active, and positions are never stored or logged.
- The guide never sends input. `capri_walkthrough` and `capri_draw` have no input capability.
- Model output is never rendered as markup. The guide renderer builds DOM from validated fields only, using `textContent`.
- Guide windows use `focusable: false`, `setContentProtection(true)`, `setIgnoreMouseEvents(true)` (except over the guide card, see Task 7), always on top at `'screen-saver'`, and cover the display's full **bounds**.
- Style: existing CSS variables only (`--ink`, `--ink-2`, `--paper`, `--violet`, `--green`, `--font-display`), hard edges and cut corners, violet offset shadow, 170 ms entrance, and `prefers-reduced-motion` respected.
- New user-facing strings get the companion name from `src/main/identity.js`, never the literal "Capri".
- The three new tool descriptions together add **under 1500 bytes** of description text.
- Languages for local commands: en, es, fr, pt, ru.

## Review Focus

1. **The window moves, scrolls or closes while marks are shown:** marks must hide, not float over the wrong spot. This is covered by the lifetime test in Task 6.
2. **Two monitors with different scaling (100% and 150%):** a mark must land on the target, not offset by the scale ratio. This is covered by the mixed-DPI layout test in Task 4.
3. **Targets that appear twice ("Save" in a menu and in a dialog):** without `nth` she must report an ambiguous target, not pick one. This is covered by the ambiguous-OCR test in Task 3.
4. **The user clicks the guide card's Next button:** it must advance and must not pause as an outside click. This is covered in Task 8.
5. **Commands-mode transcripts that aren't commands:** they must never reach the renderer or Codex. This is covered by the discard test in Task 9.

---

### Task 1: Identity and drawing schema

**Files:**
- Create: `src/main/identity.js`, `src/main/guide-schema.js`
- Test: `tests/guide-schema.test.js`

**Interfaces:**
- Produces:
  - `identity.js`: `DISPLAY_NAME` (string, `'Capri'`).
  - `guide-schema.js`:
    - `MARK_KINDS = ['ring','arrow','label','number','spotlight','underline']`
    - `CARD_KINDS = ['note','steps','table']`
    - `LIMITS = { marks: 12, cards: 2, markText: 60, noteText: 400, noteTitle: 60, stepItems: 8, stepItem: 80, tableColumns: 5, tableRows: 8, tableCell: 40, walkSteps: 12, say: 160 }`
    - `validateTarget(t, { allowSnapshot = true }) -> Target`, where `Target` is one of:
      - `{ type:'control', id }`
      - `{ type:'text', text, nth? }`
      - `{ type:'snapshot', snapshotId, x, y, width, height }`
      - `{ type:'name', name, role? }` (walkthrough only)
    - `validateDraw(args) -> { clear: boolean, marks: Mark[], cards: Card[] }`
      - `Mark = { id: string, kind, target: Target, to?: Target, text? }`, where `to` is required for `arrow`.
      - `Card = { kind, title, text?, items?, columns?, rows? }`
    - `validateWalkthrough(args) -> { title, steps: Step[] }`
      - `Step = { target: Target, say, action: 'click'|'type'|'scroll'|'look', expectApp? }`
      - A `snapshot` target is allowed in step 1 only.
  - Every validation failure throws `Error` with a message naming the field (for example `marks[3].text: at most 60 characters`).

- [ ] **Step 1: Write the failing tests** in `tests/guide-schema.test.js`:
  - `accepts every mark kind with control, text and snapshot targets` asserts the normalized output; ids default to `m1..mN` when missing.
  - `rejects unknown kinds, too many marks or cards, and long text` covers 13 marks, 3 cards, a 61-char mark text, a 401-char note, 9 step items, 6 table columns, 9 table rows, and a 41-char cell. Each throws a message matching the field path.
  - `arrow needs a destination target` throws `/marks\[0\]\.to/`.
  - `walkthrough allows snapshot targets only in step 1` passes for step 1 and throws `/steps\[1\]\.target/` for step 2.
  - `walkthrough limits` covers 13 steps and a 161-char `say`, both of which throw. An `action` outside the four throws.
  - `strings are trimmed and control characters removed`: `'Save\u0007 '` becomes `'Save'`.
- [ ] **Step 2: Run** `node --test tests/guide-schema.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `identity.js` and `guide-schema.js` with the signatures above. Use plain checks only; no new dependency.
- [ ] **Step 4: Run** `node --test tests/guide-schema.test.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/main/identity.js src/main/guide-schema.js tests/guide-schema.test.js && git commit -m "Add guide drawing and walkthrough schema"`

### Task 2: Native pointer state

**Files:**
- Modify: `src/main/native-windows.js` (the `api()` binding table and exports)
- Test: `tests/native-pointer.test.js`

**Interfaces:**
- Produces: `native-windows.pointerState() -> { down: boolean, x: number, y: number }` in native screen pixels, using `GetAsyncKeyState(0x01)` (high bit = down) and `GetCursorPos`. On a non-Windows platform it throws `'Windows context is unavailable.'`, matching `api()`.

- [ ] **Step 1: Write the failing test**: `pointerState decodes the button high bit and cursor point` injects a fake api through a new exported `_setApiForTests(fake)`. With `GetAsyncKeyState` returning `0x8000`, the result is `down:true`; returning `0x0001`, it's `down:false`. `GetCursorPos` writing `(-1200, 340)` into the buffer gives `x:-1200, y:340`.
- [ ] **Step 2: Run** `node --test tests/native-pointer.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**:
  - Add `keyState: bind(user,'GetAsyncKeyState','int16',['int32'])` and `cursorPos: bind(user,'GetCursorPos','int32',['void *'])` to `api()`.
  - Add `pointerState()` (an 8-byte buffer, `readInt32LE(0/4)`) and `_setApiForTests`.
- [ ] **Step 4: Run** the test. Expected: PASS. Also run `npm test`. Expected: all previous tests pass.
- [ ] **Step 5: Commit**: `git commit -am "Add polled pointer state for walkthrough clicks"` (add the new test file first).

### Task 3: Target resolution

**Files:**
- Create: `src/main/guide-targets.js`
- Modify: `src/main/windows-accessibility.js` (add a read-only `controlBounds(id)` method)
- Test: `tests/guide-targets.test.js`

**Interfaces:**
- Consumes:
  - `WindowsAccessibility` with `observation` (`{ window, controls: Map<id,{bounds,name,role}> }`), `inspect(query, ctx)` and `readPixels(window, query, ctx)`.
  - `ScreenAccess.frames: Map<snapshotId,{display,width,height,window}>` and `displays()`.
- Produces:
  - `new GuideTargets({ accessibility, screen, foreground })`.
  - `resolve(target, ctx) -> Promise<{ ok: true, bounds:{x,y,width,height} /* native px */, window } | { ok:false, reason }>`.
    - `control` reads the current observation and is stale if the window changed.
    - `text` calls `readPixels` on the foreground window. It returns `ambiguous` when there are 2+ matches and no `nth`, and otherwise the nth match (1-based).
    - `snapshot` maps through the frame like `ScreenAccess.point` does, with `toNativePoint`.
    - `name` calls `accessibility.inspect(name)` and keeps exact (case-insensitive) name matches, filtered by `role` when given. It falls back to `text` OCR with the same name.
  - Reasons: `'not-found' | 'ambiguous' | 'stale' | 'outside-window'`.

- [ ] **Step 1: Write the failing tests** with fakes for accessibility and screen:
  - `control target uses the inspected bounds and rejects a changed window`.
  - `text target returns ambiguous for two matches without nth, and the second with nth 2`.
  - `snapshot target maps image pixels to native pixels like ScreenAccess.point`: frame 500×400 over display bounds `{x:-1000,y:0,width:1000,height:800}`, so (250,100,10,10) maps to `{x:-500,y:200,width:20,height:20}`.
  - `name target prefers exact UIA name plus role, then falls back to OCR text`.
  - `a target outside the foreground window bounds is reported as outside-window`.
- [ ] **Step 2: Run** `node --test tests/guide-targets.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `GuideTargets.resolve` and `WindowsAccessibility.controlBounds(id)`, which returns `{bounds, window}` from the current observation or `null`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Resolve guide targets from UIA, OCR and snapshots"` (with both files and the test).

### Task 4: Scene layout

**Files:**
- Create: `src/main/guide-scene.js`
- Test: `tests/guide-scene.test.js`

**Interfaces:**
- Consumes:
  - Resolved marks: `{ id, kind, text?, bounds, toBounds? }` (native px).
  - Cards from Task 1.
  - `displays: [{ id, bounds /*DIP*/, scaleFactor }]` and `screenToDip(rect) -> rect` (Electron `screen.screenToDipRect(null, rect)` in main; a fake in tests).
- Produces: `layoutScene({ marks, cards, window /*native px*/ }, { displays, screenToDip }) -> Map<displayId, { marks: PlacedMark[], cards: PlacedCard[] }>`.
  - `PlacedMark` has `{ id, kind, text?, box:{x,y,width,height} /*DIP, relative to the display's top left*/, label?:{x,y,width}, to?:{x,y} }`.
  - `PlacedCard` has `{ kind, title, text?, items?, columns?, rows?, box }`.
  - Marks go on the display containing their center. Cards go on the display of the annotated window, beside it on the side with the most free space, never overlapping a mark box. Card width is 280 DIP; if neither side fits, it's placed inside the window's bottom-right corner.
  - Label pills are 24 DIP tall, above the target if there's room, else below (the same rule as `markerLayout` in `desktop-highlight.js`).

- [ ] **Step 1: Write the failing tests**:
  - `places a ring relative to its display in DIP`.
  - `mixed DPI: a target on the 150% display is divided by its scale, not the primary's`: display A at 100%, `{x:0,y:0,w:1920,h:1080}`; display B at 150%, DIP `{x:1920,y:0,w:1707,h:960}`. A native rect on B maps to the expected DIP box.
  - `cards avoid mark boxes and pick the wider free side`.
  - `labels flip below when there's no room above`.
  - `arrow keeps a destination point in the same display space`.
- [ ] **Step 2: Run** `node --test tests/guide-scene.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `layoutScene` as a pure function with no Electron import.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Lay out guide marks and cards per display"`

### Task 5: Guide layer window and renderer

**Files:**
- Create:
  - `src/main/guide-layer.js`
  - `src/guide-preload.js`
  - `src/renderer/guide.html`, `src/renderer/js/guide.js`, `src/renderer/styles/guide.css`
- Test: `tests/guide-layer.test.js` (main side with a fake `BrowserWindow`)
- Modify: `scripts/check-windows-desktop.js` (add a visual check that renders one of each mark and card and saves `captures/guide-layer.png`)

**Interfaces:**
- Consumes: scene maps from Task 4.
- Produces:
  - `createGuideLayer({ BrowserWindow, screen, preload, page }) -> { render(sceneMap), clear(), setCardInteractive(displayId, on:boolean), onCardAction(fn(displayId, actionId)) }`.
    - `render` creates a window per display that has content and destroys windows for displays without content. Each window gets `send('guide:scene', placedSceneForThatDisplay)`.
  - Preload exposes `guideHost.onScene(fn)` and `guideHost.cardAction(id)`. The main side accepts `guide:card-action` only from a guide window's `webContents`.
  - The renderer draws each mark kind (ring: cut-corner frame; arrow: SVG line plus a hard arrowhead; label: pill; number: square badge; spotlight: `--ink` at 55% alpha with a hole; underline: 3 px `--green` bar) and each card kind. Cards may include buttons `{id,label}` passed in the scene (used by Task 8).

- [ ] **Step 1: Write the failing tests**:
  - `creates one content-protected, non-focusable, click-through window per display with content`: assert the constructor options and the calls `setContentProtection(true)`, `setIgnoreMouseEvents(true)` and `setAlwaysOnTop(true,'screen-saver')`.
  - `destroys windows for displays that become empty and on clear()`.
  - `ignores card actions from other webContents`.
  - `setCardInteractive toggles setIgnoreMouseEvents(false/true, { forward: true })`.
- [ ] **Step 2: Run** `node --test tests/guide-layer.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `guide-layer.js`, the preload, and the renderer files.
  - CSP is `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'`, as in `desktop-highlight.html`.
  - The renderer uses `textContent` only.
- [ ] **Step 4: Run** the test. Expected: PASS. Then run `npm run test:windows-desktop` on Windows. Expected: `captures/guide-layer.png` shows every mark and card in her palette. Inspect it visually.
- [ ] **Step 5: Commit**: `git commit -m "Add guide layer windows and renderer in Capri's style"`

### Task 6: Explain on screen: `capri_draw` and drawing lifetime

**Files:**
- Create: `src/main/guide-session.js`
- Modify:
  - `src/main/codex-tools.js` (the TOOLS entry and spec filter next to `capri_point_on_snapshot`, plus an execute branch)
  - `src/main/main.js` (construct `GuideTargets`, the guide layer and `GuideSession`; pass `guide` into `CodexTools`; clear on gaming-mode changes, lock and sleep)
- Test: `tests/guide-session.test.js`, plus a case in `tests/codex-brain.test.js` or `tests/action-agent.test.js` style for the tool branch

**Interfaces:**
- Consumes: `validateDraw` (Task 1), `GuideTargets.resolve` (Task 3), `layoutScene` (Task 4), the guide layer (Task 5), `native-windows.foregroundBounds()`.
- Produces:
  - `new GuideSession({ targets, layer, layout, foreground, now, setInterval, clearInterval, allowed })`.
  - `draw(args, ctx) -> Promise<{ drawn: number, failed: [{ id, reason }] }>`:
    - It validates, resolves every target, lays out and renders what resolved, and reports the failures.
    - `clear:true` clears first.
    - Repeating an `id` replaces that mark in the current drawing.
  - `clear(reason)`.
  - Lifetime, checked every 250 ms while something is drawn:
    - The foreground window id changes: clear.
    - The window's x/y/width/height changes: hide (render an empty scene) and re-resolve once it's unchanged for 500 ms.
    - 120000 ms without a new draw or step: clear.
  - Tool spec: `['capri_draw', '<≤450 byte description>', object({ marks, cards, clear })]`, available when `accessibility || screen` exist and `screen.enabled()`.
  - `allowed()` returns true when screen awareness is on and either Gaming mode is off or a voice session is active (spec section 8, decision 2).

- [ ] **Step 1: Write the failing tests** (fake timers, fake layer and targets):
  - `draws resolved marks and reports unresolved ones without guessing`.
  - `replacing a mark id keeps the others`.
  - `clears when the foreground window changes`.
  - `hides while the window moves and re-places after 500 ms of stillness`.
  - `clears after two minutes idle`.
  - `refuses to draw when screen awareness is off, or in Gaming mode outside a voice session`.
  - `tool descriptions for capri_draw stay within budget`: `Buffer.byteLength(description) <= 450`.
- [ ] **Step 2: Run** `node --test tests/guide-session.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `GuideSession`, the `capri_draw` tool branch (`shape(args,['marks','cards','clear'])`, then `guide.draw(args,{check,signal})`) and the `main.js` wiring.
  - Fullscreen: the guide layer is **not** hidden by `onFullscreen`; only her overlay is.
  - In `before-quit`, call `guide.clear()`.
  - A new `chat:send` or `personal:route` request calls `guide.clear('new-request')` before routing, unless a walkthrough is active (Task 8 owns that case).
- [ ] **Step 4: Run** `npm test`. Expected: all pass. Then manually, in a dev run, ask "how does this page work?" on a browser settings page. Expected: rings and labels on real controls, cleared when you switch windows.
- [ ] **Step 5: Commit**: `git commit -m "Let Capri explain the screen with validated marks and cards"`

### Task 7: Walkthrough state machine

**Files:**
- Create: `src/main/walkthrough.js`
- Test: `tests/walkthrough.test.js`

**Interfaces:**
- Consumes: `validateWalkthrough` (Task 1), `GuideTargets.resolve` (Task 3), `GuideSession`-style rendering through `layer`/`layout`, and `pointerState` (Task 2).
- Produces:
  - `new Walkthrough({ plan, targets, render, speak, pointer, foreground, replan, now, setTimer, clearTimer, onEnd, name })`.
    - `render(sceneMarks, card)` draws the step ring plus number, and a guide card `{kind:'steps', title, items:[say], buttons:[{id:'next'},{id:'stop'}]}`.
    - `speak(text, { purpose: 'guide' })`.
    - `replan({ request, done, missing }) -> Promise<plan|null>`.
  - Methods:
    - `start()`.
    - `command('next'|'back'|'repeat'|'stop'|'continue')`.
    - `cardAction('next'|'stop')`.
    - `question()` pauses; `resume()` continues.
  - `state` is `'resolving'|'waiting'|'paused'|'replanning'|'ended'`, and `index` is the current step.
  - Timing constants (exported):
    - `POLL_MS = 33`, `RING_MARGIN = 8`, `SETTLE_MS = 400`, `RESOLVE_TIMEOUT_MS = 3000`
    - `MAX_REPLANS = 2`, `PAUSE_LIMIT_MS = 60000`, `NEW_WINDOW_GRACE_MS = 2000`
  - Click rule: a down then up transition, both inside the ring box grown by `RING_MARGIN`, completes a `click` step. Down/up over the card box never pauses. Down/up elsewhere pauses. Polling runs only in `waiting` for `click` steps.
  - Window rule:
    - A new foreground window of the same pid, or of `expectApp`, or any window within `NEW_WINDOW_GRACE_MS` of the step's click, is expected.
    - Another app pauses.
    - If paused longer than `PAUSE_LIMIT_MS`, it ends with reason `'paused-too-long'`.
  - Lost target: after `RESOLVE_TIMEOUT_MS` (retrying every 500 ms), it calls `replan` while replans < `MAX_REPLANS`. Otherwise it ends with `'lost'`, and her closing line offers to start over.

- [ ] **Step 1: Write the failing tests** (fake clock, pointer, targets):
  - `click inside the ring advances after SETTLE_MS and speaks the next line`.
  - `click on the card's Next advances and never pauses`.
  - `click elsewhere pauses; continue resumes and re-resolves the target`.
  - `type/scroll/look steps wait for next by voice or card, not for clicks`.
  - `back returns to the previous step and repeat re-speaks the line without moving`.
  - `a dialog from the same app is expected; another app pauses; 60 s paused ends the walkthrough`.
  - `missing target re-plans at most twice, then ends with lost`.
  - `pointer polling stops when the step is not a waiting click step` asserts the fake pointer isn't read after `stop`.
  - `pointer positions are never kept`: after the walkthrough ends, the instance holds no pointer coordinates (`JSON.stringify(walk)` has no `x:` from the pointer fake's sentinel value `-31337`).
- [ ] **Step 2: Run** `node --test tests/walkthrough.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `Walkthrough` with the constants above.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Add local walkthrough state machine with polled click detection"`

### Task 8: `capri_walkthrough` tool, re-planning and wiring

**Files:**
- Modify:
  - `src/main/codex-tools.js` (TOOLS entry ≤ 500 bytes, spec filter, execute branch)
  - `src/main/main.js`:
    - one active `Walkthrough`;
    - `replan` through `decisionBrain` with one fresh screenshot;
    - `personal:route` pauses it for a question, and "stop" or a new task ends it;
    - `chat:stop` ends it;
    - card actions come from the guide layer;
    - `render` is built as `(marks, card) => layer.render(layoutScene({ marks, cards:[card], window }, { displays, screenToDip }))`;
    - `speak` sends the line to the overlay's existing TTS path, which respects `tts.allowed()` for now. Task 9 switches it to a grant.
  - `src/main/personality.js` (a ≤ 300-byte walkthrough instruction appended to the tool instructions when the tool is available)
- Create: `src/main/guide-lines.js`: `guideLine(kind:'done'|'lost'|'paused-too-long'|'exclusive-fullscreen', lang) -> string`, short lines in her warm style in en/es/fr/pt/ru, used for walkthrough endings (Task 7's `onEnd`) and Task 10's notice.
- Test: `tests/walkthrough-tool.test.js`

**Interfaces:**
- Consumes: `Walkthrough` (Task 7), `ScreenAccess.snapshot`, `decisionBrain.chat(text, …, { images, outputSchema })`.
- Produces:
  - Tool result `{ started: true, steps: n }`, or an error such as `'A walkthrough is already running.'`.
  - Re-plan request: `{ schema: WALKTHROUGH_SCHEMA, messages: [system: re-plan instructions, user: {request, done, missing, language}], images:[snapshot] }`. The returned plan is validated by `validateWalkthrough`.
  - `WALKTHROUGH_SCHEMA` is exported from `guide-schema.js` (a JSON schema mirroring the validator).

- [ ] **Step 1: Write the failing tests**:
  - `the tool starts one walkthrough and refuses a second`.
  - `re-plan sends one image and validates the reply; invalid replies count as a failed re-plan`.
  - `a question pauses and the answer resumes; a new task or stop ends it`.
  - `every walkthrough ending speaks a guideLine in the user's language`: done, lost and paused-too-long, in es and en.
  - `combined new tool descriptions stay under 1500 bytes`: sum `capri_draw` + `capri_walkthrough` (+ `capri_reminder` when the reminders plan has landed) description bytes `< 1500`.
- [ ] **Step 2: Run** `node --test tests/walkthrough-tool.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the tool branch, re-plan and `main.js` wiring. Re-plans wait for `brain.busy === false` (poll every 250 ms, giving up after 10 s with `'lost'`).
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit**: `git commit -m "Run planned walkthroughs from Codex with local stepping and bounded re-plans"`

### Task 9: Commands-only listening and guide speech

**Files:**
- Create: `src/main/command-phrases.js`, `src/renderer/js/command-listener.js`
- Modify:
  - `src/main/speech.js`:
    - new mode `commands`;
    - a `commandsAllowed` constructor option;
    - in `drain`, a commands slot emits `{type:'command', command, minutes?}` or nothing.
  - `src/main/main.js`:
    - `commandsAllowed` is true while a walkthrough is active or a reminder window is open;
    - `speech:commands` messages tell the renderer to start or stop;
    - received commands are routed to the walkthrough, or to reminders after the reminders plan.
  - `src/main/tts.js`:
    - `speak(request)` accepts `grant` (a one-time token issued by main);
    - a valid grant bypasses the visibility and fullscreen part of `allowed()`, but never `ttsEnabled`/`muted`.
  - `src/renderer/js/app.js` (create `CommandListener`; `WakeListener.blocked()` includes `commandListener.active`)
  - `src/preload.js` (`onSpeechCommands: on('speech:commands')`)
- Test: `tests/command-phrases.test.js`, plus additions to `tests/speech.test.js` and `tests/tts.test.js`

**Interfaces:**
- Produces:
  - `commandPhrase(text) -> { command: 'next'|'back'|'repeat'|'stop'|'continue'|'done'|'snooze', minutes? } | null`.
    - Phrases: en/es/fr/pt/ru for each command.
    - Snooze parses "snooze 15 minutes", "snooze an hour", "pospón 10 minutos", and "snooze until tomorrow" (`minutes: 'tomorrow'`).
  - `SpeechInput` `commands` mode: `maxSamples = 5*16000`. It is allowed only while `commandsAllowed()` returns true, including in fullscreen and in Gaming mode. Non-matching transcripts are dropped before `emit`.
  - `SpeechOutput.grant(purpose:'guide'|'reminder') -> token` (single use, expires in 60 s).

- [ ] **Step 1: Write the failing tests**:
  - `command phrases in five languages map to the same commands`, with at least two phrasings per language for next/back/stop/done/snooze.
  - `numbers and words for snooze durations`: "snooze 15 minutes" gives 15, "snooze an hour" gives 60, "pospón diez minutos" gives 10.
  - `commands mode discards non-command speech`: a fake engine returns "what a nice day". Assert that `notify` received no event containing that text.
  - `commands mode is refused when commandsAllowed is false and allowed in fullscreen when true`.
  - `a TTS grant speaks once while the overlay is hidden and never when muted`.
- [ ] **Step 2: Run** `node --test tests/command-phrases.test.js tests/speech.test.js tests/tts.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above. The renderer `CommandListener` mirrors `WakeListener`'s microphone lifecycle with `mode: 'commands'` and shows the existing voice indicator while active.
- [ ] **Step 4: Run** `npm test`. Expected: all pass. Then manually: start a Windows Settings walkthrough, then say "next", "repeat", "back" and "stop" without the wake word. Expected: each works. While it's running, unrelated speech does nothing.
- [ ] **Step 5: Commit**: `git commit -m "Add commands-only listening for walkthroughs and granted guide speech"`

### Task 10: Body reactions, fullscreen behavior and the desktop test plan

**Files:**
- Modify:
  - `src/main/main.js` (on walkthrough start and step change, call the existing body path with `come` when her overlay is visible; at the end, `mood`)
  - `docs/WINDOWS-DESKTOP-TEST-PLAN.md`
- Test: `tests/walkthrough-tool.test.js` (additions)

**Interfaces:**
- Consumes: the existing `brainTools.body(action, ctx)` path, and `fullscreenState`.

- [ ] **Step 1: Write the failing tests**:
  - `body reactions are requested only when the overlay is visible and never in fullscreen`.
  - `the guide layer stays up in fullscreen while a requested walkthrough runs and closes at the end`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring and exclusive-fullscreen detection. The method is the builder's choice (spec section 7). When it's detected, the guide or walkthrough doesn't start, and she says once per game session that it needs borderless window mode. Add a test: `exclusive fullscreen refuses with one spoken suggestion per session`. Add manual checks to the test plan:
  - Windows Settings → Display → refresh rate walkthrough;
  - a browser settings page explanation;
  - a borderless game menu, by voice, in Gaming mode;
  - an exclusive-fullscreen game, where she says to switch to borderless;
  - two monitors at 100% and 150%;
  - the guide marks not appearing in a Print Screen capture.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit**: `git commit -m "Connect walkthroughs to Capri's body and document desktop checks"`
