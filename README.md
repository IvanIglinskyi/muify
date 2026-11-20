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
- `server/` — Express API (`/api/albums`, `/api/playlists`, `/api/tracks`, `/api/stats`, `/api/player`). Дані зберігаються в пам'яті.
- `design/` — макет.
- `.claude/agents/muify-builder.md` — Claude Code агент для розробки платформи за макетом.
