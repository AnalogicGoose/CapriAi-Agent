# Stella UI redesign — design

Date: 2026-11-25
Scope: project 2 of 3 in the Capri → Stella redesign (1. Stella herself — built on `feature/stella-character`, 2. **UI restyle**, 3. rename code/files/repo).
Mockups (approved): `.superpowers/brainstorm/1307-1795634298/content/style-direction.html` (style **C · Orbit**) and `control-room-layout-v2.html` (layout **A · One page, folding sections**).

## Intent

Stella replaced Capri's anime body, but everything around her still looks like Capri: neon-green cut-corner plates, a Capri portrait, Edgerunners wording. The owner wants the UI to feel like Stella (midnight purple/blue, soft glowing lines, small warm accents) and wants the control room minimal: most visits are for **Quit** and **Gaming mode**, sometimes **Size**. The rest of the settings are fine to keep, as long as they're compact and out of the way.

## Goals

1. **Orbit style** across every overlay and the control room: round shapes echoing her ring, a gold → rose → lavender → blue hairline border, midnight glass fills, warm gold primary button, circular icon buttons.
2. **Chat / voice picker**: keep the two-button idea (text chat, voice), restyled as Orbit round buttons under a pill-shaped greeting bubble.
3. **Chat panel**: no portrait. Slim header (name · status dot · ✕). Messages render basic formatting: **bold**, *italic*, `inline code`, simple bullet lists, and links (`[text](url)` and bare `http(s)://` URLs) in blue that open in the owner's preferred browser.
4. **Control room**: one small window with quick tiles on top and folding one-line sections below (layout A). All settings that still do something are kept; no explanation paragraphs.
5. **Wording**: remove Edgerunners/Capri-persona copy (“choom”, “digital ghost”, “biochip”, “Your space / your rules”…) from every screen touched.
6. **Name and wake word become Stella now** (owner's decision, 2026-11-25): everything the user sees or hears her called says Stella, and “Hey Stella” wakes her.
7. **Centering**: every icon button is visually centered (the owner flagged this in the mockups).

## Non-goals

- Renaming code identifiers, files, folders, CSS class prefixes (`capri__…`), config/storage paths, the repo, the desktop shortcut, or the tray/app icon (project 3). Only user-visible name text and the wake phrase change here.
- Changing Stella's character rendering or behavior (project 1).
- Changing what any setting does, what the main process accepts (`settings-policy.js`), or adding new settings.
- Full Markdown (tables, headings, images, nested lists, HTML).

## Anti-goals (failure even if it works)

- Icons that look off-center, inconsistent button sizes, or shapes that mix Orbit with the old cut corners.
- A control room that is as long and wordy as today, just recolored.
- Links that navigate inside Stella's overlay window, open non-web schemes (`file:`, `javascript:`, custom protocols), or bypass the preferred-browser path.
- Formatting implemented with `innerHTML` on model text (injection risk).
- Losing a working setting or the gaming-mode / put-away resume path while paused.

## Constraints

- Electron, no build step, ES modules, strict CSP (`script-src 'self'`, `style-src 'self'`): no inline scripts, no CDN, no framework.
- Settings window is sandboxed with a restricted preload; it may only `patch` allowed keys and call named actions. Keep using `host.patch` / `host.action` / `host.state` / `host.onUpdate` and the existing `SettingsQueue`.
- Fonts (decided, matches the approved mockups): system `"Segoe UI Variable", "Segoe UI", system-ui` for all text; bundled JetBrains Mono only for `inline code`. Chakra Petch (old Edgerunners look) is no longer used on the screens in this project. No web fonts.
- Must look right at 100% and 150% Windows scaling, on light and dark wallpapers (overlays already rely on a halo for light backgrounds).
- `prefers-reduced-motion` is respected (no sheen/flicker animation, instant folds).

## Approaches considered

1. **Restyle the control room in place**: edit the existing per-page HTML strings in `settings.js`. Smallest diff, but the file is already dense and summaries, hide rules and sub-pages would be hand-wired again.
2. **Rebuild the control room from a settings list** *(chosen by the owner)*: one declarative list describes sections and rows; a small renderer draws the folding sections. Overlays are restyled in place through a shared theme stylesheet.
3. **Add a UI framework** (React/Lit/Preact): rejected. No build step, strict CSP, and not needed at this size.

## Design

### Shared theme

New `src/renderer/styles/stella-theme.css`, loaded by `index.html` and `settings.html` before their own stylesheets. It holds CSS custom properties and shared primitives only:

- Colors (from Stella's palette): midnight backgrounds `#08071c` → `#1d1850`, panel fill `rgba(36,30,86,.9)` → `rgba(16,14,44,.94)`, text `#ece9ff`, muted `#a9a3d6` / `#8f89c0`, lavender `#b9a4f5`, violet `#8b5cf6`, blue `#5b8cff`, link blue `#7ea6ff`, gold `#f6dc9c`, rose `#f2b8c6`, warm white `#fff1d6`, quit/danger rose `#f2b8c6`, ok green `#8ee6b0`.
- Hairline border: gradient `120deg, gold .7 → rose .45 → violet .25 → blue .5`, drawn with a masked pseudo-element (as in the mockup).
- Radii: pills `999px`, panels `22–24px`, tiles `16px`.
- Primitives: `.orbit-surface` (panel), `.orbit-icon-button` (circle), `.orbit-primary` (gold), `.orbit-switch`, `.orbit-segment`.
- **Icon button rule**: fixed square size per tier (30 / 34 / 46 px), `display:grid; place-items:center`, SVG `display:block`, all icons drawn on a 24-unit viewBox. Icons whose shape is visually unbalanced (the chat bubble with its tail, the mic with its stand, the send arrow) get a per-icon optical offset in that icon's own class, verified by screenshot.

`capri.css` and `settings.css` keep their file names (project 3 renames) but drop the old green/cut-corner rules for the elements in this project.

### Overlays (restyled in place)

All in `index.html` + `capri.css`, keeping existing DOM ids and JS:

- **Talk menu** (`#talk-menu`): pill greeting bubble, two 46px round buttons below it (text chat, voice), gold hairline ring. Keep the elliptical hit test in `talk-menu.js`.
- **Chat panel** (`#panel`): remove `.panel__face` (portrait figure and canvas) and the `Portrait` usage in `panel.js`; reclaim the width. Header shows the display name, a status dot, and ✕. Drop the version/model line, the “AI · LIVE” badge and the idle “Codex: no activity…” line from the header; `.panel__activity` shows only while she's actively doing something. Input is a pill; mic is a 34px circle; send is the gold 34px circle; close moves to the header. Keep the existing re-anchoring behavior (commit 12e01cf).
- **Voice indicator, wake indicator, ticker, reminder cards, guide overlay (`guide.css`), desktop highlight (`desktop-highlight.css`)**: same surfaces, buttons and colors. Wording updated to the display name (“Hey Stella”).

### Message formatting

New module `src/renderer/js/rich-text.js` exporting `renderRichText(node, text)`:

- Parses: `**bold**`, `*italic*` / `_italic_`, `` `code` ``, lines starting with `- ` or `* ` as a bullet list, `[label](url)`, bare `http://` / `https://` URLs (trailing punctuation excluded).
- Builds DOM with `createElement` / `textContent` only; never `innerHTML`. Unmatched markers stay as literal text.
- Links (builder-check answers, my calls): only `https:` URLs become links, because the existing `publicUrl()` check in `src/main/web-tools.js` rejects `http:` and local/IP hosts; `http:` and other schemes render as plain text. Rendered as `<a href>` in link blue `#7ea6ff`, underlined; click handler calls `preventDefault()` and sends the URL through a **new** overlay IPC channel (add to `src/preload.js` + a `main.js` handler) that validates with `publicUrl()` and opens with `desktop.openUrl(url, 'default')` (preferred browser). If validation or opening fails (e.g. preferred browser not installed), the panel shows a one-line note (“Couldn't open that link”). The overlay window currently has **no** navigation guard: add `will-navigate` prevention and `setWindowOpenHandler(() => ({ action: 'deny' }))` to it.
- Used for `panel__reply`, `panel__line` and summaries wherever model text is shown. The typewriter/streaming reveal in `panel.js` (around lines 474–491) must reveal formatted text without showing raw `**` mid-stream: builder may reveal plain text while streaming and swap in formatted text at the end, or format progressively. Builder's call.
- Spoken output (TTS) must receive text with markers stripped.

### Control room

Window: about 380px wide, height fits content up to a max with internal scroll; rounded Orbit window. Today it is frameless but opaque (`backgroundColor '#130e1d'`, 840×690, `minWidth` 640, `minHeight` 530 in `src/main/settings-window.js`): change size/min sizes and make it `transparent: true` with the rounded surface drawn in CSS (keep a draggable header region). Esc and ✕ close as today. The preload exposes `window.settingsHost`.

**Settings list** in `src/renderer/js/settings-schema.js`: an array of sections, each with `id`, `label`, `icon`, `summary(state)`, and `rows`. A row has `label`, optional `tip` (tooltip, replaces paragraphs), a control (`switch` / `segment` / `select` / `slider` / `text` / `button` / `list`), the config `key` or action name, optional `visible(state)`, and optional `deeper: true` to place it in a sub-view. `settings.js` becomes the renderer + event wiring (keeps `SettingsQueue`, focus/scroll restore, `host.onUpdate`).

Layout (approved mockup):

```
┌ ◉ Stella · Here with you ················ ✕ ┐
│ [Gaming mode ○]      [Size  S ● L]          │
│ [Desktop  Ctrl+Alt+C           Put away]    │
│ ◌ Sound & voice      70% · voice on       › │
│ ◌ Memory             On                   › │
│ ◌ Reminders          2 upcoming           › │
│ ◌ Behavior & awareness                    › │
│ ◌ Codex & project    Connected            › │
│ ◌ App                v0.4.0               › │
└ Changes save automatically      ( ⏻ Quit ) ┘
```

Status text beside the name reflects paused/gaming (“Taking a break”). Footer status line shows save notices/errors (existing `#notice`). One section open at a time.

**Contents** (every row is one line, tooltip instead of paragraph):

| Section | Rows | Deeper (“… ›” sub-view) |
| --- | --- | --- |
| Quick tiles | Gaming mode (action switch `gaming`), Size S/M/L (`scale` 0.45/0.6/0.8), Desktop Put away / Bring back (`visibility`) | — |
| Sound & voice | Volume slider (mute = speaker icon toggle beside it, `muted`), Hey Stella (`wakeWordEnabled`), Spoken replies (`ttsEnabled`), Speak typed replies, Speak check-ins (`proactiveVoice`), Reply to check-ins (`checkInReplies`), Voice preview (style select + play) | **Voice engine & files**: engine, model folder (Qwen) or processing (others), Python, reference WAV, reference transcript, custom sounds folder |
| Memory | Remember recent chats (action switch), Personal memory; when on: Learn from conversation, Review requested changes, Offer to remember, Recall in conversation, Keep for (retention); buttons Review · Export; danger buttons Clear recent chats · Delete all | — |
| Reminders | List: text, next time, Move (time input) · Cancel; empty state one line | — |
| Behavior & awareness | Wander, Idle gestures, Mood & personality, Notice window changes (`windowTracking`, still drives the window watcher and curiosity, relabelled from “Sit on windows”), Evening recap card (`dailyRoutine`, still drives the evening report card, relabelled from “Daily routine”), Start conversations (`proactiveEnabled`, shown once), Companion conversations (`autonomyEnabled`), “She can see” compact toggle row: App · Titles · Processes · Activity · Time · Power · Performance, System tools, Screen vision | **Her initiative**: Reflect on open questions, Quiet trial (+ review/resume), Routines (+ review), Learn from project evidence (+ review), Daily review + recap (+ review), Ongoing interests (+ review) |
| Codex & project | Connection status, Project folder (choose / use home), Model, Reasoning effort | Codex executable path |
| App | Restart, Check local changes, Display, Preferred browser, Language, Start with Windows | Crunchyroll profile, Build info (version, path) |

**Removed** from the UI (settings keep their stored values; no migration): `possess` (ignored in `stella.js`), `surpriseAnimations` and `cursorInteractions` (forced off in `app.js`); the hero cards; the “at a glance” facts; the explanatory paragraphs and `fine` print; the Codex “Local notifications / Approval stays with you” info rows (one-line tip on the status instead).

Summaries (builder may tune wording): Sound “70% · voice on/off” or “Muted”; Memory “On” / “Off”; Reminders “N upcoming” / “None”; Behavior “Custom” or nothing; Codex “Connected” / “Waiting”; App version, or “Restart ready” when source changed.

### Wording

Rewrite visible copy in the files touched to plain, warm, short text. Remove “choom”, “digital ghost”, “biochip”, “your space / your rules”, “Make yourself at home” etc. Strings in `src/renderer/js/lines.js` that appear in the restyled UI count as UI labels (talk-menu greetings, chat badge, placeholder, “Not the real Capri” note): rewrite them in all five languages there (fr, en, es, pt, ru). Other personality/dialogue lines stay out of scope.

### Name and wake word

- `src/main/identity.js`: `DISPLAY_NAME = 'Stella'`. It already flows to the renderer through `rendererConfig()` (`main.js`) and to `command-phrases.js`, `exclusive-fullscreen.js`, `guide-session.js`, `reminder-commands.js`, `reminder-delivery.js`, `walkthrough*.js`. Check each use still reads correctly and that command parsing tests pass with the new name.
- Hard-coded visible “Capri” strings outside `DISPLAY_NAME` (e.g. `wake-listener.js` indicator texts, `settings.html` title/wordmark, “Quit Capri”, tray tooltip/menu labels, window titles, aria-labels, `lines.js` UI strings) switch to the display name. Builder greps for user-visible `Capri` and changes text only, not identifiers.
- `src/main/wake-phrase.js`: accept `hey|hei|ey` + `stella`. **My call:** keep `capri` accepted as a silent alias until project 3, so muscle memory still works; the UI only ever says “Hey Stella”. Verify the local speech recognizer actually transcribes “Stella” reliably (test a few spoken samples); if it often mishears it, accept close variants (e.g. “stela”, “stellar”) in the pattern.
- The personality prompt / identity text sent to Codex: if it names her “Capri”, change the name to Stella (name only; personality unchanged, per project 1).

## Testing

- Unit (`node --test`): `rich-text.js`: bold/italic/code/lists/links/bare URLs, rejected schemes, unmatched markers, no HTML injection; settings schema: every rendered key is accepted by `settings-policy.js`, removed keys are not rendered, `visible()` rules.
- Update `npm run test:settings` (smoke) for the one-page layout: open each section, toggle gaming pause/resume while controls stay visible, size change persists, quit button present, close/reopen.
- Screenshots in `captures/` of: picker, chat panel with formatted reply + link, control room (closed, each section open, a deeper view), at 100% and 150% scaling; check icon centering by eye.

## Left to the builder

- Exact pixel values, spacing and animation timing within the Orbit language.
- Streaming reveal strategy for formatted text.
- Summary wording and tooltip text.
- Whether the control room window resizes to content or scrolls inside a fixed height.
- Branch: start from `feature/stella-character` (project 1 isn't merged yet), or from `development` if it has merged by then.
