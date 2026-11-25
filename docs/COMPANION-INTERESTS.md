# Chosen interests and input recovery — 2026-11-07

Stella can choose a creative focus, retain it across restarts and refine its
question later. These operational preferences provide continuity; they do not
establish subjective experience. User goals, project journals and personal facts
remain separate. Existing artwork, animation rig and voice services are preserved.

## Ongoing interests

During an eligible proactive conversation, the existing tool-free Codex adapter
may choose/refine one interest: at most once per local day, with twenty-hour
minimum spacing. Failures, restarts and clearing the list do not bypass the budget.
There are at most three active interests. Each has a domain, focus, question,
rationale and state. A selected project name and up to two saved preferences
can inspire a new idea. Preferences require Memory and recall. Project files,
paths, screenshots, window titles and transcripts stay out of this model
request. Stella is prompted to generalize the inspiration before saving. Output is schema-validated and stored
in the existing curiosity SQLite database, not personal memory or user goals.

Active interests enter bounded foreground context and rotate into proactive
conversation. A delivered topic becomes `exploring`, with a mention count and a
six-hour resurfacing cooldown. A mention is not user participation or completed
work. Existing availability checks and the 5–15 minute conversation cadence apply.

## Private creative drafts

An active interest can become a small creative pursuit. At a later eligible
conversation opportunity, Stella can choose to wait or write a draft in her own
local journal. A draft contains material you can read, such as a scene, puzzle,
or game mechanic. She can save one follow-up and use it to make a second draft
on another day, even after a restart. A draft with an open follow-up gives Stella
a curious tone and takes priority over unstarted ideas. A finished draft gives
her a pleased tone and frees the next attempt for another interest. If she
shares her work aloud, curiosity makes the delivery a little quicker and
satisfaction makes it a little more relaxed. The same check-in schedule and
availability rules apply. The drafts and next step are available in
`/interests show <id>`.

Draft attempts use the existing tool-free Codex connection and have their own
persisted limit of one per local day, at least twenty hours apart. Only the
interest, its previous draft and the proposed next step are supplied. New
progress can take precedence over ordinary small talk, and Stella can choose
silence. A draft stays available for review either way. The private workspace is
part of Stella's SQLite journal. It stores generated text and has no desktop,
web or user-file actions.

**Control room → PC awareness → Chosen interests** offers review and disable.
Automatic generation requires private reflection and companion conversations to
be enabled. Local controls are `/interests list`, `show <id>`, `on|off`,
`pause|resume|dismiss|resolve <id>`, and `clear`. Pauses remove a topic from automatic
context; dismissed/resolved domains cannot be revived by generation. Feedback
persists until clear. Clear removes interests and their drafts while preserving
the attempt budgets. Off suspends work and automatic sharing.

A clear “No thanks”, “Not interested”, or supported equivalent as the first
response to a just-delivered interest pauses it locally. Bare “no” can answer a
creative question, so it does not pause a topic. Unrelated replies and refusals
after ten minutes do not mutate interests. After a draft check-in, click
**Reply** and say **Keep going** to give an unfinished draft priority for its
next attempt, or **Not now** to set that idea aside for 24 hours. These choices
survive restart and leave the usual daily attempt limit in place. A deferred
draft remains readable with `/interests show <id>`. Stella saves the choice and
time locally. Reply text is not saved. Persona
instructions accept refusal without guilt, neediness or dependency. Chosen
interests never authorize research, desktop input, purchases, posting or files.

Implementation: `src/main/companion-interests.js`, integrated into the existing
`proactive-conversation.js`, main-process context and settings paths.

## Timing and working together

When a check-in arrives at a bad moment, reply **I’m busy** or **Give me a
minute**. Stella pauses check-ins for ten minutes and can revisit that thought
once when it still fits. She keeps a topic reference for up to an hour and
checks that the information is still available before bringing it back.

Choose **Build together** on an interest, say **Let’s build that together**
as your reply, or open a regular chat and enter `/interests build <id>`.
Give feedback in the same text or voice conversation to revise the draft.
Say **Save this draft** to keep the current version and **Back to chat** to
leave. To save an agreed next step, say **Next time, let’s…** before you save,
or include it in one request such as **Save this draft, and next time let’s
add a second verse**. To remove a saved next step, say **Clear the next step**
and save again.

In a new text or voice conversation, ask **Where did we leave off on our
draft?** for a recap or say **Let’s keep working on our draft** to continue.
If there are several drafts, choose by name or by the number Stella gives you.
Use `/interests show <id>` to read the saved draft and step or
`/interests build <id>` to open a specific draft. Stella saves the draft and
agreed next step locally on request. The creative exchange uses the signed-in
Codex connection with desktop and web tools disabled.

Stella sounds pleased when you save a changed draft or agree on a new next
step. When you continue, she tries the agreed step first or suggests one
revision for you to consider. A shared draft stays available for you to
reopen, and Stella leaves the earlier solo draft out of check-ins.
During collaboration, **Not now** sets the idea aside for a day, and
**I’m busy** pauses check-ins for ten minutes. You can explicitly resume
the draft whenever you’re ready.

## Click / drag / fullscreen fixes

- Hiding the talk launcher during pickup blurred the window, causing the blur
  handler to release pointer capture and cancel the drag. Hiding now preserves
  focus while a pointer is held; keyboard focus is released after drag ends.
- Passive focus release used `setFocusable(false)`, leaving native activation
  inconsistent with cached hit state. The visible overlay remains focusable,
  uses `showInactive()` for passive presentation, and focuses only on explicit
  chat/menu requests. Trusted hit updates restore native mouse activation.
- Hit testing relied on forwarded mousemove. `pointer-recovery.js` samples a
  transient local cursor point every 150 ms when forwarding is quiet. It stores
  no history, supplies no model data, yields during pointer capture, and rejects
  stale async replies after newer mouse events or blocked/hidden/fullscreen states.

Electron documents Windows limitations on forwarded movement when a
higher-integrity window is active. That supports avoiding forwarding as the sole
input mechanism; it does not identify which window caused this user's report.
See the [official mouse-event API](https://www.electronjs.org/docs/latest/api/base-window#winsetignoremouseeventsignore-options).
No privilege elevation or Windows security change is introduced.

## Validation

- Shared draft reactions passed all 373 Node tests and the Windows x64
  directory build. An isolated Electron voice check verified the playback
  pace when saving progress and continuing from the agreed step in a second
  voice session. It used scripted transcripts, mocked Codex inference and
  the Windows speech engine with audio muted at the output.
- Windows / Node 24.15.0 / Electron 44.9.3: **263/263 Node tests passed**.
- Expanded isolated fullscreen Electron smoke passed lost native activation with
  no forwarded movement, stationary-pointer recovery, pickup with the launcher
  open, click/drag/Send/Close, rapid reversals, stale acknowledgments, overlapping
  teleport, gaming and manual stow. Fullscreen geometry is simulated and input is
  injected through Electron; native focus/visibility state is checked directly.
- Expanded cognitive Electron smoke passed interest generation/storage,
  foreground continuity, review, dismissal and disable controls, plus existing
  project/memory/proactive behavior. Its model inference is mocked.
- One real signed-in Codex turn produced a schema-valid interest about a town
  where lost objects become infrastructure, with zero tools and no user observation
  data. This used an in-memory journal, not the live companion's data.
- Windows x64 directory packaging with publishing disabled passed. Syntax and
  whitespace checks passed; packaged runtime files were compared with source.

The running companion matched the starting source before changes and was not
restarted. Reopen Stella's desktop shortcut while no reply is running, or use
the control-room Restart action, to load the update. The shortcut still targets
this checkout correctly. Physical mouse delivery in the user's particular game/
fullscreen session still needs confirmation after restart: the desktop helper
could not target the transparent live overlay. One successful model probe does
not establish long-term conversational quality.
