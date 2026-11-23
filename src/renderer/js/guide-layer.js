// Guide layer renderer. Scenes are model-derived data: every string goes through textContent, never markup.
const NS = 'http://www.w3.org/2000/svg';
const shapes = document.getElementById('shapes');
const marksLayer = document.getElementById('marks');
const cardsLayer = document.getElementById('cards');

const RING_PAD = 4;
const SPOT_PAD = 6;
const HEAD_LENGTH = 14;
const HEAD_HALF = 8;
const BADGE = 24;
const EDGE = 2;

const finite = (...values) => values.every(Number.isFinite);
const validBox = b => b && finite(b.x, b.y, b.width, b.height) && b.width > 0 && b.height > 0;
const cutSize = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cut')) || 14;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) { node.textContent = String(text); node.dir = 'auto'; }
  return node;
}
function svg(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function place(node, x, y, width) {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  if (width !== undefined) node.style.width = `${width}px`;
  return node;
}

// Chamfered rectangle: top-left and bottom-right corners cut, like her panels.
function chamfer({ x, y, width, height }, cut) {
  const c = Math.max(2, Math.min(cut, width / 3, height / 3));
  return [[x + c, y], [x + width, y], [x + width, y + height - c], [x + width - c, y + height], [x, y + height], [x, y + c]];
}
const points = list => list.map(([x, y]) => `${x},${y}`).join(' ');
const grow = (b, by) => ({ x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 });

// Shade (violet, offset) first, then the green stroke: the misregistered cel outline.
function doubled(tag, attrs, className) {
  shapes.append(svg(tag, { ...attrs, class: `${className} is-shade`, transform: 'translate(2 2)' }));
  shapes.append(svg(tag, { ...attrs, class: className }));
}

function edgePoint(box, toward) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? Math.abs(box.width / 2 / dx) : Infinity, dy ? Math.abs(box.height / 2 / dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

// Liang-Barsky: clip the segment to the visible area, so an off-display end still points the right way.
function clip(a, b, width, height) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const edges = [[-dx, a.x - EDGE], [dx, width - EDGE - a.x], [-dy, a.y - EDGE], [dy, height - EDGE - a.y]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

function drawArrow(mark, width, height) {
  const box = mark.box;
  let from, to;
  if (mark.to && finite(mark.to.x, mark.to.y)) {
    from = edgePoint(grow(box, RING_PAD), mark.to);
    to = mark.to;
  } else {
    // No destination: point at the target from its upper left.
    to = edgePoint(grow(box, RING_PAD), { x: box.x - 60, y: box.y - 60 });
    from = { x: to.x - 56, y: to.y - 56 };
  }
  const segment = clip(from, to, width, height);
  if (!segment) return;
  const [a, b] = segment;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < HEAD_LENGTH + 4) return;
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const base = { x: b.x - ux * HEAD_LENGTH, y: b.y - uy * HEAD_LENGTH };
  doubled('line', { x1: a.x, y1: a.y, x2: base.x, y2: base.y }, 'guide-arrow');
  const head = [[b.x, b.y], [base.x - uy * HEAD_HALF, base.y + ux * HEAD_HALF], [base.x + uy * HEAD_HALF, base.y - ux * HEAD_HALF]];
  doubled('polygon', { points: points(head) }, 'guide-arrowhead');
}

function drawPill(label, text) {
  if (!label || !finite(label.x, label.y, label.width) || !text) return;
  const pill = place(el('div', 'guide-pill'), label.x, label.y);
  pill.style.maxWidth = `${label.width}px`;
  pill.append(el('span', '', text));
  marksLayer.append(pill);
}

function drawMarks(marks, width, height, win) {
  const spots = marks.filter(m => m.kind === 'spotlight' && validBox(m.box));
  if (spots.length) {
    // Dim only the annotated window (the whole display only if the window is unknown).
    const area = validBox(win) ? win : { x: 0, y: 0, width, height };
    const holes = spots.map(m => `M${points(chamfer(grow(m.box, SPOT_PAD), cutSize())).replaceAll(' ', 'L')}Z`).join('');
    shapes.append(svg('path', { class: 'guide-spot', 'fill-rule': 'evenodd',
      d: `M${area.x},${area.y}H${area.x + area.width}V${area.y + area.height}H${area.x}Z${holes}` }));
  }
  let ordinal = 0;
  for (const mark of marks) {
    if (!validBox(mark.box)) continue;
    const box = mark.box;
    const text = typeof mark.text === 'string' ? mark.text : '';
    if (mark.kind === 'ring') {
      doubled('polygon', { points: points(chamfer(grow(box, RING_PAD), cutSize())) }, 'guide-ring');
    } else if (mark.kind === 'arrow') {
      drawArrow(mark, width, height);
    } else if (mark.kind === 'underline') {
      marksLayer.append(place(el('div', 'guide-underline'), box.x, box.y + box.height + 2, box.width));
    } else if (mark.kind === 'number') {
      ordinal += 1;
      const short = text && text.length <= 3;
      marksLayer.append(place(el('div', 'guide-badge', short ? text : ordinal), box.x - BADGE / 2, box.y - BADGE / 2));
      if (!short) drawPill(mark.label, text);
      continue;
    }
    drawPill(mark.label, text);
  }
}

function cardBody(card) {
  if (card.kind === 'steps') {
    const list = el('ol', 'guide-steps');
    (Array.isArray(card.items) ? card.items : []).forEach((item, i) => {
      const row = el('li');
      row.append(el('span', 'guide-steps__n', i + 1), el('span', 'guide-steps__text', item));
      list.append(row);
    });
    return list;
  }
  if (card.kind === 'table') {
    const columns = Array.isArray(card.columns) ? card.columns : [];
    const table = el('div', 'guide-table');
    table.setAttribute('role', 'table');
    table.style.gridTemplateColumns = `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`;
    const row = (cells, className) => {
      for (let i = 0; i < columns.length; i++) {
        const cell = el('div', className, cells[i] ?? '');
        cell.setAttribute('role', className === 'guide-table__head' ? 'columnheader' : 'cell');
        table.append(cell);
      }
    };
    row(columns, 'guide-table__head');
    for (const cells of Array.isArray(card.rows) ? card.rows : []) row(Array.isArray(cells) ? cells : [], 'guide-table__cell');
    return table;
  }
  return el('p', 'guide-note', card.text ?? '');
}

function drawCard(card) {
  if (!validBox(card.box)) return;
  const wrap = place(el('section', 'guide-card'), card.box.x, card.box.y, card.box.width);
  wrap.dataset.kind = card.kind;
  wrap.style.minHeight = `${card.box.height}px`;
  const plate = el('div', 'guide-card__plate');
  if (card.title) plate.append(el('h2', 'guide-card__title', card.title));
  plate.append(cardBody(card));
  const buttons = (Array.isArray(card.buttons) ? card.buttons : []).filter(b => b && typeof b.id === 'string');
  if (buttons.length) {
    const actions = el('div', 'guide-card__actions');
    for (const b of buttons) {
      const button = el('button', 'guide-card__button', typeof b.label === 'string' && b.label ? b.label : b.id);
      button.type = 'button';
      button.addEventListener('click', () => window.guideHost.cardAction(b.id));
      actions.append(button);
    }
    plate.append(actions);
  }
  wrap.append(plate);
  cardsLayer.append(wrap);
}

function draw(scene) {
  const width = window.innerWidth, height = window.innerHeight;
  shapes.replaceChildren();
  marksLayer.replaceChildren();
  cardsLayer.replaceChildren();
  shapes.setAttribute('viewBox', `0 0 ${width} ${height}`);
  drawMarks(Array.isArray(scene?.marks) ? scene.marks : [], width, height, scene?.window);
  for (const card of Array.isArray(scene?.cards) ? scene.cards : []) drawCard(card);
}

window.guideHost.onScene(draw);
