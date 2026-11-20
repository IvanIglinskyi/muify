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
- `server/` — Express API (`/api/albums`, `/api/playlists`, `/api/tracks`, `/api/history`, `/api/stats`, `/api/player`). Каталог (seed або Jamendo) — у пам'яті; стан користувача (лайки, власні плейлисти, історія прослуховувань, остання позиція/трек/гучність) зберігається у `server/data-store/user-state.json` (у `.gitignore`; атомарний запис, debounce). Інший каталог можна задати змінною `MUIFY_DATA_DIR`.
- `design/` — макет.
- `.claude/agents/muify-builder.md` — Claude Code агент для розробки платформи за макетом.
