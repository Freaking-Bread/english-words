// Основная логика интерфейса: рендер, редактирование, синхронизация, тема.
import { KEYS } from "./config.js";
import {
  loadInitial, getWords, setWords, subscribe,
  addWord, updateWord, deleteWord, toggleLearned,
} from "./store.js";

const SECTION_LABEL = { word: "слово", linker: "связку", rule: "правило" };
import { pull, push, getToken, setToken, isConfigured, checkAccess } from "./github.js";

// ── Состояние интерфейса ─────────────────────────────────────────────
const ui = { section: "word", filter: "learning", query: "", editMode: false };

// ── Короткие хелперы ─────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const grid = $("#grid");
const empty = $("#empty");

function toast(msg, type = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast is-visible " + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 2600);
}

function esc(s = "") {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
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
      (w.meaning || "").toLowerCase().includes(q)
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
          <button class="mini-btn" data-act="speak" title="Произнести">🔊</button>
        </div>`;

  const meaning = w.meaning
    ? `<p class="card__meaning">${esc(w.meaning)}</p>`
    : isRule ? "" : `<p class="card__meaning"><span class="muted">— нет значения —</span></p>`;

  const media = isRule ? "" :
    `<a class="tag-btn" href="${playphraseUrl(w.word)}" target="_blank" rel="noopener" title="Клипы из фильмов">🎬 Клипы</a>
     <a class="tag-btn" href="${youglishUrl(w.word)}" target="_blank" rel="noopener" title="Произношение из видео">🗣 YouGlish</a>`;

  const editBtns = ui.editMode
    ? `<button class="tag-btn tag-btn--edit" data-act="edit">✏️ Правка</button>
       <button class="tag-btn tag-btn--del" data-act="delete">🗑</button>`
    : "";

  const actions = media || editBtns ? `<div class="card__actions">${media}${editBtns}</div>` : "";

  return `
    <article class="card card--${cat} ${learnedCls}" data-id="${w.id}">
      <button class="card__check" data-act="learned" title="Отметить как выученное" aria-pressed="${w.learned}">
        ${w.learned ? "✓" : ""}
      </button>
      <div class="card__body">
        ${head}
        ${meaning}
        ${w.example ? `<p class="card__example">“${esc(w.example)}”</p>` : ""}
      </div>
      ${actions}
    </article>`;
}

function render() {
  const list = visibleWords();
  grid.innerHTML = list.map(cardHtml).join("");
  empty.classList.toggle("hidden", list.length > 0);

  // счётчики на вкладках
  const counts = {};
  getWords().forEach((w) => {
    const c = w.category || "word";
    counts[c] = (counts[c] || 0) + 1;
  });
  document.querySelectorAll(".tab__count").forEach((el) => {
    el.textContent = counts[el.dataset.count] || 0;
  });

  // прогресс — по текущей вкладке
  const inSection = getWords().filter((w) => (w.category || "word") === ui.section);
  const learned = inSection.filter((w) => w.learned).length;
  const total = inSection.length;
  $("#progress-text").textContent = `${learned} / ${total}`;
  $("#progress-fill").style.width = (total ? Math.round((learned / total) * 100) : 0) + "%";

  document.body.classList.toggle("edit-mode", ui.editMode);
}

// ── Делегирование кликов по карточкам ────────────────────────────────
grid.addEventListener("click", (e) => {
  const actEl = e.target.closest("[data-act]");
  if (!actEl) return;
  const card = e.target.closest(".card");
  const id = card.dataset.id;
  const act = actEl.dataset.act;

  if (act === "learned") toggleLearned(id);
  else if (act === "speak") speak(getWords().find((w) => w.id === id).word);
  else if (act === "edit") openWordDialog(id);
  else if (act === "delete") {
    if (confirm("Удалить это слово?")) deleteWord(id);
  }
});

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

$("#btn-pull").addEventListener("click", async () => {
  try {
    toast("Загружаю из GitHub…");
    const { words } = await pull();
    if (words) {
      setWords(words);
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
    await push(getWords(), "Update words from app");
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
      await push(getWords(), "Auto-sync from app");
      refreshSyncStatus();
      setSyncStatus("saved");
    } catch (err) {
      console.warn("auto-push failed:", err.message);
      setSyncStatus("error");
    }
  }, 4000);
}

// ── Тулбар / фильтры / тема ──────────────────────────────────────────
$("#search").addEventListener("input", (e) => {
  ui.query = e.target.value;
  render();
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
  $("#btn-theme").textContent = theme === "dark" ? "☀️" : "🌙";
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
  subscribe(() => {
    render();
    scheduleAutoPush();
  });
  render();
  refreshSyncStatus();
}
init();
