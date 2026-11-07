# Occasional conversation with Capri

Capri can offer a short conversation bubble every randomly chosen 5–15 minutes while you are available. She rotates between current app context, explicitly saved memories, an open curiosity question marked `ask_later`, and casual creative topics. Each generation can choose silence. Timing is approximate: a 15-second scheduler checks eligibility, and busy or quiet periods can extend the interval.

The bubble stays for 20 seconds without taking keyboard focus. Reply opens normal chat with her opening preserved in conversation context. Pause check-ins disables the feature. Re-enable **Start conversations** under Appearance, or use `/companion on`. `/companion off` pauses it and `/companion status` reports the next opportunity. This milestone uses text and existing character sounds; it does not add spoken TTS to the cognitive branch.

## Availability and pacing

- New check-ins default on for this user-requested behavior. Existing explicit off settings stay off.
- A new randomized interval is reserved before collection or inference, including failed/silent attempts. No rapid retries or catch-up queue. The pending opportunity survives restart; an overdue restart starts a fresh interval.
- User interaction resets the interval and cancels in-flight generation. Foreground requests have priority over the local model. Conversation, voice input, gaming, fullscreen, hidden Capri, sleep, screen lock and five minutes of system inactivity suppress check-ins.
- The legacy app-switch/power agent suggestion path is replaced by this cadence so it cannot interrupt between scheduled openings. Explicit `/agent think` remains available.
- Categories rotate when available. The same app is suppressed for 30 minutes; other selected subjects and exact normalized output are suppressed for two hours, including across restart. Similar wording is also suppressed within an uninterrupted session. Only one job can run at a time; generation has a 45-second abort deadline.

## Context and storage

Activity snapshots are on demand and permissioned. They include only foreground app and, when permitted, its window title; no screenshots or keystrokes. Window titles stay in memory for the current generation. The model is told app context does not establish intent, emotions, duration or actual document contents.

Memory is read only when both personal memory and recall are enabled. A conservative sensitive-term filter excludes some facts from unsolicited recall; it is not a complete semantic classifier. The prompt treats saved facts as potentially outdated. No automatic memory writes occur.

Curiosity questions are speculative and supplied only while cognition/observation permissions allow them. General smalltalk works with app observation and memory disabled. All sources are untrusted data; generation has no tools and cannot execute actions.

Only the due timestamp, previous category, hashed source keys, hashed exact outputs and delivery timestamps persist in `conversation_state` in the curiosity SQLite database. Generated text, memory facts and window titles are not saved there. Recent generated text is bounded in RAM and discarded on interaction or policy changes. Clearing curiosity questions preserves anonymous pacing state so it cannot trigger a burst.

## Validation and integration

`npm test` covers cadence, restart behavior, topic rotation, missing permissions, busy/gaming/hidden states, cancellation, silence/errors, duplicate output, saved state and first-reply context. `electron scripts/smoke-electron.js --cognitive-only` checks a real bubble without focus, Reply opening chat with its question, and pausing through IPC. Text generation is mocked in that smoke test.

Verified on Windows x64 with Node 24.15.0: 139 unit tests passed, the isolated Electron check passed, and the unpacked Windows build completed with publishing disabled.

The local cognitive branch is based on the unmerged Phase 2 work and remains separate from ongoing desktop voice/UI edits. It has not been pushed, merged or installed into the running companion. Live local-model quality, natural pacing over an extended session and eventual spoken-voice integration remain unverified.
