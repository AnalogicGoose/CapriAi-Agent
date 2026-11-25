'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deliveryPlan, reminderLine, HeldReminders } = require('../src/main/reminder-delivery');

test('fullscreen and gaming are voice-only when voice is on and hold the card', () => {
  for (const mode of [{ fullscreen: true }, { gaming: true }, { fullscreen: true, gaming: true }]) {
    assert.deepEqual(deliveryPlan({ ...mode, overlayAvailable: true, voiceOn: true }), { speak: true, card: 'held' });
  }
});

test('muted or voice off holds the card silently', () => {
  assert.deepEqual(deliveryPlan({ fullscreen: true, overlayAvailable: true, voiceOn: false }), { speak: false, card: 'held' });
  assert.deepEqual(deliveryPlan({ gaming: true, overlayAvailable: true, voiceOn: false }), { speak: false, card: 'held' });
  assert.deepEqual(deliveryPlan({ overlayAvailable: false, voiceOn: false }), { speak: false, card: 'held' });
  assert.deepEqual(deliveryPlan({ overlayAvailable: true, voiceOn: false }), { speak: false, card: 'now' });
  assert.deepEqual(deliveryPlan({ overlayAvailable: true, voiceOn: true }), { speak: true, card: 'now' });
  assert.deepEqual(deliveryPlan({ overlayAvailable: false, voiceOn: true }), { speak: true, card: 'held' });
});

test('quiet trial and paused check-ins do not appear in the policy inputs', () => {
  assert.equal(deliveryPlan.length, 1);
  const input = new Proxy({ overlayAvailable: true, voiceOn: true }, {
    get(t, k) {
      assert.notEqual(k, 'proactiveEnabled');
      return t[k];
    },
  });
  assert.deepEqual(deliveryPlan(input), { speak: true, card: 'now' });
});

test('lines exist in five languages for normal and missed', () => {
  const firedDue = new Date(2026, 10, 23, 9, 5).getTime();
  for (const lang of ['en', 'es', 'fr', 'pt', 'ru']) {
    const normal = reminderLine({ text: 'call mom' }, { lang });
    const missed = reminderLine({ text: 'call mom', fired_due: firedDue }, { missed: true, lang });
    assert.ok(normal.includes('call mom'), lang);
    assert.ok(missed.includes('call mom') && missed.includes('09:05'), lang);
    assert.notEqual(normal, missed);
    assert.ok(!/stella/i.test(normal + missed));
  }
  assert.equal(reminderLine({ text: 'x' }, { lang: 'xx' }), reminderLine({ text: 'x' }, { lang: 'en' }));
  assert.ok(reminderLine({ text: 'x', fired_due: firedDue }, { missed: true, lang: 'en', firedDue: new Date(2026, 10, 23, 18, 30).getTime() }).includes('18:30'));
});

test('held cards flush oldest first and collapse beyond five', () => {
  const held = new HeldReminders();
  for (let i = 1; i <= 7; i++) held.add({ id: i, firedDue: i });
  held.add({ id: 3, firedDue: 3 });
  let got;
  held.flush((r) => { got = r; });
  assert.deepEqual(got.reminders.map((r) => r.id), [1, 2, 3, 4]);
  assert.equal(got.more, 3);
  let again = 0;
  held.flush(() => { again++; });
  assert.equal(again, 0);
  held.add({ id: 9, firedDue: 1 });
  held.add({ id: 10, firedDue: 2 });
  held.flush((r) => { got = r; });
  assert.deepEqual(got, { reminders: [{ id: 9, firedDue: 1 }, { id: 10, firedDue: 2 }], more: 0 });
});
