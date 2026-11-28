'use strict';

// Only preferences represented by the settings UI may cross this boundary.
function settingsPatch(input, displays = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid settings.');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'preferredBrowser' && ['Firefox', 'system', 'Google Chrome', 'Microsoft Edge', 'Brave'].includes(value)) { result[key] = value; continue; }
    if (key === 'crunchyrollProfile' && typeof value === 'string' && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value)) { result[key] = value.trim(); continue; }
    if (['routinesEnabled', 'projectCuriosityEnabled', 'dailyReviewEnabled', 'dailyReviewNotify', 'proactiveEnabled', 'proactiveVoice', 'checkInReplies', 'cognitiveEnabled', 'interestsEnabled', 'wakeWordEnabled', 'systemAccess', 'screenAwareness', 'autonomyEnabled', 'autonomyScreen', 'ttsEnabled', 'speakTypedReplies', 'muted', 'wander', 'windowTracking', 'idleAnimations', 'cursorInteractions', 'personality', 'dailyRoutine', 'surpriseAnimations'].includes(key) && typeof value === 'boolean') result[key] = value;
    else if (key === 'ttsEngine' && ['windows', 'qwen', 'chatterbox', 'f5'].includes(value)) result[key] = value;
    else if (key === 'ttsDevice' && ['cpu', 'cuda'].includes(value)) result[key] = value;
    else if (['ttsPython', 'ttsModel', 'ttsReference', 'ttsReferenceText'].includes(key) && typeof value === 'string' && value.length <= 2000 && !value.includes('\0')) result[key] = value;
    else if (['codexExecutable', 'codexModel'].includes(key) && typeof value === 'string' && value.length <= 2000 && !value.includes('\0')) result[key] = value;
    else if (key === 'codexEffort' && ['low', 'medium', 'high', 'xhigh'].includes(value)) result[key] = value;
    else if (key === 'autonomyIntervalSeconds' && [60, 90, 180, 300].includes(value)) result[key] = value;
    else if (key === 'scale' && [0.45, 0.6, 0.8].includes(value)) result[key] = value;
    else if (key === 'volume' && Number.isFinite(value) && value >= 0 && value <= 1) result[key] = value;
    else if (key === 'lang' && ['auto', 'en', 'es', 'fr', 'pt', 'ru'].includes(value)) result[key] = value;
    else if (key === 'displayId' && (value === null || displays.some(d => d.id === value))) result[key] = value;
    else if (key === 'privacy' && value && typeof value === 'object' && !Array.isArray(value)) {
      result.privacy = {};
      for (const [name, setting] of Object.entries(value)) {
        if (['memoryEnabled', 'memoryCandidates', 'memoryLearn', 'memoryRecall', 'memoryConfirmChanges', 'contextTime', 'contextPower', 'contextForeground', 'contextTitles', 'contextProcesses', 'contextPerformance', 'contextEvents'].includes(name) && typeof setting === 'boolean') result.privacy[name] = setting;
        else if (name === 'retentionDays' && [0, 30, 90, 365].includes(setting)) result.privacy[name] = setting;
        else throw Error('Unknown privacy setting.');
      }
    } else throw Error('Unknown or invalid preference.');
  }
  return result;
}
// Renderer-owned state is separate from control-room and model tool settings.
function overlayPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid settings.');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (['visible', 'welcomed'].includes(key) && typeof value === 'boolean') result[key] = value;
    else if (key === 'stellaAnchor' && (value === null || (value && typeof value === 'object' && !Array.isArray(value)
      && Number.isFinite(value.x) && Number.isFinite(value.y)))) result.stellaAnchor = value && { x: Math.round(value.x), y: Math.round(value.y) };
    else throw Error('Unknown or invalid preference.');
  }
  return result;
}
module.exports = { settingsPatch, overlayPatch };
