# points-server

Minimal backend for the `afk-word-game` overlay. Records who won each word
and serves per-round and all-time leaderboards. Backed by a SQLite file, so
points survive restarts.

Run it on any machine reachable from the PC running OBS (same machine, LAN,
or over the internet) — it does not need to be `localhost`.

## Run with Docker

```
cd points-server
docker compose up -d --build
```

The database file is stored at `./data/points.db` on the host, via a bind
mount, so it survives `docker compose restart` and image rebuilds.

Set `pointsServerUrl` in `afk-word-game/afk-word-game.config.js` to
`http://<this-machine's-address>:4000`.

## Run without Docker

Install Node.js 20 or newer. Then run:

```
cd points-server
npm install
npm start
```

The server listens on port 4000. The database file is `points-server/points.db`.

Use these environment variables to change the defaults:

- `PORT`: the port to listen on.
- `DATA_DIR`: the folder that holds `points.db`.

PowerShell example:

```
$env:PORT = 5000; $env:DATA_DIR = "D:\points-data"; npm start
```

## API

All request/response bodies are JSON.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/rounds/start` | — | `{ roundId, startedAt }` |
| POST | `/api/rounds/:id/end` | — | `{ roundId, endedAt }` |
| POST | `/api/wins` | `{ roundId, username, word }` | `{ ok, roundTotal, allTimeTotal }` |
| GET | `/api/rounds/:id/leaderboard` | — | `[{ username, points }]`, sorted descending |
| GET | `/api/leaderboard/alltime` | — | `[{ username, points }]`, sorted descending |
| GET | `/api/health` | — | `{ ok: true }` |

Points are fixed at 100 per win, set on the server — a caller cannot award a
different amount.

## CORS

CORS is wide open (`cors()` with its defaults), because the overlay runs
inside an OBS Browser Source with no meaningful origin and sends no
credentials. If you ever expose this server beyond your own LAN, put it
behind a reverse proxy that restricts access instead of relying on CORS
alone.

## Manual test

```
docker compose up -d --build
curl -X POST http://localhost:4000/api/rounds/start
curl -X POST http://localhost:4000/api/wins \
  -H "Content-Type: application/json" \
  -d '{"roundId":1,"username":"testuser","word":"gg"}'
curl http://localhost:4000/api/rounds/1/leaderboard
curl http://localhost:4000/api/leaderboard/alltime
```
