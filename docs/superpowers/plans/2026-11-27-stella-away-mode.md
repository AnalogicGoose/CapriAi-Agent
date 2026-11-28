# Stella Away Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put away, Stella glides to the bottom-left corner and rests there as a small closed bud drawn by her real renderer, quiet but able to talk; a click brings her back. Then every old-character leftover goes.

**Architecture:** A new `rest.js` mixin on the Stella controller replaces fold-based `stow/unstow/stowNow` with a rest timeline (`curl` 0→1) plus a travel to a corner spot; the on-screen size shrinks with a CSS scale on her root. `buildScene` learns `curl`, `stretch` and `warm` to pose the bud; `SceneClock` learns `slow`. `app.js` drops the chip/mask canvas and wires click/right-click on the bud; the panel keeps following her `head()`.

**Tech Stack:** Electron, plain ES modules, Canvas 2D + WebGL renderer, Web Audio, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-27-stella-away-mode-design.md`

## Global Constraints

- Branch `feature/stella-away` (off `development`); commit per task; never commit `.superpowers/`.
- Corner: bottom-left of her view, margins `left 26`, `bottom 22` px (same as the old chip), bud fully on screen.
- Compact size: 40 % of awake size (`COMPACT = 0.4`).
- Going away and coming back: `REST_MS = 1500` each; curl happens over the second half going away, unfurl over the first half coming back; arc lift `ARC = 30` px.
- Resting life: breathing period 5.5 s, stretch every 9 s ± 1.5 s (randomised with `this.random`), stretch length 1.6 s; clocks slowed to 10 % (`slow = 1`).
- Resting draw rate: 18 fps once fully curled and not travelling.
- Reduced motion: fade (120 ms) at her spot, appear at the corner (and back); no arc, no stretch.
- Resting but quiet: `config.visible === false` gates in main stay as they are, except putting her away no longer cancels speech or TTS.
- Only a click (no drag) wakes her; right-click opens her menu; hover does nothing.
- No word of the old character in tracked files outside `docs/superpowers/` (`tests/stella-name.test.js` rules).
- Starlight sound palette only (`voice.js`): sine/FM bells, air, no saw/square.

## Review Focus

1. Ctrl+Alt+C pressed twice quickly (unstow mid-stow): she turns around smoothly and ends awake at the spot she left from. Test in Task 2.
2. Display or resolution change while resting (`setView`): she moves to the new corner, still fully on screen. Test in Task 2.
3. Started already put away (`stowNow`) then clicked: she returns to her saved anchor, not to the corner. Test in Task 2.
4. Pointer down on the bud and moved (a drag attempt) while resting: she does not move; a plain click still wakes her. Test in Task 2.
5. Reduced motion on while going away/coming back: no arc, no stretch, opacity fade only. Test in Task 2.

---

### Task 1: Scene poses the bud

**Files:**
- Modify: `src/renderer/js/stella/scene.js` (`SceneClock.step`, `buildScene`)
- Test: `tests/stella-scene.test.js`

**Interfaces:**
- Produces: `buildScene({..., curl = 0, stretch = 0, warm = 0})` (all 0..1); `SceneClock.step(dt, blend, idle, motions, {reduced, aim, slow = 0})`.

- [ ] **Step 1: Write failing tests** (add to `tests/stella-scene.test.js`, using its existing helpers to build a scene):
  - `curl pulls blades and sticks in and sweeps the blades`: with `curl: 1` every blade `rOut` ≤ 0.70 × its `curl: 0` value, every stick `rOut` ≤ 0.72 × its `curl: 0` value, and each blade carries `sweep` ≈ 1.0 rad (`curl: 0` → `sweep` 0).
  - `a stretch half-opens the bud`: `curl: 1, stretch: 1` blade `rOut` > `curl: 1, stretch: 0` blade `rOut`, and `sweep` < 0.6.
  - `the resting light breathes`: with `curl: 1`, `scene.inner` (the inner-light strength field the scene already exposes, or a new `inner` field) differs between `t = 0` and `t = 2.75`; with `curl: 0` the breath term is absent.
  - `warm turns the ring gold`: `warm: 1` gives `scene.ringWarm === 1` and `warm: 0` gives `0`.
  - `slow clocks crawl`: `SceneClock.step(1, …, {slow: 1})` advances `blades` and `spin` by 10 % (±1e-6) of what `slow: 0` advances.
- [ ] **Step 2: Run** `node --test tests/stella-scene.test.js` — the new tests FAIL.
- [ ] **Step 3: Implement.** In `buildScene`: blade `rOut` × `lerp(1, 0.68, curl) + 0.16 * stretch * curl`; stick `rOut` × `lerp(1, 0.7, curl)`; blade `sweep = curl * (1 - 0.55 * stretch)` (stick sweep 0.7 × that); drifting dots pulled toward the ring (`r → lerp(r, 0.5 + 0.25 r, curl)`) and their count halved; inner light `lerp(1, 0.55 + 0.4 * b, curl)` with `b = 0.5 + 0.5 sin(2π t / 5.5)`; `ringWarm = warm`; breathing scale `1 + 0.03 * b * curl`; breath quickens to a 3.5 s period while `warm`. Add `sweep` to each blade/stick object and teach `body-painter.js` to draw a swept wedge (tip rotated by `sweep`, sides as quadratic curves like the mockup `.superpowers/brainstorm/1030-1795828987/content/rest-pose.html` `wedge()`), and `finish.js`/the ring painter to tint toward `#f6dc9c` by `ringWarm`. In `SceneClock.step`, multiply every angular speed by `lerp(1, 0.1, slow)`.
- [ ] **Step 4: Run** `node --test tests/stella-scene.test.js tests/stella-blend.test.js` — PASS; `npm run test:stella` — PASS (renders unchanged at `curl 0`).
- [ ] **Step 5: Commit** `feat(stella): scene poses a closed bud (curl, stretch, warm, slow clocks)`.

### Task 2: Rest controller (put away = curled in the corner)

**Files:**
- Create: `src/renderer/js/stella/rest.js`
- Modify: `src/renderer/js/stella/fold.js` (remove `stow`, `stowNow`, `unstow`; keep fold for games/fullscreen), `src/renderer/js/stella/stella.js` (install `Rest`, `frame()`, `drawFrame()`, `place()`, `hit()`, `head()`, `setView` hook), `src/renderer/js/stella/acts.js` (`start`), `src/renderer/js/stella/focus.js` (`approach`, `remind`, `approval`)
- Test: create `tests/stella-rest.test.js` (copy the `make()` helper from `tests/stella-controller.test.js`)

**Interfaces:**
- Consumes: Task 1 `buildScene` / `SceneClock.step` options.
- Produces on `Stella`: `stowed` (bool, unchanged meaning), `stowing` (promise|null), `stow(): Promise`, `stowNow(): void`, `unstow(): Promise`, getters `curl` (0..1 eased), `compact` (1 → 0.4), `cornerSpot(): {x, y}`, `restHit(x, y): boolean`; `onStow` / `onUnstow` callbacks fire as today (onStow once curled, onUnstow when coming back starts). `stow()` does **not** call `announce()`.

- [ ] **Step 1: Write failing tests** in `tests/stella-rest.test.js`:
  - `stow glides to the corner and curls`: after `stow()` and 1600 ms of frames, `stowed === true`, `curl === 1`, `compact === 0.4`, `pos` equals `cornerSpot()` and `cornerSpot()` puts the scaled bud (radius `0.45 * size * 0.4`) inside `left 26 / bottom 22` of a 1920×1080 view; the last drawn scene had `curl === 1`; `onStow` called once; voice played `curl-up` once.
  - `unstow unfurls back to where she was`: from a spot `{x: 900, y: 500}`, stow, rest, `unstow()`, 1600 ms → `pos` ≈ `{900, 500}`, `curl === 0`, `compact === 1`, `stowed === false`, voice played `unfurl`.
  - Review Focus 1 `turning around mid-stow`: `stow()`, 700 ms, `unstow()`, 1600 ms → awake at the original spot, `curl === 0`.
  - Review Focus 2 `a new view moves her to its corner`: stowed, `setView({w: 1280, h: 720})` → `pos` equals the new `cornerSpot()`.
  - Review Focus 3 `stowNow then unstow returns to the saved anchor`: constructed with `anchor: {x: 600, y: 400}`, `stowNow()` (no sound, `curl === 1` immediately, `pos` at corner), `unstow()` → ends at `{600, 400}`.
  - Review Focus 4 `the bud cannot be dragged`: stowed, `pointerDown` on the bud then `pointerMove` 80 px → `dragging === false`, `pos` unchanged; `restHit` is true on the bud centre and false 40 px outside it.
  - Review Focus 5 `reduced motion fades instead`: reduced, stow → no frame where `pos.y` < straight-line interpolation (no arc), `stretch` stays 0, root opacity dips below 1 during the move.
  - `resting life`: stowed, step 20 s → at least one drawn scene with `stretch > 0.5`; while fully curled and not travelling, draws happen at most every `1000/18` ms.
  - `quiet while resting`: stowed, `perform('victory')`, `reactToTool('Edit')`, `agentActivity({tool: 'stella_apps', op: 'open_url', phase: 'start'})` → no motion starts and `pos` unchanged; `wakeHeard()` → no motion but voice played `listen`; `remind()` → voice played `chime`, `pos` unchanged; `setMode('alert')` → a later scene has `warm > 0.9`; leaving alert → `warm` back to 0.
  - `head follows the bud`: stowed, `head().y` is `pos.y - size * 0.25 * 0.4` and `onMove` reported it.
- [ ] **Step 2: Run** `node --test tests/stella-rest.test.js` — FAIL.
- [ ] **Step 3: Implement `rest.js`** (`Rest` mixin + `restState(reduced)`), installed with the other parts in `stella.js`. `stow()`: remember `this.restFrom = {...pos}`, `letGoAll()`, start the rest timeline toward 1 and a travel to `cornerSpot()` (use `traveler.go(spot, {reason: 'rest', fn: true})` if its easing/arc fit, else move `pos` along `lerp` + `sin(πp)·ARC` lift inside `stepRest`), play `curl-up`, resolve once curled (`stowed = true`, `onStow()`). `unstow()`: `stowed = false`, `onUnstow()`, play `unfurl`, timeline toward 0 while travelling to `restFrom ?? anchor`, `setMode('idle')` if sleeping. `stepRest(dt, now, reduced)` runs in `frame()` after `stepFold`; it eases `warm` toward `mode === 'alert' && stowed`, schedules the stretch, and exposes `curl`, `compact`, `stretch`, `warm` for `drawFrame` → `buildScene`, and `slow = curl` for `clock.step`. `place()` appends ` scale(${compact})` to the root transform; `hit()` while stowed/curling uses `restHit`; `head()` uses `size * compact`. While `stowed || stowing`: wander, idle acts and cursor reactions off (`frame()` `calm`), `pointerMove` never starts a drag, `Acts.start` returns null but still plays the `MOTION_CUES` sound for `wake`, `chime`, `approval`, `focus.approach()` resolves without moving. Throttle: in `drawFrame`, skip drawing when fully curled, not travelling, and less than `1000/18` ms since `drawnAt`. Delete `stow/stowNow/unstow` from `fold.js`.
- [ ] **Step 4: Run** `node --test tests/stella-rest.test.js tests/stella-controller.test.js tests/stella-review-fixes.test.js tests/stella-travel.test.js` — PASS (update any controller test that asserted the old fold-based stow to the new behaviour, saying so in the commit).
- [ ] **Step 5: Commit** `feat(stella): put away, she curls up resting in the corner`.

### Task 3: Away sounds

**Files:**
- Modify: `src/renderer/js/voice.js`, `docs/SOUNDS.md`, `tools/sound-lab.html`, `tests/stella-sounds.test.js`

**Interfaces:**
- Produces: cues `curl-up` and `unfurl` in `CUES` (named to avoid the existing `wake` motion → `listen` cue).

- [ ] **Step 1: Failing test** in `tests/stella-sounds.test.js`: `CUES` includes `curl-up` and `unfurl`, each has a synth (existing "every cue has a synth" test covers it once listed), and `docs/SOUNDS.md` mentions both.
- [ ] **Step 2: Run** `node --test tests/stella-sounds.test.js` — FAIL.
- [ ] **Step 3: Implement** `curlUp()`: a soft falling bell pair (D6 → A5) with long tails, a low D3 sine bloom and a breath of air falling 3000 → 600 Hz, peak ≤ 0.08 (a sigh). `unfurl()`: air rising 600 → 5000 Hz, a rising four-note bell run (D5 F#5 A5 D6) ending on a bright D6 + A6 dyad, peak ≤ 0.09. Add both to the SOUNDS table ("She curls up in the corner" / "She comes back") and to the sound-lab `WHEN` map.
- [ ] **Step 4: Run** `node --test tests/stella-sounds.test.js` — PASS; in the sound lab `measure('curl-up')` and `measure('unfurl')` return peak 0.03–0.2 and a non-silent length.
- [ ] **Step 5: Commit** `feat(sounds): curl-up and unfurl for away mode`.

### Task 4: App wiring: no chip, talk from the corner, quiet rules

**Files:**
- Delete: `src/renderer/js/chip.js`, `src/renderer/js/away-mask.js`
- Modify: `src/renderer/index.html` (remove `#chip` and the mask canvas), `src/renderer/styles/stella.css` (chip/mask rules), `src/renderer/js/app.js` (chip/mask code, `comeOut`, `hoverChip`, `nearHer`, `onChip`, `refreshHit`, contextmenu/click listeners, `onStow`/`onUnstow`/`onDoze`/`chipAt`, `onMode`), `src/renderer/js/stella/stella.js` (`onDoze`, `doze()`, `chipAt`), `src/renderer/js/brain.js` (~282 big-job teleport + celebrate), `src/main/main.js` (`toggleVisible` ~856, settings patch ~929-931), `scripts/smoke-electron.js`, `scripts/check-stella.js`
- Test: `tests/stella-rest.test.js` (brain case), `npm run test:desktop`, `npm run test:stella`

**Interfaces:**
- Consumes: Task 2 `stowed`, `restHit(x, y)`, `unstow()`, `head()`; Task 3 cues.

- [ ] **Step 1: Failing test**: in `tests/stella-rest.test.js` (or the brain test that already drives `finish`), a finished big job while `stella.stowed` does not call `stella.teleport` or `stella.celebrate` and still shows the summary via `done`.
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement.** `brain.js`: when `stella.stowed`, skip the stage teleport and victory pose and call `done({summary, hold: 14000})`; `earnUplink` handled in Task 5. `app.js`: delete chip/mask; `onBud = () => stella.stowed && mouse && stella.restHit(mouse.x, mouse.y)`; cursor `pointer` on the bud; `click` on the bud → `host.setConfig({visible: true}); stella.unstow()` (only when no drag happened); `contextmenu` on the bud → `host.openMenu()`; `nearHer` uses `0.45 * size * compact`. `stella.onStow` only hides the talk menu; `onUnstow` nothing chip-related. The panel is not suspended for put-away (stow no longer announces). `main.js`: `toggleVisible` and the `patch.visible === false` branches stop calling `speech.cancel()` / `tts.cancel()`; every other `visible === false` gate stays. Update the smoke/check scripts' chip assertions to: put away → `stella.stowed && stella.curl === 1` and `#chip` absent; click on `stella.pos` → awake.
- [ ] **Step 4: Run** `npm test`, `npm run test:desktop`, `npm run test:stella` — PASS.
- [ ] **Step 5: Commit** `feat: away mode in the app; the old corner mask is gone`.

### Task 5: Leftover cleanup and guard

**Files:**
- Modify: `src/renderer/js/lines.js`, `src/main/labels.js`, `src/main/main.js` (comments, tray items, demo terminal text), `src/renderer/js/app.js` (`satellite`/`teleport` commands), `src/renderer/js/brain.js` (satellite/red-light comments, `earnUplink` call), `src/renderer/js/stella/acts.js` (`earnUplink`), `src/main/config.js` / `src/renderer/js/settings-schema.js` / `src/main/codex-tools.js` / `src/main/settings-agent.js` / `src/main/reusable-routines.js` / `src/main/capabilities.js` (`possess`, only if dead), `src/main/reminder-delivery.js`, `src/main/reminder-controller.js`, `src/renderer/styles/stella.css`, `scripts/demo-sequence.js`, `package.json`, docs listed in the spec Cleanup section, README "What's next"
- Test: `tests/stella-name.test.js`

**Interfaces:** none new.

- [ ] **Step 1: Failing test** in `tests/stella-name.test.js`: over `git ls-files` outside `docs/superpowers/`, none of `/biochip|satellite|away-mask|night.city|\bgigs?\b|personality construct|dozens of minds|red light|\bmane\b|in the show/i` appears (case-insensitive), alongside the existing name check.
- [ ] **Step 2: Run** it — FAIL listing the files.
- [ ] **Step 3: Clean up.** Rewrite comments in Stella terms; drop the biochip line in every language of `lines.js` (replace with a resting line such as "Resting in my corner. I'm here." translated to fr/es/pt/ru in the same tone); replace satellite gaze lines with star lines. The satellite tray item and command become "Look at the stars" (all 5 languages) playing her `flare` act, and `earnUplink` becomes `starGaze` doing the same; the demo terminal text and `package.json` / `demo-sequence.js` references get neutral project names. For `teleport` and `possess`: grep their consumers; if nothing acts on them, remove the setting/label/allow-list entries (say which in the commit); if they still act, rename the label to describe what she does now.
- [ ] **Step 4: Run** `npm test`, `npm run test:desktop` — PASS.
- [ ] **Step 5: Commit** `chore: remove the last leftovers of the old character`.

### Task 6: Live check and ship

- [ ] **Step 1:** Launch from the desktop shortcut (`Desktop/Stella.lnk`, verify target/args/icon still match). Put her away by Ctrl+Alt+C, the tray and the control-room tile; watch her rest 30 s (stretch seen, nothing else moves); say "Hey Stella" (bubble + voice from the corner, she stays); trigger a permission while resting (ring warms); click her (she returns); right-click her while resting (menu); quit while away, relaunch (starts curled, silent).
- [ ] **Step 2:** `npm test`, `npm run test:desktop`, `npm run test:stella` all PASS.
- [ ] **Step 3:** Update `docs/ANIMATIONS.md` away-mode section and README "What's next"; commit; push; open PR into `development`.
