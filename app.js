import * as L from './logic.js';
import * as D from './dots.js';
import { makeSeed } from './seed.js';

const KEY = 'ritm.v1';
const DAY_GOAL = 150; // XP в день — цель для круговой диаграммы на главном
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => L.dkey(new Date());
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtDay = (k) => new Intl.DateTimeFormat('ru', { weekday: 'short', day: 'numeric', month: 'short' }).format(L.parseKey(k));
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const HABIT = { walk: 'Утренний выход', clean: 'Без ленты' };
const SIZE_NAME = { quick: 'Быстрые', mid: 'Средние', deep: 'Глубокие' };
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// ---------- хранение ----------

let S = load();
let tab = 'today';
let renderedDay = today();
const ui = { openProj: {}, cards: [], lastP: null, hideInstall: false, size: 'all', calHabit: 'walk', calMonth: 0 };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.v === 1) return L.hydrate(raw, today(), makeSeed());
  } catch {
    /* повреждённые данные — начинаем с нуля */
  }
  return L.newState(today(), makeSeed());
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    toast('Не удалось сохранить данные');
  }
}
const proj = (id) => S.projects.find((p) => p.id === id);
const task = (id) => S.tasks.find((t) => t.id === id);
const todayXp = () => {
  const k = today();
  return S.log.reduce((sum, e) => sum + (L.dkey(new Date(e.t)) === k ? e.xp : 0), 0);
};

// ---------- звук ----------

let ac = null;
function tone(freqs, step = 0.08, type = 'triangle', vol = 0.16) {
  if (!S.settings.sound) return;
  try {
    ac ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const t0 = ac.currentTime + 0.01;
    freqs.forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = f;
      const s = t0 + i * step;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(vol, s + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, s + step * 2.5);
      o.connect(g);
      g.connect(ac.destination);
      o.start(s);
      o.stop(s + step * 2.6);
    });
  } catch {
    /* звук необязателен */
  }
}
const sfx = {
  xp: () => tone([880, 1320], 0.07),
  ach: () => tone([523, 659, 784, 1047], 0.09),
  chest: () => tone([392, 523, 659, 784, 1047, 1319], 0.06),
  level: () => tone([392, 494, 587, 784, 988, 1175], 0.08, 'square', 0.08),
};

// ---------- всплывашки ----------

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
function floatXp(n) {
  if (n <= 0) return;
  const el = document.createElement('div');
  el.className = 'fxp';
  el.innerHTML = D.dotText('+' + n, 44);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
  sfx.xp();
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f5491f', '#18181a', '#cbcbc7', '#f5491f'];
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.35 + 's';
    s.style.animationDuration = 1.2 + Math.random() * 0.9 + 's';
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}

// ---------- события ----------

const queue = [];
const sheetOpen = () => $('#sheet').classList.contains('open');

function handle(evs) {
  for (const e of evs) {
    if (e.type === 'xp') floatXp(e.amount);
    else if (e.type === 'freezeEarned') toast(`+1 заморозка («${HABIT[e.habit]}») — неделя подряд`);
    else if (e.type === 'freezeUsed') toast(`Заморозка сохранила серию «${HABIT[e.habit]}» · ${fmtDay(e.k)}`);
    else if (e.type === 'comeback') toast('Возвращение после пропуска — XP ×2');
    else queue.push(e);
  }
  if (!sheetOpen()) nextEvent();
}
function nextEvent() {
  const e = queue.shift();
  if (!e) return;
  if (e.type === 'ach') showAch(e.a);
  else if (e.type === 'level') showLevel(e.level);
  else if (e.type === 'chest') showChest();
}

function act(fn) {
  const lv0 = L.levelInfo(S.xpTotal).level;
  const evs = fn() || [];
  for (const a of L.checkAchievements(S, today())) evs.push({ type: 'ach', a });
  const lv1 = L.levelInfo(S.xpTotal).level;
  if (lv1 > lv0) evs.push({ type: 'level', level: lv1 });
  save();
  render();
  handle(evs);
}

// ---------- шторка ----------

let breathTimer = null;
let breathTick = null;
function stopBreath() {
  clearTimeout(breathTimer);
  clearInterval(breathTick);
}
function sheet(html) {
  stopBreath();
  const root = $('#sheet');
  root.innerHTML = `<div class="backdrop" data-a="close"></div>
    <div class="panel" role="dialog" aria-modal="true"><div class="grab"></div>
    <button class="x circle" data-a="close" aria-label="Закрыть">${D.icon('close', 18)}</button>${html}</div>`;
  root.classList.add('open');
}
function closeSheet() {
  stopBreath();
  const root = $('#sheet');
  root.classList.remove('open');
  root.innerHTML = '';
  nextEvent();
}

function showAch(a) {
  sfx.ach();
  confetti();
  sheet(`<div class="center"><p class="cap">Новая ачивка</p>${D.dotText('+' + a.xp, 56, 'accent')}
    <h3>${esc(a.name)}</h3><p class="note">${esc(a.desc)}</p>
    <button class="btn big ink" data-a="close">Круто</button></div>`);
}
function showLevel(n) {
  sfx.level();
  confetti();
  const li = L.levelInfo(S.xpTotal);
  sheet(`<div class="center"><p class="cap">Новый уровень</p>${D.dotText(n, 96)}
    <h3>${esc(li.title)}</h3>
    <p class="note">Уровень растёт от всего заработанного XP и не падает, когда тратишь XP в магазине.</p>
    <button class="btn big ink" data-a="close">Дальше</button></div>`);
}
function showChest() {
  if (!S.pendingChests) return nextEvent();
  sheet(`<div class="center"><p class="cap">Сундук</p>${D.dotText('?', 96, 'accent wobble')}
    <p class="note">Внутри XP, заморозка серии или джекпот.</p>
    <button class="btn big accent" data-a="openChest">Открыть</button></div>`);
}

// ---------- общие куски ----------

function header() {
  const li = L.levelInfo(S.xpTotal);
  return `<header class="bar">
    <button class="lvl" data-a="levelInfo" aria-label="Уровень ${li.level}">${D.ring(li.into / li.need, 38, li.level)}</button>
    <div class="title">Ритм</div>
    <button class="xp-pill" data-a="tab" data-v="rewards" aria-label="Баланс"><b class="num">${D.group(L.balance(S))}</b><span>XP</span></button>
  </header>`;
}

function seg(action, cur, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-a="${action}" data-v="${v}">${l}</button>`).join('')}</div>`;
}

// Состояние кружка дня для календарей.
function cell(habit, x, k) {
  if (x > k) return 'fut';
  if (x < S.start) return 'pre';
  const d = S.days[x];
  const now = x === k ? ' now' : '';
  if (habit === 'walk') {
    if (d?.walk === 2) return 'ok' + now;
    if (d?.walk === 1) return 'mini' + now;
    if (d?.walkFrozen) return 'frz';
    return x === k ? 'now' : 'miss';
  }
  if (d?.clean === true) return 'ok' + now;
  if (d?.clean === false) return d.cleanFrozen ? 'frz' : 'miss';
  return x === k ? 'now' : 'q';
}

function weeks(habit, k) {
  const dow = (L.parseKey(k).getDay() + 6) % 7;
  const mon = L.addDays(k, -dow - 7);
  let h = WD.map((w) => `<span>${w}</span>`).join('');
  for (let i = 0; i < 14; i++) h += `<i class="d ${cell(habit, L.addDays(mon, i), k)}"></i>`;
  return `<div class="wk" aria-hidden="true">${h}</div>`;
}

const sizeDots = (size) => `<span class="sz s-${size}" title="${L.SIZES[size].hint}"><i></i><i></i><i></i></span>`;

// ---------- экран «Сегодня» ----------

function stat(n, unit, label) {
  return `<div><span class="light">${n}</span>${unit ? `<span class="unit">${unit}</span>` : ''}<div class="cap">${label}</div></div>`;
}

function walkCard(k, d, st) {
  const lv = L.LADDER[S.walkLevel - 1];
  const pending = !(d.walk >= 1);
  const cb = pending && L.isComeback(S, 'walk', k);
  let body;
  if (pending) {
    body = `<button class="btn big ink" data-a="walk" data-v="2">${lv.n === 1 ? 'Дошёл до площадки' : `Выполнил ступень ${lv.n}`}<span class="plus">+${lv.xp * (cb ? 2 : 1)}</span></button>
      ${cb ? '<p class="note">Был пропуск — сегодня возвращение, XP ×2</p>' : ''}
      <button class="link" data-a="walk" data-v="1">Тяжёлый день: мини-версия — 2 минуты на улице · +${L.XP.walkMini * (cb ? 2 : 1)}</button>`;
  } else {
    body = `<div class="done-line">${D.icon('check', 20)}<span>${d.walk === 2 ? 'Дошёл' : 'Мини-версия'} в ${esc(d.walkAt)} · +${d.walkXp} XP${d.walkCb ? ' · возвращение' : ''}</span>
      <button class="link" data-a="walkUndo">отменить</button></div>`;
  }
  const up = L.canLevelUp(S, k) ? `<button class="link strong" data-a="ladderUp">${L.LADDER_DAYS} дней подряд на ступени — подняться выше →</button>` : '';
  return `<section class="card ${pending ? 'accent' : ''}">
    <div class="card-top"><div><div class="cap strong">Утренний выход</div><div class="cap">Ступень ${lv.n} · ${esc(lv.name)}</div></div>${D.icon('walk')}</div>
    <div class="card-nums"><div><span class="light big">${st.walkStreak}</span><span class="unit">${plural(st.walkStreak, 'день', 'дня', 'дней')} подряд</span></div>
      <div class="cap num">${S.freezes.walk ? `${D.icon('snow', 12)} ${S.freezes.walk} · ` : ''}${Math.min(st.walkAny, L.GOAL)} / ${L.GOAL}</div></div>
    ${weeks('walk', k)}${body}${up}
  </section>`;
}

function rulesBlock() {
  const r = S.rules;
  return `<details class="rules"><summary class="cap">Правила контента ›</summary>
    <div class="cap">Нельзя</div><ul>${r.no.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="cap">Можно в наушниках, когда</div><ul>${r.when.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="cap">Работа</div><p class="note">${esc(r.work)}</p></details>`;
}

function cleanCard(k, d, st) {
  const pending = L.cleanQueue(S, k);
  const y = L.addDays(k, -1);
  const yd = S.days[y];
  let body;
  if (pending.length) {
    const q = pending[0];
    const cb = L.isComeback(S, 'clean', q);
    body = `<p class="q">${q === y ? 'Вчера' : esc(fmtDay(q))} — без ленты?</p>
      <div class="duo"><button class="btn big ink" data-a="clean" data-k="${q}">Да<span class="plus">+${L.XP.clean * (cb ? 2 : 1)}</span></button>
      <button class="btn big line" data-a="slipAsk" data-k="${q}">Нет</button></div>
      ${cb ? '<p class="note">После срыва — возвращение, XP ×2</p>' : ''}
      ${pending.length > 1 ? `<p class="note">Ещё дней без ответа: ${pending.length - 1}</p>` : ''}`;
  } else if (d.clean === false) {
    body = `<div class="done-line"><span>Срыв отмечен.${d.cleanFrozen ? ' Заморозка сохранила серию.' : ''} Не пропускай дважды: завтра возвращение ×2.</span>
      <button class="link" data-a="cleanUndo" data-k="${k}">отменить</button></div>`;
  } else if (d.clean === true) {
    body = `<div class="done-line">${D.icon('check', 20)}<span>День закрыт без ленты · +${d.cleanXp} XP</span>
      <button class="link" data-a="cleanUndo" data-k="${k}">отменить</button></div>`;
  } else {
    const late = new Date().getHours() >= 19;
    body = `<p class="note">${late ? 'Вечер. Если день прошёл без ленты — закрой его.' : 'Держишься. Отметишь вечером или завтра утром.'}</p>
      ${late ? `<button class="btn big ink" data-a="clean" data-k="${k}">Закрыть день без ленты<span class="plus">+${L.XP.clean}</span></button>` : ''}
      <div class="row between"><button class="link" data-a="slipAsk" data-k="${k}">Сорвался сегодня</button>
      ${y >= S.start && yd && yd.clean != null ? `<button class="link" data-a="cleanUndo" data-k="${y}">вчера: ${yd.clean ? 'без ленты' : 'срыв'} · изменить</button>` : ''}</div>`;
  }
  return `<section class="card">
    <div class="card-top"><div><div class="cap strong">Без ленты</div><div class="cap">Контент — только по правилам</div></div>${D.icon('feed')}</div>
    <div class="card-nums"><div><span class="light big">${st.cleanStreak}</span><span class="unit">${plural(st.cleanStreak, 'день', 'дня', 'дней')} подряд</span></div>
      <div class="cap num">${S.freezes.clean ? `${D.icon('snow', 12)} ${S.freezes.clean} · ` : ''}${Math.min(st.cleanTotal, L.GOAL)} / ${L.GOAL}</div></div>
    ${weeks('clean', k)}${body}${rulesBlock()}
  </section>`;
}

function banners(k) {
  let h = '';
  if (!standalone() && !ui.hideInstall) {
    h += `<div class="pill-card box"><div class="grow"><div class="cap">Установка</div>
      <b>Safari → «Поделиться» → «На экран Домой»</b><p class="note">Отмечай только из приложения: у Safari и у иконки разные хранилища.</p></div>
      <button class="link" data-a="hideInstall" aria-label="Скрыть">${D.icon('close', 18)}</button></div>`;
  }
  if (S.active) {
    const t = task(S.active.id);
    if (t) {
      h += `<div class="pill-card box"><div class="grow"><div class="cap">В работе</div><b>${esc(t.title)}</b></div>
        <div class="row"><button class="btn sm ink" data-a="done" data-id="${t.id}">Готово</button>
        <button class="circle" data-a="drop" aria-label="Убрать">${D.icon('close', 16)}</button></div></div>`;
    }
  }
  if (S.pendingChests > 0) {
    h += `<button class="pill-card accent" data-a="chest">${D.dotText('?', 26)}<div class="grow"><b>Неоткрытый сундук${S.pendingChests > 1 ? ` ×${S.pendingChests}` : ''}</b></div>${D.icon('right')}</button>`;
  }
  const since = L.diffDays(S.lastBackup || S.start, k);
  if (since >= 14) {
    h += `<button class="pill-card" data-a="tab" data-v="more"><div class="grow"><div class="cap">Резервная копия</div><b>Не было ${since} ${plural(since, 'день', 'дня', 'дней')}</b></div>${D.icon('right')}</button>`;
  }
  return h;
}

function todayView() {
  const k = today();
  const d = S.days[k] || {};
  const st = L.stats(S, k);
  const tx = todayXp();
  const date = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const n = L.diffDays(S.start, k) + 1;
  let html = `<section class="hero">
      <div class="row between"><span class="chip-dark">${esc(date)}</span><span class="cap">день ${n}</span></div>
      <div class="hero-main"><div>${D.dotText(Math.max(0, tx), 72)}<div class="cap">XP сегодня · цель ${DAY_GOAL}</div></div>${D.pie(tx / DAY_GOAL, 84)}</div>
      <div class="trio">${stat(st.walkStreak, 'дн', 'выход')}${stat(st.cleanStreak, 'дн', 'без ленты')}${stat(d.urges || 0, '', 'порывов сегодня')}</div>
    </section>
    ${banners(k)}${walkCard(k, d, st)}${cleanCard(k, d, st)}
    <button class="urge" data-a="urge"><div><div class="urge-t">Тянет залипнуть</div><div class="cap">Нажми вместо ленты — и выбери, чем заняться</div></div>
      <div class="urge-r"><span class="pulse"></span>${D.icon('wave', 26)}</div></button>`;
  if (new Date().getDay() === 0) {
    html += d.review
      ? `<div class="pill-card"><div class="grow"><div class="cap">Воскресенье</div><b>Колода на неделю пополнена</b></div>${D.icon('check')}</div>`
      : `<section class="card"><div class="card-top"><div><div class="cap strong">Воскресенье</div><div class="cap">15 минут на колоду</div></div>${D.icon('cards')}</div>
        <p class="note">Разрежь проекты на карточки по 10–15 минут на неделю вперёд. Тогда в момент «тянет» думать не придётся.</p>
        <div class="duo"><button class="btn ink" data-a="review">Сделал<span class="plus">+${L.XP.review}</span></button>
        <button class="btn line" data-a="tab" data-v="deck">Колода</button></div></section>`;
  }
  return html;
}

// ---------- шторки: тяга, дыхание, карточки, срыв ----------

function cardHtml(t) {
  const p = proj(t.p);
  return `<button class="tcard" data-a="take" data-id="${t.id}">
    <span class="cap">${esc(p?.name || '')}</span><span class="tc-title">${esc(t.title)}</span>
    <span class="tc-foot"><span class="row">${sizeDots(t.size)}<span class="note">${L.SIZES[t.size].hint}</span></span><span class="cap num">+${L.XP.task[t.size]} XP</span></span></button>`;
}

function urgeSheet(xp, reshuffle = false) {
  const picked = L.pickCards(S, Math.random, reshuffle ? ui.cards : []);
  ui.cards = picked.map((t) => t.id);
  const r = S.rules;
  const head = reshuffle
    ? '<h3>Другие карточки</h3>'
    : `<p class="cap">${xp ? `+${xp} XP · ` : ''}ты заметил тягу</p><h3>Это уже победа</h3>
      <p class="note">Тяга накатывает волной и спадает, если её не кормить. Направь энергию сюда:</p>`;
  sheet(`${head}
    <button class="tcard breath-card" data-a="breath"><span class="cap">Перезагрузка · 1 мин</span><span class="tc-title">Подышать: циклический вздох</span>
      <span class="tc-foot"><span></span><span class="cap num">+${L.XP.breath} XP</span></span></button>
    ${picked.map(cardHtml).join('') || '<p class="note">Колода пуста — добавь карточки во вкладке «Колода».</p>'}
    <button class="btn big line" data-a="reshuffle">Другие карточки</button>
    <p class="note">Подкаст или аудиокнига по правилам можно, если: ${esc(r.when.map((x) => x.toLowerCase()).join(', '))}.</p>`);
}

function breathSheet() {
  sheet(`<div class="center"><p class="cap">Циклический вздох · 1 минута</p>
    <p class="note">Два вдоха носом подряд (второй короткий — «добрать»), потом длинный медленный выдох ртом.</p>
    <div class="breath"><div class="orb" id="orb"></div></div>
    <div class="orb-label" id="orbL">Готов?</div>
    <div id="orbT">${D.dotText('1:00', 28)}</div>
    <button class="btn big ink" id="breathBtn" data-a="breathGo">Начать</button></div>`);
}

function runBreath(total) {
  const orb = $('#orb');
  const lab = $('#orbL');
  const tl = $('#orbT');
  const end = Date.now() + total * 1000;
  const phases = [
    ['Вдох носом', 2000, 0.92],
    ['Ещё короткий вдох', 1000, 1.08],
    ['Долгий выдох ртом', 6000, 0.55],
  ];
  let i = 0;
  let last = '';
  const step = () => {
    if (!orb.isConnected) return;
    if (i % 3 === 0 && Date.now() >= end) return finishBreath();
    const [txt, ms, sc] = phases[i % 3];
    lab.textContent = txt;
    orb.style.transitionDuration = ms + 'ms';
    orb.style.transform = `scale(${sc})`;
    i++;
    breathTimer = setTimeout(step, ms);
  };
  breathTick = setInterval(() => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    const s = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (s !== last) tl.innerHTML = D.dotText((last = s), 28);
  }, 250);
  step();
}

function finishBreath() {
  stopBreath();
  sheet(`<div class="center"><p class="cap">Готово · +${L.XP.breath} XP</p><h3>Как сейчас?</h3>
    <p class="note">Заметь, стала ли тяга слабее. Можно ещё минуту или взять карточку.</p></div>
    <div class="col"><button class="btn big ink" data-a="cards">Выбрать карточку</button>
    <button class="btn big line" data-a="breath">Ещё минута</button></div>`);
  act(() => L.doBreath(S));
}

function takenSheet(t) {
  sheet(`<p class="cap">Поехали · ${esc(proj(t.p)?.name || '')}</p><h3>${esc(t.title)}</h3>
    <p class="note">${L.SIZES[t.size].hint}. Закончишь — нажми «Готово». Можно и позже: карточка будет висеть на главном.</p>
    <div class="col"><button class="btn big ink" data-a="done" data-id="${t.id}">Готово<span class="plus">+${L.XP.task[t.size]}</span></button>
    <button class="btn big line" data-a="close">Закрыть</button></div>`);
}

function slipSheet(k) {
  const total = L.stats(S, today()).cleanTotal;
  sheet(`<p class="cap">Срыв · ${k === today() ? 'сегодня' : esc(fmtDay(k))}</p><h3>Бывает</h3>
    <p class="note">Прогресс не обнуляется: чистых дней всего — ${total}. Главное правило — не пропускать дважды.${S.freezes.clean ? ' Заморозка прикроет серию.' : ''}</p>
    <p class="cap">Что потянуло? Для себя, чтобы видеть закономерности</p>
    <div class="chips">${L.TRIGGERS.map((t) => `<button class="chip" data-a="slip" data-k="${k}" data-v="${t}">${t}</button>`).join('')}</div>
    <button class="btn big line" data-a="slip" data-k="${k}" data-v="">Пропустить</button>`);
}

function levelSheet() {
  const li = L.levelInfo(S.xpTotal);
  sheet(`<div class="center"><p class="cap">Уровень</p>${D.dotText(li.level, 80)}<h3>${esc(li.title)}</h3>
    ${D.ring(li.into / li.need, 64, '')}<p class="note num">${li.into} / ${li.need} XP до уровня ${li.level + 1}. Всего заработано ${D.group(S.xpTotal)} XP.</p></div>`);
}

// ---------- колода ----------

function projOptions(sel) {
  return S.projects.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}
function sizeOptions(sel = 'mid') {
  return Object.entries(L.SIZES).map(([k, s]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${s.label} · ${s.hint}</option>`).join('');
}

function deckView() {
  const ps = [...S.projects].sort((a, b) => L.PRIO[b.prio] - L.PRIO[a.prio]);
  const fit = (t) => ui.size === 'all' || t.size === ui.size;
  let h = `<p class="note">Карточки для момента «тянет залипнуть». Быстрые — 1–3 минуты, средние — 10–15, глубокие — 25. Начинай с глагола: «нарисовать…», «найти…».</p>
    ${seg('sizeFilter', ui.size, [['all', 'Все'], ['quick', 'Быстрые'], ['mid', 'Средние'], ['deep', 'Глубокие']])}
    <form class="card" data-f="addTask"><div class="cap strong">Новая карточка</div>
      <input name="title" placeholder="Например: нарисовать экран LFO" autocomplete="off" enterkeyhint="done" maxlength="140">
      <div class="row"><select name="p" aria-label="Проект">${projOptions(ui.lastP || ps[0]?.id)}</select>
      <select name="size" aria-label="Размер">${sizeOptions(ui.size === 'all' ? 'mid' : ui.size)}</select></div>
      <button class="btn ink wide">Добавить</button></form>`;
  for (const p of ps) {
    const ts = S.tasks.filter((t) => t.p === p.id);
    const open = ts.filter((t) => !t.done && fit(t));
    const done = ts.filter((t) => t.done);
    if (ui.size !== 'all' && !open.length) continue;
    const isOpen = ui.openProj[p.id] ?? (p.prio === 'high' || ui.size !== 'all');
    h += `<section class="card"><button class="proj-h" data-a="projToggle" data-id="${p.id}">
      <span class="prio-dot ${p.prio}"></span><span class="grow cap strong">${esc(p.name)}</span>
      <span class="cap num">${open.length}</span><span class="chev ${isOpen ? 'open' : ''}">${D.icon('right', 18)}</span></button>`;
    if (isOpen) {
      h += open
        .map(
          (t) => `<button class="task" data-a="task" data-id="${t.id}">${sizeDots(t.size)}
          <span class="grow">${esc(t.title)}${t.rep ? ` <span class="note">· повтор ${t.count || 0}</span>` : ''}</span><span class="xp">+${L.XP.task[t.size]}</span></button>`,
        )
        .join('') || '<p class="note">Пусто — добавь карточку.</p>';
      if (done.length && ui.size === 'all') {
        h += `<details class="donelist"><summary class="cap">Сделано · ${done.length}</summary>${done
          .map((t) => `<div class="task done">${D.icon('check', 16)}<span class="grow">${esc(t.title)}</span><button class="link" data-a="undone" data-id="${t.id}">вернуть</button></div>`)
          .join('')}</details>`;
      }
      h += `<button class="link" data-a="projEdit" data-id="${p.id}">Настроить проект</button>`;
    }
    h += '</section>';
  }
  return h + `<button class="btn big line" data-a="projEdit">Новый проект</button>`;
}

function taskSheet(t) {
  sheet(`<p class="cap">${esc(proj(t.p)?.name || '')} · ${L.SIZES[t.size].hint}</p><h3>${esc(t.title)}</h3>
    <div class="col"><button class="btn big ink" data-a="take" data-id="${t.id}">Взять в работу</button>
    <button class="btn big line" data-a="done" data-id="${t.id}">Уже сделал<span class="plus">+${L.XP.task[t.size]}</span></button></div>
    <form class="col" data-f="editTask" data-id="${t.id}"><p class="cap">Изменить</p>
      <input name="title" value="${esc(t.title)}" maxlength="140" aria-label="Текст">
      <div class="row"><select name="p" aria-label="Проект">${projOptions(t.p)}</select><select name="size" aria-label="Размер">${sizeOptions(t.size)}</select></div>
      <label class="chk"><input type="checkbox" name="rep" ${t.rep ? 'checked' : ''}> Повторяемая — не исчезает после выполнения</label>
      <div class="duo"><button class="btn ink">Сохранить</button>
      <button type="button" class="btn danger" data-a="taskDel" data-id="${t.id}" data-confirm="Точно?">Удалить</button></div></form>`);
}

function projSheet(p) {
  const isNew = !p;
  p ??= { id: '', name: '', prio: 'mid' };
  sheet(`<p class="cap">${isNew ? 'Новый проект' : 'Проект'}</p>
    <form class="col" data-f="saveProj" data-id="${p.id}">
      <input name="name" value="${esc(p.name)}" placeholder="Название" maxlength="60" aria-label="Название" required>
      <select name="prio" aria-label="Приоритет">${Object.entries(L.PRIO_LABEL).map(([k, v]) => `<option value="${k}" ${k === p.prio ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <p class="note">Главные проекты чаще выпадают в карточках «тянет залипнуть».</p>
      <button class="btn big ink">Сохранить</button>
      ${isNew ? '' : `<button type="button" class="btn big danger" data-a="projDel" data-id="${p.id}" data-confirm="Удалить вместе с карточками?">Удалить проект</button>`}
    </form>`);
}

// ---------- награды ----------

function rewardsView() {
  const bal = L.balance(S);
  const got = L.ACH.filter((a) => S.ach[a.id]).length;
  const rs = [...S.rewards].sort((a, b) => a.cost - b.cost);
  let h = `<section class="hero"><span class="cap">Баланс XP</span>
      <div class="hero-main"><div>${D.dotText(D.group(bal), 72)}</div></div>
      <p class="note num">Заработано ${D.group(S.xpTotal)} · потрачено ${D.group(S.spent)}. Уровень от трат не падает.</p></section>
    <section class="card"><div class="card-top"><div class="cap strong">Магазин наград</div></div><div class="col">${rs
      .map(
        (r) => `<div class="reward"><button class="grow rew-title" data-a="rewEdit" data-id="${r.id}" aria-label="Изменить: ${esc(r.title)}"><div>${esc(r.title)}</div><div class="track"><i style="width:${Math.min(100, (bal / r.cost) * 100)}%"></i></div></button>
        <button class="btn sm ${bal >= r.cost ? 'accent' : 'line'} num" data-a="buy" data-id="${r.id}" ${bal < r.cost ? 'disabled' : ''}>${D.group(r.cost)}</button></div>`,
      )
      .join('')}</div>
      <button class="btn line wide" data-a="rewEdit">Своя награда</button></section>
    <div class="row between"><span class="cap strong">Ачивки</span><span class="cap num">${got} / ${L.ACH.length}</span></div>
    <div class="achs">${L.ACH.map((a) => {
      if (S.ach[a.id]) return `<div class="ach got"><span class="dot"></span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`;
      if (a.secret) return `<div class="ach"><span class="dot"></span><b>Секрет</b><small>Откроется сама</small></div>`;
      return `<div class="ach"><span class="dot"></span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`;
    }).join('')}</div>`;
  if (S.purchases.length) {
    h += `<section class="card"><div class="cap strong">Получено</div><div class="col">${S.purchases
      .slice(0, 15)
      .map((p) => `<div class="reward"><div class="grow">${esc(p.title)}<div class="note">${esc(fmtDay(L.dkey(new Date(p.t))))}</div></div><span class="cap num">−${D.group(p.cost)}</span></div>`)
      .join('')}</div></section>`;
  }
  return h;
}

function rewardSheet(r) {
  const isNew = !r;
  r ??= { id: '', title: '', cost: 500 };
  sheet(`<p class="cap">${isNew ? 'Своя награда' : 'Награда'}</p>
    <form class="col" data-f="saveRew" data-id="${r.id}">
      <input name="title" value="${esc(r.title)}" placeholder="Что это" maxlength="80" required aria-label="Название">
      <label class="cap" for="rewCost">Цена в XP · в день выходит примерно 100–150</label>
      <input id="rewCost" name="cost" type="number" inputmode="numeric" min="10" step="10" value="${r.cost}">
      <button class="btn big ink">Сохранить</button>
      ${isNew ? '' : `<button type="button" class="btn big danger" data-a="rewDel" data-id="${r.id}" data-confirm="Точно удалить?">Удалить</button>`}
    </form>`);
}

// ---------- «Ещё» ----------

function monthCal(habit, offset) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const k0 = L.dkey(first);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const k = today();
  let cells = WD.map((w) => `<span>${w}</span>`).join('') + '<i class="blank"></i>'.repeat(lead);
  let count = 0;
  for (let i = 0; i < days; i++) {
    const c = cell(habit, L.addDays(k0, i), k);
    if (c.startsWith('ok')) count++;
    cells += `<i class="d ${c}"></i>`;
  }
  const month = new Intl.DateTimeFormat('ru', { month: 'long' }).format(first);
  return `<div class="cal-head"><div><div class="month">${esc(month)}</div><div class="cap">${first.getFullYear()}</div></div>
      <div class="center" style="align-items:flex-end;gap:6px">${D.dotText(count, 44, 'accent')}<span class="cap">${plural(count, 'день', 'дня', 'дней')}</span></div></div>
    <div class="cal" aria-hidden="true">${cells}</div>
    <div class="row between"><div class="legend">
      <span><i class="d ok"></i>сделано</span>${habit === 'walk' ? '<span><i class="d mini"></i>мини</span>' : ''}
      <span><i class="d frz"></i>заморозка</span><span><i class="d miss"></i>пропуск</span></div>
      <div class="row"><button class="circle" data-a="calNav" data-v="-1" aria-label="Предыдущий месяц">${D.icon('left')}</button>
      <button class="circle" data-a="calNav" data-v="1" aria-label="Следующий месяц" ${offset >= 0 ? 'disabled' : ''}>${D.icon('right')}</button></div></div>`;
}

function moreView() {
  const k = today();
  const st = L.stats(S, k);
  const trig = Object.entries(S.triggers).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const backup = S.lastBackup ? `последняя — ${fmtDay(S.lastBackup)}` : 'ещё не было';
  const s2 = (n, label) => `<div><span class="light">${n}</span><div class="cap">${label}</div></div>`;
  return `${seg('calHabit', ui.calHabit, [['walk', 'Выход'], ['clean', 'Без ленты']])}
    <section class="card">${monthCal(ui.calHabit, ui.calMonth)}</section>

    <section class="card"><div class="cap strong">Статистика</div><div class="stats">
      ${s2(st.walkAny, 'выходов всего')}${s2(st.walkBest, 'лучшая серия выходов')}
      ${s2(st.cleanTotal, 'дней без ленты')}${s2(st.cleanBest, 'лучшая серия без ленты')}
      ${s2(st.urges, 'побеждённых порывов')}${s2(st.tasks, 'карточек сделано')}
      ${s2(st.comebacks, 'возвращений')}${s2(st.breaths, 'дыхательных сессий')}</div>
      ${trig.length ? `<div><div class="cap">Что тянет к срывам</div><p class="note">${trig.map(([t, n]) => `${esc(t)} — ${n}`).join(' · ')}</p></div>` : ''}
    </section>

    <section class="card"><div class="cap strong">Ступени утреннего выхода</div>
      <p class="note">Новая ступень — когда текущая ${L.LADDER_DAYS} дней подряд даётся легко. Тяжело — смело спускайся.</p>
      <ol class="ladder">${L.LADDER.map((s) => `<li class="${s.n === S.walkLevel ? 'cur' : ''}">${esc(s.name)} · ${s.xp} XP</li>`).join('')}</ol>
      <div class="duo"><button class="btn line" data-a="ladder" data-v="1" ${S.walkLevel >= L.LADDER.length ? 'disabled' : ''}>Выше</button>
      <button class="btn line" data-a="ladder" data-v="-1" ${S.walkLevel <= 1 ? 'disabled' : ''}>Ниже</button></div></section>

    <section class="card"><div class="cap strong">Правила контента</div>
      <form class="col" data-f="saveRules">
        <label class="cap" for="rNo">Нельзя · по строке на пункт</label><textarea id="rNo" name="no">${esc(S.rules.no.join('\n'))}</textarea>
        <label class="cap" for="rWhen">Можно в наушниках, когда</label><textarea id="rWhen" name="when">${esc(S.rules.when.join('\n'))}</textarea>
        <label class="cap" for="rWork">Во время работы</label><input id="rWork" name="work" value="${esc(S.rules.work)}">
        <button class="btn ink wide">Сохранить правила</button></form></section>

    <section class="card"><div class="cap strong">Данные</div>
      <p class="note">Всё хранится только на этом телефоне. Резервная копия: ${backup}. Сохраняй её в «Файлы» раз в неделю-две.</p>
      <div class="duo"><button class="btn ink" data-a="export">Сохранить копию</button><button class="btn line" data-a="import">Восстановить</button></div>
      <label class="switch"><span>Звуки</span><input type="checkbox" data-a="sound" ${S.settings.sound ? 'checked' : ''}></label>
    </section>

    <section class="card science"><div class="cap strong">Почему это работает</div>
      <p><b>66 дней</b> — медиана формирования привычки в исследованиях (разброс 4–335). Пропуск одного дня процесс не ломает.</p>
      <p><b>XP сразу</b>: мгновенная награда держит мотивацию лучше отложенной (Woolley & Fishbach, 2018).</p>
      <p><b>Возвращение ×2</b>: в мегаисследовании на 61 тыс. человек лучше всего сработал бонус за возвращение после пропуска.</p>
      <p><b>Заморозки</b>: серия, которую можно «починить», меньше демотивирует при пропуске (Silverman & Barasch, 2023).</p>
      <p><b>Сундуки</b>: награда, выпадающая не каждый раз, — механизм лент, только работающий на тебя.</p>
      <p><b>Циклический вздох</b>: 5 минут в день улучшали настроение сильнее медитации (Balban et al., 2023).</p>
      <p><b>Подкаст только по дороге</b> связывает нужное с приятным (Milkman, 2014).</p>
    </section>

    <section class="card"><div class="cap strong">Сброс</div><p class="note">Удалит весь прогресс на этом телефоне. Сначала сохрани копию.</p>
      <button class="btn danger wide" data-a="reset" data-confirm="Точно стереть всё?">Начать заново</button></section>`;
}

// ---------- резервная копия ----------

async function exportData() {
  const name = `ritm-backup-${today()}.json`;
  const file = new File([JSON.stringify(S)], name, { type: 'application/json' });
  const done = () => {
    S.lastBackup = today();
    save();
    render();
    toast('Копия сохранена');
  };
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Ритм — резервная копия' });
      return done();
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  done();
}

$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const raw = JSON.parse(await f.text());
    if (raw?.v !== 1 || typeof raw.days !== 'object') throw new Error('format');
    ui.pendingImport = raw;
    sheet(`<p class="cap">Восстановление</p><h3>Заменить данные копией?</h3>
      <p class="note">В файле: ${Object.keys(raw.days).length} дней, ${raw.xpTotal} XP, старт ${esc(raw.start)}. Текущие данные на телефоне заменятся.</p>
      <button class="btn big ink" data-a="importGo">Восстановить</button>`);
  } catch {
    toast('Это не похоже на копию «Ритма»');
  }
});

// ---------- рендер ----------

const views = { today: todayView, deck: deckView, rewards: rewardsView, more: moreView };
const TABS = [
  ['today', 'Сегодня'],
  ['deck', 'Колода'],
  ['rewards', 'Награды'],
  ['more', 'Ещё'],
];

function render() {
  renderedDay = today();
  $('#app').innerHTML = `${header()}<main>${views[tab]()}</main><nav class="tabs">${seg('tab', tab, TABS)}</nav>`;
}

// ---------- действия ----------

const A = {
  tab: ({ v }) => {
    tab = v;
    render();
    scrollTo(0, 0);
  },
  close: () => closeSheet(),
  hideInstall: () => {
    ui.hideInstall = true;
    render();
  },
  levelInfo: () => levelSheet(),

  walk: ({ v }) => act(() => L.doWalk(S, today(), +v, hhmm())),
  walkUndo: () => act(() => L.undoWalk(S, today())),
  clean: ({ k }) => act(() => L.answerClean(S, k, true)),
  slipAsk: ({ k }) => slipSheet(k),
  slip: ({ k, v }) => {
    closeSheet();
    act(() => L.answerClean(S, k, false, Math.random, v || null));
  },
  cleanUndo: ({ k }) => act(() => L.undoClean(S, k)),
  review: () => act(() => L.doReview(S, today())),

  urge: () => {
    urgeSheet(L.urgeXp(S, today()));
    act(() => L.doUrge(S, today()));
  },
  reshuffle: () => urgeSheet(0, true),
  cards: () => urgeSheet(0, true),
  breath: () => breathSheet(),
  breathGo: () => {
    $('#breathBtn')?.remove();
    runBreath(60);
  },

  take: ({ id }) => {
    const t = task(id);
    if (!t) return;
    S.active = { id, t: Date.now() };
    save();
    render();
    takenSheet(t);
  },
  done: ({ id }) => {
    if (sheetOpen()) closeSheet();
    act(() => L.completeTask(S, id, today()));
  },
  drop: () => {
    S.active = null;
    save();
    render();
  },
  task: ({ id }) => {
    const t = task(id);
    if (t) taskSheet(t);
  },
  undone: ({ id }) => act(() => L.uncompleteTask(S, id)),
  taskDel: ({ id }) => {
    S.tasks = S.tasks.filter((t) => t.id !== id);
    if (S.active?.id === id) S.active = null;
    closeSheet();
    save();
    render();
  },
  sizeFilter: ({ v }) => {
    ui.size = v;
    render();
  },
  projToggle: ({ id }) => {
    const p = proj(id);
    ui.openProj[id] = !(ui.openProj[id] ?? (p?.prio === 'high' || ui.size !== 'all'));
    render();
  },
  projEdit: ({ id }) => projSheet(id ? proj(id) : null),
  projDel: ({ id }) => {
    S.projects = S.projects.filter((p) => p.id !== id);
    S.tasks = S.tasks.filter((t) => t.p !== id);
    if (S.active && !task(S.active.id)) S.active = null;
    closeSheet();
    save();
    render();
  },

  chest: () => showChest(),
  openChest: () => {
    let res = null;
    act(() => {
      res = L.openChest(S);
      return res?.xp ? [{ type: 'xp', amount: res.xp }] : [];
    });
    if (!res) return closeSheet();
    sfx.chest();
    confetti();
    const big = res.kind === 'freeze' ? D.icon('snow', 72) : D.dotText('+' + res.xp, 72, 'accent');
    const label = res.kind === 'jackpot' ? 'Джекпот' : res.kind === 'freeze' ? `Заморозка · ${HABIT[res.habit]}` : 'XP из сундука';
    sheet(`<div class="center"><p class="cap">${label}</p>${big}
      ${S.pendingChests ? '<button class="btn big accent" data-a="chest">Следующий сундук</button>' : '<button class="btn big ink" data-a="close">Забрать</button>'}</div>`);
  },

  buy: ({ id }) => {
    const r = S.rewards.find((x) => x.id === id);
    if (!r) return;
    sheet(`<p class="cap">Награда</p><h3>${esc(r.title)}</h3>
      <p class="note num">Потратить ${D.group(r.cost)} XP? Останется ${D.group(L.balance(S) - r.cost)}.</p>
      <button class="btn big accent" data-a="buyGo" data-id="${r.id}">Взять награду</button>`);
  },
  buyGo: ({ id }) => {
    let okBuy = false;
    act(() => {
      okBuy = L.buy(S, id);
      return [];
    });
    if (!okBuy) return closeSheet();
    sfx.chest();
    confetti();
    sheet(`<div class="center"><p class="cap">Награда твоя</p><h3>Наслаждайся</h3><p class="note">Ты это заработал. Без чувства вины.</p>
      <button class="btn big ink" data-a="close">Спасибо</button></div>`);
  },
  rewEdit: ({ id }) => rewardSheet(id ? S.rewards.find((r) => r.id === id) : null),
  rewDel: ({ id }) => {
    S.rewards = S.rewards.filter((r) => r.id !== id);
    closeSheet();
    save();
    render();
  },

  calHabit: ({ v }) => {
    ui.calHabit = v;
    render();
  },
  calNav: ({ v }) => {
    ui.calMonth = Math.min(0, ui.calMonth + Number(v));
    render();
  },
  ladderUp: () => A.ladder({ v: '1' }),
  ladder: ({ v }) => {
    act(() => L.setWalkLevel(S, S.walkLevel + Number(v), today()));
    toast(`Ступень ${S.walkLevel}: ${L.LADDER[S.walkLevel - 1].name}`);
  },
  sound: (_, el) => {
    S.settings.sound = el.checked;
    save();
  },
  export: () => exportData(),
  import: () => $('#importFile').click(),
  importGo: () => {
    S = L.hydrate(ui.pendingImport, today(), makeSeed());
    ui.pendingImport = null;
    L.rollover(S, today());
    save();
    closeSheet();
    render();
    toast('Данные восстановлены');
  },
  reset: () => {
    localStorage.removeItem(KEY);
    S = L.newState(today(), makeSeed());
    save();
    tab = 'today';
    render();
    toast('Начинаем заново');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  if (el.type === 'checkbox') return; // чекбоксы — по change
  if (el.dataset.confirm && !el.dataset.armed) {
    e.preventDefault();
    el.dataset.armed = '1';
    el.dataset.label = el.textContent;
    el.textContent = el.dataset.confirm;
    setTimeout(() => {
      if (el.isConnected) {
        delete el.dataset.armed;
        el.textContent = el.dataset.label;
      }
    }, 3500);
    return;
  }
  e.preventDefault();
  A[el.dataset.a]?.(el.dataset, el);
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('input[type=checkbox][data-a]');
  if (el) A[el.dataset.a]?.(el.dataset, el);
});

const forms = {
  addTask: (fd) => {
    const title = fd.get('title').trim();
    if (!title) return;
    ui.lastP = fd.get('p');
    S.tasks.push({ id: L.uid(), p: fd.get('p'), size: fd.get('size'), title, rep: false, count: 0, done: false, doneAt: null });
    ui.openProj[ui.lastP] = true;
    save();
    render();
    toast('Карточка в колоде');
    $('form[data-f=addTask] input[name=title]')?.focus();
  },
  editTask: (fd, f) => {
    const t = task(f.dataset.id);
    if (!t) return;
    Object.assign(t, { title: fd.get('title').trim() || t.title, p: fd.get('p'), size: fd.get('size'), rep: fd.get('rep') === 'on' });
    closeSheet();
    save();
    render();
  },
  saveProj: (fd, f) => {
    const data = { name: fd.get('name').trim(), prio: fd.get('prio') };
    if (!data.name) return;
    const p = proj(f.dataset.id);
    if (p) Object.assign(p, data);
    else S.projects.push({ id: L.uid(), icon: '', ...data });
    closeSheet();
    save();
    render();
  },
  saveRew: (fd, f) => {
    const data = { title: fd.get('title').trim(), cost: Math.max(10, Math.round(Number(fd.get('cost')) || 0)) };
    if (!data.title) return;
    const r = S.rewards.find((x) => x.id === f.dataset.id);
    if (r) Object.assign(r, data);
    else S.rewards.push({ id: L.uid(), icon: '', ...data });
    closeSheet();
    save();
    render();
  },
  saveRules: (fd) => {
    const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
    S.rules = { no: lines(fd.get('no')), when: lines(fd.get('when')), work: fd.get('work').trim() };
    save();
    render();
    toast('Правила сохранены');
  },
};

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-f]');
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.f]?.(new FormData(f), f);
});

// Приложение на iPhone может висеть в фоне сутками: при возвращении проверяем, не сменился ли день.
function refreshDay() {
  if (today() === renderedDay) return;
  const evs = L.rollover(S, today());
  act(() => evs);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDay();
});
setInterval(refreshDay, 60_000);

// ---------- старт ----------

act(() => L.rollover(S, today()));
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
