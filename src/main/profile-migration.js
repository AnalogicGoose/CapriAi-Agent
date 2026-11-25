'use strict';
// Her saved data (memory, reminders, settings, goals) moved from her old profile folder to
// Stella's. Copied once into a temporary folder, then renamed into place, so a failure never
// leaves a half profile; the old folder stays as a backup the owner can delete.
const nodeFs = require('node:fs');

const hasData = (fs, dir) => fs.existsSync(dir) && fs.readdirSync(dir).length > 0;

function migrateProfile(oldDir, newDir, fs = nodeFs) {
  if (hasData(fs, newDir) || !hasData(fs, oldDir)) return { migrated: false, dir: newDir };
  const temp = `${newDir}.moving-${process.pid}`;
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.cpSync(oldDir, temp, { recursive: true });
    fs.rmSync(newDir, { recursive: true, force: true }); // an empty leftover only (checked above)
    fs.renameSync(temp, newDir);
    return { migrated: true, dir: newDir };
  } catch (error) {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
    console.error('Stella: could not move her saved data, still using the old folder', error);
    return { migrated: false, dir: oldDir };
  }
}

module.exports = { migrateProfile };
