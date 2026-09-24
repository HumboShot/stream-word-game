// AFK Word Game overlay. Shows one random Twitch-culture word at a time
// while OBS is on the AFK scene. The first chat user to type that word
// exactly (case-insensitive) wins 100 points and the next word appears.
// When OBS switches away from the AFK scene, this shows a leaderboard of
// that round's winners for a while, then goes blank until the next AFK round.
//
// Points are recorded through a small self-hosted backend (see
// points-server/), so they persist across streams. If that backend is
// unreachable, the word game keeps running locally; only point tracking
// is affected.
//
// Edit the config passed to initAfkWordGame() in afk-word-game.config.js.

// Shuffles an array in place using the Fisher-Yates algorithm.
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function initAfkWordGame({
    channel,
    twitchUserId,
    twitchClientId,
    twitchClientSecret,

    words = [],
    pointsServerUrl = '',
    requestTimeoutMs = 3000,

    obsWebSocketUrl = 'ws://localhost:4455',
    obsWebSocketPassword = '',
    afkSceneNames = [],
    leaderboardDisplayDuration = 15000,
} = {}) {
    const layoutEls = {
        game: document.getElementById('layout-game'),
        leaderboard: document.getElementById('layout-leaderboard'),
    };
    const wordDisplayEl = document.getElementById('word-display');
    const leaderboardListEl = document.getElementById('leaderboard-list');
    const backendStatusEl = document.getElementById('backend-status');

    function setActiveLayout(name) {
        for (const key of Object.keys(layoutEls)) {
            layoutEls[key].classList.toggle('is-active', key === name);
        }
    }

    function setBackendOffline(offline) {
        backendStatusEl.classList.toggle('is-visible', offline);
    }

    // -----------------------------------------------------------------
    // POINTS SERVER (see points-server/README.md for the API this calls)
    // -----------------------------------------------------------------
    async function callApi(path, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
            const res = await fetch(`${pointsServerUrl}${path}`, { ...options, signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setBackendOffline(false);
            return await res.json();
        } catch (err) {
            console.warn(`AFK Word Game: points server request failed (${path})`, err);
            setBackendOffline(true);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    function startRound() {
        return callApi('/api/rounds/start', { method: 'POST' });
    }

    function endRound(roundId) {
        return callApi(`/api/rounds/${roundId}/end`, { method: 'POST' });
    }

    function fetchLeaderboard(roundId) {
        return callApi(`/api/rounds/${roundId}/leaderboard`);
    }

    function recordWin(roundId, username, word) {
        return callApi('/api/wins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roundId, username, word }),
        });
    }

    // -----------------------------------------------------------------
    // WORD LIFECYCLE
    // -----------------------------------------------------------------
    let wordPool = [];
    let currentWord = null;
    let wordLocked = false; // True from the moment a word is matched until the next word is shown.
    let currentRoundId = null;

    function refillPool() {
        wordPool = shuffleArray([...words]);
    }

    const edgeMargin = 40;

    // Returns the allowed range for an element's center, so that the whole
    // element stays inside the canvas. Elements are centered with translate(-50%, -50%).
    function centerRange(el) {
        const halfW = el.offsetWidth / 2 + edgeMargin;
        const halfH = el.offsetHeight / 2 + edgeMargin;
        return {
            minX: halfW, maxX: document.body.clientWidth - halfW,
            minY: halfH, maxY: document.body.clientHeight - halfH,
        };
    }

    function placeAt(el, x, y) {
        const r = centerRange(el);
        el.style.left = `${Math.min(Math.max(x, r.minX), r.maxX)}px`;
        el.style.top = `${Math.min(Math.max(y, r.minY), r.maxY)}px`;
    }

    function placeRandomly(el) {
        const r = centerRange(el);
        placeAt(el, r.minX + Math.random() * (r.maxX - r.minX), r.minY + Math.random() * (r.maxY - r.minY));
    }

    function showWord(word) {
        currentWord = word;
        wordLocked = false;
        wordDisplayEl.classList.remove('is-entering', 'is-hidden');
        wordDisplayEl.textContent = word;
        placeRandomly(wordDisplayEl); // Also forces a reflow, so the pop-in animation retriggers.
        wordDisplayEl.classList.add('is-entering');
    }

    function nextWord() {
        if (wordPool.length === 0) refillPool();
        showWord(wordPool.pop());
    }

    const shardCount = 18;
    const explosionDuration = 2200; // Must cover the longest animation in the .burst CSS.
    const nextWordDelay = 900;
    let nextWordTimer = null;

    // Replaces the solved word box with a burst: a copy of the box blows
    // outward and fades, shards fly out, and the winner's name pops in.
    function explodeWord(displayName, color, word) {
        const burst = document.createElement('div');
        burst.className = 'burst';

        const shell = document.createElement('div');
        shell.className = 'burst-shell';
        shell.textContent = word;
        burst.appendChild(shell);

        for (let i = 0; i < shardCount; i++) {
            const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.3;
            const distance = 160 + Math.random() * 180;
            const shard = document.createElement('div');
            shard.className = i % 3 === 0 ? 'burst-shard is-gold' : 'burst-shard';
            shard.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
            shard.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
            shard.style.setProperty('--spin', `${Math.random() * 720 - 360}deg`);
            burst.appendChild(shard);
        }

        const reveal = document.createElement('div');
        reveal.className = 'burst-reveal';
        const name = document.createElement('div');
        name.className = 'burst-name';
        name.textContent = displayName;
        name.style.color = color;
        const points = document.createElement('div');
        points.className = 'burst-points';
        points.textContent = '+100';
        reveal.append(name, points);
        burst.appendChild(reveal);

        layoutEls.game.appendChild(burst);
        placeAt(burst, parseFloat(wordDisplayEl.style.left), parseFloat(wordDisplayEl.style.top));
        setTimeout(() => burst.remove(), explosionDuration);
    }

    // -----------------------------------------------------------------
    // ROUND LIFECYCLE (driven by AFK scene entry/exit)
    // -----------------------------------------------------------------
    let isAfk = false;
    let leaderboardTimer = null;

    async function onAfkStart() {
        isAfk = true;
        clearTimeout(leaderboardTimer);
        clearTimeout(nextWordTimer);
        setActiveLayout('game');
        refillPool();
        nextWord();

        const round = await startRound();
        currentRoundId = round ? round.roundId : null;
    }

    async function onAfkEnd() {
        isAfk = false;
        currentWord = null;
        wordLocked = true; // Ignore any late matches until the next round starts.
        clearTimeout(nextWordTimer);

        const roundId = currentRoundId;
        currentRoundId = null;
        let leaderboard = [];
        if (roundId != null) {
            await endRound(roundId);
            leaderboard = (await fetchLeaderboard(roundId)) || [];
        }
        setActiveLayout('leaderboard');
        renderLeaderboard(leaderboard);
        leaderboardTimer = setTimeout(() => setActiveLayout(null), leaderboardDisplayDuration);
    }

    function renderLeaderboard(entries) {
        if (entries.length === 0) {
            leaderboardListEl.innerHTML = '<div class="leaderboard-empty">No winners this round.</div>';
            return;
        }
        leaderboardListEl.innerHTML = entries
            .map((entry, i) => `
                <div class="leaderboard-row">
                    <span class="leaderboard-rank">#${i + 1}</span>
                    <span class="leaderboard-name">${escapeHtml(entry.username)}</span>
                    <span class="leaderboard-points">${entry.points} pts</span>
                </div>
            `)
            .join('');
    }

    // -----------------------------------------------------------------
    // OBS SCENE DETECTION
    // -----------------------------------------------------------------
    connectObsWebSocket({
        url: obsWebSocketUrl,
        password: obsWebSocketPassword,
        onSceneChanged: (sceneName) => {
            const lower = sceneName.toLowerCase();
            const matchesAfk = afkSceneNames.some((name) => name.toLowerCase() === lower);
            if (matchesAfk && !isAfk) {
                onAfkStart();
            } else if (!matchesAfk && isAfk) {
                onAfkEnd();
            }
        },
    });

    // -----------------------------------------------------------------
    // TWITCH CHAT
    // -----------------------------------------------------------------
    connectTwitchChat({
        channel,
        twitchUserId,
        twitchClientId,
        twitchClientSecret,
        hideCommands: true,
        onMessage: (displayName, color, html, badgesHtml, rawText) => {
            if (!isAfk || wordLocked || !currentWord) return;
            if (rawText.trim().toLowerCase() !== currentWord.toLowerCase()) return;

            wordLocked = true; // Set synchronously, before the await below, so a burst of
                                // near-simultaneous messages cannot double-award this word.
            const word = currentWord;
            explodeWord(displayName, color, word);
            wordDisplayEl.classList.add('is-hidden');
            nextWordTimer = setTimeout(nextWord, nextWordDelay);
            if (currentRoundId != null) recordWin(currentRoundId, displayName, word);
        },
    });
}
