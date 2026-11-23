'use strict';

const STYLES = ['neutral', 'playful', 'comforting', 'pleased', 'curious'];
const PREFIX = '[[voice:';
const INSTRUCTIONS = '\nFor the spoken delivery of your visible answer, start with exactly one private marker such as [[voice: neutral]], then write your normal answer. Choose playful for mutually invited banter, comforting for a request for comfort or a difficult moment, pleased for a real milestone or shared progress, curious for genuine exploration, and neutral for ordinary tasks, unclear tone or serious factual work. Match the wording and pacing to that delivery. Keep the style subtle, and never mention the marker.';

function deliveryStyle(value) {
  return STYLES.includes(value) ? value : 'neutral';
}

function readDeliveryPrefix(text, final = false) {
  const lead = text.trimStart().toLowerCase();
  if (!final && text.length < 80 && (PREFIX.startsWith(lead) || lead.startsWith(PREFIX) && !lead.includes(']]'))) return null;
  const match = /^\s*\[\[voice:\s*([a-z]+)\s*\]\]\s*/i.exec(text);
  return match ? { style: deliveryStyle(match[1].toLowerCase()), text: text.slice(match[0].length) }
    : { style: 'neutral', text: lead.startsWith(PREFIX) ? text.replace(/^\s*\[\[voice:[^\r\n]*(?:\r?\n|$)/i, '') : text };
}

module.exports = { deliveryStyle, readDeliveryPrefix, INSTRUCTIONS };
