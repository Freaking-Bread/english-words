// Основная логика интерфейса: рендер, тренировка, редактирование, синхронизация, тема.
import { KEYS } from "./config.js";
import {
  loadInitial, getWords, setWords, subscribe, mergeRemote, isDirty, markPushed,
  addWord, updateWord, deleteWord, toggleLearned, setLearned,
} from "./store.js";
import { pull, push, ConflictError, getToken, setToken, isConfigured, checkAccess } from "./github.js";

const SECTION_LABEL = { word: "слово", linker: "связку", rule: "правило" };

// Баннер каждого раздела: английский заголовок + фото
const SECTION = {
  word:   { title: "My words", img: "word" },
  linker: { title: "Linkers",  img: "linker" },
  rule:   { title: "Rules",    img: "rule" },
};
const TRAINABLE = new Set(["word", "linker"]);

// ── Состояние интерфейса ─────────────────────────────────────────────
const ui = { section: "word", filter: "learning", query: "", editMode: false };

// ── Короткие хелперы ─────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const grid = $("#grid");
const empty = $("#empty");
const icon = (name, cls = "ic") => `<svg class="${cls}"><use href="#ic-${name}"/></svg>`;

function toast(msg, type = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast is-visible " + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 2600);
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// 1 слово / 2 слова / 5 слов
function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

// ── Внешние ссылки на реальные клипы/произношение ────────────────────
function playphraseUrl(word) {
  return `https://www.playphrase.me/#/search?q=${encodeURIComponent(word)}`;
}
function youglishUrl(word) {
  return `https://youglish.com/pronounce/${encodeURIComponent(word)}/english`;
}
function speak(word) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ── Статистика: сколько выучено сегодня и сколько дней подряд ────────
// Считается по updatedAt выученных карточек — одинаково на всех устройствах.
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

function activity() {
  const days = new Set();
  const today = dayKey(Date.now());
  let todayCount = 0;
  for (const w of getWords()) {
    if (!w.learned || !w.updatedAt) continue;
    const k = dayKey(w.updatedAt);
    days.add(k);
    if (k === today) todayCount++;
  }
  let streak = 0;
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);   // сегодня ещё не занимался — серия не сгорела
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  return { today: todayCount, streak };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// Слово дня — одно и то же весь день, из ещё не выученных
function wordOfDay() {
  const pool = getWords().filter((w) => (w.category || "word") === "word" && !w.learned && w.meaning);
  if (!pool.length) return null;
  let h = 0;
  for (const c of dayKey(Date.now())) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

// ── Баннер раздела ───────────────────────────────────────────────────
const stat = (ic, html, cls = "") => `<span class="stat ${cls}">${icon(ic)}<span>${html}</span></span>`;

function renderHero() {
  const sec = SECTION[ui.section];
  const img = $("#hero-img");
  if (img.dataset.key !== sec.img) {
    img.dataset.key = sec.img;
    img.classList.remove("is-loaded");
    $("#hero-src-sm").srcset = `img/${sec.img}-sm.webp`;
    img.src = `img/${sec.img}.webp`;
  }
  $("#hero-kicker").textContent = `${greeting()}, Gleb`;
  $("#hero-title").textContent = sec.title;

  const list = getWords().filter((w) => (w.category || "word") === ui.section);
  const learned = list.filter((w) => w.learned).length;
  const pct = list.length ? Math.round((learned / list.length) * 100) : 0;
  const { today, streak } = activity();
  $("#hero-stats").innerHTML = `
    <div class="hero__progress">
      <div class="hero__progress-row"><b>${learned}</b><span>из ${list.length} выучено</span><em>${pct}%</em></div>
      <div class="bar"><span style="width:${pct}%"></span></div>
    </div>
    <div class="hero__chips">
      ${streak ? stat("flame", `<b>${streak}</b> ${plural(streak, "день", "дня", "дней")} подряд`, "stat--hot") : ""}
      ${stat("spark", `<b>+${today}</b> сегодня`)}
    </div>`;
  $("#hero-actions").innerHTML = TRAINABLE.has(ui.section) && list.some((w) => !w.learned)
    ? `<button class="btn-hero" data-act="train">${icon("cards")} Тренировка</button>` : "";

  // Слово дня — только на «Словах»
  const wotdEl = $("#wotd");
  const w = ui.section === "word" ? wordOfDay() : null;
  wotdEl.classList.toggle("hidden", !w);
  if (w) {
    wotdEl.dataset.id = w.id;
    wotdEl.innerHTML = `
      <p class="wotd__kicker">Word of the day</p>
      <div class="wotd__row">
        <h3 class="wotd__word">${esc(w.word)}</h3>
        <button class="mini-btn" data-act="wotd-speak" aria-label="Произнести">${icon("speak")}</button>
      </div>
      <p class="wotd__meaning">${esc(w.meaning)}</p>
      ${w.example ? `<p class="wotd__ex">${esc(w.example)}</p>` : ""}`;
  }
}

$("#hero-img").addEventListener("load", (e) => e.target.classList.add("is-loaded"));
if ($("#hero-img").complete && $("#hero-img").naturalWidth) $("#hero-img").classList.add("is-loaded");

$("#hero").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "train") openTrainer(ui.section);
  else if (act === "wotd-speak") {
    const w = getWords().find((x) => x.id === $("#wotd").dataset.id);
    if (w) speak(w.word);
  }
});

// ── Фильтрация ───────────────────────────────────────────────────────
function visibleWords() {
  const q = ui.query.trim().toLowerCase();
  return getWords().filter((w) => {
    if ((w.category || "word") !== ui.section) return false;
    if (ui.filter === "learned" && !w.learned) return false;
    if (ui.filter === "learning" && w.learned) return false;
    if (!q) return true;
    return (
      w.word.toLowerCase().includes(q) ||
      (w.meaning || "").toLowerCase().includes(q) ||
      (w.example || "").toLowerCase().includes(q)
    );
  });
}

// ── Рендер одной карточки ────────────────────────────────────────────
function cardHtml(w) {
  const cat = w.category || "word";
  const isRule = cat === "rule";
  const learnedCls = w.learned ? "is-learned" : "";

  // Правила — это заметки: без произношения и клипов, текст показываем обычным блоком.
  const head = isRule
    ? `<p class="card__rule">${esc(w.word)}</p>`
    : `<div class="card__word-row">
          <h3 class="card__word">${esc(w.word)}</h3>
          <button class="mini-btn" data-act="speak" title="Произнести" aria-label="Произнести">${icon("speak")}</button>
        </div>`;

  const meaning = w.meaning
    ? `<p class="card__meaning">${esc(w.meaning)}</p>`
    : isRule ? "" : `<p class="card__meaning"><span class="muted">— нет значения —</span></p>`;

  const media = isRule ? "" :
    `<a class="tag-btn" href="${playphraseUrl(w.word)}" target="_blank" rel="noopener" title="Клипы из фильмов">${icon("film")} Клипы</a>
     <a class="tag-btn" href="${youglishUrl(w.word)}" target="_blank" rel="noopener" title="Произношение из видео">${icon("ext")} YouGlish</a>`;

  const editBtns = ui.editMode
    ? `<button class="tag-btn tag-btn--edit" data-act="edit">${icon("pencil")} Правка</button>
       <button class="tag-btn tag-btn--del" data-act="delete" aria-label="Удалить">${icon("trash")}</button>`
    : "";

  const actions = media || editBtns ? `<div class="card__actions">${media}${editBtns}</div>` : "";

  return `
    <article class="card card--${cat} ${learnedCls}" data-id="${w.id}">
      <button class="card__check" data-act="learned" title="Отметить как выученное" aria-pressed="${!!w.learned}">${icon("check")}</button>
      <div class="card__body">
        ${head}
        ${meaning}
        ${w.example ? `<p class="card__example">${esc(w.example)}</p>` : ""}
      </div>
      ${actions}
    </article>`;
}

// Карточек сотни — рисуем порциями по мере прокрутки.
const PAGE = 48;
let list = [];
let shown = 0;

function appendPage() {
  const next = list.slice(shown, shown + PAGE);
  if (!next.length) return false;
  grid.insertAdjacentHTML("beforeend", next.map(cardHtml).join(""));
  shown += next.length;
  return true;
}

function fillViewport() {
  const more = $("#more");
  while (shown < list.length && more.getBoundingClientRect().top < window.innerHeight + 900) {
    if (!appendPage()) break;
  }
}

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) fillViewport();
}, { rootMargin: "900px 0px" }).observe($("#more"));
// запасной путь: на некоторых браузерах observer срабатывает не всегда
let scrollTick = false;
window.addEventListener("scroll", () => {
  if (scrollTick || shown >= list.length) return;
  scrollTick = true;
  setTimeout(() => { scrollTick = false; fillViewport(); }, 120);
}, { passive: true });

function updateCounts() {
  const counts = {};
  getWords().forEach((w) => {
    const c = w.category || "word";
    counts[c] = (counts[c] || 0) + 1;
  });
  document.querySelectorAll(".tab__count").forEach((el) => {
    el.textContent = counts[el.dataset.count] || 0;
  });
}

function render() {
  list = visibleWords();
  shown = 0;
  grid.innerHTML = "";
  appendPage();
  setTimeout(fillViewport, 0);
  empty.classList.toggle("hidden", list.length > 0);
  renderHero();
  updateCounts();
  document.body.classList.toggle("edit-mode", ui.editMode);
}

// Галочка «выучил» — меняем одну карточку, а не перерисовываем сотни.
function onLearnedToggled(id) {
  const w = getWords().find((x) => x.id === id);
  const card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!w || !card) return;
  card.classList.toggle("is-learned", w.learned);
  card.querySelector(".card__check")?.setAttribute("aria-pressed", String(w.learned));
  if (w.learned) card.classList.add("just-learned");

  const leaves = (ui.filter === "learning" && w.learned) || (ui.filter === "learned" && !w.learned);
  if (leaves) {
    card.classList.add("is-leaving");
    setTimeout(() => {
      card.remove();
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) { list.splice(i, 1); if (i < shown) shown--; }
      fillViewport();
      empty.classList.toggle("hidden", list.length > 0);
    }, 280);
  }
}

// ── Делегирование кликов по карточкам ────────────────────────────────
grid.addEventListener("click", (e) => {
  const actEl = e.target.closest("[data-act]");
  if (!actEl) return;
  const card = e.target.closest(".card");
  const id = card.dataset.id;
  const act = actEl.dataset.act;

  if (act === "learned") { toggleLearned(id, { quiet: true }); onLearnedToggled(id); }
  else if (act === "speak") speak(getWords().find((w) => w.id === id).word);
  else if (act === "edit") openWordDialog(id);
  else if (act === "delete") {
    if (confirm("Удалить это слово?")) deleteWord(id);
  }
});

// ── Тренировка карточками ────────────────────────────────────────────
// Раунд из 20 невыученных карточек раздела. «Знаю» отмечает слово выученным,
// «Ещё учу» возвращает его в конец раунда — пока не ответишь «Знаю».
const trainer = $("#trainer");
const ROUND = 20;
const tr = { queue: [], total: 0, known: 0, flipped: false, reverse: false, section: "word" };

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

function openTrainer(section) {
  const pool = getWords().filter((w) => (w.category || "word") === section && !w.learned);
  if (!pool.length) { toast("Здесь всё выучено 🎉", "ok"); return; }
  tr.section = section;
  tr.queue = shuffle(pool.map((w) => w.id)).slice(0, ROUND);
  tr.total = tr.queue.length;
  tr.known = 0;
  tr.flipped = false;
  $("#tr-dir").textContent = tr.reverse ? "RU → EN" : "EN → RU";
  renderTrainer();
  trainer.showModal();
  $("#tr-stage .flash")?.focus();
}

function trainerCardHtml(w) {
  const en = `<h3 class="flash__word">${esc(w.word)}</h3>
              <button class="mini-btn flash__speak" data-act="tr-speak" aria-label="Произнести">${icon("speak")}</button>`;
  const ru = `<p class="flash__meaning">${esc(w.meaning || "—")}</p>`;
  const ex = w.example ? `<p class="flash__ex">${esc(w.example)}</p>` : "";
  const front = tr.reverse ? ru : en;
  const back = tr.reverse ? `${en}${ex}` : `${ru}${ex}`;
  return `
    <div class="flash ${tr.flipped ? "is-flipped" : ""}" data-act="tr-flip" role="button" tabindex="0" aria-label="Перевернуть">
      <span class="flash__face flash__face--front">${front}<span class="flash__flip-ic">${icon("flip")}</span></span>
      <span class="flash__face flash__face--back">${back}</span>
    </div>`;
}

function renderTrainer() {
  const done = tr.total - tr.queue.length;
  $("#tr-count").textContent = `${Math.min(done + 1, tr.total)} / ${tr.total}`;
  $("#tr-fill").style.width = (tr.total ? (done / tr.total) * 100 : 0) + "%";
  const stage = $("#tr-stage");
  const actions = $("#tr-actions");

  if (!tr.queue.length) {
    $("#tr-count").textContent = `${tr.total} / ${tr.total}`;
    actions.classList.add("hidden");
    stage.innerHTML = `
      <div class="tr-done">
        <div class="tr-done__ic">${icon("trophy")}</div>
        <h3 class="tr-done__title">Well done!</h3>
        <p class="tr-done__text">${tr.known} ${plural(tr.known, "слово", "слова", "слов")} в копилке</p>
        <div class="tr-done__actions">
          <button class="btn btn--primary" data-act="tr-again">Ещё раунд</button>
          <button class="btn btn--ghost" data-act="tr-close">Закрыть</button>
        </div>
      </div>`;
    return;
  }
  actions.classList.remove("hidden");
  const w = getWords().find((x) => x.id === tr.queue[0]);
  if (!w) { tr.queue.shift(); renderTrainer(); return; }
  stage.innerHTML = trainerCardHtml(w);
  stage.style.animation = "none"; void stage.offsetWidth; stage.style.animation = "";
  if (trainer.open) stage.querySelector(".flash").focus({ preventScroll: true });
}

function trainerAnswer(known) {
  const id = tr.queue.shift();
  if (!id) return;
  if (known) { tr.known++; setLearned(id, true, { quiet: true }); }
  else tr.queue.push(id);                 // вернётся в конце раунда
  tr.flipped = false;
  renderTrainer();
}

function flipCard() {
  const card = $("#tr-stage .flash");
  if (!card) return;
  tr.flipped = !tr.flipped;
  card.classList.toggle("is-flipped", tr.flipped);
}

$("#tr-stage").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "tr-speak") { e.stopPropagation(); const w = getWords().find((x) => x.id === tr.queue[0]); if (w) speak(w.word); }
  else if (act === "tr-flip") flipCard();
  else if (act === "tr-again") openTrainer(tr.section);
  else if (act === "tr-close") trainer.close();
});
$("#tr-yes").addEventListener("click", () => trainerAnswer(true));
$("#tr-no").addEventListener("click", () => trainerAnswer(false));
$("#tr-dir").addEventListener("click", () => {
  tr.reverse = !tr.reverse;
  tr.flipped = false;
  $("#tr-dir").textContent = tr.reverse ? "RU → EN" : "EN → RU";
  renderTrainer();
});
trainer.addEventListener("keydown", (e) => {
  if (!tr.queue.length) return;
  if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); flipCard(); }
  else if (e.code === "ArrowRight") trainerAnswer(true);
  else if (e.code === "ArrowLeft") trainerAnswer(false);
});
// После закрытия — обновить список: выученные за раунд уйдут из «Учу»
trainer.addEventListener("close", () => render());

// ── Диалог добавления/редактирования ─────────────────────────────────
const wordDialog = $("#word-dialog");
const wordForm = $("#word-form");
let editingId = null;

function openWordDialog(id = null) {
  editingId = id;
  const title = $("#word-dialog-title");
  if (id) {
    const w = getWords().find((x) => x.id === id);
    title.textContent = "Редактировать слово";
    wordForm.word.value = w.word;
    wordForm.meaning.value = w.meaning || "";
    wordForm.example.value = w.example || "";
  } else {
    title.textContent = "Добавить " + (SECTION_LABEL[ui.section] || "запись");
    wordForm.reset();
  }
  wordDialog.showModal();
}

wordForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    word: wordForm.word.value,
    meaning: wordForm.meaning.value,
    example: wordForm.example.value,
  };
  if (!data.word.trim()) return;
  if (editingId) updateWord(editingId, {
    word: data.word.trim(),
    meaning: data.meaning.trim(),
    example: data.example.trim(),
  });
  else addWord({ ...data, category: ui.section });
  wordDialog.close();
  toast(editingId ? "Сохранено" : "Слово добавлено", "ok");
});

// ── Синхронизация с GitHub ───────────────────────────────────────────
const syncDialog = $("#sync-dialog");

function refreshSyncStatus() {
  const el = $("#sync-status");
  if (isConfigured()) {
    const last = localStorage.getItem(KEYS.lastSync);
    el.textContent = last
      ? `Подключено. Последняя синхр.: ${new Date(+last).toLocaleString("ru")}`
      : "Токен задан. Можно синхронизировать.";
    el.className = "muted ok-text";
  } else if (getToken()) {
    el.textContent = "Токен задан, но owner репозитория ещё не прописан в config.js.";
    el.className = "muted";
  } else {
    el.textContent = "Токен не задан — работаешь локально.";
    el.className = "muted";
  }
}

// Подтянуть слова с GitHub и слить с локальными (ничего не теряя).
async function pullAndMerge() {
  const { words } = await pull();
  return words ? mergeRemote(words) : false;
}

// Отправить, если есть что. Если файл на GitHub успел поменяться
// (другое устройство) — сначала слить, потом отправить.
let pushing = null;
async function pushIfDirty() {
  if (pushing) return pushing;
  pushing = (async () => {
    if (!isDirty()) return;
    let sent = getWords();
    try {
      await push(sent, "Auto-sync from app");
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      if (await pullAndMerge()) render();
      sent = getWords();
      await push(sent, "Auto-sync from app");
    }
    markPushed(sent);
  })();
  try { await pushing; } finally { pushing = null; }
}

$("#btn-save-token").addEventListener("click", async () => {
  const val = $("#token-input").value.trim();
  setToken(val);
  refreshSyncStatus();
  if (!val) { toast("Токен удалён", "warn"); return; }
  if (!/^github_pat_|^ghp_/.test(val)) {
    toast("Похоже, это не токен. Нужна строка github_pat_…", "err");
    return;
  }
  try {
    toast("Проверяю доступ…");
    await checkAccess();
    toast("Токен сохранён, доступ есть ✓", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

// «Загрузить из GitHub» — версия с GitHub целиком заменяет локальную
$("#btn-pull").addEventListener("click", async () => {
  try {
    toast("Загружаю из GitHub…");
    const { words } = await pull();
    if (words) {
      setWords(words, { silent: true });
      mergeRemote(words);
      render();
      toast(`Загружено из GitHub: ${words.length} слов`, "ok");
    } else {
      // 404: уточняем причину — нет доступа или реально нет файла
      await checkAccess();
      toast("Репозиторий доступен, но файла words.json в нём нет", "warn");
    }
    refreshSyncStatus();
  } catch (err) {
    toast(err.message, "err");
  }
});

$("#btn-push").addEventListener("click", async () => {
  try {
    toast("Отправляю в GitHub…");
    if (await pullAndMerge()) render();
    await pushIfDirty();
    toast("Отправлено в GitHub", "ok");
    refreshSyncStatus();
  } catch (err) {
    toast("Ошибка отправки: " + err.message, "err");
  }
});

// Индикатор синхронизации (снизу слева)
let hideStatusTimer = null;
function setSyncStatus(state) {
  const el = $("#sync-indicator");
  clearTimeout(hideStatusTimer);
  if (state === "saving") {
    el.className = "sync-indicator is-visible";
    el.innerHTML = `<span class="spinner"></span><span>Сохраняю…</span>`;
  } else if (state === "saved") {
    el.className = "sync-indicator is-visible is-saved";
    el.innerHTML = `<span class="sync-ic">✓</span><span>Сохранено</span>`;
    hideStatusTimer = setTimeout(() => (el.className = "sync-indicator"), 2200);
  } else if (state === "error") {
    el.className = "sync-indicator is-visible is-error";
    el.innerHTML = `<span class="sync-ic">⚠</span><span>Не сохранено</span>`;
  } else {
    el.className = "sync-indicator";
  }
}

// Автосохранение в GitHub (с задержкой), если настроено
let pushTimer = null;
function scheduleAutoPush() {
  if (!isConfigured()) return;
  clearTimeout(pushTimer);
  setSyncStatus("saving"); // крутится с момента правки до завершения отправки
  pushTimer = setTimeout(async () => {
    try {
      await pushIfDirty();
      refreshSyncStatus();
      setSyncStatus("saved");
    } catch (err) {
      console.warn("auto-push failed:", err.message);
      setSyncStatus("error");
    }
  }, 2500);
}

// ── Тулбар / фильтры / тема ──────────────────────────────────────────
let searchTimer = null;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { ui.query = e.target.value; render(); }, 140);
});

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  ui.filter = chip.dataset.filter;
  [...$("#filters").children].forEach((c) => c.classList.toggle("is-active", c === chip));
  render();
});

$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  ui.section = tab.dataset.section;
  [...$("#tabs").children].forEach((t) => t.classList.toggle("is-active", t === tab));
  render();
  window.scrollTo({ top: 0 });
});

$("#btn-edit").addEventListener("click", () => {
  ui.editMode = !ui.editMode;
  $("#btn-edit").classList.toggle("is-on", ui.editMode);
  render();
});

$("#btn-add").addEventListener("click", () => openWordDialog(null));
$("#btn-sync").addEventListener("click", () => {
  $("#token-input").value = getToken();
  refreshSyncStatus();
  syncDialog.showModal();
});

// закрытие диалогов по кнопкам [data-close]
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", (e) => e.target.closest("dialog").close())
);

// Тема
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#btn-theme").innerHTML = icon(theme === "dark" ? "sun" : "moon");
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#0b0b12" : "#f6f6fb");
  localStorage.setItem(KEYS.theme, theme);
}
$("#btn-theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(cur);
});

// ── Инициализация ────────────────────────────────────────────────────
async function init() {
  const savedTheme =
    localStorage.getItem(KEYS.theme) ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(savedTheme);

  await loadInitial();
  subscribe((change) => {
    if (change.quiet) { renderHero(); updateCounts(); }
    else render();
    scheduleAutoPush();
  });
  render();
  refreshSyncStatus();

  // Каждый заход — свежие слова с GitHub (слияние, ничего не теряется),
  // потом отправка того, что не успело уйти в прошлый раз.
  if (isConfigured()) {
    try {
      if (await pullAndMerge()) render();
      if (isDirty()) scheduleAutoPush();
    } catch (err) {
      console.warn("sync on start failed:", err.message);
    }
  }
}
init();
