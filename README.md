# OMEA Dashboard — local live version

This is a real Vite + React app that queries your local OpenSearch cluster directly
from the browser. No backend server, no hosting cost — everything runs on your machine.

## Prerequisites

- Node.js installed (comes with `npm`)
- Your OpenSearch Docker cluster running with CORS enabled (see the updated
  `docker-compose.yml` — restart it with `docker compose down` then `docker compose up -d`
  if you haven't already applied the CORS settings)
- The `omea-articles` index populated with the enriched dataset (already done if you've
  followed the project so far)

## Setup

```
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`).

## How it works

- `src/opensearchClient.js` — the actual live queries, calling `http://localhost:9200`
  directly. These implement the exact Query DSL from `OMEA_query_dsl_reference.md`.
- `src/App.jsx` — the dashboard UI, dual-persona (Marketing Owner / Data Analyst),
  channel filter, and explainability drill-down panel.
- Typing any topic into the search box runs a real query against your indexed articles.
  If nothing matches, the dashboard tells you honestly rather than showing fake data.

## Troubleshooting

- **"Could not reach OpenSearch"** — make sure Docker is running and
  `curl.exe http://localhost:9200` works in a separate terminal.
- **CORS errors in the browser console** — double check the `docker-compose.yml`
  environment block includes `http.cors.enabled=true` and `http.cors.allow-origin=*`,
  then fully restart the container (`docker compose down && docker compose up -d`).
