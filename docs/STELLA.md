# Stella

Stella is the on-screen character of the assistant. She replaced the old sprite character
(the retired Stella renderer, see [ANIMATIONS.md](../ANIMATIONS.md)). Her code lives in
`src/renderer/js/stella/`; `src/renderer/js/app.js` creates her on `#stella` / `#stella-canvas`.
Voice, personality, memory and abilities are unchanged. The design is in
[the spec](superpowers/specs/2026-11-24-stella-character-design.md); the visual reference is
[docs/stella/stella-reference.html](stella/stella-reference.html) (card 2).

## What she looks like

- **Globe:** about 340 see-through points on a slowly spinning, tilted sphere. Front points are brighter and larger, back points dim. A soft blue-white inner light swells with her voice.
- **Ring:** a thin ring around the globe, moonlight gold blending into rose and lavender, slowly turning, with a soft glow.
- **Blades:** four purple wedges at the diagonals, thick near her and pointed at the tips.
- **Sticks:** four shorter, slimmer indigo wedges between the blades that trail them slightly.
- **Dots:** blue dots that drift and twinkle in the gaps between the blades.
- **Finish:** everything except the globe becomes fine round LEDs in a soft glow, with a cyan-to-pink sheen sliding outward over blades and sticks.

Rendering is a hybrid: shapes on an offscreen Canvas 2D, then a WebGL finish pass (LEDs, glow, sheen) and a WebGL globe pass. Her canvas is only as big as her (never full screen), and drawing pauses while she is hidden or folded away.

## States

Each state is a target the look eases toward; nothing snaps.

| State | Look |
|---|---|
| Idle | Slow spin, gentle breathing, idle variations. |
| Listening | Blades, sticks and dots draw in slightly; ring and inner light brighten. |
| Thinking | Spin speeds up; a bright spark chases around the ring. |
| Speaking | Globe ripples and inner light swells with the real voice level; blades push out and dots scatter on loud syllables. |

## Idle variations

While idle, one variation runs at a time for 10-30 s (never the same one twice in a row), with 8-25 s of plain idle between them:
speed shift, counter-turn, sway, breath pulse, shine wave, dot drift, globe tilt. Companion mood can bias which one and how strong. The `idleAnimations` setting and reduced motion both turn them off.

## Wandering

- She stays in the outer band of her display's work area, fully inside it. The central 50% x 50% rectangle is off-limits to wandering.
- She moves on gentle curved paths with ease-in/ease-out, never jumping, and never crosses the center zone while wandering. Wandering is calm (about 30-40 px/s); a function's move (pointing, a walkthrough step, come, a reminder or approval nudge, going back home) is quick: about 500 px/s, 0.6-2.5 s whatever the distance. A finished task doesn't move her.
- Rhythm: travel to a new spot, rest 30 s to 3 min (floating a few px so she never fully stops), repeat.
- No wandering while chat is open or she is listening, thinking, speaking or working, or during a walkthrough. She resumes after a short grace period.
- She lives on one display (`displayId`). If a walkthrough target is on another display she goes to the nearest edge and aims a blade at it.
- Her anchor is where she was last dropped or where her last wander hop ended. Only a drop saves it (as `stellaAnchor`, restored at startup); first run is the lower-right of the band. After a walkthrough, point or reminder she glides back to it. With `wander` off she stays at her anchor.
- Reduced motion: no travel (she is placed with a short fade), spin and sheen nearly still, no variations.
- Drag: press and move; she follows with a slight lag and leans, and settles where dropped (no gravity). A plain click keeps its old behavior.

## Folding away

Put away (Ctrl+Alt+C), a game, or a fullscreen app on her display: her points retract into the ring, the ring collapses to a point of light and fades. Returning reverses it. Timing guarantees come from the existing fullscreen/Gaming pipeline (a game never waits more than about 1.1 s for her to fold). Reduced motion makes this a short fade.

## Function to motion

| Function | Motion |
|---|---|
| Open app / site / workspace / media | Blades flare outward, a ring of light pulses out |
| Close app | Blades fold in briefly, then return |
| Web / news search, Steam deals, YouTube lookup | One stick lights up and sweeps around like a radar |
| Read screen, files, context | A scan line passes down through the globe |
| Type / click / desktop steps | Quick ticks of light run along the sticks |
| Point / highlight (`stella_point`) | She glides beside the outlined control and aims her nearest blade at it until the outline goes (8 s, or the window moves), then heads back. A screenshot highlight (`stella_point_on_snapshot`) only scans |
| Walkthrough / visual guide | Point, held for each step; she sits beside the target, never over it or its highlight, then returns to her band |
| Draw on screen | A short stream of LED dots runs from her toward what was drawn (toward the middle of her display until the drawing is placed, or toward the edge of another display); she stays where she is |
| Reminder due | Ring pulses brightly three times; she drifts a little toward the center (outside the forbidden zone) |
| Memory save / recall | Dots swirl into the globe (save) or out of it (recall) |
| Approval needed | Ring glows steadily; she comes slightly closer and stays until answered |
| Error / alert | Short flicker and small shake |
| Task done | One full spin and a small burst of light |
| Music playing | Blades pulse gently for 45 s after she starts music or a video (a fixed time; it doesn't follow the actual playback) |
| Wake word heard | Quick brighten and turn toward listening |

`stella_body` actions (the reply comes as soon as she starts; nothing waits for her to arrive): `come` glides toward the cursor (stops at the center zone's edge), `nap` rests (dimmed, no wandering) until `wake`, `mood` and `wave` give soft pulses, `dance` a spin burst, `stretch` a breath pulse, `sit`/`stand` a short reply that she no longer sits. Put away, in a game or folded, she does nothing and says she's tucked away. With no working renderer (none, or its context lost for more than a second) she can't be clicked or dragged, so there's no invisible target on screen.

Removed pet behaviors (teleporting, sitting, window perching and possession, gestures, falling, cut-ins) are not coming back; the settings that controlled them have no effect.

## Tuning

Look constants (counts, widths, colors, speeds, LED size, sheen) are in `src/renderer/js/stella/params.js`; the object is frozen, so edit the file and reload. Her on-screen size is `sizeFromScale` times the `scale` setting (minimum `minSize`). Behavior timings live next to the code they drive: `idle.js` (variation gaps and durations), `wander.js` / `travel.js` (speed, hop length, bob), `fold.js` (fold duration).

## Checks

- `npm test` runs the unit tests (including `tests/stella-*.test.js`).
- `npm run test:stella` runs `scripts/check-stella.js`: an isolated hidden-window check of the painter, renderer, performance, context loss and the real overlay page with a stub host. Output and a pose gallery go to `.stella-local/stella-check`.
- `npm run test:settings`, `npm run test:layout` and `node_modules/electron/dist/electron.exe scripts/smoke-electron.js --fullscreen-only` are isolated end-to-end checks (own test profile) that exercise her in the real overlay.

## UI (project 2: Orbit)

Every screen around her shares `src/renderer/styles/stella-theme.css`: midnight surfaces, a gold → rose → blue
hairline, round icon buttons (30 / 34 / 46 px, icons centered by grid) and a warm gold primary button.

- **Chat panel:** no portrait; header is her name, a status dot and ✕. Replies go through `js/rich-text.js`
  (bold, italic, `code`, bullet lists, https links; built with DOM nodes, never HTML). Streaming text hides
  half-typed markers; speech gets the same text without markers.
- **Links:** `host.openLink` → `link:open` (main, `link-open.js`) → `publicUrl()` check → preferred browser.
  The overlay window itself never navigates.
- **Control room:** see `CONTROL-ROOM.md`.
- **Name:** `DISPLAY_NAME` is Stella; "Hey Stella" wakes her. "Stella" still works quietly as an alias
  (`NAME_ALIASES`, wake phrase) until the rename project.
