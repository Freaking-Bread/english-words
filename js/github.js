// Слой синхронизации с GitHub (роль «бэкенда» для статического сайта).
// Читает и коммитит words.json в приватный репозиторий данных через REST API.
// Токен хранится ТОЛЬКО в localStorage твоего браузера и никуда больше не уходит.
import { GITHUB, KEYS } from "./config.js";

const API = "https://api.github.com";

// ── base64 <-> UTF-8 (кириллица корректно) ──────────────────────────
function b64EncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64DecodeUnicode(str) {
  const bin = atob(str.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Проверить, что токен реально видит приватный репозиторий данных.
export async function checkAccess() {
  const res = await fetch(`${API}/repos/${GITHUB.owner}/${GITHUB.repo}`, { headers: headers(), cache: "no-store" });
  if (res.status === 401) throw new Error("Неверный или просроченный токен (401). Скопируй токен заново (github_pat_…).");
  if (res.status === 403) throw new Error("Токену не хватает прав (403).");
  if (res.status === 404)
    throw new Error(`Токен не видит репозиторий «${GITHUB.repo}». Проверь, что токен выдан именно на этот репозиторий с правом Contents: Read and write.`);
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`);
  return true;
}

export function getToken() {
  return localStorage.getItem(KEYS.token) || "";
}
export function setToken(t) {
  if (t) localStorage.setItem(KEYS.token, t.trim());
  else localStorage.removeItem(KEYS.token);
}
export function isConfigured() {
  return Boolean(GITHUB.owner && GITHUB.repo && getToken());
}

function headers() {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl() {
  return `${API}/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${GITHUB.path}`;
}

// Файл на GitHub изменился с тех пор, как мы его читали.
export class ConflictError extends Error {}

// Скачать актуальный words.json из репозитория. Возвращает { words, sha }.
export async function pull() {
  const url = `${contentsUrl()}?ref=${encodeURIComponent(GITHUB.branch)}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (res.status === 404) return { words: null, sha: null }; // файла ещё нет
  if (!res.ok) throw new Error(`GitHub pull: ${res.status} ${res.statusText}`);
  const data = await res.json();
  let b64 = data.content;
  if (!b64 || data.encoding === "none") {
    // файл больше 1 МБ — содержимое только через Blobs API
    const blob = await fetch(`${API}/repos/${GITHUB.owner}/${GITHUB.repo}/git/blobs/${data.sha}`, { headers: headers(), cache: "no-store" });
    if (!blob.ok) throw new Error(`GitHub pull: ${blob.status}`);
    b64 = (await blob.json()).content;
  }
  localStorage.setItem(KEYS.sha, data.sha);
  return { words: JSON.parse(b64DecodeUnicode(b64)), sha: data.sha };
}

// Закоммитить words.json в репозиторий.
export async function push(words, message = "Update words") {
  const body = {
    message,
    content: b64EncodeUnicode(JSON.stringify(words, null, 2)),
    branch: GITHUB.branch,
  };
  const sha = localStorage.getItem(KEYS.sha);
  if (sha) body.sha = sha; // обновление существующего файла требует sha

  const res = await fetch(contentsUrl(), {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // 409 — sha устарел, 422 — sha не передан, а файл уже есть.
  // Вслепую не перезаписываем: вызывающий сначала сольёт свежие данные.
  if (res.status === 409 || res.status === 422) throw new ConflictError("words.json");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub push: ${res.status} ${txt}`);
  }
  const data = await res.json();
  localStorage.setItem(KEYS.sha, data.content.sha);
  localStorage.setItem(KEYS.lastSync, String(Date.now()));
  return data;
}
