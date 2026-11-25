'use strict';
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '../../src/renderer/js');
const cache = new Map();
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const SPEC = /(\b(?:import|export)\b[^'"`;]*?\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

// Returns a data: URI for the file, with relative imports inlined recursively.
function toUri(file) {
  const abs = path.resolve(file);
  if (cache.has(abs)) return cache.get(abs);
  const source = fs.readFileSync(abs, 'utf8');
  const out = source.replace(SPEC, (m, head, q, spec) =>
    `${head}${q}${toUri(path.resolve(path.dirname(abs), spec))}${q}`);
  const result = uri(out);
  cache.set(abs, result);
  return result;
}

// relPath is relative to src/renderer/js/, e.g. 'stella/math.js'.
function loadRenderer(relPath) {
  return import(toUri(path.join(ROOT, relPath)));
}

module.exports = {loadRenderer};
