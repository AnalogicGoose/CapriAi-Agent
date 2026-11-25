# Visual guides, walkthroughs and reminders: design

Date: 2026-11-23 · Status: ready for approval · Branch: `feature/visual-guides-reminders`

## 1. Intent

Capri should be able to **show** you how things work instead of only telling you. The main uses are explaining how a page, app or game screen works, and walking you through changing a setting in Windows, an app or a game. She should also remind you of things at a time you choose. All three keep her current personality, voice, colors and fonts.

A rename and a new character and sprites are planned **after** this work. The new features must therefore not depend on the name "Capri" or on how her sprite looks.

The idea comes from Jarvis (a fork of KenKaiii/Roamies). That project is AGPL-3.0 and Capri is MIT, so **no Jarvis code, schemas or assets may be copied**. Everything here is designed and written independently.

## 2. Goals, non-goals, anti-goals

**Goals**
- **G1 Explain on screen:** she marks and labels the parts of what you're looking at, where they are, in her style.
- **G2 Walkthroughs:** she rings one control at a time, says the step, waits for you to act, then moves on. This works in Windows Settings, normal apps, web pages, and games in borderless or windowed mode.
- **G3 Reminders:** one-off and repeating reminders with snooze, set by voice or text, delivered in her voice.
- **G4 Low consumption:** a walkthrough costs about one Codex request, not one per step. Reminders fire with no AI call.

**Non-goals (this version)**
- Diagram, chart, maths, map, 3D or quiz cards. Only `note`, `steps` and `table` cards ship now.
- Capri clicking for you during a guide. You always click; existing `capri_control` and `capri_input` stay separate.
- Reminders on your phone or in a calendar (a possible later "phone connection").
- Drawing over **exclusive** fullscreen games (Windows doesn't allow it).
- Reminder rules beyond: once, every day, weekdays, chosen weekdays, every N minutes/hours, monthly on day N.

**Anti-goals (would be a failure even if it technically works)**
- A system-wide mouse or keyboard hook, or recording where you click. Capri's privacy rule is no hooks.
- Pointing confidently at the **wrong** control. When unsure, she says so and asks or looks again.
- Interrupting a game visually for a reminder.
- Her drawings appearing in the screenshots Codex sees and confusing it.
- New user-facing strings hard-coding the name "Capri".
- Running model-written code (HTML/SVG/JS) to draw anything.

## 3. Constraints and current state

- **Electron overlay:** one transparent, click-through `BrowserWindow` sized to the *work area* of one display (`createOverlay`, `src/main/main.js`). It hides when a fullscreen app is in front (`onFullscreen`) and in Gaming mode.
- **Highlight today:** `src/main/desktop-highlight.js` opens one small, content-protected, non-focusable window per highlight (one box plus a caption, 8 s, cleared when the foreground window moves). Styles are in `src/renderer/styles/desktop-highlight.css`.
- **Finding targets today:**
  - `WindowsAccessibility.inspect()` uses UI Automation by name through a PowerShell helper (~600 ms per call, ~1.5 s the first time), with an OCR fallback (`windows-ocr.ps1`).
  - `ScreenAccess.snapshot()` returns a screenshot with coordinates.
  - Codex tools `capri_window_controls`, `capri_point`, `capri_point_on_snapshot` and `capri_control` live in `src/main/codex-tools.js`.
- **Style:** flat and hard-edged ("Trigger cel"), dark `--ink` panels, violet misregistered offset shadow, `--green` accents, Chakra Petch for display type, JetBrains Mono for body. CSS variables live in `src/renderer/styles/capri.css`.
- **Speech:**
  - Whisper wake word ("Hey Capri") works across apps. A wake activates `voiceSession` and shows the overlay, even in fullscreen.
  - TTS goes through `SpeechOutput`. Its `allowed()` currently requires the overlay to be visible and not fullscreen, unless a voice session is active, and is off in Gaming mode.
  - TTS is off by default (`ttsEnabled: false`).
- **Storage:** `node:sqlite` files in `%APPDATA%\CapriGPT`.
- **Languages:** her UI and lines exist in en, es, fr, pt and ru.
- **Codex:**
  - Chat turns run through `CodexBrain` with dynamic tools.
  - Tool specs are re-sent every turn, so new tool descriptions must be short (target under 1.5 KB added in total).
  - PR #8 (token budget) is open and changes `codex-brain.js` and the prompts; build on top of it if it has merged.

## 4. Approaches considered

**Where drawings appear**
- A. Her existing overlay: one display, stops above the taskbar, hidden in fullscreen. Showing it in a game would bring her body back.
- **B. A separate guide layer (chosen):** one transparent, click-through, non-focusable, content-protected window per display that has something drawn on it. It covers the full display bounds, can appear over borderless games without her body, and is invisible to screen capture.
- C. One window per mark: awkward for arrows between targets and label collision.

**How a walkthrough runs**
- **A. Plan once, run locally (chosen):** one Codex turn produces the whole plan, and Capri executes it locally. Codex is called again only when a step's target can't be found or the screen is unexpected.
- B. Codex at every step: adaptive, but one request and a few seconds per step.

## 5. Decided behavior

### 5.1 Guide layer (shared by explain and walkthrough)
- A new main-process module owns one guide window per display, created on demand and destroyed when empty.
- Window properties:
  - Transparent, frameless, `focusable: false`, ignores the mouse, `setContentProtection(true)`.
  - Always on top at the `screen-saver` level.
  - Sized to the display's **full bounds** (not the work area).
- Coordinates:
  - Targets arrive in native screen pixels from UI Automation or OCR, or as snapshot pixels mapped through the existing `ScreenAccess` frame.
  - They are converted to DIP per display, the same way `desktop-highlight.js` does today.
- It renders only validated structures (section 5.2) with CSS and SVG in her style. No model-supplied markup.
- **Lifetime:** drawings belong to the window they annotate.
  - If that window loses the foreground, they clear.
  - If it moves or resizes, marks hide and are re-placed once it stops.
  - A new drawing that replaces them (`capri_draw` with `clear: true`, or one on another window), 2 minutes without interaction, Gaming mode turning on, a locked or suspended session, or quitting also clear them. A new request does not: asking about a drawing must not erase it. *(Clarified after review.)*
  - Walkthrough steps keep their mark until the step ends.
- **Fullscreen and games:** the guide layer may show while a fullscreen window is in front **only** for an explanation or walkthrough you explicitly asked for in the current request.
  - Her body and panel stay hidden.
  - When the guide ends, the layer closes and fullscreen hiding resumes.
  - In Gaming mode, guides run only when you explicitly ask by voice, matching how voice requests already lift Gaming mode for that request (section 8, decision 2). She never starts one on her own.
  - If the game is exclusive fullscreen (the layer can't appear on top), she says so once and suggests borderless window. Detecting this is a builder call (section 7).
- **Her body:** while a guide runs and her overlay is visible, she reacts through existing body actions (`capri_body` actions such as `come`, `mood`, `wave`). Nothing depends on specific sprite frames, so the new character only has to support the same actions.

### 5.2 Explain on screen: the drawing format
- **New Codex tool `capri_draw`** with arguments `{ marks: Mark[], cards: Card[], clear: boolean }`. It is validated in the main process before anything draws, and an invalid draw returns a plain error to Codex. Limits: 12 marks, 2 cards.
- **Target:** exactly one of:
  - `control`: an `id` from `capri_window_controls` in the same turn.
  - `text`: a visible text string, found by OCR in the foreground window, with an optional `nth` when it appears more than once.
  - `snapshot`: `{ snapshotId, x, y, width, height }` from `capri_screen`.
- **Mark kinds (v1):**
  - `ring`: a cut-corner frame around the target.
  - `arrow`: from a target or side to a target.
  - `label`: a short pill with text, placed beside the target.
  - `number`: a numbered badge, for order.
  - `spotlight`: dims the rest of the window, around one target only.
  - `underline`: under a text target.
  - Each mark has an optional `text` (≤ 60 chars) and an `id` the model can refer to later ("change mark 3").
- **Card kinds (v1):**
  - `note`: a title and ≤ 400 chars.
  - `steps`: a title and ≤ 8 short items.
  - `table`: ≤ 5 columns × 8 rows, short cells.
  - Cards are placed in calm space beside the annotated window. Placement is a builder call: avoid covering marks, keep them on the same display.
- **Edits:** `capri_draw` with `clear: true` removes everything. Repeating an `id` replaces that mark.
- **Resolution failures:** a target that can't be found is reported back to Codex in the tool result, and the other marks still draw. Nothing is placed at a guessed position.
- **Style:**
  - Marks use the existing palette and fonts: `--green` for the active target, `--violet` offset shadows, `--ink`/`--paper` for labels.
  - Hard edges, cut corners, and the same 170 ms entrance as `desktop-highlight.css`.
  - Respects `prefers-reduced-motion`.

### 5.3 Walkthroughs
- **New Codex tool `capri_walkthrough`** with arguments `{ title, steps: Step[] }`, at most 12 steps.
  - **Step** is `{ target: Target-by-name, say, action }`:
    - `target`: a control name plus an optional role, or visible text. Snapshot pixels are allowed only for step 1, because pixels go stale after the screen changes.
    - `say`: her line for this step, in her voice, ≤ 160 chars.
    - `action`: one of `click`, `type`, `scroll`, `look`.
  - The tool returns immediately ("walkthrough started"), and the Codex turn ends. The steps run locally.
- **Running a step:**
  1. Resolve the target in the foreground window: UI Automation by name, then OCR.
  2. Ring it, label it with the step number, and show her line in a small guide card on the layer.
  3. Speak the line through TTS if voice is on.
- **Advancing:**
  - **`click` steps:** while the step is active, Capri polls the left mouse button state and pointer position (Win32 `GetAsyncKeyState` and `GetCursorPos` through koffi, about 30 times a second). A press-and-release inside the ring (plus an 8 px margin) counts as done.
    - No hook is installed, and positions are never stored or logged.
    - Polling stops as soon as the step ends.
  - **`type`, `scroll` and `look` steps:** advance by voice ("next" / "siguiente"), by a **Next** button on the guide card, or automatically when UI Automation shows the targeted control's value changed. The automatic check is a builder call.
  - **Voice commands while a walkthrough is active**, all handled locally with no AI call: "next", "back", "repeat", "stop", in en/es/fr/pt/ru.
- **After each step:** wait about 400 ms for the UI to settle, then resolve the next target.
  - If it can't be found within about 3 s, Capri asks Codex **once** for a revised plan, sending a fresh screenshot, the original request, the steps done and the missing target.
  - At most 2 re-plans per walkthrough. After that she says she's lost the thread and offers to start over.
- **Clicking elsewhere:** a click outside the ring, or a different foreground window, pauses the walkthrough. She waits for "continue", or for the expected window to return within 60 s, before checking again. After that the walkthrough ends.
- **Never clicks for you.** The walkthrough tool has no input capability.
- **End:** she gives a short closing line in her personality, and the layer clears.

### 5.4 Reminders
- **Storage:** a new SQLite file in the profile folder. Reminders don't follow memory retention.
  - Fields: id, text, schedule (structured), next_due, created_at, last_fired, snoozed_until, status (active, done, cancelled), language.
- **Creating:**
  - **New Codex tool `capri_reminder`** with operations `add`, `list`, `update`, `cancel`.
  - `add` takes a structured schedule, `{ kind: once|daily|weekdays|days|interval|monthly, at, days, every_minutes, day_of_month, start }`, computed by Codex from your words in your local time zone.
  - Capri computes `next_due` itself (deterministic, DST-safe, unit-tested) and replies with the exact local date and time in her voice.
- **Offline commands:** `/remind list`, `/remind cancel <id>` and `/remind done <id>`, plus local phrases "what are my reminders" and "¿qué recordatorios tengo?".
- **Scheduler:** a single main-process timer set to the earliest `next_due` (not polling), re-armed on changes, on resume from sleep and on clock changes.
- **Delivery, in her voice:**
  - **Normal:** a reminder card in her panel style with **Done**, **Snooze 10 min** and **Snooze…** (15 min, 1 h, tomorrow 9:00), plus TTS if voice is on. Voice replies "done" and "snooze 15 minutes" are handled locally.
  - **Fullscreen game or Gaming mode:**
    - Voice only, no visual. This needs a narrow TTS exception for reminder delivery only.
    - The card appears once fullscreen ends or Gaming mode is turned off.
    - With voice off or muted, the card is held until then.
  - **Quiet trial and paused check-ins** don't block reminders.
  - **PC asleep or Capri closed:** on the next start or resume she says once what was missed. A repeating reminder only reports its latest missed time.
- **Recurring reminders:** "Done" completes only the current time, and the next one is scheduled. "Cancel" stops the series.
- **Control room:** a Reminders list showing text, next time and repeat, with cancel and edit-time.

### 5.5 Name independence
- New user-facing strings, tool descriptions and reminder or guide lines get the companion's name from one source, a new `identity` module exporting her display name. They never hard-code it.
- Her lines for steps and reminders come from Codex in her personality, or from small localized templates in the existing lines style (`src/renderer/js/lines.js`).

### 5.6 Calls made after the builder review
Each item is marked as the designer's call. Section 8 covers the two that needed your decision.
- **Next button on a click-through layer** (designer's call):
  - Only the guide card is interactive. While a step is active, the cursor polling that already runs flips the guide window to accept the mouse when the pointer is over the card, and back when it leaves.
  - Clicks on the card never count as "outside the ring".
- **Steps that open a new window** (designer's call):
  - A step may name the app it expects next (`expect: { app }`, a process name).
  - Without it, any new foreground window of the same process, or one that appears within 2 s of the step's click, counts as expected.
  - Only a window from another app pauses the walkthrough.
- **Re-planning** (designer's call):
  - A separate, tool-free Codex request on the background decision brain, sending the original request, the steps done, the missing target and one fresh screenshot. It returns only a new step list in the walkthrough schema.
  - It isn't added to chat history.
  - It needs screen awareness on, as guides already do.
  - If a chat turn is running, it waits for that turn to finish.
- **New requests mid-walkthrough** (designer's call):
  - A question while a walkthrough runs pauses it. She answers, then resumes the current step and re-checks its target.
  - A request for a different task, or "stop", ends it.
- **Reminders while she's hidden in her biochip** (designer's call): the reminder card appears from the biochip in the corner, like other notifications. She doesn't come out of it.
- **PR #8** (designer's call): start from `development`. If PR #8 merges first, rebase onto it and keep the new tool descriptions within the budget it sets.

## 6. Consumption
- **Explain:** one normal chat turn, plus `capri_draw` calls inside it.
- **Walkthrough:** one turn, plus at most 2 re-plans.
- **Reminders:** one turn to create, then zero AI calls to fire, snooze or complete.
- **Added tool descriptions:** target under 1.5 KB in total for the three new tools.
- **Polling:** the mouse-button check runs only while a `click` step is active.

## 7. Left to the builder
- Module and file names, the internal message format between main and the guide window, and how the guide renderer is structured (plain DOM/SVG is expected).
- Exact card placement, label collision avoidance, and arrow routing.
- How exclusive fullscreen is detected: for example, the guide window isn't visible on top after showing, or the foreground window reports exclusive mode.
- Whether `type` steps auto-advance on a UI Automation value change.
- Whether to keep one persistent PowerShell UI Automation helper during a walkthrough to cut the ~600 ms per lookup. Recommended, but optional.
- Exact snooze presets and Control room layout, within her existing style.
- Tests: unit tests for schema validation, target resolution with fakes, walkthrough state machine, click-in-ring logic, and schedule math (including DST and month ends). Extend `docs/WINDOWS-DESKTOP-TEST-PLAN.md` with manual checks: Windows Settings refresh rate, a browser settings page, a borderless game menu, two monitors, 150% scaling.

## 8. Your decisions after the builder review

**Decision 1: listening for guide and reminder commands. Chosen: a commands-only listening window.**
- **When the mic stays open:** only while a walkthrough you started is running, and for 30 s after a reminder fires or is shown. She shows her existing microphone indicator the whole time.
- **What she acts on:** only the fixed local commands:
  - next, back, repeat, stop, continue;
  - done, snooze N minutes or hours, snooze until tomorrow;
  - and their es/fr/pt/ru equivalents.
- **What's thrown away:** every other transcript is discarded on the spot, never sent to the renderer, Codex or storage, and never logged. This is the same rule the wake mode follows today.
- **Fullscreen and Gaming mode:** this window is allowed in both, because you started the walkthrough or set the reminder.
- **Implementation:** a new `commands` mode in `SpeechInput` with its own `allowed` rule. It uses the existing Whisper engine. Matching is local and needs no AI call.
- **When it closes:** at walkthrough end, after the 30 s reminder window, on "stop", or on any of the existing cancellation paths (lock screen, sleep, renderer reload).

**Decision 2: Gaming mode and explicit voice requests. Chosen: allowed when you ask.**
- An explicit voice request ("Hey Capri, show me…") may start an explanation or walkthrough in Gaming mode, consistent with today's `agentConfig` behavior during a voice session.
- Gaming mode still stops everything she does on her own (check-ins, reflection, background decisions).
- Reminders may speak in Gaming mode (voice only, card later).
- The TTS exception is limited to:
  - reminder delivery;
  - walkthrough lines of a guide you requested.
