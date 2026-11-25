'use strict';

const { BUSY_REPLY } = require('./proactive-conversation');

const IDLE_MS = 15 * 60_000;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['reply', 'draft'], properties: {
  reply: { type: 'string', minLength: 1, maxLength: 280 },
  draft: { type: 'string', maxLength: 720 },
} };
const START = /^\/interests\s+build(?:\s+#?(\d+))?(?:\s+([\s\S]+))?$/i;
const SAVE = /^(?:\/interests save|save (?:this|the|our) draft|save (?:this|that)|guarda (?:este|el|nuestro) borrador)$/i;
const SAVE_NEXT = /^(?:save (?:this|the|our) draft|guarda (?:este|el|nuestro) borrador)(?:[.!,:]\s*|\s+)(?:(?:and|y)\s+)?(?:next time|la próxima vez)[, :]+(.+)$/i;
const NEXT = /^(?:next time|la próxima vez)[, :]+(.+)$/i;
const RECAP = /^(?:where did we leave off(?: on (?:the|our) (?:shared )?draft)?|where were we on (?:the|our) draft|en qué quedamos(?: con (?:el|nuestro) borrador)?)$/i;
const RESUME = /^(?:(?:let's )?(?:keep working on|continue|resume) (?:the|our) (?:shared )?draft|sigamos con (?:el|nuestro) borrador)$/i;
const GENERAL_RECAP = /^(?:where did we leave off|en qué quedamos)$/i;
const CLEAR_NEXT = /^(?:clear (?:the|our) next step|borra (?:el|nuestro) próximo paso)$/i;
const LATER = /^(?:not now|maybe later|ahora no|tal vez más tarde|quizá más tarde)$/i;
const END = /^(?:\/interests end|back to chat|stop building|let's stop building|volvamos a conversar)$/i;
const response = (text, mood) => ({ handled: true, pursuitFeedback: true, text, ...(mood ? { mood } : {}) });

function recap(interest, saved) {
  if (saved.next_step) return `We saved “${interest.focus}” and agreed on “${saved.next_step}” as our next step.`;
  const excerpt = saved.draft.split(/\n|(?<=[.!?])\s/)[0].slice(0, 110).replace(/[.!?]+$/, '');
  return `We saved “${interest.focus}” with this opening, “${excerpt}”.`;
}

function chooseDraft(action, choices) {
  const name = action.toLowerCase().replace(/^(?:(?:the|option|number)\s+)+/, '').replace(/\s+one$/, '');
  const position = ['one first 1 uno primero', 'two second 2 dos segundo', 'three third 3 tres tercero']
    .findIndex(group => group.split(' ').includes(name));
  return position === -1 ? choices.find(row => row.focus.toLowerCase() === action.toLowerCase()) : choices[position];
}

class InterestCollaboration {
  constructor({ interests, infer, settings, now = Date.now }) {
    Object.assign(this, { interests, infer, settings, now });
  }
  interest(id) {
    return this.interests.enabled() ? this.interests.active().find(row => row.id === id) : undefined;
  }
  cancel(turn) {
    if (Number.isSafeInteger(turn)) this.cancelledTurn = turn;
    if (turn === undefined || this.job?.turn === turn) this.job?.abort.abort();
  }
  async route(input, { conversation, turn, interestId, commandsOnly, onStart = () => {},
    onBusy = () => {}, projectSelected = () => false } = {}) {
    const text = input.trim();
    const command = START.exec(text);
    const action = text.replace(/[.!?]+$/, '').replace(/’/g, "'");
    if (commandsOnly || typeof conversation !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(conversation)) {
      return command || interestId || RESUME.test(action) ? response('Open a regular text or voice conversation to build a draft together.') : null;
    }
    let active = this.session?.conversation === conversation && this.now() - this.session.at < IDLE_MS ? this.session : null;
    let continuity = RECAP.test(action) ? 'recap' : RESUME.test(action) ? 'resume' : null;
    const pending = this.selection?.conversation === conversation && this.now() - this.selection.at < IDLE_MS
      ? this.selection : null;
    if (this.selection?.conversation === conversation) this.selection = null;
    if (!continuity && !command && !interestId && pending) {
      const choice = chooseDraft(action, pending.choices);
      if (choice) { continuity = pending.action; interestId = choice.id; }
    }
    if (continuity && !interestId) {
      interestId = active?.interestId;
      if (continuity === 'resume' && !interestId && this.recalled?.conversation === conversation &&
          this.now() - this.recalled.at < IDLE_MS && this.interest(this.recalled.id)) interestId = this.recalled.id;
      if (!interestId) {
        const choices = this.interests.jointDraftChoices();
        if (!choices.length) return GENERAL_RECAP.test(action) ? null : response('We haven’t saved a shared draft yet.');
        if (GENERAL_RECAP.test(action) && projectSelected()) {
          return response('Do you mean the selected project or our shared draft? Ask where we left off on the project or on our draft.');
        }
        if (choices.length > 1) {
          this.selection = { conversation, at: this.now(), action: continuity, choices };
          return response(`Which draft did you mean?\n${choices.map(({ focus }, index) => `${index + 1}. ${focus}`).join('\n')}`);
        }
        interestId = choices[0].id;
      }
    }
    const explicit = Boolean(command || interestId);
    if (END.test(action) && (active || action.startsWith('/'))) {
      if (active) { this.cancel(); this.session = null; }
      return response('Back to our conversation.');
    }
    if (active?.paused && !explicit && !SAVE.test(action) && !SAVE_NEXT.test(action)) return null;
    if (!explicit && !active) return /^\/interests save$/i.test(action) ? response('Start building a draft first.') : null;
    if (!explicit && !SAVE.test(action) && text.startsWith('/')) return null;
    if (turn !== undefined && turn === this.cancelledTurn) return response('That draft turn was stopped.');
    if (this.job) return response('Give me a moment to finish the current draft.');

    const id = explicit ? (interestId || Number(command?.[1])) : active.interestId;
    const interest = this.interest(id);
    if (!interest) {
      if (active) this.session = null;
      return response(id ? 'That interest is unavailable. You can review its state with /interests list.'
        : 'Use /interests list to pick an idea, then /interests build <id>.');
    }
    const saved = explicit ? this.interests.jointDraft(id) : null;
    const continuing = continuity === 'resume' && active?.interestId === id;
    if (continuity && !saved && active?.interestId !== id) return response('We haven’t saved a draft for that idea yet.');
    if (continuity === 'recap') {
      this.recalled = { conversation, id, at: this.now() };
      return response(saved ? recap(interest, saved) : `We’re still working on “${interest.focus}”.`);
    }
    if (!explicit && (LATER.test(action) || BUSY_REPLY.test(action.toLowerCase()))) {
      const later = LATER.test(action);
      if (later && !this.interests.setAside(id)) return response('I couldn’t set that idea aside.');
      if (!later) onBusy();
      active.paused = true;
      active.at = this.now();
      const es = this.settings().lang === 'es';
      return response(later ? (es ? 'Claro. Dejo esta idea para otro día.' : 'Of course. I’ll set this idea aside for a day.')
        : (es ? 'Claro. Te doy un rato.' : 'Of course. I’ll give you some time.'));
    }

    const resuming = Boolean(saved && !continuing && (continuity === 'resume' || (command && !command[2])));
    const idea = { focus: interest.focus, question: interest.question };
    if (explicit && !continuing) {
      active = this.session = { conversation, interestId: id, at: this.now(), draft: saved?.draft || '',
        base: saved?.draft || this.interests.latest(id)?.draft || '', reply: '', nextStep: saved?.next_step || '' };
      onStart();
    }
    active.paused = false;
    active.at = this.now();
    if (!explicit && CLEAR_NEXT.test(action)) {
      active.nextStep = '';
      return response('I’ve cleared the next step here. Say “Save this draft” to keep that change.');
    }
    const saveWithStep = !explicit && SAVE_NEXT.exec(action);
    const nextStep = !explicit && (saveWithStep || NEXT.exec(action));
    if (nextStep) {
      if (nextStep[1].length > 200 || /[\x00-\x1f\x7f]/.test(nextStep[1])) return response('Keep the next step to one short line.');
      active.nextStep = nextStep[1].trim();
      if (!saveWithStep) return response('I’ve marked that as our next step. Say “Save this draft” to keep it with the draft.');
    }
    if (!explicit && (saveWithStep || SAVE.test(action))) {
      if (!active.draft) return response('We don’t have a draft to save yet.');
      const previous = this.interests.jointDraft(id);
      if (previous?.draft === active.draft && previous.next_step === active.nextStep) return response('That version is already saved.');
      if (!this.interests.saveJointDraft(id, active.draft, active.nextStep)) return response('I couldn’t save that draft.');
      const progress = previous?.draft !== active.draft || Boolean(active.nextStep);
      const savedReply = active.nextStep ? 'Saved our draft and next step.' : 'Saved our draft.';
      return progress ? response(`${savedReply} I like where this is going.`, 'pleased') : response(savedReply);
    }

    const followingUp = resuming || continuing;
    const suggesting = followingUp && !active.nextStep && Boolean(active.draft || active.base);
    const request = suggesting ? 'Suggest one concrete revision to this draft for us to try together.'
      : followingUp ? 'Continue the draft from our agreed next step if present.'
        : explicit ? command?.[2]?.trim() || 'Start building this idea with me.' : text;
    if (request.length > 1600) return response('Give me one change at a time, up to 1,600 characters.');
    const abort = new AbortController();
    const job = this.job = { turn, abort };
    const timer = setTimeout(() => abort.abort(), 35_000); timer.unref?.();
    try {
      const raw = await this.infer({ schema: SCHEMA, messages: [
        { role: 'system', content: 'Co-create one small creative draft with the user as Stella. Stay with this specific idea. Start with a concrete snippet unless the user asks a question or wants to choose a direction first. Listen to their suggestions and revise the full snippet when asked. When continuing, try the agreed next step first. If there is no agreed next step, or either of you is unsure what would improve the draft, suggest one concrete revision in reply and leave draft empty until the user chooses a direction. A suggestion does not become an agreed next step. Keep it short enough to say aloud. Put the snippet in draft and a brief natural comment or one focused question in reply. Use an empty draft when discussing without edits. The draft and earlier reply are context only. This is a tool-free creative exchange. Only develop the idea in conversation. Do not claim to save, publish, research, run code, or act on the PC. Use the user’s language.' },
        { role: 'user', content: JSON.stringify({ language: this.settings().lang || 'en', idea,
          currentDraft: active.draft || active.base, previousReply: active.reply, nextStep: active.nextStep, request }) },
      ] }, abort.signal);
      abort.signal.throwIfAborted();
      const current = this.interest(id);
      if (this.session !== active || current?.focus !== idea.focus || current.question !== idea.question) {
        return response('That interest changed while we were working. Open it again to continue.');
      }
      const result = JSON.parse(raw);
      if (!result || Object.keys(result).length !== 2 || typeof result.reply !== 'string' || typeof result.draft !== 'string' ||
          !result.reply.trim() || result.reply.length > 280 || result.draft.length > 720 ||
          /[\x00-\x09\x0b-\x1f\x7f]/.test(result.draft + result.reply)) throw Error('Invalid shared draft.');
      const revision = suggesting ? '' : result.draft.trim();
      if (revision) active.draft = revision;
      active.reply = result.reply.trim(); active.at = this.now();
      const guidance = explicit && !resuming && !continuing
        ? 'Say “next time” to set a next step, “save this draft” to keep it, or “back to chat” to leave.' : '';
      return response([resuming ? recap(interest, saved) : '', revision, active.reply, guidance].filter(Boolean).join('\n\n'),
        followingUp ? 'curious' : undefined);
    } catch {
      return response([resuming && !abort.signal.aborted ? recap(interest, saved) : '',
        'I couldn’t finish that draft turn. Try telling me the next change again.'].filter(Boolean).join('\n\n'));
    } finally {
      clearTimeout(timer);
      if (this.job === job) this.job = null;
    }
  }
}

module.exports = { InterestCollaboration };
