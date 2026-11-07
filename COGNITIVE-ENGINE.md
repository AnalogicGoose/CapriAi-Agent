# Capri Cognitive Engine — Persistent Inquiry

This branch implements three stages of a bounded, local-first curiosity pipeline: observation, private reflection, and persistent inquiry. An inquiry is a goal to resolve an evidence gap about a repeated app event. It does not authorize desktop tasks, spontaneous conversations, screen capture or speech.

## Event → question → local reflection

1. The existing Windows foreground-change watcher triggers the `CognitiveFoundation` observer through the permissioned `ContextService`.
2. Three visits to the same application within ten minutes create one tentative question (30-minute per-app cooldown).
3. The observer stores **only a validated application name and a fixed evidence code** in a separate SQLite journal. No window titles, process lists, messages, screenshots or keystrokes are stored.
4. The `ReflectionEngine` schedules a low-priority local Ollama inference. It asks the existing `qwen3.5:9b` agent model for schema-constrained JSON: a revised question, hypothesis, counterpoint, confidence, priority and `wait | ask_later | dismiss`.
5. The result is fully validated before persisting. Hypotheses are explicitly speculative; `ask_later` only records a possibility and **does not** send a message.
6. Reflections survive app restart. Later qualifying events increment an evidence revision on the same open inquiry. A review consumes only the revision it actually inspected; evidence arriving during inference remains pending.
7. A reviewed inquiry becomes eligible again only after six hours AND fresh evidence. Priority orders eligible inquiries, with older reviews first within each priority. No evidence means no new inference. Startup and a lightweight one-minute scheduler check for eligible work without collecting desktop context.
8. The last five reviews per inquiry persist; the latest three and the previous hypothesis are supplied to the model. Capri is prompted to challenge her previous hypothesis, consider an alternative and identify missing evidence. Recurring app events are not proof of intent, and past model outputs are explicitly speculative.

## Safety and runtime limits

- Existing agent, gaming mode, foreground context and event-observation settings gate the pipeline. Permissions are rechecked after asynchronous observation and before saving model output.
- The reflection engine uses the existing local Ollama integration. It cannot use the web or any desktop tools. It does not write to authorized personal memories.
- At most **two autonomous reflection attempts per rolling hour**, including unsuccessful calls. Reservations persist across restart and journal clearing; maximum one concurrent job; 45-second cancellation deadline. Reservations occur before model availability checks, so an offline attempt also counts.
- User requests cancel background reflection through `ForegroundPriority`. An in-progress reflection is also cancelled on game mode, policy changes, application shutdown, or explicit pause.
- The scheduler cannot infer without an eligible inquiry. Revisiting needs a new qualifying app event plus the six-hour cooldown.
- Journal holds at most 100 questions with five reviews each, and prunes entries inactive for 30 days. Clear and expiry remove review history too. Resolved and dismissed subjects stay suppressed until their journal entry expires or is cleared.
- Default `cognitiveEnabled=true` can be disabled through the local `/curiosity off` command. Questions remain until the user deletes them.

## User commands

- `/curiosity status`: view observation and model-assistance status.
- `/curiosity list`: inspect questions and stored reflection records.
- `/curiosity history <id>`: inspect the latest three reviews and their evidence revisions.
- `/curiosity on` / `/curiosity off`: enable or pause cognition.
- `/curiosity resolve <id>`: mark a question resolved.
- `/curiosity dismiss <id>`: dismiss a question.
- `/curiosity clear`: delete questions and review history; anonymous hourly attempt timestamps remain until budget expiry.

## What this is not

This is bounded self-questioning behavior, not evidence of consciousness. Repeated app focus does not prove a user wants help. Model output must not be treated as observation or authorization, and it never initiates a spoken conversation at this stage.

The separate [proactive conversation loop](PROACTIVE-CONVERSATION.md) now provides user-authorized text openings every 5–15 eligible minutes. It can gently surface an `ask_later` question while retaining its speculative status. The private reflection engine itself continues to generate no notifications or speech.

## Next milestone

Add explicit user-goal and feedback signals with verified provenance; measure useful questions and false positive rates; add opt-in interruption policies and a soft, non-invasive UI for inspecting curiosity. Only then consider proactive conversation.

## Validation

Unit tests include the reflection output schema, numeric limits, local inference orchestration, permission gating, foreground cancellation, error handling, duplicate questions and retention. Run `npm test` and relevant Windows Electron smoke tests before merging.

Phase 3 additionally tests Phase 2 schema migration, restart persistence, fresh-evidence and cooldown gating, evidence arriving during inference, closed-question protection, persisted budgets, history bounds and deletion. `electron scripts/smoke-electron.js --cognitive-only` exercises the real SQLite journal and preload/IPC commands in an isolated Electron profile with inference disabled.

This branch builds on the unmerged Phase 2 branch. It has not been installed into the desktop checkout containing ongoing voice/UI work. Live Ollama reflection quality and normal foreground-event behavior still require an interactive acceptance check before merging.
