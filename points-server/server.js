// Minimal backend for the AFK Word Game overlay: records word-match wins
// and serves per-round and all-time leaderboards, backed by SQLite. See
// README.md for the API and how to run this with Docker.

const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', routes);

app.get('/', (req, res) => {
    res.type('text').send('points-server is running. Try /api/health or /api/leaderboard/alltime.');
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`points-server listening on :${port}`);
});
