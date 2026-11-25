# Stella Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Remove dead Capri code/art and rename everything Capri → Stella without losing her memory.
**Architecture:** Two passes on `feature/stella-rename`: delete dead code first, then mechanical rename + one data-migration function.
**Tech Stack:** Electron, Node test runner, PowerShell.
**Spec:** docs/superpowers/specs/2026-11-25-stella-rename-design.md

## Global Constraints
- Old versions stay in git history; no history rewrite.
- Intro animation + away mode keep working with their current art (moved to `assets/stella-legacy/`).
- userData `%APPDATA%\CapriGPT` → `%APPDATA%\Stella`; old folder kept as backup.
- Repo → `AnalogicGoose/Stella`.

## Review Focus
- First start with both folders existing / Stella folder already populated → never overwrite Stella data.
- Copy fails half-way → do not switch to an empty profile silently; fall back to old folder.
- Smoke-test profile (`STELLA_TEST_PROFILE`) must never migrate real data.
- Old Codex hook entry left in `~/.codex/hooks.json` pointing to a deleted file.
- Desktop shortcut pointing at the old folder after the folder rename.

---

### Task 1: Remove dead Capri code and art
**Files:** delete `src/renderer/js/capri.js`, `sprite.js`, `acting.js`, `sprite-clips.js` (if unused after), unused `assets/capri/*`, check scripts that only load `capri.js` (`check-animations.js`, `check-cel-animations.js`, `check-portraits.js`, `check-speech-aura.js` if so) + their package.json scripts; trim close-up/cut-in parts of `fx.js` not used by intro/away mode.
- [ ] Trace imports; list what intro/away mode load; delete the rest
- [ ] `npm test` + `npm run test:stella` pass; app launches
- [ ] Commit `chore: remove dead Capri character code and art`

### Task 2: Data folder migration
**Files:** Create `src/main/profile-migration.js`; Test `tests/profile-migration.test.js`; Modify `src/main/main.js:429-433`.
**Produces:** `migrateProfile(oldDir: string, newDir: string): {migrated: boolean, dir: string}` — copies when newDir missing/empty and oldDir exists; on copy error removes partial newDir and returns `{migrated:false, dir: oldDir}`.
- [ ] Tests: copies files+subfolders; skips when newDir has data; returns oldDir on failure; no-op when oldDir missing
- [ ] Implement with `fs.cpSync(..., {recursive:true})` into a temp dir then rename
- [ ] main.js: userData = result.dir (skip under test profile)
- [ ] Commit `feat: move saved data from CapriGPT to Stella`

### Task 3: Rename everything in the tree
- [ ] `git mv` files/folders (capri.css→stella.css, hooks, Start-Capri.cmd, remaining assets/capri→assets/stella-legacy, drop icons/capri.*)
- [ ] Replace names: `capri://`→`stella://`, `CAPRIGPT_`/`CAPRI_`→`STELLA_`, `.caprigpt-local`→`.stella-local`, `caprigpt`→`stella`, `Capri`→`Stella`, `capri`→`stella`; package.json name/appId/productName/description/repository
- [ ] User-facing docs updated; old specs/plans left as records
- [ ] Move local `.caprigpt-local` → `.stella-local`
- [ ] `git grep -i capri` → only records; all tests + test:stella pass; launch
- [ ] Commit `refactor: rename Capri to Stella`

### Task 4: Outside the repo
- [ ] `codex:uninstall` (old) then `codex:install` + `codex:check`
- [ ] Rename GitHub repo, update remote
- [ ] Rename folder `ChatGPT\Capri`→`ChatGPT\Stella`, rebuild `Desktop\Stella.lnk`, launch from shortcut, memory present
