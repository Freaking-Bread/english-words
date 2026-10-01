// Настройки приложения.
// Синхронизация читает/пишет words.json в ПРИВАТНОМ репозитории данных.
export const GITHUB = {
  owner: "Freaking-Bread",      // имя пользователя GitHub
  repo: "english-words-data",   // приватный репозиторий с реальными словами
  branch: "main",
  path: "words.json",
};

// Ключи в localStorage (старые не переименовывать — в них токен и слова)
export const KEYS = {
  words: "ew_words_v1",
  token: "ew_gh_token",
  sha: "ew_gh_sha",
  theme: "ew_theme",
  lastSync: "ew_last_sync",
  dirty: "ew_dirty",        // есть неотправленные правки
  tomb: "ew_tomb",          // id удалённых карточек (чтобы слияние их не вернуло)
  pending: "ew_pending",    // id новых карточек, ещё не отправленных на GitHub
};

// Откуда грузить стартовый список слов при первом заходе
export const DATA_URL = "data/words.json";
