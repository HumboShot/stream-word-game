// AFK Word Game overlay. Streamer.bot runs the game (see
// streamerbot/word-game.cs): it starts a round when OBS switches to the AFK
// scene, checks chat for the word, keeps the points, and posts the round
// results to chat. This page only displays what the script broadcasts:
//   - round-start / state: show the rules and a countdown, then the word at a random spot
//   - winner: explode the word box, reveal the winner, then show the next word
//   - round-end: go blank
//
// Edit the config passed to initAfkWordGame() in afk-word-game.config.js.

function initAfkWordGame({
    streamerbotUrl = 'ws://127.0.0.1:8080/',
    streamerbotPassword = '',
    actionName = 'Word Game', // Must match the Streamer.bot action name.
    nextWordDelay = 900,      // Time between the explosion and the next word.
    showEmoteName = true,     // false: show only the emote image until someone solves it.
} = {}) {
    const gameEl = document.getElementById('layout-game');
    const wordDisplayEl = document.getElementById('word-display');
    const statusEl = document.getElementById('streamerbot-status');

    function setGameVisible(visible) {
        gameEl.classList.toggle('is-active', visible);
    }

    // -----------------------------------------------------------------
    // PLACEMENT
    // -----------------------------------------------------------------
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

    // -----------------------------------------------------------------
    // WORD AND EXPLOSION
    // -----------------------------------------------------------------
    let nextWordTimer = null;

    // Fills a word box with the emote image (if any) and the text chat must type.
    // Without showName, the text is left out, unless there is no image to show.
    // onImageLoad runs when the image size is known, so the box can be kept on screen.
    function renderWord(el, word, image, { showName = true, onImageLoad } = {}) {
        el.replaceChildren();
        const text = document.createElement('span');
        text.className = 'word-text';
        text.textContent = word;
        if (image) {
            const img = document.createElement('img');
            img.className = 'word-emote';
            img.alt = '';
            img.addEventListener('load', () => onImageLoad && onImageLoad());
            img.addEventListener('error', () => {
                img.replaceWith(text); // Leaves only the name, whether or not it was shown.
                onImageLoad && onImageLoad();
            });
            img.src = image;
            el.appendChild(img);
        }
        if (showName || !image) el.appendChild(text);
    }

    function showWord(word, image) {
        clearTimeout(nextWordTimer);
        hideIntro(true);
        setGameVisible(true);
        wordDisplayEl.classList.remove('is-entering', 'is-hidden');
        renderWord(wordDisplayEl, word, image, {
            showName: showEmoteName,
            // The image changed the box size. Pull it back inside the canvas.
            onImageLoad: () => placeAt(wordDisplayEl,
                parseFloat(wordDisplayEl.style.left), parseFloat(wordDisplayEl.style.top)),
        });
        placeRandomly(wordDisplayEl); // Also forces a reflow, so the pop-in animation retriggers.
        wordDisplayEl.classList.add('is-entering');
    }

    // Warms the browser cache, so the next emote appears without a blank frame.
    function preloadImage(url) {
        if (url) new Image().src = url;
    }

    // -----------------------------------------------------------------
    // INTRO AND COUNTDOWN
    // -----------------------------------------------------------------
    const introEl = document.getElementById('intro');
    const countdownEl = introEl.querySelector('.intro-countdown');
    const introPointsEl = introEl.querySelector('.intro-points');
    const introLateEl = introEl.querySelector('.intro-late');
    const introLeaveDuration = 350; // Must match the intro-out animation in the CSS.
    let countdownTimer = null;
    let introLeaveTimer = null;

    function hideIntro(animate) {
        clearTimeout(countdownTimer);
        if (!introEl.classList.contains('is-visible')) return;
        introEl.classList.remove('is-visible');
        if (!animate) return;
        introEl.classList.add('is-leaving');
        clearTimeout(introLeaveTimer);
        introLeaveTimer = setTimeout(() => introEl.classList.remove('is-leaving'), introLeaveDuration);
    }

    // Shows the rules card and counts down to the first word. Streamer.bot
    // ignores chat guesses until the same moment.
    function startCountdown(word, image, ms, points, lateSeconds, latePoints) {
        clearTimeout(nextWordTimer);
        clearTimeout(introLeaveTimer);
        introEl.classList.remove('is-leaving');
        setGameVisible(true);
        wordDisplayEl.classList.add('is-hidden');
        introPointsEl.textContent = points;
        introLateEl.hidden = !(lateSeconds > 0);
        introLateEl.querySelector('.intro-late-seconds').textContent = lateSeconds;
        introLateEl.querySelector('.intro-late-points').textContent = latePoints;
        introEl.classList.add('is-visible');
        preloadImage(image);

        const endAt = performance.now() + ms;
        let shownSeconds = null;
        function tick() {
            const left = endAt - performance.now();
            if (left <= 0) {
                showWord(word, image);
                return;
            }
            const seconds = Math.ceil(left / 1000);
            if (seconds !== shownSeconds) {
                shownSeconds = seconds;
                countdownEl.textContent = seconds;
                countdownEl.classList.toggle('is-final', seconds <= 3);
                countdownEl.classList.remove('is-ticking');
                void countdownEl.offsetWidth; // Force a reflow, so the tick animation retriggers.
                countdownEl.classList.add('is-ticking');
            }
            countdownTimer = setTimeout(tick, left % 1000 || 1000);
        }
        tick();
    }

    // Gives users without a chat color a stable color, like Twitch does.
    function hashColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return `hsl(${Math.abs(hash) % 360}, 70%, 65%)`;
    }

    const shardCount = 18;
    const explosionDuration = 2200; // Must cover the longest animation in the .burst CSS.

    // Replaces the solved word box with a burst: a copy of the box blows
    // outward and fades, shards fly out, and the winner's name pops in.
    function explodeWord(displayName, color, word, image, points) {
        const burst = document.createElement('div');
        burst.className = 'burst';

        const shell = document.createElement('div');
        shell.className = 'burst-shell';
        renderWord(shell, word, image); // Always with the name, so the answer is revealed.
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
        name.style.color = color || '';
        if (!name.style.color) name.style.color = hashColor(displayName); // Empty or invalid color.
        const pointsEl = document.createElement('div');
        pointsEl.className = 'burst-points';
        pointsEl.textContent = `+${points}`;
        reveal.append(name, pointsEl);
        burst.appendChild(reveal);

        gameEl.appendChild(burst);
        placeAt(burst, parseFloat(wordDisplayEl.style.left), parseFloat(wordDisplayEl.style.top));
        lastBurstCenter = { x: parseFloat(burst.style.left), y: parseFloat(burst.style.top) };
        latePopCount = 0;
        setTimeout(() => burst.remove(), explosionDuration);
    }

    // Late guesses: a small "+27 Name" pop that rises below the last explosion.
    // Pops stack one line apart, and wrap after latePopRows, so they do not overlap.
    const latePopDuration = 1800; // Must match the late-pop animation in the CSS.
    const latePopRows = 6;
    const latePopLineHeight = 46;
    let lastBurstCenter = null;
    let latePopCount = 0;

    function showLatePop(displayName, color, points) {
        const pop = document.createElement('div');
        pop.className = 'late-pop';
        const pointsEl = document.createElement('span');
        pointsEl.className = 'late-pop-points';
        pointsEl.textContent = `+${points}`;
        const name = document.createElement('span');
        name.className = 'late-pop-name';
        name.textContent = displayName;
        name.style.color = color || '';
        if (!name.style.color) name.style.color = hashColor(displayName);
        pop.append(pointsEl, name);
        gameEl.appendChild(pop);

        const center = lastBurstCenter || { x: document.body.clientWidth / 2, y: document.body.clientHeight / 2 };
        const row = latePopCount % latePopRows;
        latePopCount++;
        placeAt(pop, center.x + (Math.random() - 0.5) * 120, center.y + 100 + row * latePopLineHeight);
        setTimeout(() => pop.remove(), latePopDuration);
    }

    // -----------------------------------------------------------------
    // STREAMER.BOT EVENTS
    // -----------------------------------------------------------------
    function handleGameEvent(data) {
        if (data.source !== 'stream-word-game') return;

        if (data.type === 'round-start' || (data.type === 'state' && data.word)) {
            const countdownMs = parseInt(data.countdownMs, 10) || 0;
            if (countdownMs > 0) {
                startCountdown(data.word, data.image, countdownMs, data.points || 100,
                    parseInt(data.lateSeconds, 10) || 0, data.latePoints || 0);
            } else {
                showWord(data.word, data.image);
            }
        } else if (data.type === 'late') {
            if (gameEl.classList.contains('is-active')) showLatePop(data.name, data.color, data.points);
        } else if (data.type === 'state' || data.type === 'round-end') {
            clearTimeout(nextWordTimer);
            hideIntro(false);
            setGameVisible(false);
        } else if (data.type === 'winner') {
            clearTimeout(nextWordTimer);
            if (gameEl.classList.contains('is-active')) {
                explodeWord(data.name, data.color, data.word, data.image, data.points || 100);
            }
            wordDisplayEl.classList.add('is-hidden');
            preloadImage(data.nextImage);
            nextWordTimer = setTimeout(() => showWord(data.nextWord, data.nextImage), nextWordDelay);
        }
    }

    connectStreamerbot({
        url: streamerbotUrl,
        password: streamerbotPassword,
        onCustomEvent: handleGameEvent,
        onReady: (send) => {
            // Ask the script for the current word, in case this page was
            // reloaded in the middle of a round.
            send({ request: 'DoAction', action: { name: actionName }, args: { wordGameRequest: 'state' } });
        },
        onStatusChange: (status) => statusEl.classList.toggle('is-visible', status === 'disconnected'),
    });
}
