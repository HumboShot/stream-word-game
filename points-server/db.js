// Opens (and creates, on first run) the SQLite database backing the AFK
// Word Game's points and leaderboard. The file lives under DATA_DIR, which
// docker-compose.yml mounts as a volume, so points survive container
// restarts and image rebuilds.

const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, 'points.db'));

db.exec(`
    CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id),
        username TEXT NOT NULL,
        word TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wins_round ON wins(round_id);
    CREATE INDEX IF NOT EXISTS idx_wins_username ON wins(username);
`);

module.exports = db;
