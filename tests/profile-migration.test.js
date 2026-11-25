'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { migrateProfile } = require('../src/main/profile-migration');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stella-profile-'));

test('copies the old profile, subfolders included, and keeps the old one as a backup', () => {
  const root = tmp(), from = path.join(root, 'CapriGPT'), to = path.join(root, 'Stella');
  fs.mkdirSync(path.join(from, 'sounds'), { recursive: true });
  fs.writeFileSync(path.join(from, 'personal-memory.sqlite'), 'memory');
  fs.writeFileSync(path.join(from, 'sounds', 'a.wav'), 'wav');
  assert.deepEqual(migrateProfile(from, to), { migrated: true, dir: to });
  assert.equal(fs.readFileSync(path.join(to, 'personal-memory.sqlite'), 'utf8'), 'memory');
  assert.equal(fs.readFileSync(path.join(to, 'sounds', 'a.wav'), 'utf8'), 'wav');
  assert.ok(fs.existsSync(path.join(from, 'personal-memory.sqlite')));
});

test('never touches a Stella profile that already has data', () => {
  const root = tmp(), from = path.join(root, 'CapriGPT'), to = path.join(root, 'Stella');
  fs.mkdirSync(from); fs.mkdirSync(to);
  fs.writeFileSync(path.join(from, 'config.json'), 'old');
  fs.writeFileSync(path.join(to, 'config.json'), 'new');
  assert.deepEqual(migrateProfile(from, to), { migrated: false, dir: to });
  assert.equal(fs.readFileSync(path.join(to, 'config.json'), 'utf8'), 'new');
});

test('no old profile: nothing to move', () => {
  const root = tmp(), to = path.join(root, 'Stella');
  assert.deepEqual(migrateProfile(path.join(root, 'CapriGPT'), to), { migrated: false, dir: to });
});

test('a failed copy leaves no half profile and keeps using the old one', () => {
  const root = tmp(), from = path.join(root, 'CapriGPT'), to = path.join(root, 'Stella');
  fs.mkdirSync(from); fs.writeFileSync(path.join(from, 'config.json'), 'old');
  const failing = { ...fs, cpSync() { fs.mkdirSync(arguments[1], { recursive: true }); throw Error('disk full'); } };
  assert.deepEqual(migrateProfile(from, to, failing), { migrated: false, dir: from });
  assert.equal(fs.existsSync(to), false);
  assert.deepEqual(fs.readdirSync(root), ['CapriGPT']);
});
