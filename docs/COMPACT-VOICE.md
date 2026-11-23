# Compact voice conversation

With **Sound → Enable voice replies** and **Speak typed replies** on, Capri
speaks ordinary chat replies while showing them in the chat. Dictation into
the text composer remains a draft you can review before sending. Choose
**Preview voice** to hear the selected voice.

With **Speak check-ins** on, Capri can say her optional companion remarks
aloud. These include welcomes after returning to the PC, new drafts, and other
remarks she chooses to share when available. Windows idle time is sampled
locally, and the return trigger respects PC event awareness and a thirty-minute
cooldown. Agent suggestions continue to appear as text.

With **Reply to spoken check-ins** enabled, answer aloud when Capri speaks
first. You can talk over her or reply within about 12 seconds of the end of a
remark. For a draft she just shared, “Keep going” and “Not now” apply to that
draft. The microphone indicator shows when the reply window is open. If the
microphone is unavailable, Capri can still deliver the remark. Click the
indicator, press Escape, or say “stop listening” to end the exchange. Audio is
processed locally and no recording is saved.

Capri starts warming the local voice while she decides what to say. A spoken
check-in must begin within thirty seconds and while its card is current. The
text is available as soon as the remark arrives.
Closing the card, muting Capri, starting a voice conversation, or entering
fullscreen ends pending playback. The return signal describes recent Windows
input without inferring where you were.

Both the voice menu and "Hey Capri" enter the same compact voice session. It
shows only a 30-pixel microphone above Capri. The icon follows her head, appears
green while listening and violet while replying, and is dim while preparing or
thinking. No transcript, chat card, activity text, or launcher remains on screen.
The overlay does not request keyboard focus. Native action confirmation gates
remain in force; this flow adds no automatic approval.

After the wake phrase, the existing microphone stream and addressed words are
handed over without restarting capture. Whisper continues listening across
turns. The same Codex brain and conversation history answer voice and typed
messages; a trusted voice-turn option requests natural spoken prose. Only
addressed/session transcripts reach the normal reasoning backend. Idle wake
transcripts remain local and discarded, as before. No audio recordings are saved.

Turn on **Control room → Memory → Remember recent chats** to resume ordinary
voice or text conversations after restarting. Capri keeps the text of up to
12 completed exchanges on this PC for up to seven days. Recent chat text can
be sent to Codex when you continue. This setting starts off. **Clear recent
chats** removes the saved text, and turning the switch off also clears it.

With **Personal memory** and **Learn from conversation** enabled, Capri saves
clear statements about your preferences, activities and belongings from voice
and text. These details use the personal memory retention and recall settings.
Capri can also learn from a short answer in context. If she asks what you
play and you say **Table tennis, mostly**, she can remember that you play
table tennis. You can speak naturally or ask explicitly when you prefer.
Review them with **Memory → Review**. Say **Talk less about [topic]** to leave
the topic for you to introduce, **Bring up [topic] again** to lift that
preference, or **Forget [topic]** to remove what she has saved about it. If a
memory contains several details, Capri can edit the relevant part. Use
`/memory topics` to review the topics you have set aside.

Clear changes such as **I used to play on Xbox, but now I mostly play on PC**
update the older gaming preference while keeping unrelated details. Say
**I’m taking a break from anime** to keep the interest saved and leave the
topic for you to bring up. **I’m back into anime** lifts that preference.

For a named topic, Capri can keep a short recap longer than recent chat.
For example, say **I’m caught up through episode 15 of Black Clover** and
**We were comparing Asta and Yuno** in the next turn. **No spoilers past
episode 15** records a separate limit. Name the topic when you want to
continue. Updating your progress or the discussion point carries across
restarts. **Show my topic recaps** lists them, and **Forget the recap for
Black Clover** removes that recap. These entries use personal memory
retention.

Interruption uses local Silero v5 via `@ricky0123/vad-web` 0.0.31 and
`onnxruntime-web` 1.22.0, served entirely from installed application dependencies.
The detector shares the existing echo-cancelled microphone stream and runs on
one WASM CPU thread. If it hears speech over Capri, playback briefly pauses.
Capri only accepts the interruption if speech continues after the playback echo
has had time to fade. Otherwise playback resumes from the same point.
Confirmed speech stops scheduled audio,
cancels generation, and resets recognition with a bounded 500 ms pre-roll so the
beginning of the interruption is retained. Recognition revisions, chat IDs and
playback epochs discard stale outputs. Brief noise does not use a simple volume
threshold to interrupt speech. Browser echo cancellation and noise suppression
are enabled; real microphone/speaker echo still requires user acceptance testing.

Clicking the microphone, pressing Escape while the overlay receives keyboard
events, saying "stop listening" / "end call", or opening text chat ends the
session. After 60 seconds without input or an active reply it returns to wake-only
listening. The icon disappears. Disconnection, revoked wake access for a
wake-started session, muting, disabling speech and app unload cancel capture.

## Validation

- Unit tests cover spoken and silent typed replies, complete wake-request assembly,
  speech interruption, stale generation/delta rejection, echo transcript gating,
  continuous input beyond 90 seconds and recognition reset.
- `electron scripts/check-voice-call.js`, with `CAPRI_VOICE_TEST_WAV` pointing at
  an authorized local speech sample, exercises real offline Silero/WASM in the
  native renderer with a synthesized MediaStream. It checks brief-click rejection,
  audio cancellation, a 30-pixel icon and a hidden chat surface. It never captures
  the user's microphone. The observed warm detection cut audio about 190 ms after
  the first positively classified speech frame; this is not a hardware latency
  guarantee.
- `electron scripts/smoke-electron.js --voice-flow-only --wake-live` uses an
  isolated profile, Chromium's fake microphone, and fake recognition/reasoning/TTS
  backends. It checks the real app/preload/main flow: the typed-reply switch, wake
  handoff, voice-only output, continuous microphone ownership, hidden panel,
  manual compact voice entry and click-to-end.
- The existing settings smoke check passes. Production dependency audit reports
  no known vulnerabilities for the newly installed dependency graph.

Authoritative detector documentation:
[browser setup](https://docs.vad.ricky0123.com/user-guide/browser/) and
[API](https://docs.vad.ricky0123.com/user-guide/api/).

The desktop shortcut continues to target this checkout directly. No running
Capri session is restarted, and no branch is pushed or release published.
