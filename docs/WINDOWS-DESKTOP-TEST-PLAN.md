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
- Native-resolution capture was reasoned from the Electron API and verified only by unit tests plus the OCR helper; run Capri on the desktop to confirm.

## Running the real-OCR test
`$env:CAPRI_REAL_OCR='1'; npm test` (PowerShell). It is skipped by default: the first CI run of it failed on the GitHub runner (log not available to diagnose), so it is opt-in until it can be made deterministic there.
