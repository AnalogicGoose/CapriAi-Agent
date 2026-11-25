# Stella Character Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Capri's sprite character on the overlay with Stella: a glowing eight-point star with a spinning dot globe, calm wandering, idle variations and a motion for every function.

**Architecture:** Pure, unit-tested logic modules (state blending, idle scheduling, wandering, motion catalog, per-frame scene description) feed a hybrid renderer: Canvas 2D paints the body into offscreen canvases, WebGL turns it into glowing LEDs with a holo sheen and draws the globe on top. A new `Stella` controller exposes the same surface the rest of the renderer already calls on `capri` (`perform`, `pointAt`, `setMode`, `head`, `hit`, …), so `brain.js`, `chat.js`, `guide.js`, `integration.js`, `companion.js`, `talk-menu.js` and `fullscreen-presence.js` keep working unchanged. Main sends two new events: agent tool activity and walkthrough focus.

**Tech Stack:** Electron (main CommonJS, renderer ES modules), Canvas 2D, WebGL 1, `node --test`, isolated Electron check scripts.

**Spec:** `docs/superpowers/specs/2026-11-24-stella-character-design.md` (visual reference: `docs/stella/stella-reference.html`, card 2 "In between").

## Global Constraints

- No code, schemas or assets copied from Roamies/Jarvis (AGPL-3.0). Repo is MIT.
- New code and new identifiers use the name Stella. Existing Capri names, files, tool ids (`capri_*`), IPC channel names and assets are not renamed (project 3).
- Do not delete the old renderer (`capri.js`, `sprite.js`, `acting.js`, `fx.js`, assets); only stop using it from `app.js`.
- Voice, personality, memory and abilities unchanged. Every `capri_*` tool keeps working.
- Respect Windows reduced motion (`reducedMotion` from `src/renderer/js/util.js`), including when it changes at runtime.
- Smooth: every visual change eases; nothing snaps. 60 fps target, rendering paused when hidden/folded.
- Center zone (middle 50% of width × 50% of height of the overlay view) is off-limits to wandering, reminders and approval approaches; point/walkthrough may enter it.
- Work on branch `feature/stella-character`. Commit after each task.

## Review Focus

1. **Overlay resize / display or taskbar change** while she travels or rests → she re-clamps fully inside the new view and, if wandering, into the band; never off-screen. (Task 9)
2. **WebGL context lost** (GPU reset, sleep/resume) → renderer rebuilds on `webglcontextrestored`; until then she is still hit-testable and the loop doesn't throw. (Task 8)
3. **Drag released partly off-screen or into the center** → she settles at the nearest fully visible spot; the drop spot (clamped) becomes the anchor even in the center; wandering resumes from there. (Task 9)
4. **Walkthrough/point target at a screen edge, under her, or on another display** → beside-placement stays inside the view and doesn't overlap the target rect; another display → nearest edge facing it with a blade aimed toward it. (Task 10)
5. **Reduced motion toggled while running** → travel stops at once (she settles where she is), idle variations stop, flicker/shake off; turning it back on resumes. (Task 9)

---

## File structure

New, `src/renderer/js/stella/`:

| File | Responsibility |
|---|---|
| `params.js` | Every tunable number and color (one place to tweak her look). |
| `math.js` | `clamp`, `lerp`, `smoothstep`, `easeInOut`, `damp`, `noise1`, `TAU`. |
| `blend.js` | `StateBlend`: eases listen/think/speak/rest weights and the voice level. |
| `idle.js` | `IdleScheduler`: picks idle variations and their envelopes. |
| `wander.js` | Zone math, target picking, curved paths, rest timing, beside-target placement. |
| `motions.js` | Motion catalog + mappings from agent tools, Codex tools, old act names and body actions. |
| `scene.js` | `buildScene(...)`: pure per-frame description (angles, radii, widths, dots, ring, globe, sheen). |
| `body-painter.js` | Paints the body and the holo mask from a scene into two offscreen canvases. |
| `gl.js` | Tiny WebGL helpers (compile, program, texture, quad). |
| `finish.js` | WebGL pass: LED grid, glow, unlit backdrop, holo sheen/flicker/edges. |
| `globe.js` | WebGL pass: globe points and inner light. |
| `renderer.js` | `StellaRenderer`: owns the canvas, the passes, resize, context loss. |
| `stella.js` | `Stella` controller: loop, position, travel, drag, fold, motions, Capri-compatible surface. |

New tests: `tests/helpers/esm.js`, `tests/stella-blend.test.js`, `tests/stella-idle.test.js`, `tests/stella-wander.test.js`, `tests/stella-motions.test.js`, `tests/stella-scene.test.js`, `tests/stella-controller.test.js`, `tests/agent-activity.test.js`. New check: `scripts/check-stella.js` (+ `package.json` script `test:stella`).

Modified: `src/main/codex-tools.js`, `src/main/walkthrough-controller.js`, `src/main/main.js`, `src/preload.js`, `src/main/config.js`, `src/main/settings-policy.js`, `src/renderer/index.html`, `src/renderer/js/app.js`, `src/renderer/js/fullscreen-presence.js`, `scripts/smoke-electron.js` (only where it asserts sprite-character behavior), docs.

---

### Task 1: Test loader, params and math

**Files:**
- Create: `tests/helpers/esm.js`, `src/renderer/js/stella/params.js`, `src/renderer/js/stella/math.js`
- Test: `tests/stella-blend.test.js` (math cases live here first; blend added in Task 2)

**Interfaces:**
- Produces: `loadRenderer(relPath: string) => Promise<module>` (relPath from `src/renderer/js/`, e.g. `'stella/math.js'`). Inlines relative `import … from './x.js'` / `'../x.js'` recursively as `data:` URIs (existing tests import single files this way; Stella modules import each other).
- Produces `math.js`: `TAU`, `clamp(v,a,b)`, `lerp(a,b,k)`, `smoothstep(x)` (0..1 cubic), `easeInOut(x)` (same curve, named for paths), `damp(current,target,rate,dt)` = `lerp(current,target,1-Math.exp(-rate*dt))`, `noise1(x)` in [-1,1] = `(sin(1.7x)+0.6 sin(2.9x+1.3)+0.35 sin(4.3x+2.1))/1.95`.
- Produces `params.js` `export const P` (frozen). Values from the reference mockup (sizes in units of the canvas side `s`, with `sc = s/360`):
  - `sizeFromScale: 250` (diameter px = round(250 × config.scale); default scale 0.6 → 150), `minSize: 96`
  - `R: 0.47` (×s), `ring: 0.4` (×R), `globe: 0.8` (×ring radius), `globePoints: 340`, `globePitch: -0.35`
  - `blades: {count:4, offset: Math.PI/4, rIn:0.53, rOut:0.97, wIn:40, wOut:1.5}`; `sticks: {count:4, offset:0, lag:0.05, rIn:0.54, rOut:0.78, wIn:20, wOut:1}` (w in `sc` units)
  - `dots: {perGap:26, spreadMin:0.16, spreadMax:0.42, rMin:0.5, rMax:0.86}`
  - `speeds: {spin:0.35, spinThink:1.6, blades:0.22, bladesThink:1.5, bladesSpeak:0.1, chase:1.5, chaseThink:3}`
  - `ease: {state:3, voiceAttack:18, voiceRelease:7}`
  - `led: {cell:3.5, cellMin:2.5, glowAlpha:0.55, glowBlur:6, levels:4, unlit:'rgba(120,130,220,0.06)'}`
  - `sheen: {speed:0.45, seedStep:0.23, width:0.16, cyan:[120,240,255], pink:[255,170,240], alpha:0.35, edge:'rgba(215,205,255,0.45)'}`
  - `colors`: blade gradient `['rgba(196,170,255,0.95)','rgba(139,92,246,0.9)','rgba(91,33,182,0.8)']`, stick gradient `['rgba(165,180,252,0.9)','rgba(99,102,241,0.85)','rgba(55,48,163,0.75)']`, dots `['#5b8cff','#7ea6ff']`, ring conic stops `[[0,'#f6dc9c'],[0.22,'#f2b8c6'],[0.45,'#b9a4f5'],[0.62,'#f2b8c6'],[0.8,'#f6dc9c'],[1,'#f6dc9c']]`, globe front `'#bcd3ff'` back `'#4f7cff'`, inner light `['rgba(235,245,255,0.95)','rgba(120,170,255,0.6)','rgba(60,100,255,0)']`, ambient `'rgba(70,90,230,A)'`.

- [ ] **Step 1: Write failing tests** in `tests/stella-blend.test.js`: `loadRenderer('stella/math.js')`; assert `clamp(5,0,1)===1`, `lerp(0,10,0.25)===2.5`, `smoothstep(0)===0 && smoothstep(1)===1 && smoothstep(0.5)===0.5`, `damp(0,1,3,0)===0`, `damp(0,1,3,10)>0.999`, `noise1` stays within [-1,1] for 1000 samples; and `loadRenderer('stella/params.js')` → `Object.isFrozen(P)` and `P.blades.count===4`.
- [ ] **Step 2: Run** `node --test tests/stella-blend.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(stella): test loader, params and math helpers`.

---

### Task 2: State blending

**Files:** Create `src/renderer/js/stella/blend.js`; Test `tests/stella-blend.test.js`.

**Interfaces:**
- Consumes: `math.js`, `P.ease`.
- Produces: `class StateBlend { mode: 'idle'|'listen'|'think'|'speak'|'rest'; listen; think; speak; rest; level; setMode(mode); setVoice(raw /*0..1 or null*/); step(dt) }`. Each weight eases toward 1 when it is the mode, else 0, with `damp(...,P.ease.state,dt)`. `level` follows `raw` with attack rate 18 when rising, release 7 when falling. Unknown modes throw.

- [ ] **Step 1: Failing tests:** `blend weights ease without snapping` (setMode('think'); after one 16 ms step `0<think<0.1`; after 3 s `think>0.99`, others `<0.01`); `voice rises fast and falls slower` (setVoice(1): after 0.1 s level>0.8; setVoice(0): after 0.1 s level>0.4); `rejects unknown mode`.
- [ ] **Step 2: Run** `node --test tests/stella-blend.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): eased state blending`.

---

### Task 3: Idle scheduler

**Files:** Create `src/renderer/js/stella/idle.js`; Test `tests/stella-idle.test.js`.

**Interfaces:**
- Produces: `export const IDLE_VARIATIONS = ['speedShift','counterTurn','sway','breathPulse','shineWave','dotDrift','globeTilt']`; `class IdleScheduler { constructor({random=Math.random, energy=()=>0.5}); update(now /*ms*/, {allowed:boolean}) => {name:string|null, envelope:number /*0..1*/, energy:number}; }`.
- Rules (spec): first variation after a gap; gap 8–25 s; variation duration 10–30 s; envelope eases in over the first 2 s and out over the last 2 s (`smoothstep`); never the same name twice in a row; when `allowed` is false the current variation fades out over 2 s and no new one starts; `energy()` (companion mood, 0..1) scales the returned `energy` field only.

- [ ] **Step 1: Failing tests:** `never repeats a variation back to back` (deterministic `random` sequence, simulate 2 h in 100 ms steps, collect starts, assert no consecutive duplicates and ≥5 distinct names); `durations and gaps stay in range` (measure each run and gap: duration ∈ [10,30] s, gap ∈ [8,25] s); `envelope is continuous` (max change between 100 ms samples < 0.06); `disallowed fades out and blocks new starts`.
- [ ] **Step 2: Run** `node --test tests/stella-idle.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): idle variation scheduler`.

---

### Task 4: Wandering and placement

**Files:** Create `src/renderer/js/stella/wander.js`; Test `tests/stella-wander.test.js`.

**Interfaces:**
- Produces:
  - `centerZone(view:{w,h}) => {x,y,w,h}` = middle 50%×50%.
  - `clampToView(p:{x,y}, radius, view) => {x,y}` (fully visible, `radius` = her half-size + 8 px margin).
  - `inBand(p, radius, view) => boolean` (inside view and her circle doesn't intersect the center zone).
  - `pickWanderTarget({from, radius, view, random}) => {x,y}`: a point `inBand`, at least 160 px and at most 45% of the view's diagonal from `from` (relax the max if no candidate after 40 tries; always returns an `inBand` point).
  - `makePath(from, to, random) => {from,to,control,length}`: quadratic Bézier, control point offset perpendicular to the chord by 15–30% of its length, on a random side.
  - `pointOnPath(path, u /*0..1*/) => {x,y}`; `travelDuration(path) => ms` at 30 px/s, clamped to [2500, 20000].
  - `restDuration(random) => ms` in [30000, 180000].
  - `besideTarget({target:{x,y,w,h}, radius, view, from}) => {x,y}`: the closest candidate of {left, right, above, below} the rect at `radius+24` px gap that is fully in view and doesn't overlap the rect; if none fits, the in-view point farthest from the rect center.
  - `edgeToward({direction:'left'|'right'|'up'|'down', radius, view, from}) => {x,y}`: the point on that view edge (clamped) nearest `from`.

- [ ] **Step 1: Failing tests:** `wander targets never enter the center or leave the view` (5 view sizes incl. 1280×680, 3440×1400, 800×600; 2000 random picks each); `paths start and end exactly and bend smoothly` (pointOnPath(0)==from, (1)==to, max step between u samples bounded); `travel and rest durations in range`; `beside-target never overlaps the target and stays in view` (targets at each corner, edges, center, and a target larger than half the view); `edge placement faces the other display`; **Review Focus 1/3 support:** `clampToView brings off-screen points fully inside`.
- [ ] **Step 2: Run** `node --test tests/stella-wander.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): calm wandering and placement math`.

---

### Task 5: Motion catalog and mappings

**Files:** Create `src/renderer/js/stella/motions.js`; Test `tests/stella-motions.test.js`.

**Interfaces:**
- Produces `export const MOTIONS` — `{ [name]: {duration:ms, priority:1..3, hold?:true} }` for: `flare` (900, 2), `fold` (700, 2), `radar` (1800, 1), `scan` (1400, 1), `ticks` (1200, 1), `aim` (hold, 3), `trail` (1200, 1), `chime` (1800, 3), `swirlIn` (1300, 1), `swirlOut` (1300, 1), `approval` (hold, 3), `glitch` (500, 3), `celebrate` (1400, 2), `musicPulse` (hold, 1), `wake` (600, 2), `pulse` (500, 1), `doublePulse` (900, 1), `spinBurst` (1500, 2), `breath` (1600, 1). Envelope rule: ease in 15% / out 25% of duration with `smoothstep`; `hold` motions stay at 1 until released, then ease out over 400 ms.
- `motionForAgentTool(tool:string, op?:string) => string` mapping every `capri_*` tool id in `src/main/codex-tools.js`:
  - `capri_apps` → `open_url|open_app|open_workspace|open_media|play_music|play_video|youtube_latest|open_result` → `flare`; `search_web|search_news|steam_deals` → `radar`
  - `capri_close_app` → `fold`; `capri_screen`, `capri_context`, `capri_point_on_snapshot` → `scan`; `capri_input`, `capri_desktop_step`, `capri_control`, `capri_window_controls`, `capri_routine_step` → `ticks`
  - `capri_point` → `aim`; `capri_walkthrough` → `aim`; `capri_draw` → `trail`; `capri_reminder` → `swirlIn` (scheduling; due reminders use `chime` via Task 13)
  - `capri_memory_learn`, `capri_memory_change`, `capri_project_change`, `capri_routines_save`, `capri_topic_recap` → `swirlIn`; `capri_memory_lookup`, `capri_project_lookup`, `capri_routines_lookup`, `capri_curiosity_lookup`, `capri_settings_read`, `capri_saved_work`, `capri_daily_review` → `swirlOut`
  - `capri_approval` → `approval`; `capri_settings_change`, `capri_routines_delete`, `capri_body` → `pulse`; anything else → `'think'` (state, not motion)
- `motionForCodexTool(tool) => string` (external Codex hook events, same regexes as `acting.js` `actionForTool`): search→`radar`, write/edit/patch/notebook→`ticks`, read/view/inspect/list→`scan`, else `'think'`.
- `motionForAct(name) => string|null` for names still called on `capri.perform`: `alarm`→`glitch`, `flinch`→`glitch`, `curious`→`pulse`, `hop`→`celebrate`, `victory`→`celebrate`, `split`→`spinBurst`, `zap`→`flare`, `point`→`aim`, `unpoint`→null (release aim), `talk`/`listen`/`idleListen`→null (states handle them), `dive`/`dropLand`/`dropPlop`/`plop`/`fold`/`turn`→null. Names `companion.js` plays through `capri.perform` (read them from `src/renderer/js/companion.js`): `idleWave`→`doublePulse`; `idleStretch`, `idleYawn`, `idleBreathe`, `idleSway`, `idlePreen`→`breath`; `idleBounce`, `spin`, `dance`→`spinBurst`; any other name → `null`. Never returns `undefined`.
- `bodyResponse(action) => {motion:string|null, reply:string|null, rest?:boolean, wake?:boolean, come?:boolean}`: `come`→`{come:true,motion:'pulse'}`, `nap`→`{rest:true,motion:'breath'}`, `wake`→`{wake:true,motion:'wake'}`, `mood`→`{motion:'pulse'}` (reply from companion), `wave`→`doublePulse`, `dance`→`spinBurst`, `stretch`→`breath`, `sit`/`stand`→`{motion:null, reply:'I don’t sit anymore — I just float around now.'}`.
- `class MotionMixer { play(name, now); release(name, now); update(now) => {[name]: envelope}; busy(now) => boolean }`: priority — a lower-priority motion is ignored while a higher one is active; same-priority replaces with crossfade; routine (priority 1) starts are rate-limited to one per 1800 ms.

- [ ] **Step 1: Failing tests:** `every capri tool id has a motion` (parse the `TOOLS` rows' first column out of `src/main/codex-tools.js` text with a regex and assert each maps to a name in `MOTIONS` or `'think'`, and that no tool maps to `'think'` except ones in an explicit allow-list you write in the test: none expected); `apps operations split between flare and radar`; `codex tool names follow the old action rules`; `old act names map or are deliberately ignored` (every name in the PERFORM list above returns a string or `null`, never `undefined`); `body actions keep the ability` (`sit` returns the exact reply string above); `mixer respects priority, crossfades and rate-limits` (play `radar` twice within 1800 ms → second ignored; `glitch` over `radar` wins; envelope continuous).
- [ ] **Step 2: Run** `node --test tests/stella-motions.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): motion catalog and tool mappings`.

---

### Task 6: Scene description

**Files:** Create `src/renderer/js/stella/scene.js`; Test `tests/stella-scene.test.js`.

**Interfaces:**
- Consumes: `P`, `math.js`, `StateBlend` fields, `IdleScheduler.update` result, `MotionMixer.update` result.
- Produces: `class SceneClock { step(dt, blend, idle, motions) }` holding accumulated angles (`spin`, `blades`, `sticks`, `chase`, `ringTurn`, `sway`, `tilt`) so speed changes never jump angles; `buildScene({s, t, clock, blend, idle, motions, aim /*angle|null*/, reduced}) => Scene` where `Scene = { s, R, ring:{r, turn, alpha, chase:{angle, strength}}, blades:[{angle, rIn, rOut, wIn, wOut, seed}], sticks:[same], dots:[{x,y,r,alpha,color}], globe:{r, yaw, pitch, wavy, rippleSpeed, heart:{r, alpha}}, ambient:number, sheen:{enabled, flicker:boolean} }` (coordinates relative to the canvas, center `s/2`).
- Behavior to reproduce from the reference mockup (`luna(...)` and constants), plus:
  - idle variations: `speedShift` (blade speed × 1±0.8·env), `counterTurn` (sticks turn opposite), `sway` (blade/stick angle = base + 0.5·sin(t·0.6)·env instead of accumulating), `breathPulse` (scale +6%·env), `shineWave` (sheen seeds sequential, speed ×2), `dotDrift` (dots orbit +0.6 rad/s ·env), `globeTilt` (pitch −0.35 → +0.25·env).
  - motions: `flare` blades rOut +18%·env and ring alpha +; `fold` rOut −35%·env; `radar` one stick (index by time) width ×1.6 and brightness, sweeping 2 rad/s; `scan` globe band position (add `globe.scan: 0..1`); `ticks` sheen flicker forced on with stepped positions; `aim` rotates nearest blade to `aim` angle (shortest path, eased) and extends it +15%; `trail` (handled by the controller in screen space; scene just raises ambient); `chime` ring alpha 3 pulses; `swirlIn/swirlOut` dots radius × (1 ∓ 0.5·env) with orbit; `approval` ring alpha steady 1; `glitch` x/y jitter ±2 px·env (0 if reduced) and flicker; `celebrate`/`spinBurst` +2π blades over the motion; `musicPulse` blade length × (1+0.08 sin(t·8)); `wake`/`pulse`/`doublePulse`/`breath` scale envelopes.
  - `reduced`: no flicker, no jitter, angular speeds × 0.1, idle variations ignored.
  - `blend.rest`: brightness × 0.45, speeds × 0.3.

- [ ] **Step 1: Failing tests:** `geometry matches the reference` (idle, t=0, s=360: R=169.2, 4 blades at π/4 offsets with rIn≈0.53R, rOut≈0.97R, wIn=40, wOut=1.5; 4 sticks; 104 dots); `angles accumulate, never jump when speed changes` (switch blend think 0→1 abruptly in SceneClock; max per-frame angle delta < 0.05 rad at 60 fps); `speaking widens and extends` (with level 1 vs 0: blade wIn larger and rOut larger, heart.r larger); `aim turns the nearest blade the short way`; `reduced motion removes flicker and jitter`; `rest dims`.
- [ ] **Step 2: Run** `node --test tests/stella-scene.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): per-frame scene description`.

---

### Task 7: Body painter

**Files:** Create `src/renderer/js/stella/body-painter.js`; Create `scripts/check-stella.js` (first section); Modify `package.json` (`"test:stella": "electron scripts/check-stella.js"`).

**Interfaces:**
- Consumes: `Scene`.
- Produces: `class BodyPainter { constructor(size); resize(size); paint(scene) => {body: OffscreenCanvas, mask: OffscreenCanvas} }`.
  - `body`: ambient glow, blades, sticks (tapered quads, radial gradients from `P.colors`), dots, ring (conic gradient + soft glow + thinking chase arc). Port of the mockup's body drawing.
  - `mask`: same blade/stick shapes filled flat with `rgb(255·coverage, 255·u, 255·seed/8)` where `u` is 0 at the inner end → 1 at the tip (linear gradient along the blade axis) and the seed identifies the point; transparent elsewhere. Used by the shader for sheen and edges.
- `scripts/check-stella.js` follows `scripts/check-animations.js`: isolated `userData` under `.caprigpt-local/stella-check`, loads modules by file URL in a hidden window, 25 s timeout, exits 1 on failure.

- [ ] **Step 1: Write the check section** "painter": paint idle scene at s=360 and s=96; assert body canvas has > 4% non-transparent pixels and mask alpha is non-zero only where body blade pixels are; save `body.png` and `mask.png` to `.caprigpt-local/stella-check/`.
- [ ] **Step 2: Run** `node_modules/electron/dist/electron.exe scripts/check-stella.js` → FAIL (module missing).
- [ ] **Step 3: Implement `BodyPainter`.**
- [ ] **Step 4: Run** the check → PASS; open the PNGs and compare with `docs/stella/stella-reference.html` card 2 by eye.
- [ ] **Step 5: Commit** `feat(stella): body painter`.

---

### Task 8: WebGL finish, globe and renderer

**Files:** Create `src/renderer/js/stella/gl.js`, `finish.js`, `globe.js`, `renderer.js`; Modify `scripts/check-stella.js`.

**Interfaces:**
- Produces: `class StellaRenderer { constructor(canvas:HTMLCanvasElement); setSize(cssSize, dpr); draw(scene, t); get lost(): boolean; dispose() }`.
  - Pass 1 `finish.js`: uploads `body` + `mask` textures each frame; fragment shader samples `body` on an LED grid (cell = `max(P.led.cellMin, P.led.cell·s/360)` CSS px × dpr), quantizes brightness to `P.led.levels`, draws round LEDs with size by level, a blurred body underlay at `P.led.glowAlpha` (two-pass separable blur, or a 9-tap blur — implementer's choice), faint unlit LEDs inside radius `0.48·s`, then sheen from `mask`: band at `pos = fract-like ((t·0.45 + seed·0.23) mod 1.4) − 0.2` along `u`, cyan→pink, alpha 0.35, flicker multiplier `1 + 0.27·sin(23t+7seed)·sin(3.1t+seed)` (off when `scene.sheen.flicker` is false), crisp edge where mask coverage gradient is high (`P.sheen.edge`). Premultiplied alpha output; transparent background.
  - Pass 2 `globe.js`: `scene.globe` — 340 golden-spiral points as `gl.POINTS`, rotated by yaw/pitch, ripple radius `1 + wavy·0.13·band` with `band = 0.5 sin(7y − rippleSpeed·t) + 0.5 sin(4·atan2(z,x) + 3t)`, depth-shaded color/alpha/size (front `#bcd3ff`, back `#4f7cff`), additive blend; optional `scan` band brightening; then the inner light as a radial sprite.
  - Context loss: listen for `webglcontextlost` (preventDefault, set `lost`) and `webglcontextrestored` (rebuild programs/textures); `draw` is a no-op while lost.
- [ ] **Step 1: Extend the check:** render idle/listen/think/speak/each motion at s=150 into a gallery grid; assert `gl.getError()===gl.NO_ERROR` after each frame, the canvas center pixel region is non-transparent, and frames for idle at t and t+0.5 s differ (animated). **Review Focus 2:** call `WEBGL_lose_context.loseContext()`, assert `renderer.lost` and that `draw` doesn't throw; `restoreContext()`, wait for the event, assert a non-blank frame again. **Perf:** time 300 idle frames at s=150; record the mean ms/frame in the check output and fail if > 4 ms.
- [ ] **Step 2: Run** the check → FAIL.
- [ ] **Step 3: Implement** the four files.
- [ ] **Step 4: Run** → PASS; inspect `gallery.png` against the reference.
- [ ] **Step 5: Commit** `feat(stella): WebGL LED finish, globe and renderer`.

---

### Task 9: Stella controller — core, drag, resize, reduced motion

**Files:** Create `src/renderer/js/stella/stella.js`; Test `tests/stella-controller.test.js`.

**Interfaces:**
- Consumes: Tasks 2–6, `StellaRenderer` (injected; tests pass a fake with `setSize/draw`).
- Produces `class Stella` with constructor `({root, canvas, voice, renderer?, now=()=>performance.now(), schedule=requestAnimationFrame, random=Math.random, reduced=()=>reducedMotion.matches, saveAnchor=(p)=>{}})` and the surface the existing renderer calls on `capri` (names verbatim, so callers need no change):
  - state: `mode` (`'idle'|'work'|'alert'|'sleep'`), `setMode(mode)` (calls `onMode(mode, prev)`), `wake()`, `dormant=false`, `busy` (getter: motion mixer busy or travelling to a function target), `act` (getter: `null` or `{player:{name}}` for the active motion, for callers that check `capri.act`), `endAct(completed)`, `setChatThinking(on)` + `chatThinking`, `speechLevel` setter → blend voice.
  - geometry: `pos {x,y}` (her center), `scale`, `setScale(scale)` (diameter = `round(250·scale)`, min 96), `view {w,h}`, `setView(w,h)` (re-clamp; **Review Focus 1**), `head()` → `{x: pos.x, y: pos.y - size·0.25}`, `towardCenter()` → `+1` if she's left of view center else `-1`, `hit(x,y)` → inside circle radius `0.45·size`, `spot(name)` → `'post'|'random'` points in the band.
  - pointer: `pointerHeld`, `dragging`, `onPointerHold`, `onClick`, `onMenu`, `cancelDrag()`. Drag starts after 5 px; she follows the pointer with `damp(rate 14)`; points lean opposite to velocity (scene `aim` unused); release → settle at `clampToView` of the pointer point, save anchor via `saveAnchor`, wander timer restarts. Click without drag → `onClick()`.
  - callbacks kept: `onMove(head)` every frame she moves, `onMode`, `onTeleport(phase)` ('start'/'end' around travels ≥ 600 ms so panels can suspend), `onStow`, `onUnstow`, `onGaze` (never called), `onDoze` (never called), `onIdleWave` (never called), `chipAt`.
  - actions: `perform(name, dir)` → `motionForAct`; `reactToTool(tool)` → `motionForCodexTool`; `reactToAction(name)` (`'think'` → think state for 2 s; others → motion); `agentActivity({tool, op, phase, ok})` → on `start` play `motionForAgentTool` (holds released on `end`); `ok===false` → `glitch`; music: on `end` with `ok` for `capri_apps` ops `play_music`/`play_video`/`youtube_latest`, hold `musicPulse` for 45 s (the spec's "short fixed time" fallback — the overlay has no playback signal), released early by `stow`/fold or another `capri_apps` start; `trail` (from `capri_draw`) runs toward the view center because the overlay doesn't receive the drawing's position; `wakeHeard()` → `wake` motion + listen state; `pulse()`, `hurt()` → `glitch`, `celebrate({onSpeak})` → `celebrate` then `onSpeak()` after 600 ms, `spark()`/`zap()`/`gaze()`/`earnUplink()` → `pulse`/`flare` (return truthy where callers await), `attend()` → listen state 3 s, `goToWork()` → `setMode('work')`, `wakeHeard()` (see above), `companion` (property; app assigns the `Companion`).
  - removed pet behaviors kept as safe no-ops returning resolved promises: `sitOn`, `possess`, `doze`, `unpeek`, `intro`(→ `materialize`), `canSit()`→false, `pickSeat()`→null, `requestPosture()`→ `bodyResponse('sit').reply`, `possessWindows` property ignored, `windows`/`setWindows(data)` stored only (callers read `capri.windows.wins`).
  - loop: one `schedule` loop; per frame: step blend/idle (allowed when idle, not dragging, not travelling to a function target, not rest, not reduced, `idleAnimations` on)/motions/clock, build scene, `renderer.draw`, position the canvas (`root.style.transform`), call `onMove` when position changed. Pause drawing when `hidden`, folded or `document.hidden`.
  - **Review Focus 5:** `reduced()` is read every frame: when it becomes true mid-travel she stops where she is (no snap), anchor := current position.
- [ ] **Step 1: Failing tests** (fake renderer, fake clock, manual `schedule`): `exposes every member the renderer calls` (list from the grep of `capri.*` usages in `src/renderer/js/*.js` minus ones only used by the sprite renderer: `fx`, `root`, `voice`, `drawFrame`, `fullscreenProgress`, `hidden`, `debug`, `stance`, `facing`, `sky`, `uplinkDay`, `mission`, `js`, `setStance`, `materialize`, `teleport`, `summon`, `stow`, `unstow`, `stowNow`, `gamingDeparture`, `prepareGamingReturn`, `gamingArrival` — those are added in Tasks 10–11; assert the rest are present); `drag follows smoothly and settles clamped` (**Review Focus 3**: release at (-50,-50) and at view center → final pos fully visible; anchor saved equals clamped drop point); `click without drag calls onClick`; `setView shrink re-clamps her inside` (**Review Focus 1**); `reduced motion stops travel in place` (**Review Focus 5**); `routine tool bursts don't flicker` (10 `reactToTool('Read')` in 1 s → one `scan` start); `requestPosture replies in character`; `act reports the active motion`.
- [ ] **Step 2: Run** `node --test tests/stella-controller.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): controller core, drag and resize`.

---

### Task 10: Stella controller — wandering, pointing, walkthrough focus, body actions

**Files:** Modify `src/renderer/js/stella/stella.js`; Test `tests/stella-controller.test.js`.

**Interfaces:**
- Adds to `Stella`: `wander` (boolean, config), `anchor {x,y}|null` (from `config.stellaAnchor`), `nextMove`, `nextGaze` (numbers; callers set them to postpone her moving — honored: no wander travel before `nextMove`), `teleport(spot)` → `glideTo(spot)`, `summon(cursor)` → glide toward cursor, stopping at the edge of the center zone, `glideTo(point, {reason}) => Promise` (curved `makePath`, `travelDuration`, `easeInOut`; `onTeleport('start'|'end')` for travels ≥ 600 ms), `pointAt(target, {label}) => Promise<truthy>` (target = window `{x,y,w,h}` in overlay coords or a point `{x,y}` → treat as a 1×1 rect; glide `besideTarget`, play `aim` with angle toward target center; sets `pointing = {dir}` for `panel.setAnchor`), `stopPointing()` (release `aim`, return toward anchor area after 1.5 s), `canPoint(win)` (rect intersects view), `guideFocus(focus)` where `focus = null | {rect:{x,y,w,h}} | {direction:'left'|'right'|'up'|'down'}` (rect → like `pointAt`, held until next focus; direction → `edgeToward` + aim toward that side; `null` → release and glide back to anchor), `bodyAction(action) => Promise<string>` (uses `bodyResponse`; `rest` → `blend.setMode('rest')`, no wandering until `wake` or a click/chat; `come` → `summon` with current cursor passed by app; returns the reply or `'done'`), `remind()` → `chime` + small glide toward screen center that stops outside the center zone, `approval(on)` → hold/release `approval` and glide a little toward view center (outside the zone).
- Wander loop: when `wander` and allowed (idle mode, not chat open — app sets `nextMove`, not dragging/pointing/guiding/rest/reduced), after `restDuration` pick `pickWanderTarget` from current pos and `glideTo` it; while resting add bob `±3 px` with period 4 s. `wander=false` → stays at anchor.
- Anchor: first run (no saved anchor) → lower-right band point (`x = view.w − 0.15·view.w`, `y = view.h − 0.18·view.h`, then `clampToView`, then nudged into band). Function returns go to the anchor area (anchor itself if `wander=false`, otherwise a `pickWanderTarget` near the anchor within 200 px).
- [ ] **Step 1: Failing tests:** `wandering stays in the band for an hour of simulated time` (sample pos every frame; never `!inBand` once she's started wandering from a band point); `wander off keeps her at the anchor`; `nextMove postpones travel`; `pointAt places her beside, never over, the target` (**Review Focus 4**: targets at four corners, view center and one wider than half the view); `guide focus to another display goes to that edge and aims`; `guide end returns to the anchor area`; `nap rests until wake`; `come stops outside the center zone`; `reminders and approvals stay outside the center zone`.
- [ ] **Step 2: Run** `node --test tests/stella-controller.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): wandering, pointing and walkthrough focus`.

---

### Task 11: Stella controller — folding away (stow, games, fullscreen)

**Files:** Modify `src/renderer/js/stella/stella.js`, `src/renderer/js/fullscreen-presence.js`; Test `tests/stella-controller.test.js`, existing `tests/fullscreen.test.js`.

**Interfaces:**
- Adds to `Stella`: `fold` (0..1, 1 = folded), `stowed`, `gaming`, `fullscreen`, `fullscreenProgress`, `hidden`, `root`, `fx` (= `null`), `voice`, `drawFrame(now)` (render one frame immediately), `stow() / unstow() / stowNow()` (fold over 600 ms, reduced motion 120 ms fade; `onStow`/`onUnstow`), `materialize(spot)` (start folded at `spot`, unfold), `intro(spot)` → `materialize(spot)`, `gamingDeparture() => Promise` (fold, resolve when folded, ≤ 1100 ms), `prepareGamingReturn()` (folded, invisible, placed at anchor), `gamingArrival() => Promise` (unfold), `presenceEffect(active)` (no particles; plays `voice.play(active ? 'teleport-out' : 'teleport-in', {soft:true})` only).
  - Fold visual (scene input `fold`): blades/sticks rOut → rIn, dots → ring, ring radius → 0 into a single bright point that fades; reverse to unfold. `fullscreenProgress` drives `fold` directly so `FullscreenPresence` timing/revisions stay authoritative.
- `fullscreen-presence.js`: replace the beam/burst block with `if (this.capri.presenceEffect) this.capri.presenceEffect(active); else { …existing beam/burst code… }` (keep the old branch so the Capri renderer still works if swapped back).
- [ ] **Step 1: Failing tests:** `stow folds and unstow unfolds smoothly` (fold monotonic, ends at 1/0); `gaming departure resolves after folding`; `fullscreen progress drives the fold`; `presence effect uses no fx`; existing `tests/fullscreen.test.js` still passes.
- [ ] **Step 2: Run** `node --test tests/stella-controller.test.js tests/fullscreen.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): fold away for stow, games and fullscreen`.

---

### Task 12: Main process — agent activity, walkthrough focus, anchor setting

**Files:** Modify `src/main/codex-tools.js`, `src/main/walkthrough-controller.js`, `src/main/main.js`, `src/preload.js`, `src/main/config.js`, `src/main/settings-policy.js`; Test `tests/agent-activity.test.js`, `tests/walkthrough.test.js`, `tests/settings-policy.test.js`.

**Interfaces:**
- `CodexTools` constructor accepts `activity = () => {}`; `run(name, args, context)` calls `activity({tool:name, op: args?.operation ?? args?.action ?? args?.tool ?? null, phase:'start'})` before `execute` and `activity({tool:name, op, phase:'end', ok:true|false})` after (in `finally`; `ok` false when it threw). Errors thrown by `activity` are swallowed. No argument values other than that short `op` string are sent.
- `WalkthroughController` constructor accepts `focus = () => {}`; in `render()` after computing the scene, call `focus({displayId, rect})` with the current step's **target** mark box (first mark) in screen DIP when present (else the card box), and `focus(null)` when the walkthrough ends (same place `notifyActive(false)` is called).
- `main.js`: pass `activity: event => overlay?.webContents.send('agent:activity', event)` to `CodexTools`; pass `focus` to the walkthrough controller converting to overlay coordinates: if `displayId` equals the overlay's display, send `{rect:{x: r.x − workArea.x, y: r.y − workArea.y, w: r.width, h: r.height}}`; otherwise send `{direction}` (left/right/up/down by comparing that display's bounds center to the overlay display's); `null` passes through. Channel `'guide:focus'`.
- `preload.js`: `onAgentActivity: on('agent:activity')`, `onGuideFocus: on('guide:focus')`.
- `config.js` DEFAULTS: add `stellaAnchor: null`; change the `wander` comment to `// calm wandering around the edges when idle`.
- `settings-policy.js` `overlayPatch`: accept `stellaAnchor` when it is `null` or `{x,y}` with finite numbers (round to integers); reject anything else.
- [ ] **Step 1: Failing tests:** `run reports start and end with only the operation name` (fake `execute`; assert two events, `ok:true`; for a throwing tool `ok:false` and the error still propagates; an `activity` that throws doesn't break the tool); `walkthrough reports its target and clears at the end` (extend `tests/walkthrough.test.js` with a fake `focus`); `overlay may save a finite anchor only` (`{x:1.6,y:2.2}`→`{x:2,y:2}`; `{x:'a'}`, `{x:Infinity,y:0}` rejected).
- [ ] **Step 2: Run** `node --test tests/agent-activity.test.js tests/walkthrough.test.js tests/settings-policy.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stella): agent activity and walkthrough focus events`.

---

### Task 13: Wire Stella into the overlay

**Files:** Modify `src/renderer/index.html`, `src/renderer/js/app.js`; Modify `scripts/check-stella.js`.

**Interfaces:**
- Consumes everything above.
- `index.html`: add `<div id="stella"><canvas id="stella-canvas"></canvas></div>` where `#capri` is, and hide/remove the `#capri` element's sprite canvas from layout (keep `#fx`, `#chip`, `#mask` elements; `#mask` stays unused).
- `app.js`:
  - Stop loading `capri-full.png`, intro and cut-in images; keep fonts. `FxLayer` is no longer constructed; `fx` references removed from boot (fullscreen presence uses `presenceEffect`).
  - `const capri = new Stella({ root: #stella, canvas: #stella-canvas, voice, renderer: new StellaRenderer(canvas), saveAnchor: p => host.setConfig({ stellaAnchor: p }) })` — keep the variable name `capri` so the rest of the file and other modules are untouched; set `capri.wander`, `capri.anchor = config.stellaAnchor`, `capri.gaming`, `capri.setScale(config.scale)`, `capri.idleAnimations = config.idleAnimations !== false`.
  - Companion: after `capri.companion.configure(config)` (and in `onConfig`), configure with `cursorInteractions:false, surpriseAnimations:false` forced (spec: cursor greetings and surprises removed; daily-routine gestures map to a gentle `breath` and the evening report keeps working).
  - Wake word: in `wakeListener`'s `onWake`, call `capri.wakeHeard()` before `voiceCall.start(event)`. Proactive messages: in `host.onConversation` after `panel.say(...)`, call `capri.perform('curious')` (→ `pulse`).
  - `host.onAgentActivity?.(e => capri.agentActivity(e))`; `host.onGuideFocus?.(f => capri.guideFocus(f))`; reminder cards: when `reminderCards.receive` shows a card call `capri.remind()`; approvals: where `integration.js` sets `alert` mode, `Stella.setMode('alert')` also calls `approval(true)` and leaving alert calls `approval(false)` (inside `Stella.setMode`, so `integration.js` stays unchanged).
  - `onBodyAction`: `result = await capri.bodyAction(action)`; for `come`, pass the cursor first: `await host.cursor()` if available (same call `companion.js` uses) → `capri.summon(point)`; `mood` keeps `capri.companion.request('mood')` for the reply text and plays the motion.
  - `host.onConfig`: also update `capri.idleAnimations`, `capri.anchor` only if changed externally.
  - Commands: `teleport` → `capri.glideTo(capri.spot('random'))`; `intro` → `capri.materialize(capri.spot('post'))`; `act` → `capri.perform(cmd.act)` or method by name (drop the sit branch); `pose` → keep `scale`/`at`/`still`, drop `stance`/`facing`.
  - Replace `brain.onShowcase` body with a Stella sequence using captions: `flare` (open), `radar` (search), think state 2 s, `swirlIn` (memory), `stow()`/`unstow()`, `celebrate`.
  - Startup: `config.visible === false` → `capri.stowNow()`; else `await capri.materialize(capri.anchor || capri.spot('post'))`.
  - Remove the possession demo branch and `capri.possessWindows` assignments.
- [ ] **Step 1: Extend the check:** boot `src/renderer/index.html` with a stub `window.host` (all `on*` no-ops, `getConfig` returning defaults with `stellaAnchor:null`, `setConfig` capturing patches) in the isolated window; assert `#stella-canvas` draws non-blank pixels within 2 s, `capri.hit` is true at her center, dispatching a fake agent activity `{tool:'capri_apps', op:'search_web', phase:'start'}` sets the active motion to `radar`, a drag sequence via synthetic pointer events moves her and produces a `stellaAnchor` patch, and no console errors occurred.
- [ ] **Step 2: Run** `npm run test:stella` → FAIL.
- [ ] **Step 3: Implement the wiring.**
- [ ] **Step 4: Run** `npm run test:stella` → PASS, then `npm start`, watch her for 5 minutes idle, open chat, ask her to search the web, run a walkthrough, drag her, toggle Gaming mode in the control room.
- [ ] **Step 5: Commit** `feat(stella): Stella replaces the sprite character on the overlay`.

---

### Task 14: Existing suites, docs

**Files:** Modify `scripts/smoke-electron.js` (only assertions about sprite-only behavior: intro cut-ins, sitting, perching, possession, teleport beams), `ANIMATIONS.md`; Create `docs/STELLA.md`.

- [ ] **Step 1: Run** `npm test` → record failures; each one must be either a test of the old renderer modules themselves (leave passing — the modules still exist) or an app-level assertion about removed behavior (update to the Stella equivalent or delete with a one-line reason in the commit message).
- [ ] **Step 2: Run** `npm run test:settings`, `npm run test:desktop -- --fullscreen-only` (as documented in `ANIMATIONS.md`), `npm run test:layout`; fix app-level assertions the same way.
- [ ] **Step 3: Write `docs/STELLA.md`:** what she looks like, states, idle variations, wandering rules, function → motion table (from the spec), how to tune `params.js`, how to run `npm run test:stella`. Replace the top of `ANIMATIONS.md` with a pointer to it, marking the rest as the retired Capri renderer (removed in the rename project).
- [ ] **Step 4: Run** `npm test && npm run test:stella` → PASS.
- [ ] **Step 5: Commit** `docs(stella): character guide; update suites for the new character`.
