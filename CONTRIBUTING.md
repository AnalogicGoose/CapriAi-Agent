# Developing Stella

Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the branch model and
[docs/RELEASING.md](docs/RELEASING.md) before preparing a version.

Use Node.js 24 and `npm ci` with the committed lockfile. Windows x64 is the
current development/build target; macOS and Linux are unverified experiments.
Run `npm test` and `npx electron-builder --win --x64 --dir --publish never` before
merging. Desktop, Ollama, browser, microphone and native Windows changes also
need the relevant checks in [`docs/VALIDATION.md`](docs/VALIDATION.md) and an interactive Windows session.
CI does not replace those checks.

Keep commits focused. Use imperative English subjects and explain the reason in
the body when it is not obvious, for example `Keep gaming mode silent on resume`.
Do not commit local credentials, models, voice samples, captures or build output.
Use pull requests into long-lived branches and record what was tested, on which
platform, and what remains unverified. Never stage unrelated working-tree edits.

The README pictures in `docs/media/` come from the real renderer. To refresh them, run
`node_modules\electron\dist\electron.exe tools/capture-readme-media.js`, then
`python tools/build-readme-gif.py` (needs Pillow), and copy `captures/settings-home.png`
from `npm run test:settings` to `docs/media/control-room.png`.
