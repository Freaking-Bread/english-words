// Настройки приложения.
// Синхронизация читает/пишет words.json в ПРИВАТНОМ репозитории данных.
export const GITHUB = {
  owner: "",                    // ← имя пользователя GitHub (впишется при публикации)
  repo: "english-words-data",   // приватный репозиторий с реальными словами
  branch: "main",
  path: "words.json",
};

// Ключи в localStorage
export const KEYS = {
  words: "ew_words_v1",
  token: "ew_gh_token",
  sha: "ew_gh_sha",
  theme: "ew_theme",
  lastSync: "ew_last_sync",
};

// Откуда грузить стартовый список слов при первом заходе
export const DATA_URL = "data/words.json";
