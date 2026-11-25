'use strict';
const fs = require('node:fs');
const { CodexClient } = require('./codex-client');
const { executable } = require('./codex-runtime');
const { PERSONA } = require('./personality');
const { readDeliveryPrefix, INSTRUCTIONS: VOICE_DELIVERY } = require('./voice-delivery');

const MAX_WARM_TURNS = 24;
const THREAD_RELEASE_TIMEOUT = 400;
const SCREEN_LOOKS = new Set(['capri_window_controls', 'capri_screen', 'capri_point', 'capri_point_on_snapshot', 'capri_draw']);

function packContext(data, budget = 16000) {
  const packed = Object.create(null), omitted = [];
  const priority = ['namedRoutineInvocation', 'savedTaskInvocation', 'automaticMemory', 'topicRecaps', 'currentProject', 'savedContinuity', 'savedGoals', 'personalMemory', 'companionInterests', 'presentation', 'capabilities'];
  const keys = [...new Set([...priority, ...Object.keys(data)])].filter(key => Object.hasOwn(data, key));
  // Reserve room to report omissions; never slice JSON or split a saved record.
  const fits = (key, value) => Buffer.byteLength(JSON.stringify({ ...packed, [key]: value })) <= budget - 1000;
  for (const key of keys) {
    if (fits(key, data[key])) packed[key] = data[key];
    else if (Array.isArray(data[key])) {
      packed[key] = [];
      for (const value of data[key]) if (fits(key, [...packed[key], value])) packed[key].push(value);
      omitted.push(key);
    } else omitted.push(key);
  }
  if (omitted.length) packed.omittedContextFields = omitted.slice(0, 12).map(key => key.slice(0, 60));
  return JSON.stringify(packed);
}

function routineReply(receipt) {
  const { routine, status, finished_steps: finished, total_steps: total, reason } = receipt;
  return `Routine “${routine}” ${status} after ${finished}/${total} steps.${reason ? '\n' + reason : ''}\nSay “Resume routine ${routine}” to continue at step ${finished + 1}. Check any partial effects from that step before retrying.`;
}

class CodexBrain {
  constructor({ settings, cwd, tools, recentConversation, systemTools = () => false, workspace, context = () => ({}), approve = async () => false, onOutcome = () => {},
    clientFactory = options => new CodexClient(options), locate = executable, warmIdleMs = 0, canKeepWarm = () => true }) {
    Object.assign(this, { settings, cwd, tools, recentConversation, clientFactory, locate, systemTools, workspace, context, approve, onOutcome, warmIdleMs, canKeepWarm });
    this.history = []; this.epoch = 0; this.busy = false; this.lastStatus = null;
  }
  createClient(nativeTools = this.systemTools(), warmThreads = false) {
    fs.mkdirSync(this.cwd, { recursive: true });
    return this.clientFactory({ executable: this.locate(this.settings().codexExecutable), cwd: this.cwd, nativeTools, warmThreads });
  }
  dropWarmClient() {
    const parked = this.warmClient;
    if (!parked) return;
    this.warmClient = null;
    clearTimeout(parked.timer);
    parked.client.close();
  }
  parkClient(client, key, turns) {
    const parked = { client, key, turns, expires: Date.now() + this.warmIdleMs };
    this.warmClient = parked;
    parked.timer = setTimeout(() => this.dropWarmClient(), this.warmIdleMs);
    parked.timer.unref?.();
    client.onFailure = () => { if (this.warmClient === parked) this.dropWarmClient(); };
  }
  withRecentConversation(use, create = false) {
    try {
      const store = this.recentConversation?.(create);
      if (store) return use(store);
    } catch { console.error('[capri] Recent conversation storage unavailable.'); }
  }
  discardHistory(keepRecent = false) {
    this.history = [];
    if (!keepRecent) this.withRecentConversation(store => store.clear());
  }
  reset({ keepRecent = false } = {}) {
    this.discardHistory(keepRecent);
    this.tools.reset?.();
    this.tools.consumeHistoryReset?.();
  }
  cancel() {
    this.epoch++;
    this.dropWarmClient();
    if (this.client && this.threadId && this.turnId) {
      // Interrupt before closing stdio so Codex can cancel owned commands too.
      this.stopping = Promise.race([
        this.client.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }).catch(() => {}),
        new Promise(resolve => { const timer = setTimeout(resolve, 500); timer.unref?.(); }),
      ]);
    }
    this.abort?.abort();
    if (!this.stopping) this.client?.close(); this.tools.cancel?.();
  }
  async inspect(client) {
    const account = await client.request('account/read', { refreshToken: false });
    if (!account.account && account.requiresOpenaiAuth !== false) throw Error('Sign in with the Codex CLI first: codex login.');
    let data = [], cursor = null;
    for (let page = 0; page < 5; page++) {
      const result = await client.request('model/list', { limit: 50, includeHidden: false, ...(cursor ? { cursor } : {}) });
      data.push(...(result.data || [])); cursor = result.nextCursor; if (!cursor) break;
    }
    const selected = this.settings().codexModel;
    const model = selected ? data.find(row => row.id === selected || row.model === selected)
      : data.find(row => row.isDefault) || data[0];
    if (!model) throw Error(selected ? 'Selected Codex model is unavailable to this account.' : 'No Codex models are available to this account.');
    const modelName = model.model || model.id;
    this.lastStatus = { ok: true, backend: 'codex', model: modelName,
      models: data.map(row => ({ id: row.model || row.id })), account: account.account?.type || 'provider',
      cloud: true, verifiedInference: false };
    return { model, modelName };
  }
  async status() {
    if (this.settings().gamingMode) return { ok: false, backend: 'codex', error: 'Gaming mode: resume from the control room.' };
    if (this.busy) return this.lastStatus || { ok: false, backend: 'codex', error: 'Codex is connecting.' };
    let client;
    try { client = this.createClient(); await client.start(); await this.inspect(client); return this.lastStatus; }
    catch (error) { return { ok: false, backend: 'codex', error: error.message }; }
    finally { client?.close(); }
  }
  async chat(text, onDelta = () => {}, onProgress = () => {}, options = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw Error('Use a message up to 12000 characters.');
    if (this.busy) throw Error('One Capri request at a time.');
    if (this.settings().gamingMode) throw Error('Gaming mode is on.');
    let savedTask = this.tools.resumeTask?.(text);
    if (savedTask?.message) return savedTask.message;
    let resolveSavedTask = () => this.tools.resumeTask?.(text);
    const nativeTools = this.systemTools() && !this.tools.teachingOnly?.(text);
    const workspace = nativeTools ? (typeof this.workspace === 'function' ? this.workspace() : this.workspace) : null;
    const retainClient = this.warmIdleMs > 0 && this.canKeepWarm();
    const clientKey = JSON.stringify([this.settings().codexExecutable || '', nativeTools, workspace]);
    let parked = this.warmClient;
    if (parked && (!retainClient || parked.key !== clientKey || parked.client.closed || Date.now() >= parked.expires)) {
      this.dropWarmClient(); parked = null;
    }
    if (parked) { clearTimeout(parked.timer); this.warmClient = null; }
    const client = parked?.client || this.createClient(nativeTools, retainClient);
    let completed = false;
    this.stopping = null;
    this.busy = true; const epoch = ++this.epoch;
    this.abort = new AbortController(); const signal = this.abort.signal;
    this.client = client;
    const diagnostics = this.lastDiagnostics = { calls: 0, completed: 0, errors: [], rejectedMethods: [] };
    const nativeItems = new Map();
    const completedCommands = new Map();
    const commentaryItems = new Set();
    let finish, fail, textOut = '', completedText = '', streamItemId, toolQueue = Promise.resolve(), calls = 0, routineTurn = false;
    const partialAnswers = [];
    const useDelivery = typeof options.onDelivery === 'function' && !options.outputSchema;
    let voicePrefix = '', streamedDelivery;
    const stream = delta => {
      if (!useDelivery || streamedDelivery) return onDelta(delta);
      voicePrefix += delta;
      const parsed = readDeliveryPrefix(voicePrefix);
      if (!parsed) return;
      streamedDelivery = parsed.style; voicePrefix = '';
      options.onDelivery(streamedDelivery);
      if (parsed.text) onDelta(parsed.text);
    };
    let actionHistory = [], nativeRoutineFailure = false;
    const dedupe = new Map();
    const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    result.catch(() => {}); // A process can fail while initialize is still pending.
    const check = () => {
      signal.throwIfAborted();
      if (epoch !== this.epoch || this.settings().gamingMode) throw Error('Request stopped.');
      if (savedTask && JSON.stringify(resolveSavedTask()) !== JSON.stringify(savedTask))
        throw Error('The saved task, project or recall permission changed. Ask to resume again.');
    };
    const activateSavedTask = (task, resolve) => {
      if (task.workspace && nativeTools && workspace !== task.workspace) throw Error('The saved task workspace changed.');
      savedTask = task; resolveSavedTask = resolve;
    };
    const stop = () => { fail(Error('Request stopped. Completed actions may remain.')); if (!this.stopping) client.close(); };
    signal.addEventListener('abort', stop, { once: true });
    let timer = setTimeout(() => this.cancel(), nativeTools ? 600000 : 180000);
    const trackRoutine = active => {
      if (!active || routineTurn) return;
      routineTurn = true;
      if (!nativeTools) { clearTimeout(timer); timer = setTimeout(() => this.cancel(), 600000); }
    };
    this.threadId = this.turnId = null;
    client.onFailure = fail;
    client.onNotification = (method, params) => {
      if (epoch !== this.epoch || !this.threadId || params.threadId !== this.threadId) return;
      if (method === 'turn/started') { this.turnId = params.turn.id; return; }
      if (params.turnId && params.turnId !== this.turnId) return;
      if (nativeTools && params.item?.id && (method === 'item/started' || method === 'item/completed')) nativeItems.set(params.item.id, params.item);
      if (nativeTools && method === 'item/completed' && params.item?.id && params.item.type === 'commandExecution') completedCommands.set(params.item.id, params.item);
      if (nativeTools && method === 'item/completed' && params.item?.id && ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'imageView'].includes(params.item.type)) {
        try {
          const stopped = this.tools.observeNative?.(params.item, workspace);
          if (stopped) { nativeRoutineFailure = true; fail(Error(stopped)); this.cancel(); return; }
        } catch (error) { fail(error); this.cancel(); return; }
      }
      if (method === 'item/started' && params.item?.type === 'agentMessage' && params.item.phase === 'commentary') commentaryItems.add(params.item.id);
      if (method === 'item/agentMessage/delta') {
        if (typeof params.delta === 'string' && !commentaryItems.has(params.itemId)) {
          const separator = params.itemId && streamItemId && params.itemId !== streamItemId && partialAnswers.length ? '\n\n' : '';
          streamItemId = params.itemId;
          const delta = separator + params.delta;
          textOut += delta; if (textOut.length > 100000) return this.cancel(); stream(delta);
        }
      } else if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') {
        if (params.item.phase === 'partial_answer' && params.item.text && !options.outputSchema) partialAnswers.push(params.item.text);
        else completedText = params.item.text || completedText;
      }
      else if (method === 'item/started' && params.item?.type === 'dynamicToolCall') onProgress(`Using ${params.item.tool}.`);
      else if (method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'imageView', 'collabAgentToolCall'].includes(params.item?.type)) {
        if (!nativeTools) { fail(Error('Codex attempted a tool outside Capri’s configured tool boundary. Request stopped.')); this.cancel(); }
        else onProgress(`Codex: ${params.item.type}.`);
      } else if (method === 'turn/completed') {
        if (this.turnId && params.turn?.id !== this.turnId) return;
        if (params.turn?.status === 'completed') finish();
        else fail(Error(params.turn?.error?.message || 'Codex turn stopped or failed.'));
      }
    };
    client.onRequest = message => {
      if (nativeTools && ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(message.method)) {
        return (async () => {
          let accepted = false;
          try {
            check();
            if (message.params?.threadId !== this.threadId || message.params?.turnId !== this.turnId) throw Error('Stale approval request.');
            accepted = await this.approve(message, { text, signal, item: nativeItems.get(message.params.itemId) }); check();
          } catch { accepted = false; }
          client.respond(message.id, message.method === 'item/permissions/requestApproval'
            ? { permissions: accepted === true ? message.params.permissions : {}, scope: 'turn', strictAutoReview: true }
            : { decision: accepted === true ? 'accept' : 'decline' });
        })();
      }
      if (message.method !== 'item/tool/call') {
        if (!diagnostics.rejectedMethods.includes(message.method)) diagnostics.rejectedMethods.push(message.method);
        client.respond(message.id, null, { code: -32601, message: 'This Capri client does not grant external approvals or tools.' });
        return;
      }
      toolQueue = toolQueue.then(async () => {
        const p = message.params;
        try {
          check();
          if (!p || p.threadId !== this.threadId || !this.turnId || p.turnId !== this.turnId || typeof p.callId !== 'string' || !p.callId || (p.namespace && p.namespace !== 'capri')) throw Error('Stale or invalid tool request.');
          const fingerprint = JSON.stringify([p.tool, p.arguments]);
          let receipt = dedupe.get(p.callId);
          if (receipt && receipt.fingerprint !== fingerprint) throw Error('Conflicting duplicate tool call.');
          if (!receipt) {
            if (++calls > (nativeTools || routineTurn ? 40 : 10)) throw Error('Capri tool budget exceeded.');
            diagnostics.calls++;
            onProgress(`Using ${p.tool}.`);
            const value = await this.tools.run(p.tool, p.arguments, {
              text, history: actionHistory, savedTask, activateSavedTask, signal, check, progress: onProgress, turn: options.turn });
            trackRoutine(this.tools.routineSession);
            check(); receipt = { fingerprint, value }; dedupe.set(p.callId, receipt);
            diagnostics.completed++;
          }
          const { image, ...metadata } = receipt.value && typeof receipt.value === 'object' ? receipt.value : { result: receipt.value };
          const serialized = JSON.stringify(metadata);
          if (Buffer.byteLength(serialized) > 48000) throw Error('Tool result is too large; narrow the request.');
          const contentItems = [{ type: 'inputText', text: serialized }];
          if (image) {
            if (typeof image !== 'string' || !/^data:image\/(?:jpeg|png);base64,/.test(image) || image.length > 3000000) throw Error('Invalid screen image.');
            contentItems.push({ type: 'inputImage', imageUrl: image });
          }
          client.respond(message.id, { success: true, contentItems });
        } catch (error) {
          // Session-only diagnostics contain no prompts, arguments or receipts.
          diagnostics.errors.push({ tool: typeof p?.tool === 'string' ? p.tool : 'unknown', message: error.message });
          onProgress(`Local tool failed: ${error.message}`);
          client.respond(message.id, { success: false, contentItems: [{ type: 'inputText', text: error.message }] });
        }
      });
      return toolQueue;
    };
    try {
      const namedRoutineInvocation = savedTask ? null : this.tools.beginTurn?.(text);
      if (namedRoutineInvocation?.message) return namedRoutineInvocation.message;
      trackRoutine(namedRoutineInvocation);
      if (!parked) await client.start();
      check();
      const { model, modelName } = await this.inspect(client); check();
      const effective = await client.request('config/read', { includeLayers: false }); check();
      const mcp = Object.fromEntries(Object.keys(effective.config?.mcp_servers || {}).map(key => [key, { enabled: false }]));
      const started = await client.request('thread/start', { cwd: workspace || this.cwd, model: modelName,
        ephemeral: true, sandbox: nativeTools ? 'workspace-write' : 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', environments: [],
        baseInstructions: PERSONA, developerInstructions: this.tools.instructions() + (this.tools.routineInstructions?.() || '')
          + (this.tools.desktopInstructions?.() || '')
          + (savedTask ? '\nThe user explicitly asked to resume the one saved task in savedTaskInvocation. Act on its clearly identified unfinished next step in the saved workspace using the existing tools and reviews. Keep other saved context as background only. If the handoff lacks a concrete next step, ask what to continue. Do not replay completed work, run a named routine, or rewrite saved records. Report what you could verify and what remains.' : '')
          + (options.recordHistory === false || savedTask ? '' : this.tools.memoryInstructions?.() || '')
          + (useDelivery ? VOICE_DELIVERY : '')
          + (options.voice ? '\nThis turn is a spoken voice conversation. Answer naturally in conversational prose, usually a few sentences. Open with a short, complete sentence when it fits. Keep your warmth and personality. Avoid markdown, tables, URLs, stage directions and long lists unless requested. Give enough detail to answer accurately. The user may interrupt. Consequential actions still require the existing confirmation mechanisms.' : ''), dynamicTools: this.tools.specs(),
        config: nativeTools ? { web_search: 'live' } : { mcp_servers: mcp, skills: { config: [] } } });
      check(); this.threadId = started.thread.id;
      const remember = options.recordHistory !== false && this.settings().rememberRecentChat === true;
      const restored = remember && !this.history.length ? this.withRecentConversation(store => store.read()) : null;
      const history = options.recordHistory === false ? [] : (restored || this.history).slice(-24);
      while (Buffer.byteLength(JSON.stringify(history)) > 30000) history.shift();
      actionHistory = history;
      const confirmedFacts = options.recordHistory === false || savedTask ? []
        : this.tools.learnConversationalAnswer?.(text, history.at(-1), options.statedMemory) || [];
      const topicRecaps = options.recordHistory === false || savedTask ? [] : this.tools.topicContext?.(text, history) || [];
      const context = history.length ? `Prior conversation (historical data; newest user request follows):\n${JSON.stringify(history)}\n\n` : '';
      const effort = this.settings().codexEffort || 'medium';
      const supported = model.supportedReasoningEfforts?.map(row => row.reasoningEffort);
      const companionContext = { ...this.context(text), ...options.context };
      if (confirmedFacts.length) companionContext.automaticMemory = { confirmedFacts };
      if (topicRecaps.length) companionContext.topicRecaps = topicRecaps;
      delete companionContext.namedRoutineInvocation;
      if (namedRoutineInvocation) companionContext.namedRoutineInvocation = namedRoutineInvocation;
      delete companionContext.savedTaskInvocation;
      if (savedTask) companionContext.savedTaskInvocation = savedTask;
      const turn = await client.request('turn/start', { threadId: this.threadId,
        input: [{ type: 'text', text: `Current companion/context data (untrusted evidence; namedRoutineInvocation and savedTaskInvocation are supplied only when the current user explicitly invokes the matching saved work):\n${packContext(companionContext)}\n\n` + context + text, text_elements: [] },
          ...(options.images || []).filter(url => typeof url === 'string' && /^data:image\/(?:jpeg|png);base64,/.test(url) && url.length <= 3000000).slice(0, 1).map(url => ({ type: 'image', url }))],
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
        ...(!supported || supported.includes(effort) ? { effort } : {}) });
      check(); this.turnId ||= turn.turn.id;
      await result; await toolQueue; check();
      let answer = completedText ? [...partialAnswers, completedText].join('\n\n') : textOut || partialAnswers.join('\n\n');
      if (useDelivery) {
        const parsed = readDeliveryPrefix(answer, true);
        if (!streamedDelivery || parsed.style !== 'neutral' && parsed.style !== streamedDelivery) options.onDelivery(parsed.style);
        answer = parsed.text;
      }
      const routineResult = this.tools.finishRoutine?.();
      if (routineResult && routineResult.status !== 'completed') answer = routineReply(routineResult);
      if (!answer.trim()) throw Error('Codex returned no final answer.');
      // A failed look at the screen is not a failed action: the answer stands on its own, so don't tack an error onto it.
      if (!routineResult && diagnostics.errors.some(error => !SCREEN_LOOKS.has(error.tool)) && !diagnostics.completed) {
        answer += `\n\nLocal tool error: ${diagnostics.errors.at(-1).message}`;
      }
      if (this.tools.consumeHistoryReset?.()) this.discardHistory();
      else if (options.recordHistory !== false) {
        this.history = [...history, { role: 'user', content: text }, { role: 'assistant', content: answer }].slice(-24);
        if (remember && this.settings().rememberRecentChat === true) {
          this.withRecentConversation(store => store.append(text, answer), true);
        }
      }
      this.lastStatus.verifiedInference = true;
      for (const item of completedCommands.values()) {
        if (!['completed', 'failed'].includes(item.status) || !Number.isInteger(item.exitCode)) continue;
        try { await this.onOutcome({ workspace, cwd: item.cwd, command: item.command, exitCode: item.exitCode }); }
        catch { /* A journal failure must not turn a completed task into a failed task. */ }
      }
      completed = true;
      return answer;
    } catch (error) {
      if (routineTurn && (nativeRoutineFailure || !signal.aborted)) {
        const receipt = this.tools.finishRoutine?.();
        if (receipt && receipt.status !== 'completed') return routineReply({ ...receipt,
          reason: receipt.reason || String(error.message || 'I couldn’t finish the run.').slice(0, 200) });
      }
      throw error;
    } finally {
      if (this.tools.consumeHistoryReset?.()) this.discardHistory();
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      await this.stopping;
      const threadId = this.threadId;
      this.threadId = this.turnId = null;
      client.onFailure = client.onNotification = () => {};
      client.onRequest = ({ id }) => client.respond(id, null, { code: -32603, message: 'No Capri turn is active.' });
      const turns = (parked?.turns || 0) + 1;
      let released = false;
      if (completed && threadId && retainClient && this.canKeepWarm() && epoch === this.epoch && !client.closed && turns < MAX_WARM_TURNS) {
        try {
          const result = await client.request('thread/unsubscribe', { threadId }, THREAD_RELEASE_TIMEOUT);
          released = ['unsubscribed', 'notLoaded', 'notSubscribed'].includes(result?.status);
        } catch { /* Older servers and unhealthy connections fall back to a fresh process. */ }
      }
      if (released && epoch === this.epoch && this.canKeepWarm() && !client.closed) this.parkClient(client, clientKey, turns);
      else client.close();
      this.tools.endTurn?.(); this.client = null; this.busy = false;
      this.stopping = this.abort = null;
    }
  }
}
module.exports = { CodexBrain, PERSONA };
