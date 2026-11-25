# Stella — character, motion and behavior

Date: 2026-11-24
Status: draft for approval
Scope: project 1 of 3 in the Capri → Stella redesign (1. Stella herself, 2. UI restyle, 3. rename)

## Intent

Capri began as a desktop pet modeled on an anime character. It has become a personal AI assistant, and the owner wants it to be **their own AI**, not a fan character. The assistant becomes **Stella**: same personality, voice and abilities, with a new original look and calmer, assistant-like behavior.

This project replaces the character on screen: how Stella looks, how she moves, and how she shows what she is doing. The UI restyle and the full rename are separate projects that follow.

Success: Stella feels alive and smooth while idle, every function she performs has a recognisable motion, and she never gets in the way of the owner's work.

## Goals

- Render Stella as designed (reference: `docs/stella/stella-reference.html`, card **2 · In between**).
- Calm wandering around the outer part of the screen, never abrupt, never near the center.
- Varied ambient idle animations so she never looks frozen or repetitive.
- A distinct motion for every function, including walkthroughs, where she travels toward what she explains.
- Keep two old functions, restyled: fold away for games and fullscreen apps, and drag-to-move.
- Smooth (60 fps) and light on the PC.

## Non-goals (this project)

- Restyling chat panels, control room, guide overlay or highlight marker (project 2). The panel portrait stays Capri's until then.
- Renaming code, files, persona text, icons, shortcut or GitHub repo (project 3). Code added here uses the name Stella; existing Capri names are left alone.
- Changing her voice, personality, memory or any ability.
- Deleting the old Capri sprite renderer and art (project 3 removes them; this project only stops using them).

## Anti-goals (failure even if it works)

- Anything that copies Roamies/Jarvis code, schemas or assets (AGPL-3.0; this repo is MIT). Ideas only.
- Pet behaviors returning: teleporting around, sitting on windows/floor, possessing windows, waving/stretching/yawning, surprise flips, falling with gravity.
- Sudden moves, snapping between states, or a busy look. Every change blends.
- Stella drifting into the middle of the screen or over what the owner is working on.
- Noticeable CPU/GPU load while idle.

## Constraints

- Windows, Electron. Stella lives in the existing full-work-area transparent overlay (`src/main/main.js` `createOverlay`), which is click-through except where hit-testing enables it (`main.js` ~1215).
- Existing systems to reuse rather than rebuild: fullscreen/gaming detection (`src/main/fullscreen.js`, `exclusive-fullscreen.js`, `renderer/js/fullscreen-presence.js`), voice level from the speech analyser (`renderer/js/speech-aura.js`), tool/action events (`renderer/js/acting.js` `actionForTool`, `capri.js` `reactToTool`/`reactToAction`/`pointAt`, `brain.js`), companion mood state (`renderer/js/companion.js`), reduced-motion handling, `scale` and `wander` config (`src/main/config.js`).
- Must respect Windows reduced motion.
- Existing tests (`npm test`) and isolated Electron check scripts (`scripts/check-*.js`) must keep passing or be updated for the new character.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Port the mockup's Canvas 2D code as is | Fastest, but the LED effect reads pixels back from the canvas every frame on the CPU; wasteful for an always-on overlay and can stutter under load. |
| B | Rebuild everything as WebGL shaders | Smoothest and lightest, but every look tweak becomes slow to try, and the look will keep being tuned. |
| **C** | **Hybrid (chosen)** | Shapes drawn with Canvas 2D into an offscreen canvas; LED conversion, glow and holo sheen done in a WebGL shader; the globe drawn in WebGL. Smooth and light, still easy to tweak, reuses the existing WebGL setup. Slightly more setup than A. |

The owner chose **C**.

For behavior, a new lean controller is written for Stella instead of trimming `capri.js` (~1,900 lines of sprite poses, sitting, teleporting and pet logic). Useful pieces are reused through their existing modules.

## Visual design

Source of truth for proportions, colors and motion: `docs/stella/stella-reference.html` (card 2). Summary:

- **Globe (center):** ~340 points spread evenly on a sphere, see-through, spinning slowly around a tilted axis. Front points brighter and larger, back points dim. A soft blue-white inner light that swells with her voice. Drawn smooth (not LED).
- **Ring:** thin ring just outside the globe. Moonlight gold blending into rose and lavender (conic gradient, slowly turning), with a soft glow.
- **Blades:** 4 purple straight wedges at the diagonals, thick near her and pointed at the tips.
- **Sticks:** 4 smaller indigo wedges between the blades, same shape, shorter and slimmer, trailing the blades slightly when they turn.
- **Dot clusters:** blue dots drifting and twinkling in the gaps between blades.
- **Finish:** everything except the globe is converted into fine round LEDs sitting in a soft glow (blurred copy underneath, faint unlit LEDs behind). Over the blades and sticks: a cyan-to-pink sheen sliding outward, each point timed differently, a faint flicker and crisp lavender edges.
- **Palette:** midnight purple and blue; warm colors only in the ring and the sheen.

Size: the existing `scale` setting maps to her diameter. Default ≈ 150 px on screen (builder's call to tune). The LED cell size and dot minimums scale with her so she stays readable at small sizes (the mockup's 96 px preview is the lower bound).

## Rendering architecture

- A Stella canvas sized to her bounding box (plus glow margin), positioned inside the overlay. Never a full-screen canvas.
- **Body pass (Canvas 2D, offscreen):** blades, sticks, dot clusters, ring, at device resolution.
- **Finish pass (WebGL):** samples the body texture into an LED grid with a few brightness levels, adds the blurred glow and the faint unlit LED backdrop, then the holo sheen/flicker/edges for blades and sticks.
- **Globe pass (WebGL):** point sprites with depth shading and the inner light, drawn on top.
- One animation loop at display cadence. Rendering pauses when Stella is hidden, folded away, or the overlay is not visible.
- Parameters (counts, widths, colors, speeds) live in one tunable module so look tweaks stay quick.

## States

Blended continuously (no snapping); each state is a target the visuals ease toward.

| State | Look |
|---|---|
| Idle | Slow spin, gentle breathing, idle variations (below). |
| Listening | Blades, sticks and dots draw in slightly; ring and inner light brighten. |
| Thinking | Spin speeds up; a bright spark chases around the ring. |
| Speaking | Globe ripples and inner light swells with the real voice level; blades push out and dots scatter on loud syllables. |

## Idle variations

While idle, one variation runs at a time for 10–30 s, chosen randomly without repeating the last one, blending in and out:

1. **Speed shift:** blade and stick spin slowly speeds up or slows down, then settles.
2. **Counter-turn:** blades and sticks turn in opposite directions for a while.
3. **Sway:** points rock back and forth instead of spinning all the way round.
4. **Breath pulse:** an occasional larger expand-and-relax.
5. **Shine wave:** the holo sheen runs around all eight points in sequence.
6. **Dot drift:** dot clusters swirl around her, then return to their gaps.
7. **Globe tilt:** the globe's spin axis tips, then rights itself.

Pauses between variations: 8–25 s of plain idle. The companion mood state (energy) may bias choice and intensity (calmer at night, livelier after interaction). The `idleAnimations` setting turns variations off; reduced motion turns them off.

## Wandering

- **Zone:** a band around the outer part of the current display's work area. The central rectangle covering 50% of width and 50% of height is off-limits. Stella stays fully inside the work area.
- **Movement:** curved paths (gentle arcs, not straight lines) with ease-in/ease-out, slow speed (≈ 20–40 px/s, builder to tune). No jumps.
- **Rhythm:** travel to a new point, rest 30 s – 3 min, repeat. While resting she floats gently (a few px of bob) so she never fully stops.
- **Pauses:** no wandering while chat is open, while she is listening, thinking, speaking or working, or while a walkthrough is active. She resumes after a short grace period.
- **Display:** she lives on one display, the one chosen by the existing `displayId` setting (today's single overlay). She cannot be dragged to another display. If a walkthrough target is on another display, she goes to the edge of her display nearest it and aims a blade toward it. *(Builder's call: multi-display travel would need new overlay work and wasn't asked for.)*
- **Position memory:** her anchor (last spot she was dropped or settled) is saved to config and restored at startup. First run: the lower-right part of the wander band. After a walkthrough, point or reminder she glides back to her anchor area. With `wander` off she stays at her anchor and returns to it exactly. *(Builder's call.)*
- **Setting:** the existing `wander` setting now means "calm wandering" (it used to mean random teleports). Off = she stays where she is placed.

## Functions → motions

Each motion is a short overlay on top of the current state, blending in and out. Rapid tool bursts are rate-limited like today (cooldown so she doesn't flicker between motions).

| Function | Motion |
|---|---|
| Open app / site / workspace / media | Blades flare outward, a ring of light pulses out. |
| Close app | Blades fold in briefly, then return. |
| Web / news search, Steam deals, YouTube lookup | One stick lights up and sweeps around her like a radar. |
| Read screen, files, context | A scan line passes down through the globe. |
| Type / click / desktop steps | Quick ticks of light run along the sticks. |
| Point / highlight | She glides toward the target and aims her nearest blade at it. |
| Walkthrough / visual guide | Same as point, held for each step; she moves alongside each step's target, never covering it or its highlight, then returns to her wander zone when the guide ends. |
| Draw on screen | A trail of LED dots runs from her toward the drawing. |
| Reminder due | Ring pulses brightly three times; she drifts a little toward the screen center (staying outside the forbidden zone). |
| Memory save / recall | Dots swirl into the globe (save) or out of it (recall). |
| Approval needed | Ring glows steadily; she comes slightly closer and stays until answered. |
| Error / alert | Short flicker and small shake. |
| Task done | One full spin and a small burst of light. |
| Music playing | Blades pulse gently while playback is active. |
| Wake word heard | Quick brighten and turn toward listening. |
| Routines, evening report, proactive message | Reuse the closest motion above (builder maps; e.g. proactive message = soft pulse + approach). |

**Where she may go during functions** *(builder's call)*: the center zone only limits wandering. Point and walkthrough may bring her anywhere on her display, because the owner asked that she move to what she explains; she sits beside the target, never over it or its highlight. Approval and reminder approaches stay outside the center zone.

**Music** *(builder's call)*: the pulse only follows music Stella started herself, for as long as the existing post-launch media check reports it playing (or a short fixed time if it can't tell). No new always-on media watcher.

**The `capri_body` tool** *(builder's call)*: kept, so the model keeps the ability. Actions map to Stella: `come` → glide toward the cursor (stops at the edge of the center zone), `nap` → rest mode (dimmed, slow spin, no wandering) until `wake` or interaction, `wake` → brighten and resume, `mood` → unchanged reply plus a soft pulse, `wave` → friendly double pulse, `dance` → spin burst, `stretch` → breath pulse, `sit`/`stand` → short in-character reply that she doesn't sit anymore, no motion. Renaming the tool id is project 3.

The mapping replaces `actionForTool`'s pose names with Stella motion names; every tool id in `src/main/codex-tools.js` must map to some motion (fallback: thinking).

## Kept functions, restyled

- **Games and fullscreen:** instead of teleporting, she folds in — points retract into the ring, the ring collapses into a point of light that fades. Returning reverses it. Keeps today's timing guarantees (fast transition, revision checks, hide fallback) by reusing the existing fullscreen/gaming pipeline and only replacing the visual.
- **Drag:** press and move to drag her; she follows the pointer with a slight lag and her points lean with the motion. On release she settles where dropped (no gravity, no falling, no ledges). A click without dragging keeps today's behavior. Her new spot becomes her wander anchor until the next move.

## Removed behaviors

Stop using (code removal belongs to project 3): random wander teleports, desktop/floor sitting and sit commands, window perching and window tracking, window possession (`possess`), pet gestures (wave, stretch, yawn, dance, preen, bounce), rare surprises, daily-routine gestures, cursor greetings, gravity drag/fall/land, cinematic cut-ins and the sprite/rig renderer.

Settings that controlled removed behaviors (`windowTracking`, `possess`, `surpriseAnimations`, `dailyRoutine`, `cursorInteractions`) stop having an effect; hiding them in the control room happens in project 2. Chat commands for removed gestures (sit, wave, dance…) get a short in-character reply instead of an animation (builder's call on wording, using existing local-command routing).

## Reduced motion

No wandering travel (she stays put), spin and sheen nearly still, no flicker or shake, no idle variations. States still read through brightness and the ring. Fold-away becomes a short fade.

## Testing

- Unit: wander target selection never lands in the forbidden center or outside the work area; path easing has no discontinuities; idle scheduler never repeats and respects durations/gates; every tool id maps to a motion; state blending is continuous.
- Isolated Electron renderer check (like `scripts/check-animations.js`): renders each state and motion, saves a gallery image, checks the canvas isn't blank, checks hit-testing, drag and fold-away.
- Performance check: idle frame cost and CPU usage stay within a budget the builder sets and records (target: no visible impact on a normal PC).
- Existing `npm test`, settings smoke and fullscreen smoke updated where they assumed the sprite character.

## Left to the builder

- Exact sizes, speeds, counts and timing values (start from the reference mockup).
- Shader structure and how the body texture is shared with WebGL.
- Wander path shape details and the rest/travel timing curve.
- Motion choices for minor functions marked "builder maps".

## Branch

Work happens on `feature/stella-character`, created from `development` after the visual guides, walkthroughs and reminders work (PR #9) was merged into it. All tools in the motion table (walkthrough, draw, reminder) exist on this base.
