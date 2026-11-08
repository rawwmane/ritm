// Графика «Ритма»: точечный шрифт 5×7 для цифр, круговая диаграмма, кольцо уровня, линейные иконки.
// Всё рисуется inline-SVG без внешних шрифтов, поэтому работает офлайн.

const G = {
  0: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  ':': ['.', '.', '#', '.', '#', '.', '.'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
};

// Число с пробелами между разрядами: 12840 → «12 840».
export const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function dotText(str, h = 48, cls = '') {
  const s = String(str);
  let x = 0;
  let c = '';
  for (const ch of s) {
    const g = G[ch] || G[' '];
    const w = g[0].length;
    g.forEach((row, y) => {
      for (let i = 0; i < w; i++) if (row[i] === '#') c += `<circle cx="${x + i + 0.5}" cy="${y + 0.5}" r="0.42"/>`;
    });
    x += w + 1;
  }
  x = Math.max(1, x - 1);
  const w = ((x / 7) * h).toFixed(1);
  return `<svg class="dots ${cls}" width="${w}" height="${h}" viewBox="0 0 ${x} 7" role="img" aria-label="${s}">${c}</svg>`;
}

export function pie(p, size = 72) {
  const v = Math.max(0, Math.min(1, p || 0));
  const r = size / 2;
  const box = `width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"`;
  if (v >= 0.999) return `<svg class="pie" ${box}><circle cx="${r}" cy="${r}" r="${r}" class="pie-on"/></svg>`;
  const a = v * 2 * Math.PI;
  const x = (r + r * Math.sin(a)).toFixed(2);
  const y = (r - r * Math.cos(a)).toFixed(2);
  const wedge = v > 0 ? `<path class="pie-on" d="M${r} ${r}L${r} 0A${r} ${r} 0 ${v > 0.5 ? 1 : 0} 1 ${x} ${y}Z"/>` : '';
  return `<svg class="pie" ${box}><circle cx="${r}" cy="${r}" r="${r}" class="pie-off"/>${wedge}</svg>`;
}

export function ring(p, size = 36, label = '') {
  const sw = 3;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const m = size / 2;
  const v = Math.max(0, Math.min(1, p || 0));
  const arc = v > 0
    ? `<circle cx="${m}" cy="${m}" r="${r}" class="ring-on" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(c * v).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${m} ${m})"/>`
    : '';
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${m}" cy="${m}" r="${r}" class="ring-off" fill="none" stroke-width="${sw}"/>${arc}
    <text x="${m}" y="${m}" dominant-baseline="central" text-anchor="middle">${label}</text></svg>`;
}

const ICON = {
  walk: '<path d="M4 12h15M13.5 6l6 6-6 6"/>',
  feed: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M4 4l16 16"/>',
  wave: '<path d="M2 14c2.5-4 5-4 7.5 0s5 4 7.5 0 3.5-3 5-2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  cards: '<rect x="4" y="7" width="12" height="14" rx="2.5"/><path d="M8 4h9.5A2.5 2.5 0 0 1 20 6.5V17"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
};
export const icon = (name, size = 22) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
