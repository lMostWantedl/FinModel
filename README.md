# Debt Optimizer

TypeScript-first debt optimization platform (see `docs/` for the blueprint):
a pure calculation engine, Fastify API, and React UI with Excel export and
scenario simulation.

## Layout

- `packages/engine` — pure, deterministic calculation engine (`@debt/engine`):
  amortization, month-by-month simulation, Avalanche / Snowball / Optimized
  strategies, foreclosure evaluation, November-bonus allocation. Decimal.js
  money math, zero I/O, Vitest-tested.
- `apps/api` — Fastify + Prisma (SQLite) API (`@debt/api`): loans CRUD,
  `/simulate`, `/simulation`, `/dashboard`, `/export/excel` (ExcelJS).
- `apps/web` — React + Vite + Recharts UI (`@debt/web`): dashboard, loan
  management, scenario comparison.

## Getting started

```bash
npm install
npm run db:push -w @debt/api     # create the SQLite schema
npm run build -w @debt/engine    # engine must be built before the API starts
npm run dev:api                  # Fastify on :3001
npm run dev:web                  # Vite on :5173
```

Run the engine tests with `npm test`.

## API

| Method | Path            | Purpose                                        |
| ------ | --------------- | ---------------------------------------------- |
| GET    | `/loans`        | list loans                                     |
| POST   | `/loans`        | add a loan                                     |
| DELETE | `/loans/:id`    | remove a loan                                  |
| POST   | `/simulate`     | run + persist a simulation (all strategies)    |
| GET    | `/simulation`   | latest persisted simulation                    |
| GET    | `/dashboard`    | remaining debt, next target, timeline, charts  |
| GET    | `/export/excel` | ExcelJS workbook (loans, comparison, timeline) |

Auth is anonymous for local use (per `docs`), JWT/OAuth is a later phase.
