# Stella rename (redesign project 3) — short design

**Why:** Stella is the owner's own AI. Every trace of Capri (the Edgerunners character) leaves the current code. Old versions stay in git history on purpose, so the owner can go back.

**Goals**
- No dead Capri code or art in the current tree.
- No "Capri"/"CapriGPT" names in files, code, scheme, env vars, data folder, app folder, shortcut, or repo.
- Her memory, reminders, settings and goals survive.

**Non-goals (later, after token recharge):** redesigning the intro animation and away mode. Their art stays for now (moved/renamed, not redrawn). No history rewrite. Voice unchanged.

**Anti-goals:** she forgets anything; the app or shortcut stops launching; Codex connection silently breaks.

## Approaches
- **A · Clean up first, then rename (chosen).** Two passes on `feature/stella-rename`; failures are attributable to one pass; no renaming of files about to be deleted.
- B · One sweep — faster to write, one huge diff, hard to tell what broke.
- Keeping internal names (e.g. `capri://`) — rejected: owner wants no trace.

## Design
**Pass 1 — remove dead Capri:** delete `src/renderer/js/capri.js`, `sprite.js`, `acting.js`, `sprite-clips.js` if only they use it, old-character art in `assets/capri/` not used by intro/away mode, the close-up/cut-in parts of `fx.js`, and check scripts/tests that only test those. Keep whatever the intro and away mode still load. Run `npm test` + `test:stella` + launch.

**Pass 2 — rename:**
- Files/folders: `capri.css`→`stella.css`, hooks → `stella-hook.js` / `stella-codex-hook.js`, `Start-Capri.cmd`→`Start-Stella.cmd`, remaining `assets/capri/` (intro/away art) → `assets/stella-legacy/`, `assets/icons/capri.*` removed (stella icons exist), `.caprigpt-local/`→`.stella-local/` (move the local folder too, it holds the voice runtime).
- Code: identifiers, CSS classes (`capri__*`), `data-caprigpt-*`, `capri://`→`stella://`, `CAPRI_*`/`CAPRIGPT_*`→`STELLA_*`, `app.setName('Stella')`, package `name: stella`, `appId: stella.desktop`, `productName: Stella`, docs/README text.
- Data: userData → `%APPDATA%\Stella`. On startup, if `Stella` has no data and `CapriGPT` exists, copy everything across, verify, then leave `CapriGPT` in place as a backup (owner can delete later). Covered by a test.
- Codex: uninstall old hook, reinstall new one (`codex:install`), check with `codex:check`.
- Last: rename app folder `ChatGPT\Capri` → `ChatGPT\Stella`, rebuild `Desktop\Stella.lnk`, rename GitHub repo to `AnalogicGoose/Stella` and update the git remote + `repository` field.
- Done when `git grep -i capri` only hits intentional mentions (this spec, history notes in old plans/specs may stay as records) and tests + live launch pass with memory intact.

**Left to the builder:** exact handling of older docs that mention Capri (records may stay; user-facing docs get updated).
