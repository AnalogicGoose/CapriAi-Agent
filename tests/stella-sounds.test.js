// Stella's sound palette: every motion sound is a real cue, and none of the old pre-Stella sounds are left.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/js/voice.js'), 'utf8');
const cues = JSON.parse(source.match(/export const CUES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));

test('every motion sound names a cue the voice can play', async () => {
  const { MOTION_CUES, MOTIONS } = await import('../src/renderer/js/stella/motions.js');
  for (const [motion, cue] of Object.entries(MOTION_CUES)) {
    assert.ok(MOTIONS[motion], `${motion} is a motion`);
    assert.ok(cues.includes(cue), `${cue} is a cue`);
  }
});

test('the old pre-Stella sounds and harsh waveforms are gone', () => {
  for (const old of ['bolt', 'charge', 'possess', 'star', 'land', 'rise']) assert.ok(!cues.includes(old), old);
  assert.doesNotMatch(source, /'sawtooth'|'square'/);
});

test('every cue has a synth', () => {
  for (const cue of cues) assert.ok(source.includes(`${/-/.test(cue) ? `'${cue}'` : cue}: () => this.`), cue);
});
