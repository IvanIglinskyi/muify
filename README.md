# MuiFy

Музична платформа: React + TypeScript (Vite) на фронтенді, Node.js + Express + TypeScript на бекенді.

![Макет](design/muify-design.png)

## Запуск

```bash
npm run install:all   # встановити залежності (перший раз)
npm run dev           # API на http://localhost:4000, клієнт на http://localhost:5173
npm run build         # перевірка типів і збірка обох частин
npm test              # тести сервера (Vitest + supertest) і клієнта (Vitest + jsdom + Testing Library)
npm run typecheck     # tsc для сервера (разом із тестами) і клієнта
```

CI: `.github/workflows/ci.yml` (Node 22, `npm ci` у корені/server/client, typecheck, build, tests). Секрети не потрібні: тести використовують in-memory фейк Firebase і локальний фейковий Jamendo API.

## Можливості цієї версії

- **Статистика на Home** — реальні дані слухача: час прослуховування («3 h 20 min»), лайки (треки + альбоми), кількість різних прослуханих треків (`GET /api/stats`, лише для залогінених / local; гостям — картка «Sign in to see your listening stats»). Рахується з історії (останні 2000 прослуховувань).
- **Сторінка артиста** `/artist/:id` (`GET /api/artists/:id`): Jamendo (`jr123` → `/artists`, `/tracks?artist_id`, `/albums/tracks?artist_id`) або seed (`sa-<ім'я>`). Імена артистів клікабельні в рядках треків, картках альбомів, на сторінці альбому, у плеєрі, Recent Plays і статистиці (окремі посилання; клік по рядку й далі запускає трек).
- **Персональні рекомендації** (`GET /api/recommendations`, `/api/tracks/daily-mix`): Daily Mix з улюблених/найчастіше слуханих артистів і жанрів (Jamendo: `artist_id` + `fuzzytags`), без нещодавно прослуханого, детермінований на користувача й день, кеш на користувача (1 год або до зміни смаку). Рядок «Because you liked …» на Home, якщо даних достатньо. Гостям — загальний мікс.
- **Плейлисти**: опис, зміна порядку (drag-and-drop або ⋮ → Move up / Move down / to top / to bottom), публічне посилання `/p/:shareId` (read-only, відкривається і гостями). Firebase: індекс `sharedPlaylists/{shareId} → { ownerUid, playlistId }` (читає лише сервер; правила RTDB і далі забороняють клієнтський доступ); local: `shareId` у самому плейлисті. Вимкнення посилання → 404.
- **Гарячі клавіші** (поза текстовими полями): Space, Shift+←/→, ←/→ (±5 с), ↑/↓ (гучність), M, L, `/`, `?` (довідка; також у меню Settings).

## Структура

- `client/` — React-застосунок (компоненти в `src/components`, стан у `src/store`).
- `server/` — Express API (`/api/albums`, `/api/artists`, `/api/playlists`, `/api/shared`, `/api/tracks`, `/api/recommendations`, `/api/history`, `/api/stats`, `/api/player`, `/api/me`). Тести — у `server/test/`. Каталог (seed або Jamendo) — у пам'яті, спільний для всіх. Стан користувача (лайки, власні плейлисти, історія, остання позиція/трек/гучність, профіль) — окремо для кожного користувача, див. «Акаунти».

## Акаунти (Firebase)

- **Режим `firebase`** (заповнені `FIREBASE_DATABASE_URL` + сервісний ключ у `server/.env`, і Firebase web-конфіг у `client/.env.local`): вхід через Email/пароль або Google (Firebase Auth у браузері). Сервер перевіряє ID-токен (`Authorization: Bearer …`, `firebase-admin`) і зберігає дані у Realtime Database під `users/{uid}/…` (`profile`, `likes`, `playlists`, `history`, `player`, `meta`). Гості можуть слухати й переглядати каталог; збереження вимагає входу (API відповідає 401).
- **Режим `local`** (Firebase не налаштовано): як раніше — без входу, один користувач, стан у `server/data-store/user-state.json` (або `MUIFY_DATA_DIR`). Сервер один раз пише попередження в лог.
- Режим видно в `GET /api/status` → `auth`.
- Браузер ніколи не читає RTDB напряму: `database.rules.json` забороняє будь-який клієнтський доступ (застосувати: Firebase Console → Realtime Database → Rules, або `npx firebase-tools deploy --only database --project <id>`).
- Емулятори: `firebase.json` (Auth :9099, RTDB :9000, потрібна Java 11+), змінні `FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_DATABASE_EMULATOR_HOST` на сервері та `VITE_USE_FIREBASE_EMULATORS=true` у клієнті.
- Перевірки: офлайн-перевірка Firebase-режиму (колишній `scripts/auth-smoke.ts`) тепер — Vitest-тести `server/test/*.firebase.test.ts` (входять у `npm test`). Живі перевірки з реальними обліковими даними (не в CI): `cd server && npx tsx scripts/firebase-live-check.ts http://localhost:5174` (реальний проєкт, створює й видаляє тестових користувачів `muify-test-*@example.com` і їхні `sharedPlaylists`), `npx tsx scripts/firebase-leftovers.ts`.
- `design/` — макет.
- `.claude/agents/muify-builder.md` — Claude Code агент для розробки платформи за макетом.
