// Слой синхронизации с GitHub (роль «бэкенда» для статического сайта).
// Использует GitHub REST API: читает и коммитит data/words.json прямо в репозиторий.
// Токен хранится ТОЛЬКО в localStorage твоего браузера и никуда больше не уходит.
import { GITHUB, KEYS } from "./config.js";

const API = "https://api.github.com";

function b64EncodeUnicode(str) {
  // корректно кодируем UTF-8 (кириллица и т.п.) в base64
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode("0x" + p1)
    )
  );
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(
    atob(str)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
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

// Скачать актуальный words.json из репозитория. Возвращает { words, sha }.
export async function pull() {
  const url = `${contentsUrl()}?ref=${encodeURIComponent(GITHUB.branch)}`;
  const res = await fetch(url, { headers: headers() });
  if (res.status === 404) return { words: null, sha: null }; // файла ещё нет
  if (!res.ok) throw new Error(`GitHub pull: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const json = b64DecodeUnicode(data.content.replace(/\n/g, ""));
  const words = JSON.parse(json);
  localStorage.setItem(KEYS.sha, data.sha);
  return { words, sha: data.sha };
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

  if (res.status === 409) {
    // конфликт версий: подтягиваем свежий sha и пробуем ещё раз
    const fresh = await pull();
    localStorage.setItem(KEYS.sha, fresh.sha || "");
    return push(words, message);
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub push: ${res.status} ${txt}`);
  }
  const data = await res.json();
  localStorage.setItem(KEYS.sha, data.content.sha);
  localStorage.setItem(KEYS.lastSync, String(Date.now()));
  return data;
}
