// Safe, tiny formatter for chat text: **bold**, *italic* / _italic_, `code`,
// "- " bullet lists, [label](https://…) and bare https:// links.
// Output is built with createElement/createTextNode only — model text is never
// parsed as HTML. Only public-looking https: URLs become links; the main
// process validates again before anything opens.

const MAX = 20000;          // longer text is shown plain
const LOOKAHEAD = 2000;     // markers never pair across more than this
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', "'", '"']);
const word = ch => Boolean(ch) && /[\p{L}\p{N}]/u.test(ch);

function httpsHref(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}

function closing(s, marker, from) {
  const limit = Math.min(s.length, from + LOOKAHEAD);
  const at = s.indexOf(marker, from);
  return at === -1 || at >= limit ? -1 : at;
}

function bareUrl(s, i) {
  let end = i;
  while (end < s.length && !/\s/.test(s[end])) end++;
  let url = s.slice(i, end);
  while (url && TRAILING.has(url.at(-1))) {
    if (url.at(-1) === ')' && url.split('(').length > url.split(')').length - 1) break;
    url = url.slice(0, -1);
  }
  return url;
}

function parseLine(s) {
  const out = [];
  let text = '';
  const push = item => { if (text) { out.push({ type: 'text', text }); text = ''; } out.push(item); };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '`') {
      const j = closing(s, '`', i + 1);
      if (j > i + 1) { push({ type: 'code', text: s.slice(i + 1, j) }); i = j + 1; continue; }
    } else if (s.startsWith('**', i)) {
      const j = closing(s, '**', i + 2), inner = j > i + 2 ? s.slice(i + 2, j) : '';
      if (inner && inner.trim() === inner) { push({ type: 'b', text: inner }); i = j + 2; continue; }
      text += '**'; i += 2; continue;
    } else if ((ch === '*' || ch === '_') && !(ch === '_' && word(s[i - 1]))) {
      const j = closing(s, ch, i + 1), inner = j > i + 1 ? s.slice(i + 1, j) : '';
      if (inner && inner.trim() === inner && !(ch === '_' && word(s[j + 1]))) { push({ type: 'i', text: inner }); i = j + 1; continue; }
    } else if (ch === '[') {
      const mid = closing(s, '](', i + 1);
      if (mid > i + 1) {
        let depth = 1, k = mid + 2;
        const limit = Math.min(s.length, k + LOOKAHEAD);
        for (; k < limit && depth; k++) { if (s[k] === '(') depth++; else if (s[k] === ')') depth--; }
        if (!depth) {
          const label = s.slice(i + 1, mid), href = httpsHref(s.slice(mid + 2, k - 1));
          if (href) push({ type: 'link', text: label, href }); else text += label;
          i = k; continue;
        }
      }
    } else if ((s.startsWith('https://', i) || s.startsWith('http://', i)) && !word(s[i - 1])) {
      const url = bareUrl(s, i), href = url.startsWith('https://') && httpsHref(url);
      if (href && url.length > 8) push({ type: 'link', text: url, href }); else text += url;
      i += url.length || 1; continue;
    }
    text += ch; i++;
  }
  if (text) out.push({ type: 'text', text });
  return out;
}

// Chunks are blank-line separated; each holds paragraph and list blocks.
function parseChunks(source) {
  const raw = String(source ?? '').replace(/\r\n?/g, '\n');
  const plain = raw.length > MAX;
  return raw.split(/\n{2,}/).filter(chunk => chunk.trim()).map(chunk => {
    const blocks = [];
    let para = null, list = null;
    for (const line of chunk.split('\n')) {
      const item = !plain && line.match(/^\s*[-*]\s+(.*)$/);
      if (item) {
        para = null;
        if (!list) blocks.push(list = { type: 'ul', items: [] });
        list.items.push(parseLine(item[1]));
      } else {
        list = null;
        const inlines = plain ? (line ? [{ type: 'text', text: line }] : []) : parseLine(line);
        if (!para) blocks.push(para = { type: 'p', inlines });
        else para.inlines.push({ type: 'text', text: '\n' }, ...inlines);
      }
    }
    return blocks;
  });
}

export function parseRichText(text) { return parseChunks(text).flat(); }

const inlineText = inlines => inlines.map(item => item.text).join('');
export function plainText(text) {
  return parseChunks(text).map(blocks => blocks.map(block => block.type === 'p' ? inlineText(block.inlines)
    : block.items.map(item => `- ${inlineText(item)}`).join('\n')).join('\n')).join('\n\n');
}

const TAG = { b: 'strong', i: 'em', code: 'code' };
function appendInlines(doc, parent, inlines, onLink) {
  for (const item of inlines) {
    if (item.type === 'text') {
      if (item.text === '\n') parent.appendChild(doc.createElement('br'));
      else parent.appendChild(doc.createTextNode(item.text));
    } else if (item.type === 'link') {
      const a = doc.createElement('a');
      a.setAttribute('href', item.href);
      a.setAttribute('class', 'rich-link');
      a.setAttribute('title', item.href);
      a.textContent = item.text;
      a.addEventListener('click', event => { event.preventDefault(); onLink?.(item.href); });
      parent.appendChild(a);
    } else {
      const el = doc.createElement(TAG[item.type]);
      el.textContent = item.text;
      parent.appendChild(el);
    }
  }
}

export function renderRichText(node, text, { onLink } = {}) {
  const doc = node.ownerDocument;
  node.replaceChildren();
  for (const block of parseRichText(text)) {
    if (block.type === 'p') {
      const p = doc.createElement('p');
      appendInlines(doc, p, block.inlines, onLink);
      node.appendChild(p);
    } else {
      const ul = doc.createElement('ul');
      for (const item of block.items) {
        const li = doc.createElement('li');
        appendInlines(doc, li, item, onLink);
        ul.appendChild(li);
      }
      node.appendChild(ul);
    }
  }
}
