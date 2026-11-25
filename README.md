<div align="center">

<img src="docs/media/stella.gif" alt="Stella, a glowing globe of light with turning purple blades, moving through idle, listening, thinking and speaking" width="900">

<p>She floats beside your work, talks with you, remembers what you choose,<br>and helps on your PC when you ask.</p>

[![CI](https://github.com/AnalogicGoose/Stella/actions/workflows/ci.yml/badge.svg?branch=development)](https://github.com/AnalogicGoose/Stella/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-a9a2ff)](LICENSE)
![Windows x64](https://img.shields.io/badge/Windows-x64-6e7bff)
![Version](https://img.shields.io/github/package-json/v/AnalogicGoose/Stella/development?label=version&color=e9a3c4)
![Electron](https://img.shields.io/badge/Electron-desktop-47848f)

[Quick start](#quick-start) · [What she can do](#what-she-can-do) · [Privacy](#privacy-and-control) · [Docs](#documentation) · [Français](README.fr.md)

</div>

---

## Meet Stella

Most assistants live in a browser tab and wait. Stella lives **on your desktop**. She is a small, original character, a see-through globe of light inside a gold-to-rose ring with turning purple blades, and you can always tell what she is doing: she draws in to listen, spins up to think and ripples with her own voice when she speaks.

Click her to talk by text or voice, or just say **"Hey Stella"**. She uses [Codex](https://github.com/openai/codex) for conversation and the tasks you ask for. Your microphone is transcribed locally on your PC.

<table>
<tr>
<td width="55%" valign="middle"><img src="docs/media/chat.png" alt="Stella beside her chat panel, answering a request to plan the week"></td>
<td width="45%" valign="top"><img src="docs/media/control-room.png" alt="Stella's Control room with Gaming mode, size, Put away and folding settings sections"></td>
</tr>
<tr>
<td align="center"><sub>Talk by text or voice, right next to her</sub></td>
<td align="center"><sub>The Control room: everything on one small page</sub></td>
</tr>
</table>

## What she can do

<table>
<tr><td width="50%" valign="top"><b>Talk and listen</b><br>Text or voice chat, a "Hey Stella" wake word, and optional expressive speech. You can interrupt her mid-sentence.</td><td width="50%" valign="top"><b>Help on your PC</b><br>On request she opens apps and sites, searches the web, reads a screen snapshot, uses desktop controls and works inside a project you pick.</td></tr>
<tr><td width="50%" valign="top"><b>Remember, if you want</b><br>Save goals, decisions and resume points, and teach her routines she can run later. Memory is off until you turn it on.</td><td width="50%" valign="top"><b>Start a conversation</b><br>She can bring up an interest she chose or come back to a question when there is something new to say.</td></tr>
<tr><td width="50%" valign="top"><b>Reminders</b><br>Ask her to remind you, and she comes over when it's time.</td><td width="50%" valign="top"><b>Stay out of the way</b><br>Gaming mode, fullscreen apps and <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> fold her into a point of light until you need her.</td></tr>
</table>

### She shows what she's doing

<img src="docs/media/states.png" alt="Stella idle, listening, thinking and speaking" width="100%">

Every function has its own motion: her blades flare when she opens something, a stick sweeps like a radar while she searches the web, and a scan line passes through her globe while she reads your screen. When idle she drifts calmly around the edges of your screen and never covers the middle. [How her look and motion work](docs/STELLA.md)

## Quick start

You need **Windows x64**, **Git**, **Node.js 24** and the **[Codex CLI](https://github.com/openai/codex)**, signed in.

```powershell
git clone https://github.com/AnalogicGoose/Stella.git
cd Stella
npm.cmd ci
npm.cmd start
```

Stella appears in the lower-right part of your screen. Click her to talk. Right-click her or her tray icon to open the **Control room**. If she can't find the Codex CLI, pick its executable under **Codex & project**.

## Privacy and control

- **Your microphone stays local.** Speech-to-text runs on your PC. Expressive speech can run locally too.
- **Memory is opt-in.** Personal memory and recent-chat memory start off. You can review, export or clear everything from the Control room.
- **She asks first.** Actions with consequences, and requests outside Codex's permissions, wait for your approval.
- **Easy to quiet.** Gaming mode hides her and pauses anything she would start on her own. "Hey Stella" still works if you want it to.

## Documentation

| Topic | Read |
|---|---|
| Her look, states and motion | [docs/STELLA.md](docs/STELLA.md) |
| Voice, wake word and speech | [Compact voice](docs/COMPACT-VOICE.md) · [Wake word](docs/WAKE-WORD.md) · [Expressive voice](docs/EXPRESSIVE-VOICE.md) |
| Desktop tasks and projects | [Agent presence](docs/AGENT-PRESENCE.md) · [Desktop tasks](docs/DESKTOP-TASKS.md) · [Project companion](docs/PROJECT-COMPANION.md) |
| Memory and continuity | [Continuity](docs/COMPANION-CONTINUITY.md) · [Routines](docs/REUSABLE-ROUTINES.md) · [Interests](docs/COMPANION-INTERESTS.md) |
| Building and contributing | [CONTRIBUTING.md](CONTRIBUTING.md) · [Development](docs/DEVELOPMENT.md) · [Releasing](docs/RELEASING.md) |

## What's next

- A new intro animation and a redesigned away mode for Stella
- A packaged installer with updates, so Node.js isn't needed

See the [roadmap](docs/ROADMAP.md) for more.

## Contributing

Ideas, bug reports and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). It covers the branch model, the checks to run (`npm test`) and how to test desktop changes on Windows.

If Stella makes your desktop a little nicer, a ⭐ helps other people find her.

## Credits and license

Stella started from [Capri Desktop](https://github.com/mochiiwuff/capri-desktop) by mochiiwuff and its contributors. Stella herself is an original character made for this project.

The code is under the [MIT license](LICENSE). Fonts are Chakra Petch and JetBrains Mono, distributed via Fontsource under the SIL Open Font License.
