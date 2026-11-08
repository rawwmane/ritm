// Ритм — чистая логика: даты, серии, XP, заморозки, ачивки. Без DOM, тестируется в Node.

export const XP = {
  walkMini: 20,
  clean: 40,
  urge: 10,
  urgeCap: 10, // сколько порывов в день дают XP (дальше считаются, но без очков)
  breath: 15,
  review: 30,
  task: { quick: 10, mid: 25, deep: 50 },
};
export const CHEST_CHANCE = 0.3;
export const FREEZE_MAX = 2;
export const GOAL = 66; // медиана формирования привычки (Singh et al. 2024: 59–66 дней)
export const LOG_MAX = 300;

export const LADDER = [
  { n: 1, name: 'Дойти до площадки', xp: 50 },
  { n: 2, name: 'Дойти + одно упражнение (вис на турнике)', xp: 60 },
  { n: 3, name: 'Дойти + 5 минут движения', xp: 70 },
  { n: 4, name: 'Дойти + комплекс на 15 минут', xp: 80 },
  { n: 5, name: 'Полноценная тренировка', xp: 100 },
];
export const LADDER_DAYS = 14; // сколько дней подряд на ступени, прежде чем предлагать следующую

export const SIZES = {
  quick: { icon: '⚡', label: 'Быстро', hint: '1–3 мин' },
  mid: { icon: '📗', label: 'Средне', hint: '10–15 мин' },
  deep: { icon: '🔧', label: 'Глубоко', hint: '25 мин' },
};
export const PRIO = { high: 3, mid: 2, low: 1 };
export const PRIO_LABEL = { high: 'Главный', mid: 'Обычный', low: 'Хобби / фон' };
export const TRIGGERS = ['Скука', 'Усталость', 'Тревога', 'Автомат', 'Одиночество', 'Другое'];

const TITLES = [
  [1, 'Спящий'], [2, 'Проснувшийся'], [3, 'Путник'], [5, 'Ритмичный'], [7, 'Упорный'],
  [10, 'Хозяин утра'], [13, 'Хозяин внимания'], [16, 'Мастер ритма'], [20, 'Легенда SAVEINC'],
];

// ---------- даты (локальное время, ключ YYYY-MM-DD) ----------

export function dkey(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dkey(d);
}
export function diffDays(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 864e5);
}

// ---------- состояние ----------

// Версия стартового наполнения. Новые награды/карточки для уже установленных копий добавляются миграцией.
export const SEED_V = 2;
const MIGRATIONS = {
  2: (s, seed) => addFromSeed(s.rewards, seed.rewards, ['r12', 'r13']),
};
function addFromSeed(list, seedList, ids) {
  for (const id of ids) {
    const item = seedList.find((x) => x.id === id);
    if (item && !list.some((x) => x.id === id)) list.push({ ...item });
  }
}

export function newState(today, seed) {
  return {
    v: 1,
    seedV: SEED_V,
    start: today,
    xpTotal: 0,
    spent: 0,
    days: {},
    freezes: { walk: 0, clean: 0 },
    freezeAwards: { walk: '', clean: '' },
    walkLevel: 1,
    walkLevelSince: today,
    ach: {},
    counters: { urges: 0, breaths: 0, tasks: 0, comebacks: 0, chests: 0, reviews: 0, purchases: 0, slips: 0 },
    triggers: {},
    pendingChests: 0,
    active: null,
    projects: seed.projects,
    tasks: seed.tasks,
    rewards: seed.rewards,
    rules: seed.rules,
    purchases: [],
    settings: { sound: true },
    lastBackup: null,
    lastRollover: today,
    log: [],
  };
}

export function hydrate(raw, today, seed) {
  const base = newState(today, seed);
  const s = { ...base, ...raw };
  for (const key of ['freezes', 'freezeAwards', 'counters', 'settings', 'rules']) {
    s[key] = { ...base[key], ...(raw[key] || {}) };
  }
  for (let v = (raw.seedV || 1) + 1; v <= SEED_V; v++) MIGRATIONS[v]?.(s, seed);
  s.seedV = SEED_V;
  return s;
}

export function day(S, k) {
  if (!S.days[k]) S.days[k] = { walk: 0, clean: null, urges: 0, tasks: 0 };
  return S.days[k];
}

function gain(S, xp, txt) {
  if (!xp) return;
  S.xpTotal += xp;
  S.log.unshift({ t: Date.now(), xp, txt });
  if (S.log.length > LOG_MAX) S.log.length = LOG_MAX;
}

export const balance = (S) => S.xpTotal - S.spent;

export function levelInfo(xp) {
  // порог уровня n: 50·n·(n−1) → 0, 100, 300, 600, 1000, …
  let n = 1;
  while (xp >= 50 * (n + 1) * n) n++;
  const cur = 50 * n * (n - 1);
  const next = 50 * (n + 1) * n;
  let title = TITLES[0][1];
  for (const [lv, t] of TITLES) if (n >= lv) title = t;
  return { level: n, into: xp - cur, need: next - cur, title };
}

// ---------- серии ----------

export function ok(habit, d) {
  if (!d) return false;
  return habit === 'walk' ? d.walk >= 1 : d.clean === true;
}
const frozen = (habit, d) => !!(d && d[habit + 'Frozen']);

// Серия, заканчивающаяся днём k. Замороженные дни серию не рвут, но и не прибавляют.
export function runEndingAt(S, habit, k) {
  let n = 0;
  while (k >= S.start) {
    const d = S.days[k];
    if (ok(habit, d)) n++;
    else if (!frozen(habit, d)) break;
    k = addDays(k, -1);
  }
  return n;
}

export function streak(S, habit, today) {
  const td = S.days[today];
  if (ok(habit, td)) return runEndingAt(S, habit, today);
  if (habit === 'clean' && td && td.clean === false && !td.cleanFrozen) return 0;
  let k = addDays(today, -1);
  // «вчера без ленты?» ещё не отвечено — не показываем ноль, считаем от позавчера
  if (habit === 'clean' && k >= S.start && (S.days[k]?.clean ?? null) === null) k = addDays(k, -1);
  return runEndingAt(S, habit, k);
}

export function bestStreak(S, habit, today) {
  let best = 0;
  let cur = 0;
  for (let k = S.start; k <= today; k = addDays(k, 1)) {
    const d = S.days[k];
    if (ok(habit, d)) best = Math.max(best, ++cur);
    else if (frozen(habit, d)) continue;
    else if (k === today && !(habit === 'clean' && d && d.clean === false)) continue;
    else cur = 0;
  }
  return best;
}

// Возвращение: успех сразу после пропуска (не замороженного), если раньше уже были успехи.
export function isComeback(S, habit, k) {
  const prev = addDays(k, -1);
  if (prev < S.start) return false;
  const p = S.days[prev];
  if (ok(habit, p) || frozen(habit, p)) return false;
  if (habit === 'clean' && (p?.clean ?? null) === null) return false; // неизвестный день — без бонуса
  return Object.keys(S.days).some((x) => x < k && ok(habit, S.days[x]));
}

function maybeAwardFreeze(S, habit, k, ev) {
  const run = runEndingAt(S, habit, k);
  if (run > 0 && run % 7 === 0 && S.freezeAwards[habit] !== k && S.freezes[habit] < FREEZE_MAX) {
    S.freezes[habit]++;
    S.freezeAwards[habit] = k;
    ev.push({ type: 'freezeEarned', habit });
  }
}

function maybeChest(S, d, flag, rng, ev) {
  if (d[flag]) return; // сундук разыгрывается один раз на отметку дня (отмена/повтор не фармит)
  d[flag] = true;
  if (rng() < CHEST_CHANCE) {
    S.pendingChests = (S.pendingChests || 0) + 1;
    ev.push({ type: 'chest' });
  }
}

// Вызывается при каждом открытии: прошедшие дни без выхода закрываются заморозкой, если она есть.
export function rollover(S, today) {
  const ev = [];
  let k = S.lastRollover && S.lastRollover > S.start ? S.lastRollover : S.start;
  while (k < today) {
    const d = S.days[k];
    if (!ok('walk', d) && !frozen('walk', d) && S.freezes.walk > 0 && runEndingAt(S, 'walk', addDays(k, -1)) > 0) {
      day(S, k).walkFrozen = true;
      S.freezes.walk--;
      ev.push({ type: 'freezeUsed', habit: 'walk', k });
    }
    k = addDays(k, 1);
  }
  S.lastRollover = today;
  return ev;
}

// Дни, на которые ещё не ответили «без ленты?» (до 7 дней назад), от старых к новым.
export function cleanQueue(S, today) {
  const out = [];
  let k = addDays(today, -7);
  if (k < S.start) k = S.start;
  for (; k < today; k = addDays(k, 1)) {
    if ((S.days[k]?.clean ?? null) === null) out.push(k);
  }
  return out;
}

export function canLevelUp(S, today) {
  return (
    S.walkLevel < LADDER.length &&
    streak(S, 'walk', today) >= LADDER_DAYS &&
    diffDays(S.walkLevelSince, today) >= LADDER_DAYS
  );
}

// ---------- действия (возвращают события для интерфейса) ----------

export function doWalk(S, k, v, at, rng = Math.random) {
  const d = day(S, k);
  if (d.walk) return [];
  const ev = [];
  const cb = isComeback(S, 'walk', k);
  let xp = v === 2 ? LADDER[S.walkLevel - 1].xp : XP.walkMini;
  if (cb) {
    xp *= 2;
    S.counters.comebacks++;
    ev.push({ type: 'comeback' });
  }
  Object.assign(d, { walk: v, walkAt: at, walkXp: xp, walkCb: cb });
  gain(S, xp, v === 2 ? 'Утренний выход' : 'Выход (мини)');
  ev.push({ type: 'xp', amount: xp });
  maybeAwardFreeze(S, 'walk', k, ev);
  maybeChest(S, d, 'walkRolled', rng, ev);
  return ev;
}

export function undoWalk(S, k) {
  const d = S.days[k];
  if (!d || !d.walk) return;
  gain(S, -d.walkXp, 'Отмена: выход');
  if (d.walkCb) S.counters.comebacks--;
  Object.assign(d, { walk: 0, walkAt: null, walkXp: 0, walkCb: false });
}

export function answerClean(S, k, yes, rng = Math.random, trigger = null) {
  const d = day(S, k);
  if (d.clean !== null && d.clean !== undefined) return [];
  const ev = [];
  if (yes) {
    const cb = isComeback(S, 'clean', k);
    const xp = XP.clean * (cb ? 2 : 1);
    if (cb) {
      S.counters.comebacks++;
      ev.push({ type: 'comeback' });
    }
    Object.assign(d, { clean: true, cleanXp: xp, cleanCb: cb });
    gain(S, xp, 'День без ленты');
    ev.push({ type: 'xp', amount: xp });
    maybeAwardFreeze(S, 'clean', k, ev);
    maybeChest(S, d, 'cleanRolled', rng, ev);
  } else {
    d.clean = false;
    S.counters.slips++;
    if (trigger) {
      d.trig = trigger;
      S.triggers[trigger] = (S.triggers[trigger] || 0) + 1;
    }
    if (S.freezes.clean > 0 && runEndingAt(S, 'clean', addDays(k, -1)) > 0) {
      S.freezes.clean--;
      d.cleanFrozen = true;
      ev.push({ type: 'freezeUsed', habit: 'clean', k });
    }
  }
  return ev;
}

export function undoClean(S, k) {
  const d = S.days[k];
  if (!d || d.clean === null || d.clean === undefined) return;
  if (d.clean === true) {
    gain(S, -d.cleanXp, 'Отмена: день без ленты');
    if (d.cleanCb) S.counters.comebacks--;
  } else {
    S.counters.slips--;
    if (d.trig) S.triggers[d.trig] = Math.max(0, (S.triggers[d.trig] || 1) - 1);
    if (d.cleanFrozen) S.freezes.clean = Math.min(FREEZE_MAX, S.freezes.clean + 1);
  }
  Object.assign(d, { clean: null, cleanXp: 0, cleanCb: false, cleanFrozen: false, trig: null });
}

export function urgeXp(S, k) {
  return (S.days[k]?.urges || 0) < XP.urgeCap ? XP.urge : 0;
}

export function doUrge(S, k) {
  const xp = urgeXp(S, k);
  day(S, k).urges++;
  S.counters.urges++;
  gain(S, xp, 'Заметил тягу');
  return xp ? [{ type: 'xp', amount: xp }] : [];
}

export function doBreath(S) {
  S.counters.breaths++;
  gain(S, XP.breath, 'Дыхание');
  return [{ type: 'xp', amount: XP.breath }];
}

export function doReview(S, k) {
  const d = day(S, k);
  if (d.review) return [];
  d.review = true;
  S.counters.reviews++;
  gain(S, XP.review, 'Пополнил колоду');
  return [{ type: 'xp', amount: XP.review }];
}

export function completeTask(S, id, k) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t || (t.done && !t.rep)) return [];
  const xp = XP.task[t.size];
  if (t.rep) t.count = (t.count || 0) + 1;
  else Object.assign(t, { done: true, doneAt: k, xp });
  if (S.active?.id === id) S.active = null;
  S.counters.tasks++;
  day(S, k).tasks++;
  gain(S, xp, t.title);
  return [{ type: 'xp', amount: xp }];
}

export function uncompleteTask(S, id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t || !t.done) return;
  gain(S, -(t.xp ?? XP.task[t.size]), 'Отмена: ' + t.title);
  S.counters.tasks--;
  const d = S.days[t.doneAt];
  if (d && d.tasks > 0) d.tasks--;
  Object.assign(t, { done: false, doneAt: null });
}

export function openChest(S, rng = Math.random) {
  if (!S.pendingChests) return null;
  S.pendingChests--;
  S.counters.chests++;
  const r = rng();
  let res;
  if (r < 0.05) res = { kind: 'jackpot', xp: 250 };
  else if (r < 0.25) {
    const habit = S.freezes.walk <= S.freezes.clean ? 'walk' : 'clean';
    if (S.freezes[habit] < FREEZE_MAX) {
      S.freezes[habit]++;
      res = { kind: 'freeze', habit };
    } else res = { kind: 'xp', xp: 60 };
  } else res = { kind: 'xp', xp: 20 + Math.floor(rng() * 7) * 10 };
  if (res.xp) gain(S, res.xp, 'Сундук');
  return res;
}

export function buy(S, id, now = Date.now()) {
  const r = S.rewards.find((x) => x.id === id);
  if (!r || balance(S) < r.cost) return false;
  S.spent += r.cost;
  S.purchases.unshift({ id, title: r.title, icon: r.icon, cost: r.cost, t: now });
  S.counters.purchases++;
  return true;
}

export function setWalkLevel(S, n, k) {
  S.walkLevel = Math.max(1, Math.min(LADDER.length, n));
  S.walkLevelSince = k;
}

// ---------- статистика и ачивки ----------

export function stats(S, today) {
  let walkAny = 0;
  let walkFull = 0;
  let cleanTotal = 0;
  let early = 0;
  let perfect = 0;
  for (const d of Object.values(S.days)) {
    if (d.walk >= 1) walkAny++;
    if (d.walk === 2) walkFull++;
    if (d.clean === true) cleanTotal++;
    if (d.walk >= 1 && d.walkAt && d.walkAt < '07:00') early++;
    if (d.walk >= 1 && d.clean === true && d.tasks >= 1) perfect++;
  }
  return {
    ...S.counters,
    walkAny, walkFull, cleanTotal, early, perfect,
    walkLevel: S.walkLevel,
    walkStreak: streak(S, 'walk', today),
    cleanStreak: streak(S, 'clean', today),
    walkBest: bestStreak(S, 'walk', today),
    cleanBest: bestStreak(S, 'clean', today),
  };
}

export const ACH = [
  { id: 'walk1', icon: '👟', name: 'Первый шаг', desc: 'Первый выход на площадку', xp: 50, test: (s) => s.walkAny >= 1 },
  { id: 'walk7', icon: '🔥', name: 'Неделя на ногах', desc: '7 дней подряд выходишь', xp: 150, test: (s) => s.walkBest >= 7 },
  { id: 'walk21', icon: '⚡', name: 'Двадцать один', desc: '21 день подряд', xp: 300, test: (s) => s.walkBest >= 21 },
  { id: 'walk30', icon: '🗓', name: 'Месяц утра', desc: '30 выходов всего', xp: 300, test: (s) => s.walkAny >= 30 },
  { id: 'walk66', icon: '🏆', name: 'Привычка', desc: '66 выходов: столько в среднем нужно, чтобы привычка закрепилась', xp: 666, test: (s) => s.walkAny >= 66 },
  { id: 'walk100', icon: '💯', name: 'Сотня', desc: '100 выходов', xp: 1000, test: (s) => s.walkAny >= 100 },
  { id: 'ladder2', icon: '🪜', name: 'Новая ступень', desc: 'Поднялся на ступень выше', xp: 100, test: (s) => s.walkLevel >= 2 },
  { id: 'clean1', icon: '🧘', name: 'Чистый день', desc: 'Первый день без ленты', xp: 50, test: (s) => s.cleanTotal >= 1 },
  { id: 'clean7', icon: '🛡', name: 'Неделя тишины', desc: '7 дней подряд без ленты', xp: 150, test: (s) => s.cleanBest >= 7 },
  { id: 'clean30', icon: '🌙', name: 'Месяц тишины', desc: '30 дней подряд без ленты', xp: 500, test: (s) => s.cleanBest >= 30 },
  { id: 'clean66', icon: '👑', name: 'Хозяин внимания', desc: '66 дней без ленты всего', xp: 666, test: (s) => s.cleanTotal >= 66 },
  { id: 'urge1', icon: '🌊', name: 'Заметил', desc: 'Первый раз нажал «Тянет залипнуть»', xp: 30, test: (s) => s.urges >= 1 },
  { id: 'urge10', icon: '🏄', name: 'Серфер', desc: '10 побеждённых порывов', xp: 100, test: (s) => s.urges >= 10 },
  { id: 'urge50', icon: '🌀', name: 'Повелитель волн', desc: '50 побеждённых порывов', xp: 250, test: (s) => s.urges >= 50 },
  { id: 'urge100', icon: '🐋', name: 'Океан', desc: '100 побеждённых порывов', xp: 500, test: (s) => s.urges >= 100 },
  { id: 'breath10', icon: '🫁', name: 'Дыхание', desc: '10 дыхательных сессий', xp: 100, test: (s) => s.breaths >= 10 },
  { id: 'task1', icon: '🃏', name: 'Первая карта', desc: 'Выполнил карточку из колоды', xp: 30, test: (s) => s.tasks >= 1 },
  { id: 'task25', icon: '🛠', name: 'Делатель', desc: '25 карточек', xp: 250, test: (s) => s.tasks >= 25 },
  { id: 'task100', icon: '🏭', name: 'Мастерская', desc: '100 карточек', xp: 700, test: (s) => s.tasks >= 100 },
  { id: 'review1', icon: '🗂', name: 'Колода в порядке', desc: 'Первое воскресное пополнение колоды', xp: 50, test: (s) => s.reviews >= 1 },
  { id: 'shop1', icon: '🎁', name: 'Заслужил', desc: 'Первая награда из магазина', xp: 50, test: (s) => s.purchases >= 1 },
  { id: 'early', secret: true, icon: '🌅', name: 'Ранняя пташка', desc: 'Вышел до 7:00', xp: 100, test: (s) => s.early >= 1 },
  { id: 'comeback1', secret: true, icon: '🔄', name: 'Возвращение', desc: 'Вернулся после пропуска', xp: 100, test: (s) => s.comebacks >= 1 },
  { id: 'comeback5', secret: true, icon: '🦅', name: 'Феникс', desc: '5 возвращений после пропусков', xp: 300, test: (s) => s.comebacks >= 5 },
  { id: 'perfect', secret: true, icon: '💎', name: 'Идеальный день', desc: 'Выход, день без ленты и карточка из колоды в один день', xp: 150, test: (s) => s.perfect >= 1 },
  { id: 'chest10', secret: true, icon: '🗝', name: 'Кладоискатель', desc: 'Открыл 10 сундуков', xp: 150, test: (s) => s.chests >= 10 },
];

export function checkAchievements(S, today) {
  const out = [];
  // ачивка даёт XP, а XP — не условие ачивок, поэтому одного прохода достаточно
  const s = stats(S, today);
  for (const a of ACH) {
    if (S.ach[a.id] || !a.test(s)) continue;
    S.ach[a.id] = today;
    gain(S, a.xp, 'Ачивка: ' + a.name);
    out.push(a);
  }
  return out;
}

// ---------- колода ----------

function weightedPick(pool, weight, rng) {
  const total = pool.reduce((sum, t) => sum + weight(t), 0);
  let r = rng() * total;
  for (const t of pool) {
    r -= weight(t);
    if (r < 0) return t;
  }
  return pool[pool.length - 1];
}

// Три карточки для момента «тянет»: быстрая, средняя, глубокая. Главные проекты выпадают чаще.
export function pickCards(S, rng = Math.random, exclude = []) {
  const prio = Object.fromEntries(S.projects.map((p) => [p.id, PRIO[p.prio] || 1]));
  const open = S.tasks.filter((t) => !t.done && prio[t.p]);
  const out = [];
  for (const size of ['quick', 'mid', 'deep']) {
    let pool = open.filter((t) => t.size === size && !exclude.includes(t.id));
    if (!pool.length) pool = open.filter((t) => t.size === size);
    if (pool.length) out.push(weightedPick(pool, (t) => prio[t.p], rng));
  }
  return out;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
