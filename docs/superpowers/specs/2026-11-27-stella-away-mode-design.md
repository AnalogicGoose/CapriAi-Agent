# Stella away mode: design

Date: 2026-11-27 · Status: approved in conversation, pending doc approval · Branch: `feature/stella-away`

## Intent

Put away (Ctrl+Alt+C, tray "Put her away", control-room "Put away" tile), Stella should still be *there*,
resting calmly in the bottom-left corner like she's chilling, small and nearly still, but alive. This
keeps the idea of the old away mode (fold to a corner form, click it to bring her back) but drops the
inherited art: today she folds into a point and a green mask from the old character (`chip.js` +
`away-mask.js`) stands in for her. That mask is the last big leftover of the old character; once away
mode is redone, every remaining leftover goes too.

## Goals

- Going away is an animation: she glides in a soft arc to the bottom-left corner, shrinking, and over
  the second half her blades and sticks curl round into a **closed bud** hugging the ring (option A
  in the mockups, chosen by the owner).
- Resting: mostly still and compact, with slow signs of life: breathing inner glow, globe turning
  very slowly, a few drifting blue dots, and every ~9 s a sleepy stretch (blades half-open, settle).
- Drawn by her real renderer: same LEDs, glow, holo sheen and palette as awake. The mockup was only
  a sketch.
- She can still talk while resting: her bubble and voice come from the corner, above her, and she
  stays put. Covers "Hey Stella", reminders and Codex/agent messages. She is *resting but quiet*: she
  does not start conversations or initiatives on her own while put away (decision 8b).
- Click her (only a click; hover does not wake her) and she unfurls with a big stretch, grows, and
  floats back to where she was before.
- New sounds: `settle` (curling up: a soft falling bell plus a breath of air, a sigh) and `wake`
  (coming back: a rising unfurl ending on a bright note), in the starlight palette of `voice.js`
  (see docs/SOUNDS.md). Resting itself is silent.
- Waiting on a permission while resting: her ring warms to gold and her breathing quickens a little;
  she stays curled. (Replaces the mask's eyes opening.)
- Put away when the app last quit: she starts already resting in the corner (no animation).
- Afterwards: no leftovers of the old character anywhere in tracked files (see Cleanup).

## Non-goals

- No new triggers for away mode (no auto-away on idle). Same three triggers as today.
- Gaming mode and the automatic fullscreen hide keep their existing fold/teleport behaviour.
- No change to how typed chat works: opening the typed chat (its hotkey / panel) still brings her out
  of the corner, because the owner is coming to work with her.

## Anti-goals

- Busy or twitchy resting: anything that draws the eye from the corner. She must read as relaxed.
- A second, separate drawing of her (that was option B, rejected): the corner form is her own body.
- Waking because the pointer passed through the corner.
- Noticeable CPU/GPU cost while resting.

## Approaches considered

- **A · Her real body, curled up (chosen).** The overlay renderer keeps drawing her, moved to the
  corner, scaled down and posed with a `rest` amount (0 awake … 1 curled). Bubble and voice already
  follow her body, so talking from the corner mostly works. Cost: the renderer keeps running; it is
  throttled while resting.
- **B · A separate small corner canvas (like the old chip/mask).** Cheap and isolated, but a second
  picture of her to keep in sync forever, and the bubble would need new anchoring. Rejected.

## How it works today (for the builder)

- `src/renderer/js/stella/fold.js`: `stow()` folds her to a point (`foldTo(1)`), sets `stowed`, calls
  `onStow`; `stowNow()` does it instantly; `unstow()` unfolds. `announce(away)` fires `onTeleport`,
  which in `app.js` suspends/resumes the panel. `tucked` (focus.js) blocks body actions while stowed.
- `app.js`: `onStow` shows the chip, `onUnstow` hides it; clicking the chip (`comeOut`) unstows and sets
  config `visible: true`; `config.visible === false` at start calls `stowNow()`. Several flows unstow
  first (chat open in `chat.js`, demo, tray `satellite` / `show`, walkthrough). `onMode` sets the chip's
  alert mode. Main (`main.js` ~710, ~854) sends `stow` commands and keeps `visible` in config.
- Scene (`stella/scene.js` `buildScene`) already takes `fold`, motion envelopes and idle params;
  `params.js` holds radii (blades rIn .53 / rOut .97, sticks rOut .78), speeds and colours.
  `P.minSize` (96 px) bounds the canvas size, so the compact look should come from posing/scaling
  inside the scene, not from shrinking below that canvas size (builder's call how).
- Motion sounds are mapped in `MOTION_CUES` (`stella/motions.js`), cues live in `voice.js` `CUES`, guarded
  by `tests/stella-sounds.test.js`. Ambient cues are skipped while she speaks.

## Design decisions

1. **Rest state replaces the fold for put-away.** `stow()` no longer folds her to a point: it sends her
   to the corner and eases `rest` 0→1. `stowed` keeps its meaning ("put away") for every existing
   caller. `unstow()` eases `rest` 1→0 and travels back to her saved anchor. Gaming/fullscreen still
   use the fold. If she is resting when a game starts, the fold applies on top as today.
2. **Corner spot:** bottom-left of her current display's work area (above the taskbar), with a margin
   so the bud and its glow sit clear of the edge. While resting she ignores wandering, drags, idle
   acts and gestures (except the stretch), as `tucked` does today.
3. **Timing:** going away about 1.5 s (travel eased, arc of a few tens of px, curl over the second
   half); coming back about 1.5 s (unfurl and stretch over the first half while travelling). Reduced
   motion: a short fade out at her spot and in at the corner (and back), no arc, no stretch.
4. **Compact size:** about 40 % of her awake size on screen, as in the sketch.
5. **Resting life:** breathing glow (~5.5 s period), globe spin and blade drift slowed to a crawl,
   drifting dots reduced and pulled in, stretch every ~9 s (slightly randomised so it is not mechanical).
   No idle acts, no wander, no cursor reactions while resting.
6. **Throttled drawing while resting:** a lower frame rate (target ~15–20 fps) once fully curled; full rate
   during the going/coming animations.
7. **Hit area while resting:** only the bud itself (small padding) is clickable; the overlay stays
   click-through elsewhere. A click (pointer down + up without a drag) brings her back. Dragging her
   while resting is not supported (she stays put).
8. **Talking from the corner:** the panel is no longer suspended when she is put away; it anchors above
   her compact body using the existing head/onMove path, kept on screen. Speech, blips and "Hey Stella"
   work as when awake. The wake word does not bring her out. Typed chat opening brings her out (today's
   behaviour, kept).
8b. **Resting but quiet (owner's decision).** Put away, she talks when *you* talk to her and still
   delivers what's addressed to you, but starts nothing on her own:
   - Kept as today (gated on `config.visible === false`): proactive conversation off, autonomy off,
     check-in voice calls ended, desktop highlight off, non-granted TTS off outside a voice session.
   - Still reaching you from the corner: replies to "Hey Stella" / voice sessions (spoken), reminders
     (spoken when they carry a voice grant, as today), finished-task / Codex messages (bubble; spoken
     only under the existing TTS rules).
   - Changed: putting her away no longer cuts off a line she is in the middle of saying
     (`main.js` ~856 and ~929-936 stop cancelling speech/TTS on stow); she finishes it, then rests.
8c. **Flows that move her (builder-check answer, my call).** Flows that need her body on screen keep
   bringing her out as today: walkthroughs, pointing / `guideFocus` / stella_point, the mission report,
   the demo, typed chat. Flourishes are skipped while she rests: the big-job glide to `stage` and the
   victory pose (`brain.js` ~282, celebrate), `agentActivity` / tool reaction motions, idle acts, wander.
   She only speaks from the corner.
8d. **Right-click on the bud (my call)** opens her menu (`host.openMenu()`), as the old chip did; the
   bud's hit area handles `contextmenu` as well as click.
9. **Permission while resting:** her ring warms to gold and breathing quickens slightly while mode is
   `alert`; back to normal when it clears.
10. **Sounds:** add `settle` and `wake` to `CUES`, synthesised in the starlight style, played by
    `stow()` / `unstow()` (not by `stowNow()`), and listed in docs/SOUNDS.md. Note the existing `wake`
    *motion* maps to the `listen` cue; the new `wake` cue is a different thing. The builder may rename
    the new cues if that collision is confusing (e.g. `rest` / `rise`), keeping them in docs and tests.
11. **Removed:** `src/renderer/js/chip.js`, `src/renderer/js/away-mask.js`, the `#chip` canvas in
    `index.html`, the chip/mask CSS, the dead doze-mask code (`onDoze`, `doze()`), `chipAt`, and the
    `Mask` class. Callers move to the rest state.

## Cleanup of old-character leftovers

Remove or rewrite in Stella's own terms every reference to the old character's world, in tracked files
outside `docs/superpowers/` history docs (those are records and may keep the name where
`tests/stella-name.test.js` already allows it). Known items:

- "biochip" in comments (`main.js`, `app.js`, `reminder-delivery.js`…) and in her lines (`lines.js`:
  "Biochip warm. I'm here." in every language).
- The satellite / "red light" uplink: tray item "Look at the satellite" (labels in 5 languages), the
  `satellite` command in `app.js`, `earnUplink`, and comments in `brain.js`. Rewrite as a Stella act
  (e.g. a star-gaze or a glow) or remove if it adds nothing; builder's call, keeping any user-facing
  feature that still works.
- `lines.js` header ("personality construct, dozens of minds"), gaze lines about the satellite.
- "Teleport" tray label and "Possess my windows" setting: check whether each still does anything in
  Stella. Dead settings/labels are removed (config default, settings schema, labels, codex/settings
  agent allow-lists, routines list); live ones are renamed in Stella terms.
- Comments mentioning a mane, impact frames or "the show" (e.g. `stella.css` line ~114, `chip.js`).
- Docs: `docs/ANIMATIONS.md`, `docs/ANIMATION-OVERHAUL-2.0.md`, `docs/START-HERE.md`,
  `docs/PERSONALITY-AND-CONTINUITY.md`, `docs/AGENT-PRESENCE.md`, README "What's next" (away mode
  shipped), and scripts `check-stella.js`, `smoke-electron.js`, `smoke-memory-language-live.js`,
  `check-conversation.js` where they reference the mask/chip/biochip/satellite.

A grep-based guard test (extend `tests/stella-name.test.js` or `tests/stella-sounds.test.js`) keeps
`biochip`, `satellite`, `away-mask` and similar terms from returning.

## Verification

- Unit tests for the rest state (stow/unstow transitions, stowNow, hit area, reduced motion, alert
  warmth flag, sounds in `CUES` and docs), all existing tests green.
- `npm run test:desktop` / `test:stella` updated from chip to rest state and passing.
- Live check in the real app: put away by each trigger, rest for a while, "Hey Stella" and a reminder
  while resting, permission while resting, click to come back, quit while away and relaunch.
  Desktop shortcut still launches the current build.

## Left to the builder

Exact curves, arc height, the scene math for curling (sweep of blades and sticks, how LEDs follow the
curve), the throttle mechanism, panel offset above the bud, and the synthesis details of the two sounds.
