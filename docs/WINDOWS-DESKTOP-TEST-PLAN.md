# Windows accessibility, OCR and highlight: test plan

Status legend: **U** = automated unit test (mocked), **W** = real Windows run (helper scripts against a live desktop), **M** = manual, not yet done.

| Area | What to verify | Level | Status (2026-11-23) |
|---|---|---|---|
| UI Automation | `windows-accessibility.ps1` lists controls of a real window; query filter; wrong pid; invalid HWND | W | Done on Windows Calculator: 40 controls in ~0.9 s, query ~0.45 s, errors are friendly |
| UIA actions | `invoke` / `set-value` on a real control, with confirmation dialog | M | Not run (needs user to approve a real action) |
| UIA privacy | Password controls never exposed | M | Not verified: a PowerShell WinForms fixture exposed only generic Panes, so this still needs a real Edit/password field |
| UIA stability | Window closes or changes mid-inspect; 400-node cap (`limited`) on large trees | U / M | Mock-covered; cap not stress-tested |
| OCR accuracy | Exact word and phrase match, case-insensitive, punctuation, 8/12/20 pt | W + U | Done on generated bitmaps; 8 pt and `Cancel:` failed before this change |
| OCR accuracy | Real app screenshots, dark themes, non-English languages, HiDPI | M | Not run |
| Highlight alignment | DIP/native conversion, multi-monitor and negative origins, edge clamping | U | `markerLayout` tests pass |
| Highlight alignment | Overlay lines up with a real control at 100%, 150% and 200% scaling, on 2 monitors | M | Not run (needs interactive desktop) |
| Error handling | Timeout (6.5 s), abort, paused awareness, foreground change, stale observation | U | Pass |
| Performance | Helper start-up ~0.4 s per call (new PowerShell each time); OCR ~0.4 s for a 600x120 image | W | Measured; full-screen 4K OCR not measured |

## Defects confirmed and fixed (branch `fix/windows-accessibility-verification`)
1. OCR never matched a word followed by punctuation (`Cancel:`). Punctuation at word edges is now ignored when comparing.
2. OCR missed small text (8 pt). The helper now retries once at 2x scale and maps bounds back.
3. OCR screenshots were downscaled to 1600x1000, which blurs text on 1080p/4K displays. The OCR capture now requests native resolution (capped at 8192 px).
4. An invalid or closed window handle leaked a raw .NET message; it now reports "The observed window closed or changed."

## Not changed / open
- The password-control exclusion and real invoke/set-value paths still need a manual pass.
- `npm run test:desktop` (Electron smoke) was not run.
- Native-resolution capture was reasoned from the Electron API and verified only by unit tests plus the OCR helper; run Stella on the desktop to confirm.

## Running the real-OCR test
`$env:STELLA_REAL_OCR='1'; npm test` (PowerShell). It is skipped by default: the first CI run of it failed on the GitHub runner (log not available to diagnose), so it is opt-in until it can be made deterministic there.

## Real-desktop check (`npm run test:windows-desktop`)
Opens a fixture window on every display and exercises the real overlay, real screen capture and real Windows OCR. It needs an interactive Windows session and is not part of CI.

Verified 2026-11-23 on a 1920x1080 @1x primary and a 1440x900 @2x secondary at a negative origin:
- The highlight surrounds the target within its 3 DIP frame + 2 DIP shadow on both displays (no scaling or monitor-origin drift). Shown in ~59 ms.
- OCR on the native-resolution capture finds 11 px text on both displays and maps it inside the text's real bounds. The old 1600x1000 capture missed the same text on the 1080p display. Capture ~0.4 s + OCR ~0.4 s per lookup.

Still manual: real invoke/set-value actions (need the confirmation dialog), password-field exclusion on a real password box, 150% scaling, and `npm run test:desktop`, whose Codex-status assertion at `scripts/smoke-electron.js:1569` fails the same way on the pre-#5 commit `2f248d8` (pre-existing, unrelated to accessibility or OCR).

## Visual guides and walkthroughs (branch `feature/visual-guides-reminders`)
Automated: guide schema, scene layout, target resolution, the walkthrough state machine, commands-only phrases, body reactions (visible overlay only, never in fullscreen) and the exclusive-fullscreen refusal are unit tests (**U**, `npm test`). Everything below needs an interactive desktop.

| Area | What to verify | Level | Status (2026-11-23) |
|---|---|---|---|
| Walkthrough, Windows Settings | "How do I change my refresh rate?": Settings → Display → Advanced display → refresh rate, one ring and card per step, Next/Back/Repeat/Stop by voice and on the card, the done line at the end, her body comes over on each step | M | Not run |
| Explanation, browser | Ask her to explain a browser settings page (e.g. Chrome or Firefox privacy settings): marks land on the named controls, the drawing clears on a new request or when the page changes | M | Not run |
| Borderless game, Gaming mode | Gaming mode on, a borderless-windowed game in front, "Hey Stella, show me how to change the graphics quality": the guide layer appears over the game menu, her body and panel stay hidden, commands-only listening works, the layer closes at the end and fullscreen hiding resumes | M | Not run |
| Exclusive fullscreen game | A game in exclusive fullscreen: asking for a guide draws nothing; she says once that it needs borderless window mode (not again until the game leaves fullscreen) and helps by voice. Detection reads the shell's Direct3D exclusive-mode state (`SHQueryUserNotificationState` = 3); note which games are missed (OpenGL/Vulkan exclusive, fullscreen-optimized D3D) | M | Not run |
| Two monitors, mixed scaling | Monitors at 100% and 150%: a walkthrough on each display, and an app dragged across mid-step; rings sit on their controls and the card stays beside the window | M | Not run |
| Capture privacy | Print Screen (and Snipping Tool) while a ring and card are shown: the guide marks do not appear in the capture (content protection) | M | Not run |
