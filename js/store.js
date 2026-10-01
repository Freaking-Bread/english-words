// Слой данных: слова + localStorage + слияние с GitHub.
// Правка помечает данные «грязными» — автосохранение отправит их.
// Удаления запоминаются (tombstones), чтобы слияние их не воскрешало,
// а новые неотправленные карточки (pending) — чтобы слияние их не потеряло.
import { KEYS, DATA_URL } from "./config.js";

let words = [];
const listeners = new Set();

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
let dirty = localStorage.getItem(KEYS.dirty) === "1";
let tomb = readJson(KEYS.tomb, {});
let pending = readJson(KEYS.pending, []);

function saveMeta() {
  localStorage.setItem(KEYS.dirty, dirty ? "1" : "0");
  localStorage.setItem(KEYS.tomb, JSON.stringify(tomb));
  localStorage.setItem(KEYS.pending, JSON.stringify(pending));
}

export const isDirty = () => dirty;

// Слова успешно ушли на GitHub. sentList — то, что реально отправили:
// если пока шёл запрос появились новые правки, флаг остаётся.
export function markPushed(sentList) {
  if (sentList === words) dirty = false;
  const sent = new Set(sentList.map((x) => x.id));
  pending = pending.filter((id) => !sent.has(id));
  saveMeta();
}

// ── Реактивность ─────────────────────────────────────────────────────
// change = { id?, quiet? } — quiet: интерфейс обновит себя точечно
function emit(change = {}) {
  persistLocal();
  listeners.forEach((fn) => fn(change));
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persistLocal() {
  localStorage.setItem(KEYS.words, JSON.stringify(words));
}

function touch(change) {
  dirty = true;
  saveMeta();
  emit(change);
}

export function getWords() {
  return words;
}

// Полная замена (ручная загрузка из GitHub)
export function setWords(next, { silent = false } = {}) {
  words = Array.isArray(next) ? next : [];
  if (silent) persistLocal();
  else emit();
}

// Слить данные с GitHub с локальными:
//  • карточка есть в обоих местах → побеждает более свежая (updatedAt);
//  • только на GitHub → берём, если мы её здесь не удаляли;
//  • только локально → оставляем, если она новая и ещё не отправлена
//    (иначе её удалили на другом устройстве).
export function mergeRemote(remote) {
  if (!Array.isArray(remote)) return false;
  const fresh = new Set(pending);
  const localById = new Map(words.map((x) => [x.id, x]));
  const remoteIds = new Set(remote.map((r) => r.id));
  const fromRemote = remote
    .filter((r) => !tomb[r.id])
    .map((r) => {
      const l = localById.get(r.id);
      return l && (l.updatedAt || 0) > (r.updatedAt || 0) ? l : r;
    });
  const localOnly = words.filter((l) => !remoteIds.has(l.id) && fresh.has(l.id));
  const merged = [...localOnly, ...fromRemote];

  const changed = JSON.stringify(merged) !== JSON.stringify(words);
  dirty = JSON.stringify(merged) !== JSON.stringify(remote);
  words = merged;
  persistLocal();
  saveMeta();
  return changed;
}

// Первичная загрузка: сначала localStorage, иначе стартовый data/words.json.
export async function loadInitial() {
  const cached = localStorage.getItem(KEYS.words);
  if (cached) {
    try {
      words = JSON.parse(cached);
    } catch {
      words = null; // повреждённый кэш — грузим с нуля
    }
  }
  if (!Array.isArray(words)) {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      words = await res.json();
    } catch {
      words = [];
    }
  }
  persistLocal();
  // старые удаления (старше 90 дней) больше не нужны
  const cutoff = Date.now() - 90 * 864e5;
  for (const id in tomb) if (tomb[id] < cutoff) delete tomb[id];
  saveMeta();
  return words;
}

function uid() {
  return "w_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function addWord({ word, meaning = "", example = "", category = "word" }) {
  const now = Date.now();
  const item = {
    id: uid(),
    word: word.trim(),
    meaning: meaning.trim(),
    example: example.trim(),
    learned: false,
    category,
    createdAt: now,
    updatedAt: now,
  };
  words = [item, ...words];
  pending = [...pending, item.id];
  touch({ id: item.id });
  return item;
}

export function updateWord(id, patch, { quiet = false } = {}) {
  words = words.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w));
  touch({ id, quiet });
}

export function deleteWord(id) {
  words = words.filter((w) => w.id !== id);
  tomb[id] = Date.now();
  pending = pending.filter((x) => x !== id);
  touch({ id });
}

export function setLearned(id, learned, opts) {
  updateWord(id, { learned }, opts);
}
export function toggleLearned(id, opts) {
  const w = words.find((x) => x.id === id);
  if (w) setLearned(id, !w.learned, opts);
}
