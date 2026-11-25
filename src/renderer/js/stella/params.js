const deepFreeze = o => {
  Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
};

export const P = deepFreeze({
  sizeFromScale: 250, minSize: 96,
  R: 0.47, ring: 0.4, globe: 0.8, globePoints: 340, globePitch: -0.35,
  blades: {count: 4, offset: Math.PI / 4, rIn: 0.53, rOut: 0.97, wIn: 40, wOut: 1.5},
  sticks: {count: 4, offset: 0, lag: 0.05, rIn: 0.54, rOut: 0.78, wIn: 20, wOut: 1},
  dots: {perGap: 26, spreadMin: 0.16, spreadMax: 0.42, rMin: 0.5, rMax: 0.86},
  speeds: {spin: 0.35, spinThink: 1.6, blades: 0.22, bladesThink: 1.5, bladesSpeak: 0.1, chase: 1.5, chaseThink: 3},
  ease: {state: 3, voiceAttack: 18, voiceRelease: 7},
  led: {cell: 3.5, cellMin: 2.5, glowAlpha: 0.55, glowBlur: 6, levels: 4, unlit: 'rgba(120,130,220,0.06)'},
  sheen: {speed: 0.45, seedStep: 0.23, width: 0.16, cyan: [120, 240, 255], pink: [255, 170, 240],
    alpha: 0.35, edge: 'rgba(215,205,255,0.45)'},
  colors: {
    blade: ['rgba(196,170,255,0.95)', 'rgba(139,92,246,0.9)', 'rgba(91,33,182,0.8)'],
    stick: ['rgba(165,180,252,0.9)', 'rgba(99,102,241,0.85)', 'rgba(55,48,163,0.75)'],
    dots: ['#5b8cff', '#7ea6ff'],
    ring: [[0, '#f6dc9c'], [0.22, '#f2b8c6'], [0.45, '#b9a4f5'], [0.62, '#f2b8c6'], [0.8, '#f6dc9c'], [1, '#f6dc9c']],
    globeFront: '#bcd3ff', globeBack: '#4f7cff',
    inner: ['rgba(235,245,255,0.95)', 'rgba(120,170,255,0.6)', 'rgba(60,100,255,0)'],
    ambient: 'rgba(70,90,230,A)'
  }
});
