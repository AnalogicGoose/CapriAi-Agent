// Her reminder cards from main (reminder-controller.js), one at a time. A card stays in this queue until it is acted on
// (Done / Snooze, by button or voice) or the user dismisses it / lets it time out. If anything else takes it off the
// panel (another message, a permission prompt clearing alerts), it goes back to the front of the queue and shows again
// once the panel is free. Each time a card is actually shown, main is told (reminderShown), which opens the 30 s
// window for the voice replies "done" / "snooze".
const USER_GONE = new Set(['user', 'timeout']);

export class ReminderCards {
  // panel: Panel; host: preload bridge; blocked(): a chat, voice call, permission prompt or menu owns her attention;
  // speak(line, grant): her voice with a one-time grant.
  constructor({ panel, host, blocked = () => false, speak = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, retryMs = 3000 }) {
    Object.assign(this, { panel, host, blocked, speak, setTimer, clearTimer, retryMs });
    this.queue = [];
    this.open = null; // the card on the panel
    this.retry = null;
  }

  receive(message) {
    if (!message || typeof message.line !== 'string' || !message.line || message.line.length > 400) return;
    if (message.type === 'speak') { if (typeof message.grant === 'string') this.speak(message.line, message.grant); return; }
    if (message.type === 'resolved') { this.resolved(message, message.line); return; }
    if (message.type === 'card') {
      if (!Number.isSafeInteger(message.id) || !Number.isFinite(message.firedDue) || !Array.isArray(message.actions) || !Array.isArray(message.snooze)) return;
      if (this.queue.some(card => same(card, message)) || same(this.open, message)) return;
      if (message.speak && typeof message.grant === 'string') this.speak(message.line, message.grant);
    } else if (message.type !== 'more') return;
    this.queue.push({ ...message });
    this.show();
  }

  // Free means: nothing owns her attention, and the panel is empty or shows a passing info line (a card that was
  // displaced waits for an empty panel, so it never ping-pongs with what displaced it).
  free(card) {
    if (this.blocked()) return false;
    const cur = this.panel.visible ? this.panel.current : null;
    if (!cur || cur.reminder) return true;
    return !card.requeued && ['info', 'idle'].includes(cur.kind);
  }

  show() {
    this.clearTimer(this.retry); this.retry = null;
    if (this.open && this.panel.visible && this.panel.current?.reminder === this.open) return;
    const next = this.queue[0];
    if (!next) return;
    if (!this.free(next) || !this.panel.say(this.message(next))) { this.retry = this.setTimer(() => this.show(), this.retryMs); return; }
    this.queue.shift();
    this.open = next;
    if (next.type === 'card') this.host.reminderShown?.(next.id, next.firedDue);
  }

  message(card) {
    const onLeave = reason => this.left(card, reason);
    if (card.type === 'more') return { kind: 'alert', line: card.line, hold: 15000, reminder: card, onLeave };
    return { kind: 'alert', line: card.line, hold: 120000, reminder: card, onLeave,
      actions: this.mainActions(card), onAction: id => this.action(card, id) };
  }

  mainActions(card) { return card.actions.map(({ id, label }) => ({ id, label, primary: id === 'done' })); }

  action(card, id) {
    if (id === 'done') return this.act(card, 'done');
    if (id === 'snooze10') return this.act(card, 'snooze', 10);
    if (id === 'snooze') {
      this.panel.setActions(card.snooze.map(({ label }, i) => ({ id: `s${i}`, label })),
        choice => this.act(card, 'snooze', card.snooze[Number(choice.slice(1))]?.minutes));
    }
  }

  async act(card, action, minutes) {
    let result = null;
    try { result = await this.host.reminderAction(card.id, action, card.firedDue, minutes); } catch { /* reported below */ }
    if (result?.ok || result?.gone) { this.resolved(card, result.text); return; }
    // Failed: keep the card, back on its main buttons, with a short line saying so.
    if (this.panel.current?.reminder === card) {
      this.panel.setActions(this.mainActions(card), id => this.action(card, id));
      this.panel.setActivity(typeof card.failed === 'string' ? card.failed : '');
    }
  }

  // Acted on (here or by voice): the card goes for good, with her short acknowledgement when nothing else waits.
  resolved(ref, text) {
    const index = this.queue.findIndex(card => same(card, ref));
    if (index >= 0) this.queue.splice(index, 1);
    const shown = this.panel.current?.reminder;
    if (shown && same(shown, ref)) { shown.handled = true; this.panel.hide('acted'); }
    if (this.open && same(this.open, ref)) { this.open.handled = true; this.open = null; }
    if (typeof text === 'string' && text && !this.queue.length) this.panel.say({ kind: 'info', line: text.slice(0, 320), hold: 2500 });
    this.show();
  }

  left(card, reason) {
    if (this.open === card) this.open = null;
    if (!card.handled && !USER_GONE.has(reason) && !this.queue.includes(card)) {
      card.requeued = true;
      this.queue.unshift(card);
    }
    this.clearTimer(this.retry);
    this.retry = this.setTimer(() => this.show(), 400);
  }
}

function same(a, b) { return Boolean(a && b && a.type !== 'more' && a.id === b.id && a.firedDue === b.firedDue); }
