import * as L from './logic.js';
import { makeSeed } from './seed.js';

const KEY = 'ritm.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => L.dkey(new Date());
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtDay = (k) => new Intl.DateTimeFormat('ru', { weekday: 'short', day: 'numeric', month: 'short' }).format(L.parseKey(k));
const HABIT = { walk: 'Утренний выход', clean: 'Без ленты' };
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
const ui = { openProj: {}, cards: [], lastP: null, hideInstall: false };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.v === 1) return L.hydrate(raw, today(), makeSeed());
  } catch {
    /* повреждённые данные — начинаем заново, но не перетираем до первого сохранения */
  }
  return L.newState(today(), makeSeed());
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    toast('⚠️ Не удалось сохранить данные');
  }
}
const proj = (id) => S.projects.find((p) => p.id === id);
const task = (id) => S.tasks.find((t) => t.id === id);

// ---------- звук (короткие синт-сигналы, WebAudio) ----------

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
    /* звук — необязательная часть */
  }
}
const sfx = {
  xp: () => tone([880, 1320], 0.07),
  ach: () => tone([523, 659, 784, 1047], 0.09),
  chest: () => tone([392, 523, 659, 784, 1047, 1319], 0.06),
  level: () => tone([392, 494, 587, 784, 988, 1175], 0.08, 'square', 0.08),
};

// ---------- всплывашки и праздники ----------

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
  el.textContent = `+${n} XP`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
  sfx.xp();
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ff8a3d', '#34d399', '#8b7bff', '#7dd3fc', '#fbbf24'];
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.35 + 's';
    s.style.animationDuration = 1.1 + Math.random() * 0.9 + 's';
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}

// ---------- события: XP, ачивки, уровни, сундуки ----------

const queue = [];
const sheetOpen = () => $('#sheet').classList.contains('open');

function handle(evs) {
  for (const e of evs) {
    if (e.type === 'xp') floatXp(e.amount);
    else if (e.type === 'freezeEarned') toast(`❄️ +1 заморозка («${HABIT[e.habit]}») — неделя подряд!`);
    else if (e.type === 'freezeUsed') toast(`❄️ Заморозка сохранила серию «${HABIT[e.habit]}» (${fmtDay(e.k)})`);
    else if (e.type === 'comeback') toast('🔄 Возвращение после пропуска — ×2 XP');
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

// Любое действие: выполнить, проверить ачивки и уровень, сохранить, перерисовать, показать события.
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
  root.innerHTML = `<div class="backdrop" data-a="close"></div><div class="panel" role="dialog" aria-modal="true"><button class="x" data-a="close" aria-label="Закрыть">✕</button>${html}</div>`;
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
  sheet(`<div class="center"><div class="big-ic">${a.icon}</div><p class="tiny">Новая ачивка</p><h3>${esc(a.name)}</h3>
    <p>${esc(a.desc)}</p><p><span class="pill xp">+${a.xp} XP</span></p>
    <button class="btn big xp" data-a="close">Круто</button></div>`);
}
function showLevel(n) {
  sfx.level();
  confetti();
  const li = L.levelInfo(S.xpTotal);
  sheet(`<div class="center"><div class="big-ic">⬆️</div><p class="tiny">Новый уровень</p><h3>Уровень ${n} · ${esc(li.title)}</h3>
    <p class="tiny">Уровень растёт от всего заработанного XP и не падает, когда тратишь XP в магазине.</p>
    <button class="btn big xp" data-a="close">Дальше</button></div>`);
}
function showChest() {
  if (!S.pendingChests) return nextEvent();
  sheet(`<div class="center"><div class="chest-ic">🎁</div><h3>Сундук!</h3>
    <p class="tiny">Внутри XP, заморозка серии или джекпот.</p>
    <button class="btn big xp" data-a="openChest">Открыть</button></div>`);
}

// ---------- экран «Сегодня» ----------

function header() {
  const li = L.levelInfo(S.xpTotal);
  const pct = Math.round((li.into / li.need) * 100);
  return `<header class="top">
    <div class="lvl"><div class="badge">${li.level}</div>
      <div class="lvl-txt"><div class="lvl-title">${esc(li.title)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="tiny num">${li.into} / ${li.need} XP до ур. ${li.level + 1}</div></div></div>
    <button class="bal" data-a="tab" data-v="rewards">💠 ${L.balance(S)}</button>
  </header>`;
}

function chain(habit, k) {
  let cells = '';
  for (let i = 13; i >= 0; i--) {
    const x = L.addDays(k, -i);
    const d = S.days[x];
    let c = 'miss';
    if (x < S.start) c = 'pre';
    else if (habit === 'walk') {
      if (d?.walk === 2) c = 'ok';
      else if (d?.walk === 1) c = 'mini';
      else if (d?.walkFrozen) c = 'frz';
      else if (x === k) c = 'now';
    } else if (d?.clean === true) c = 'ok';
    else if (d?.clean === false) c = d.cleanFrozen ? 'frz' : 'bad';
    else c = x === k ? 'now' : 'q';
    cells += `<i class="c ${c}"></i>`;
  }
  return `<div class="chain ${habit}" aria-hidden="true">${cells}</div>`;
}

function meta(habit, streak, total) {
  return `<div class="meta"><span>🔥 ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд</span>
    <span title="Заморозки: спасают серию при пропуске">❄️ ${S.freezes[habit]}</span>
    <span class="goal">${Math.min(total, L.GOAL)} / ${L.GOAL}</span></div>
    <div class="bar ${habit}"><i style="width:${Math.min(100, (total / L.GOAL) * 100)}%"></i></div>`;
}

function walkCard(k, d, st) {
  const lv = L.LADDER[S.walkLevel - 1];
  let body;
  if (d.walk >= 1) {
    body = `<div class="done-row"><span class="check">✓</span>
      <div class="grow">${d.walk === 2 ? 'Дошёл' : 'Мини-версия'} в ${esc(d.walkAt)} · <b>+${d.walkXp} XP</b>${d.walkCb ? ' · возвращение' : ''}</div>
      <button class="link" data-a="walkUndo">отменить</button></div>`;
  } else {
    const cb = L.isComeback(S, 'walk', k);
    const label = lv.n === 1 ? 'Дошёл до площадки' : `Выполнил ступень ${lv.n}`;
    body = `<button class="btn big walk" data-a="walk" data-v="2">${label} <span class="pill">+${lv.xp * (cb ? 2 : 1)}</span></button>
      ${cb ? '<p class="tiny accent">Был пропуск — сегодня возвращение, XP ×2</p>' : ''}
      <button class="link" data-a="walk" data-v="1">Тяжёлый день? Мини-версия: выйти на улицу на 2 минуты (+${L.XP.walkMini * (cb ? 2 : 1)})</button>`;
  }
  const up = L.canLevelUp(S, k)
    ? `<button class="banner soft" data-a="ladderUp">🪜 ${L.LADDER_DAYS} дней подряд на этой ступени. Готов подняться выше? →</button>`
    : '';
  return `<section class="card">
    <div class="card-h"><span class="ic walk-ic">👟</span><div class="grow"><h2>Утренний выход</h2>
      <p class="tiny">Ступень ${lv.n}: ${esc(lv.name)}</p></div></div>
    ${body}${meta('walk', st.walkStreak, st.walkAny)}${chain('walk', k)}${up}
  </section>`;
}

function rulesBlock() {
  const r = S.rules;
  return `<details class="rules"><summary>Правила контента</summary>
    <p class="tiny b">Нельзя</p><ul>${r.no.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="tiny b">Можно в наушниках, когда</p><ul>${r.when.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="tiny">${esc(r.work)}</p></details>`;
}

function cleanCard(k, d, st) {
  const pending = L.cleanQueue(S, k);
  const y = L.addDays(k, -1);
  const yd = S.days[y];
  let body;
  if (pending.length) {
    const q = pending[0];
    const cb = L.isComeback(S, 'clean', q);
    const label = q === y ? `Вчера, ${fmtDay(q)}` : fmtDay(q);
    body = `<p class="q">${label} — без ленты?</p>
      <div class="row2"><button class="btn big clean" data-a="clean" data-k="${q}">Да ✓ <span class="pill">+${L.XP.clean * (cb ? 2 : 1)}</span></button>
      <button class="btn big ghost" data-a="slipAsk" data-k="${q}">Нет</button></div>
      ${cb ? '<p class="tiny accent">После срыва — возвращение, XP ×2</p>' : ''}
      ${pending.length > 1 ? `<p class="tiny">Ещё дней без ответа: ${pending.length - 1}</p>` : ''}`;
  } else if (d.clean === false) {
    body = `<div class="done-row bad"><span class="check">·</span>
      <div class="grow">Срыв отмечен.${d.cleanFrozen ? ' ❄️ Заморозка сохранила серию.' : ''} Не пропускай дважды: завтра возвращение ×2.</div>
      <button class="link" data-a="cleanUndo" data-k="${k}">отменить</button></div>`;
  } else if (d.clean === true) {
    body = `<div class="done-row"><span class="check">✓</span><div class="grow">День закрыт без ленты · <b>+${d.cleanXp} XP</b></div>
      <button class="link" data-a="cleanUndo" data-k="${k}">отменить</button></div>`;
  } else {
    const late = new Date().getHours() >= 19;
    body = `<p class="tiny">${late ? 'Вечер. Если день прошёл без ленты — закрой его.' : 'Держишься. Отметишь вечером или завтра утром.'}</p>
      ${late ? `<button class="btn mid clean" data-a="clean" data-k="${k}">Закрыть день без ленты ✓</button>` : ''}
      <button class="link" data-a="slipAsk" data-k="${k}">Сорвался сегодня</button>`;
    if (y >= S.start && yd && yd.clean != null) {
      body += `<p class="tiny">Вчера: ${yd.clean ? '✓ без ленты' : 'срыв'} · <button class="link inline" data-a="cleanUndo" data-k="${y}">изменить</button></p>`;
    }
  }
  return `<section class="card">
    <div class="card-h"><span class="ic clean-ic">🧘</span><div class="grow"><h2>Без ленты</h2>
      <p class="tiny">Контент — только по правилам</p></div></div>
    ${body}${meta('clean', st.cleanStreak, st.cleanTotal)}${chain('clean', k)}${rulesBlock()}
  </section>`;
}

function banners(k) {
  let h = '';
  if (!standalone() && !ui.hideInstall) {
    h += `<div class="banner soft"><span>📲 Установи на экран «Домой»: в Safari нажми «Поделиться» → «На экран Домой». Отмечай только из приложения: у Safari и у иконки разные хранилища.</span>
      <button class="link" data-a="hideInstall">✕</button></div>`;
  }
  if (S.active) {
    const t = task(S.active.id);
    if (t) {
      h += `<div class="banner active"><div class="grow"><div class="tiny">В работе</div><b>${esc(t.title)}</b></div>
        <div class="row"><button class="btn good sm" data-a="done" data-id="${t.id}">Готово</button>
        <button class="btn ghost sm" data-a="drop" aria-label="Убрать">✕</button></div></div>`;
    }
  }
  if (S.pendingChests > 0) {
    h += `<button class="banner chest" data-a="chest">🎁 Неоткрытый сундук${S.pendingChests > 1 ? ` ×${S.pendingChests}` : ''}<span>Открыть →</span></button>`;
  }
  const since = L.diffDays(S.lastBackup || S.start, k);
  if (since >= 14) h += `<button class="banner soft" data-a="tab" data-v="more">💾 Резервной копии не было ${since} ${plural(since, 'день', 'дня', 'дней')} — сохранить →</button>`;
  return h;
}

function todayView() {
  const k = today();
  const d = S.days[k] || {};
  const st = L.stats(S, k);
  const h = new Date().getHours();
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const n = L.diffDays(S.start, k) + 1;
  let html = `<p class="hello">${hello} · день ${n}</p>${banners(k)}${walkCard(k, d, st)}${cleanCard(k, d, st)}
    <button class="urge" data-a="urge"><span class="urge-t">🌊 Тянет залипнуть</span>
      <span class="tiny">нажми вместо ленты · сегодня ${d.urges || 0} · всего ${S.counters.urges}</span></button>`;
  if (new Date().getDay() === 0) {
    html += d.review
      ? `<div class="banner soft">🗂 Колода на неделю пополнена ✓</div>`
      : `<section class="card"><h2>🗂 Воскресенье: пополни колоду</h2>
        <p class="tiny">15 минут: разрежь проекты на карточки по 10–15 минут на неделю вперёд. Тогда в момент «тянет» думать не придётся.</p>
        <div class="row"><button class="btn sm ghost" data-a="tab" data-v="deck">Открыть колоду</button>
        <button class="btn sm good" data-a="review">Сделал +${L.XP.review}</button></div></section>`;
  }
  return html;
}

// ---------- шторки: тяга, дыхание, карточки, срыв ----------

function cardHtml(t) {
  const p = proj(t.p);
  const s = L.SIZES[t.size];
  return `<button class="tcard ${t.size}" data-a="take" data-id="${t.id}">
    <span class="tc-top"><span>${esc(p ? p.icon + ' ' + p.name : '')}</span><span>${s.icon} ${s.hint}</span></span>
    <span class="tc-title">${esc(t.title)}</span><span class="pill xp">+${L.XP.task[t.size]} XP</span></button>`;
}

function urgeSheet(xp, reshuffle = false) {
  const picked = L.pickCards(S, Math.random, reshuffle ? ui.cards : []);
  ui.cards = picked.map((t) => t.id);
  const r = S.rules;
  const head = reshuffle
    ? ''
    : `<h3>🌊 Ты заметил тягу</h3>
      <p>${xp ? `<span class="pill xp">+${xp} XP</span> ` : ''}Это уже победа. Тяга накатывает волной и спадает, если её не кормить. Направь энергию сюда:</p>`;
  sheet(`${head || '<h3>Другие карточки</h3>'}
    <button class="tcard" data-a="breath"><span class="tc-top"><span>🌿 Перезагрузка</span><span>1 мин</span></span>
      <span class="tc-title">🫁 Подышать: циклический вздох</span><span class="pill xp">+${L.XP.breath} XP</span></button>
    ${picked.map(cardHtml).join('') || '<p class="tiny">Колода пуста — добавь карточки во вкладке «Колода».</p>'}
    <button class="btn mid ghost" data-a="reshuffle">🔄 Другие карточки</button>
    <p class="tiny">По правилам подкаст или аудиокнигу можно, если: ${esc(r.when.map((x) => x.toLowerCase()).join(', '))}.</p>`);
}

function breathSheet() {
  sheet(`<div class="center"><h3>Циклический вздох</h3>
    <p class="tiny">Два вдоха носом подряд (второй — короткий, «добрать»), потом длинный медленный выдох ртом. Минута.</p>
    <div class="breath"><div class="orb" id="orb"></div><div class="orb-label" id="orbL">Готов?</div></div>
    <p class="tiny num" id="orbT">1:00</p>
    <button class="btn big xp" id="breathBtn" data-a="breathGo">Начать</button></div>`);
}

function runBreath(total) {
  const orb = $('#orb');
  const lab = $('#orbL');
  const tl = $('#orbT');
  const end = Date.now() + total * 1000;
  const phases = [
    ['Вдох носом', 2000, 0.95],
    ['Ещё короткий вдох', 1000, 1.12],
    ['Долгий выдох ртом', 6000, 0.6],
  ];
  let i = 0;
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
    tl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }, 250);
  step();
}

function finishBreath() {
  stopBreath();
  sheet(`<div class="center"><div class="big-ic">🌿</div><h3>Готово</h3>
    <p>Заметь, как сейчас: тяга стала слабее? Можно ещё минуту или взять карточку.</p>
    <div class="col"><button class="btn mid xp" data-a="breath">Ещё минута</button>
    <button class="btn mid ghost" data-a="cards">Выбрать карточку</button>
    <button class="btn mid ghost" data-a="close">Закрыть</button></div></div>`);
  act(() => L.doBreath(S));
}

function takenSheet(t) {
  sheet(`<p class="tiny">Поехали</p><h3>${esc(t.title)}</h3>
    <p class="tiny">${L.SIZES[t.size].icon} ${L.SIZES[t.size].hint}. Закончишь — нажми «Готово». Можно позже: карточка будет висеть сверху на главном экране.</p>
    <div class="col"><button class="btn big good" data-a="done" data-id="${t.id}">Готово ✓ +${L.XP.task[t.size]} XP</button>
    <button class="btn mid ghost" data-a="close">Закрыть</button></div>`);
}

function slipSheet(k) {
  const total = L.stats(S, today()).cleanTotal;
  const when = k === today() ? 'сегодня' : fmtDay(k);
  sheet(`<h3>Бывает</h3>
    <p>Срыв (${esc(when)}) не обнуляет прогресс: чистых дней всего — <b>${total}</b>. Главное — не пропускать дважды. ${S.freezes.clean ? 'Заморозка прикроет серию.' : ''}</p>
    <p class="tiny b">Что потянуло? Для себя, чтобы видеть закономерности</p>
    <div class="chips">${L.TRIGGERS.map((t) => `<button class="chip" data-a="slip" data-k="${k}" data-v="${t}">${t}</button>`).join('')}</div>
    <button class="btn mid ghost" data-a="slip" data-k="${k}" data-v="">Пропустить</button>`);
}

// ---------- колода ----------

function projOptions(sel) {
  return S.projects.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.icon)} ${esc(p.name)}</option>`).join('');
}
function sizeOptions(sel = 'mid') {
  return Object.entries(L.SIZES)
    .map(([k, s]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${s.icon} ${s.label} · ${s.hint}</option>`)
    .join('');
}

function deckView() {
  const ps = [...S.projects].sort((a, b) => L.PRIO[b.prio] - L.PRIO[a.prio]);
  let h = `<h1>Колода</h1>
    <p class="tiny">Карточки для момента «тянет залипнуть». Быстрые — 1–3 минуты, средние — 10–15, глубокие — 25. Начинай с глагола: «нарисовать…», «найти…».</p>
    <form class="add" data-f="addTask">
      <input name="title" placeholder="Новая карточка…" autocomplete="off" enterkeyhint="done" maxlength="140">
      <div class="row"><select name="p" aria-label="Проект">${projOptions(ui.lastP || ps[0]?.id)}</select>
      <select name="size" aria-label="Размер">${sizeOptions()}</select></div>
      <button class="btn sm xp">Добавить</button></form>`;
  for (const p of ps) {
    const ts = S.tasks.filter((t) => t.p === p.id);
    const open = ts.filter((t) => !t.done);
    const done = ts.filter((t) => t.done);
    const isOpen = ui.openProj[p.id] ?? p.prio === 'high';
    h += `<section class="proj"><button class="proj-h" data-a="projToggle" data-id="${p.id}">
      <span class="grow">${esc(p.icon)} ${esc(p.name)}</span><span class="prio p-${p.prio}">${'●'.repeat(L.PRIO[p.prio])}</span>
      <span class="tiny num">${open.length}</span><span class="chev">${isOpen ? '▾' : '▸'}</span></button>`;
    if (isOpen) {
      h += open
        .map(
          (t) => `<button class="task" data-a="task" data-id="${t.id}"><span>${L.SIZES[t.size].icon}</span>
          <span class="grow">${esc(t.title)}${t.rep ? ` <span class="tiny">↻ ${t.count || 0}</span>` : ''}</span>
          <span class="tiny">+${L.XP.task[t.size]}</span></button>`,
        )
        .join('') || '<p class="tiny pad">Пусто — добавь карточку.</p>';
      if (done.length) {
        h += `<details class="donelist"><summary>Сделано: ${done.length}</summary>${done
          .map((t) => `<div class="task done"><span>✓</span><span class="grow">${esc(t.title)}</span><button class="link" data-a="undone" data-id="${t.id}">вернуть</button></div>`)
          .join('')}</details>`;
      }
      h += `<button class="link" data-a="projEdit" data-id="${p.id}">Настроить проект</button>`;
    }
    h += '</section>';
  }
  return h + `<button class="btn mid ghost" data-a="projEdit">+ Проект</button>`;
}

function taskSheet(t) {
  const p = proj(t.p);
  sheet(`<p class="tiny">${esc(p?.icon)} ${esc(p?.name)} · ${L.SIZES[t.size].icon} ${L.SIZES[t.size].hint}</p><h3>${esc(t.title)}</h3>
    <div class="col"><button class="btn big xp" data-a="take" data-id="${t.id}">Взять в работу</button>
    <button class="btn mid good" data-a="done" data-id="${t.id}">Уже сделал ✓ +${L.XP.task[t.size]}</button></div>
    <form class="col" data-f="editTask" data-id="${t.id}"><p class="tiny b">Изменить</p>
      <input name="title" value="${esc(t.title)}" maxlength="140" aria-label="Текст">
      <div class="row"><select name="p" aria-label="Проект">${projOptions(t.p)}</select><select name="size" aria-label="Размер">${sizeOptions(t.size)}</select></div>
      <label class="chk"><input type="checkbox" name="rep" ${t.rep ? 'checked' : ''}> Повторяемая (не исчезает после выполнения)</label>
      <div class="row"><button class="btn sm ghost grow">Сохранить</button>
      <button type="button" class="btn sm danger" data-a="taskDel" data-id="${t.id}" data-confirm="Точно удалить?">Удалить</button></div></form>`);
}

function projSheet(p) {
  const isNew = !p;
  p ??= { id: '', icon: '✨', name: '', prio: 'mid' };
  sheet(`<h3>${isNew ? 'Новый проект' : 'Проект'}</h3>
    <form class="col" data-f="saveProj" data-id="${p.id}">
      <div class="row"><input name="icon" value="${esc(p.icon)}" maxlength="4" style="width:64px;text-align:center" aria-label="Иконка">
      <input name="name" value="${esc(p.name)}" placeholder="Название" maxlength="60" class="grow" aria-label="Название" required></div>
      <select name="prio" aria-label="Приоритет">${Object.entries(L.PRIO_LABEL).map(([k, v]) => `<option value="${k}" ${k === p.prio ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <p class="tiny">Главные проекты чаще выпадают в карточках «тянет залипнуть».</p>
      <button class="btn mid xp">Сохранить</button>
      ${isNew ? '' : `<button type="button" class="btn mid danger" data-a="projDel" data-id="${p.id}" data-confirm="Удалить проект и все его карточки?">Удалить проект</button>`}
    </form>`);
}

// ---------- награды ----------

function rewardsView() {
  const bal = L.balance(S);
  const got = L.ACH.filter((a) => S.ach[a.id]).length;
  const rs = [...S.rewards].sort((a, b) => a.cost - b.cost);
  let h = `<h1>Награды</h1>
    <section class="card balance"><div><div class="tiny">Баланс</div><div class="big-num">💠 ${bal}</div></div>
      <div class="tiny right num">заработано ${S.xpTotal}<br>потрачено ${S.spent}</div></section>
    <p class="tiny">Трать XP на настоящие награды. Уровень от этого не падает. Лучшие награды — те, что двигают твои проекты.</p>
    <section class="card"><h2>Магазин</h2><div>${rs
      .map(
        (r) => `<div class="reward"><span class="r-ic">${esc(r.icon)}</span>
        <div class="grow"><div>${esc(r.title)}</div><div class="bar thin"><i style="width:${Math.min(100, (bal / r.cost) * 100)}%"></i></div></div>
        <button class="btn sm ${bal >= r.cost ? 'xp' : 'ghost'}" data-a="buy" data-id="${r.id}" ${bal < r.cost ? 'disabled' : ''}>${r.cost}</button>
        <button class="link" data-a="rewEdit" data-id="${r.id}" aria-label="Изменить">✎</button></div>`,
      )
      .join('')}</div>
      <button class="btn mid ghost" data-a="rewEdit">+ Своя награда</button></section>
    <h2>Ачивки · ${got} / ${L.ACH.length}</h2><div class="achs">${L.ACH.map((a) => {
      if (S.ach[a.id]) return `<div class="ach got"><span>${a.icon}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`;
      if (a.secret) return `<div class="ach"><span>❓</span><b>Секрет</b><small>Откроется сама</small></div>`;
      return `<div class="ach"><span class="dim">${a.icon}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`;
    }).join('')}</div>`;
  if (S.purchases.length) {
    h += `<section class="card"><h2>Получено</h2>${S.purchases
      .slice(0, 15)
      .map((p) => `<div class="reward"><span class="r-ic">${esc(p.icon)}</span><div class="grow">${esc(p.title)}<div class="tiny">${fmtDay(L.dkey(new Date(p.t)))}</div></div><span class="tiny num">−${p.cost}</span></div>`)
      .join('')}</section>`;
  }
  return h;
}

function rewardSheet(r) {
  const isNew = !r;
  r ??= { id: '', icon: '🎁', title: '', cost: 500 };
  sheet(`<h3>${isNew ? 'Своя награда' : 'Награда'}</h3>
    <form class="col" data-f="saveRew" data-id="${r.id}">
      <div class="row"><input name="icon" value="${esc(r.icon)}" maxlength="4" style="width:64px;text-align:center" aria-label="Иконка">
      <input name="title" value="${esc(r.title)}" placeholder="Что это" maxlength="80" class="grow" required aria-label="Название"></div>
      <label class="tiny">Цена в XP (в день выходит примерно 100–150)</label>
      <input name="cost" type="number" inputmode="numeric" min="10" step="10" value="${r.cost}" aria-label="Цена">
      <button class="btn mid xp">Сохранить</button>
      ${isNew ? '' : `<button type="button" class="btn mid danger" data-a="rewDel" data-id="${r.id}" data-confirm="Точно удалить?">Удалить</button>`}
    </form>`);
}

// ---------- «Ещё» ----------

function moreView() {
  const k = today();
  const st = L.stats(S, k);
  const trig = Object.entries(S.triggers).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const stat = (label, v) => `<div class="stat"><b>${v}</b><span class="tiny">${label}</span></div>`;
  const backup = S.lastBackup ? `последняя: ${fmtDay(S.lastBackup)}` : 'ещё не было';
  return `<h1>Ещё</h1>
    <section class="card"><h2>Статистика</h2><div class="stats">
      ${stat('выходов всего', st.walkAny)}${stat('лучшая серия выходов', st.walkBest)}
      ${stat('дней без ленты', st.cleanTotal)}${stat('лучшая серия без ленты', st.cleanBest)}
      ${stat('побеждённых порывов', st.urges)}${stat('карточек сделано', st.tasks)}
      ${stat('возвращений', st.comebacks)}${stat('дыхательных сессий', st.breaths)}</div>
      ${trig.length ? `<p class="tiny b">Что тянет к срывам</p><p class="tiny">${trig.map(([t, n]) => `${esc(t)} — ${n}`).join(' · ')}</p>` : ''}
    </section>

    <section class="card"><h2>Ступени утреннего выхода</h2>
      <p class="tiny">Новая ступень — только когда текущая даётся легко ${L.LADDER_DAYS} дней подряд. Если тяжело — смело спускайся.</p>
      <ol class="ladder">${L.LADDER.map((s) => `<li class="${s.n === S.walkLevel ? 'cur' : ''}">${esc(s.name)} · ${s.xp} XP</li>`).join('')}</ol>
      <div class="row"><button class="btn sm ghost" data-a="ladder" data-v="-1" ${S.walkLevel <= 1 ? 'disabled' : ''}>↓ Ниже</button>
      <button class="btn sm ghost" data-a="ladder" data-v="1" ${S.walkLevel >= L.LADDER.length ? 'disabled' : ''}>↑ Выше</button></div></section>

    <section class="card"><h2>Правила контента</h2>
      <form class="col" data-f="saveRules">
        <label class="tiny b">Нельзя (по строке на пункт)</label><textarea name="no">${esc(S.rules.no.join('\n'))}</textarea>
        <label class="tiny b">Можно в наушниках, когда…</label><textarea name="when">${esc(S.rules.when.join('\n'))}</textarea>
        <label class="tiny b">Во время работы</label><input name="work" value="${esc(S.rules.work)}">
        <button class="btn sm ghost">Сохранить правила</button></form></section>

    <section class="card"><h2>Данные</h2>
      <p class="tiny">Всё хранится только на этом телефоне. Резервная копия — ${backup}. Сохрани её в «Файлы» раз в неделю-две.</p>
      <div class="row"><button class="btn sm xp grow" data-a="export">💾 Сохранить копию</button>
      <button class="btn sm ghost grow" data-a="import">Восстановить</button></div>
      <label class="switch"><span>Звуки</span><input type="checkbox" data-a="sound" ${S.settings.sound ? 'checked' : ''}></label>
    </section>

    <section class="card"><h2>Как это работает</h2>
      <p class="tiny"><b>66 дней</b> — медиана формирования привычки в исследованиях (разброс 4–335). Пропуск одного дня процесс не ломает.</p>
      <p class="tiny"><b>Мгновенная награда</b>: XP сразу после действия держит мотивацию лучше отложенной (Woolley & Fishbach, 2018).</p>
      <p class="tiny"><b>Возвращение ×2</b>: в мегаисследовании на 61 тыс. человек лучше всего сработал бонус за возвращение после пропуска.</p>
      <p class="tiny"><b>Заморозки</b>: серия, которую можно «починить», меньше демотивирует при пропуске (Silverman & Barasch, 2023).</p>
      <p class="tiny"><b>Сундуки</b>: награда, которая выпадает не каждый раз, — тот же механизм, на котором держатся ленты. Только здесь он работает на тебя.</p>
      <p class="tiny"><b>Циклический вздох</b>: 5 минут в день улучшали настроение сильнее медитации (Balban et al., 2023).</p>
      <p class="tiny">Награды за выход: можно слушать любимый подкаст только по дороге на площадку — так нужное связывается с приятным (Milkman, 2014).</p>
    </section>

    <section class="card"><h2>Сброс</h2><p class="tiny">Удалит весь прогресс на этом телефоне. Сначала сохрани копию.</p>
      <button class="btn sm danger" data-a="reset" data-confirm="Точно стереть всё?">Начать заново</button></section>`;
}

// ---------- резервная копия ----------

async function exportData() {
  const name = `ritm-backup-${today()}.json`;
  const file = new File([JSON.stringify(S)], name, { type: 'application/json' });
  const done = () => {
    S.lastBackup = today();
    save();
    render();
    toast('💾 Копия сохранена');
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
    sheet(`<h3>Восстановить копию?</h3><p>Из файла: ${Object.keys(raw.days).length} дней, ${raw.xpTotal} XP, старт ${esc(raw.start)}.</p>
      <p class="tiny">Текущие данные на телефоне заменятся.</p>
      <button class="btn mid xp" data-a="importGo">Восстановить</button>`);
  } catch {
    toast('⚠️ Это не похоже на копию «Ритма»');
  }
});

// ---------- рендер ----------

const views = { today: todayView, deck: deckView, rewards: rewardsView, more: moreView };
const TABS = [
  ['today', '☀️', 'Сегодня'],
  ['deck', '🃏', 'Колода'],
  ['rewards', '🏆', 'Награды'],
  ['more', '⚙️', 'Ещё'],
];

function render() {
  renderedDay = today();
  $('#app').innerHTML = `${header()}<main>${views[tab]()}</main>
    <nav class="tabs"><div class="tabs-in">${TABS.map(
      ([id, ic, label]) => `<button class="tab ${tab === id ? 'on' : ''}" data-a="tab" data-v="${id}"><span>${ic}</span>${label}</button>`,
    ).join('')}</div></nav>`;
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
    const xp = L.urgeXp(S, today());
    urgeSheet(xp);
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
  projToggle: ({ id }) => {
    const p = proj(id);
    ui.openProj[id] = !(ui.openProj[id] ?? p?.prio === 'high');
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
    const [ic, msg] =
      res.kind === 'jackpot'
        ? ['💰', `Джекпот! +${res.xp} XP`]
        : res.kind === 'freeze'
          ? ['❄️', `Заморозка для «${HABIT[res.habit]}»`]
          : ['✨', `+${res.xp} XP`];
    sheet(`<div class="center"><div class="big-ic">${ic}</div><h3>${msg}</h3>
      ${S.pendingChests ? `<button class="btn big xp" data-a="chest">Следующий сундук</button>` : `<button class="btn big xp" data-a="close">Забрать</button>`}</div>`);
  },

  buy: ({ id }) => {
    const r = S.rewards.find((x) => x.id === id);
    if (!r) return;
    sheet(`<div class="center"><div class="big-ic">${esc(r.icon)}</div><h3>${esc(r.title)}</h3>
      <p>Потратить <b>${r.cost} XP</b>? Останется ${L.balance(S) - r.cost}.</p>
      <button class="btn big xp" data-a="buyGo" data-id="${r.id}">Взять награду</button></div>`);
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
    sheet(`<div class="center"><div class="big-ic">🎁</div><h3>Наслаждайся</h3><p>Ты это заработал. Без чувства вины.</p>
      <button class="btn big xp" data-a="close">Спасибо</button></div>`);
  },
  rewEdit: ({ id }) => rewardSheet(id ? S.rewards.find((r) => r.id === id) : null),
  rewDel: ({ id }) => {
    S.rewards = S.rewards.filter((r) => r.id !== id);
    closeSheet();
    save();
    render();
  },

  ladderUp: () => A.ladder({ v: '1' }),
  ladder: ({ v }) => {
    act(() => L.setWalkLevel(S, S.walkLevel + Number(v), today()));
    toast(`🪜 Ступень ${S.walkLevel}: ${L.LADDER[S.walkLevel - 1].name}`);
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
    toast('✅ Данные восстановлены');
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
  if (el.type === 'checkbox') return; // чекбоксы обрабатываются по change
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
  addTask: (fd, f) => {
    const title = fd.get('title').trim();
    if (!title) return;
    ui.lastP = fd.get('p');
    S.tasks.push({ id: L.uid(), p: fd.get('p'), size: fd.get('size'), title, rep: false, count: 0, done: false, doneAt: null });
    ui.openProj[ui.lastP] = true;
    save();
    render();
    toast('🃏 Карточка в колоде');
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
    const data = { icon: fd.get('icon').trim() || '✨', name: fd.get('name').trim(), prio: fd.get('prio') };
    if (!data.name) return;
    const p = proj(f.dataset.id);
    if (p) Object.assign(p, data);
    else S.projects.push({ id: L.uid(), ...data });
    closeSheet();
    save();
    render();
  },
  saveRew: (fd, f) => {
    const data = { icon: fd.get('icon').trim() || '🎁', title: fd.get('title').trim(), cost: Math.max(10, Math.round(Number(fd.get('cost')) || 0)) };
    if (!data.title) return;
    const r = S.rewards.find((x) => x.id === f.dataset.id);
    if (r) Object.assign(r, data);
    else S.rewards.push({ id: L.uid(), ...data });
    closeSheet();
    save();
    render();
  },
  saveRules: (fd) => {
    const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
    S.rules = { no: lines(fd.get('no')), when: lines(fd.get('when')), work: fd.get('work').trim() };
    save();
    render();
    toast('✅ Правила сохранены');
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
