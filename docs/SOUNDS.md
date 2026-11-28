# Stella's sounds

All of Stella's sound effects are synthesized live in `src/renderer/js/voice.js`; no audio files ship
with the app. The palette is **starlight**: glassy FM bells, tiny stardust pings and a little air, all in
D lydian and sent through a soft echo so each sound leaves a faint trail, like her LEDs. There are no
saw or square waves and no crackle.

Hear them all in the sound lab: run `python -m http.server 8765` in the repo root and open
<http://localhost:8765/tools/sound-lab.html>.

| Cue | When it plays |
| --- | --- |
| `hello` | She greets you |
| `blip` | Text appears while she isn't speaking aloud |
| `tick` | A small step of work |
| `done` | A task finished |
| `alert` | Something needs you |
| `error` | Something failed |
| `teleport-out` / `teleport-in` | She leaves for a fullscreen app or game / comes back |
| `listen` | "Hey Stella" was heard |
| `grab` / `drop` | You pick her up / set her down |
| `chime` | A reminder is due |
| `celebrate` | A victory |
| `flare` | She opens an app, page or media for you |
| `remember` / `recall` | She saves to / looks up her memory, projects or routines |
| `approval` | She asks for permission |
| `wave` | She waves |
| `dance` | She spins or dances |
| `curl-up` | You put her away: she curls up in the corner |
| `unfurl` | She comes back out of her corner |

Motion sounds (`listen` and everything from `chime` down) are mapped in `MOTION_CUES`
(`src/renderer/js/stella/motions.js`). They stay quiet while she is speaking aloud, and her frequent
working motions (scanning, typing, searching) make no sound so long tasks never become a stream of pings.

## Your own sounds

Drop a file named after a cue (`hello.mp3`, `chime.wav`, `listen.ogg`...) into the custom sounds folder
(control room → Sound & voice → custom sounds folder) and it replaces the synth for that cue.
