# Stella's control room

Right-click Stella or her tray icon to open her control room; the tray's left click opens it too.
Close with Escape (Escape first leaves a sub-view) or the ✕; she keeps running.

It is one small rounded window in her Orbit style:

- **Quick tiles:** Gaming mode, Size (S / M / L), Put away / Bring back (Ctrl + Alt + C).
- **Folding sections**, one line each with a short summary; one opens at a time:

| Section | In the section | One click deeper |
| --- | --- | --- |
| Sound & voice | Volume + mute, Hey Stella, spoken replies, speak typed replies, speak check-ins, reply to check-ins, voice preview | Voice engine & files: engine, model folder / processing, Python, reference WAV and words, custom sounds |
| Memory | Recent chats, personal memory (and, when on: learn, review changes, offer to remember, recall, keep for), review/export, clear | — |
| Reminders | Upcoming reminders with Move / Cancel | — |
| Behavior & awareness | Wander, idle gestures, mood, notice window changes, evening recap card, start conversations, companion check-ins, "She can see" chips, system tools, screen vision | Her initiative: reflection, quiet trial, routines, project evidence, daily review + recap, interests |
| Codex & project | Connection, project folder, model, reasoning effort | Advanced: Codex path |
| App | Version + check/restart, display, preferred browser, language, start with Windows | More: Crunchyroll profile, build info |

- **Footer:** save notices and **Quit**.

Every row is one line; explanations live in tooltips. The list of rows is data in
`src/renderer/js/settings-schema.js`; `settings.js` draws it. Changes save automatically through the narrow
settings preload, and the main process (`settings-policy.js`) still validates every key and action.

Removed from the UI because they no longer do anything with Stella's body: window mischief, rare surprises and
pointer reactions (their stored values are kept).

Validation: `npm test` (schema, renderer and policy tests) and `npm run test:settings` (Electron: every section and
sub-view without sideways overflow, saving, gaming pause/resume while controls stay visible, close/reopen).
Screenshots are saved under ignored `captures/`.
