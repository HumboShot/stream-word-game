// REST routes for the AFK Word Game's points and leaderboard. Points are
// fixed at 100 per win here, on the server, so a client can never award
// itself a different amount.

const express = require('express');
const db = require('./db');

const POINTS_PER_WIN = 100;
const router = express.Router();

router.post('/rounds/start', (req, res) => {
    const startedAt = new Date().toISOString();
    const { lastInsertRowid } = db.prepare('INSERT INTO rounds (started_at) VALUES (?)').run(startedAt);
    res.json({ roundId: lastInsertRowid, startedAt });
});

router.post('/rounds/:id/end', (req, res) => {
    const roundId = Number(req.params.id);
    const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
    if (!round) return res.status(404).json({ error: 'round not found' });

    const endedAt = new Date().toISOString();
    db.prepare('UPDATE rounds SET ended_at = ? WHERE id = ?').run(endedAt, roundId);
    res.json({ roundId, endedAt });
});

router.get('/rounds/:id/leaderboard', (req, res) => {
    const roundId = Number(req.params.id);
    const rows = db.prepare(`
        SELECT username, SUM(points) AS points
        FROM wins
        WHERE round_id = ?
        GROUP BY username
        ORDER BY points DESC, MIN(created_at) ASC
    `).all(roundId);
    res.json(rows);
});

router.get('/leaderboard/alltime', (req, res) => {
    const rows = db.prepare(`
        SELECT username, SUM(points) AS points
        FROM wins
        GROUP BY username
        ORDER BY points DESC
    `).all();
    res.json(rows);
});

router.post('/wins', (req, res) => {
    const { roundId, username, word } = req.body || {};
    if (!roundId || !username || !word) {
        return res.status(400).json({ error: 'roundId, username, and word are required' });
    }
    const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
    if (!round) return res.status(404).json({ error: 'round not found' });

    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO wins (round_id, username, word, points, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(roundId, username, word, POINTS_PER_WIN, createdAt);

    const roundTotal = db.prepare('SELECT COALESCE(SUM(points), 0) AS total FROM wins WHERE round_id = ? AND username = ?')
        .get(roundId, username).total;
    const allTimeTotal = db.prepare('SELECT COALESCE(SUM(points), 0) AS total FROM wins WHERE username = ?')
        .get(username).total;

    res.json({ ok: true, roundTotal, allTimeTotal });
});

router.get('/health', (req, res) => {
    res.json({ ok: true });
});

module.exports = router;
