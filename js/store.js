// Слой данных: состояние + localStorage + загрузка стартового списка.
// CRUD-операции над словами и подписка на изменения (простая реактивность).
import { KEYS, DATA_URL } from "./config.js";

let words = [];
const listeners = new Set();

function emit() {
  persistLocal();
  listeners.forEach((fn) => fn(words));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getWords() {
  return words;
}

export function setWords(next, { silent = false } = {}) {
  words = Array.isArray(next) ? next : [];
  if (!silent) emit();
  else persistLocal();
}

function persistLocal() {
  localStorage.setItem(KEYS.words, JSON.stringify(words));
}

// Первичная загрузка: сначала localStorage, иначе стартовый data/words.json.
export async function loadInitial() {
  const cached = localStorage.getItem(KEYS.words);
  if (cached) {
    try {
      words = JSON.parse(cached);
      return words;
    } catch {
      /* повреждённый кэш — грузим с нуля */
    }
  }
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    words = await res.json();
  } catch {
    words = [];
  }
  persistLocal();
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
  emit();
  return item;
}

export function updateWord(id, patch) {
  words = words.map((w) =>
    w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w
  );
  emit();
}

export function deleteWord(id) {
  words = words.filter((w) => w.id !== id);
  emit();
}

export function toggleLearned(id) {
  const w = words.find((x) => x.id === id);
  if (w) updateWord(id, { learned: !w.learned });
}

export function stats() {
  const total = words.length;
  const learned = words.filter((w) => w.learned).length;
  return { total, learned, remaining: total - learned };
}
