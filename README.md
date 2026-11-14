# CapriAi Agent

CapriAi Agent is an independently maintained Windows desktop companion. Capri can talk with you, remember information you choose to save, and help with tasks on your PC. She uses Codex for conversation and requested work, with local microphone transcription and optional local speech.

[Français](README.fr.md)

![Capri beside her conversation panel, discussing how to start a project](docs/screenshots/conversation.png)

## What Capri can do

- **Talk and listen.** Click Capri to start a text or voice conversation. [Wake word](docs/WAKE-WORD.md) · [Expressive speech](docs/EXPRESSIVE-VOICE.md)
- **Start a conversation.** She can bring back an interest she chose or revisit a question when she has fresh evidence. [Agent presence](docs/AGENT-PRESENCE.md) · [Chosen interests](docs/COMPANION-INTERESTS.md)
- **Help with desktop tasks.** On request, she can inspect a screen snapshot, use desktop controls, and work in a selected project. [Desktop tools](docs/AGENT-PRESENCE.md) · [Project companion](docs/PROJECT-COMPANION.md)
- **Pick up where you left off.** Save goals, decisions, and resume points, or teach Capri a routine she can run when requested. [Continuity](docs/COMPANION-CONTINUITY.md) · [Reusable routines](docs/REUSABLE-ROUTINES.md)

## Run from source

Use Windows x64, Git, Node.js 24, and a signed-in Codex CLI.

```powershell
git clone https://github.com/Chocoyito1/CapriAi-Agent.git
cd CapriAi-Agent
npm.cmd ci
npm.cmd start
```

Right-click Capri or her tray icon to open the **Control room**. If Capri cannot find the Codex CLI, select its executable under **Connections**. [Development and build instructions](CONTRIBUTING.md)

![Capri’s Control room showing agent status, personal memory, gaming mode, and desktop presence](docs/screenshots/control-room.png)

Screenshots show the development app with a sample conversation.

## Credits and rights

CapriAi Agent builds on [Capri Desktop](https://github.com/mochiiwuff/capri-desktop) by mochiiwuff and its contributors. The original project’s documentation and screenshots are available there.

Capri and Project Capricorn, Cyberpunk, and Cyberpunk: Edgerunners belong to CD PROJEKT RED, Studio Trigger, and Netflix. This is an unaffiliated, non-commercial fan project. The character imagery comes from frames of the show, a fan-made cutout, and fan art. The [MIT license](LICENSE) covers the code. Character artwork and screenshots containing it remain subject to the respective rights holders.

Fonts are Chakra Petch and JetBrains Mono, distributed via Fontsource under the SIL Open Font License.
