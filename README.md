# MuiFy

Музична платформа: React + TypeScript (Vite) на фронтенді, Node.js + Express + TypeScript на бекенді.

![Макет](design/muify-design.png)

## Запуск

```bash
npm run install:all   # встановити залежності (перший раз)
npm run dev           # API на http://localhost:4000, клієнт на http://localhost:5173
npm run build         # перевірка типів і збірка обох частин
```

## Структура

- `client/` — React-застосунок (компоненти в `src/components`, стан у `src/store`).
- `server/` — Express API (`/api/albums`, `/api/playlists`, `/api/tracks`, `/api/history`, `/api/stats`, `/api/player`, `/api/me`). Каталог (seed або Jamendo) — у пам'яті, спільний для всіх. Стан користувача (лайки, власні плейлисти, історія, остання позиція/трек/гучність, профіль) — окремо для кожного користувача, див. «Акаунти».

## Акаунти (Firebase)

- **Режим `firebase`** (заповнені `FIREBASE_DATABASE_URL` + сервісний ключ у `server/.env`, і Firebase web-конфіг у `client/.env.local`): вхід через Email/пароль або Google (Firebase Auth у браузері). Сервер перевіряє ID-токен (`Authorization: Bearer …`, `firebase-admin`) і зберігає дані у Realtime Database під `users/{uid}/…` (`profile`, `likes`, `playlists`, `history`, `player`, `meta`). Гості можуть слухати й переглядати каталог; збереження вимагає входу (API відповідає 401).
- **Режим `local`** (Firebase не налаштовано): як раніше — без входу, один користувач, стан у `server/data-store/user-state.json` (або `MUIFY_DATA_DIR`). Сервер один раз пише попередження в лог.
- Режим видно в `GET /api/status` → `auth`.
- Браузер ніколи не читає RTDB напряму: `database.rules.json` забороняє будь-який клієнтський доступ (застосувати: Firebase Console → Realtime Database → Rules, або `npx firebase-tools deploy --only database --project <id>`).
- Емулятори: `firebase.json` (Auth :9099, RTDB :9000, потрібна Java 11+), змінні `FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_DATABASE_EMULATOR_HOST` на сервері та `VITE_USE_FIREBASE_EMULATORS=true` у клієнті.
- Перевірки: `cd server && npx tsx scripts/auth-smoke.ts` (без мережі, фейковий Firebase-шар), `npx tsx scripts/firebase-live-check.ts http://localhost:5174` (реальний проєкт, створює й видаляє тестових користувачів `muify-test-*@example.com`), `npx tsx scripts/firebase-leftovers.ts`.
- `design/` — макет.
- `.claude/agents/muify-builder.md` — Claude Code агент для розробки платформи за макетом.
