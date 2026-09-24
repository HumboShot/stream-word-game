// This is a minimal obs-websocket v5 client. It reports the currently active
// OBS scene (see afk-word-game.js). Copied from the stream-overlays repo.
//
// OBS Studio 28 and later ships obs-websocket built in (Tools > WebSocket Server
// Settings). This code connects to it directly, at the default ws://localhost:4455,
// so it needs no extra server or process beyond enabling obs-websocket in OBS. Like
// shared/twitch-chat.js, this is a hand-rolled WebSocket client, with no
// obs-websocket-js npm package, because this repo has no bundler and pages
// open directly as local files.
//
// Protocol summary (https://github.com/obsproject/obs-websocket):
//   1. The server sends "Hello" (op 0), with an auth challenge if a password is set.
//   2. The client sends "Identify" (op 1), with a computed auth string if needed.
//   3. The server sends "Identified" (op 2) once it accepts the client.
//   4. The server sends "Event" (op 5) messages for things such as scene changes.
//   5. The client can send "Request" (op 6) and gets "RequestResponse" (op 7).

// This is a pure-JS SHA-256 implementation, with no Web Crypto or crypto.subtle dependency.
// The OBS Browser Source loads local files through a custom scheme. This does not reliably
// count as a "secure context", so crypto.subtle is unavailable there.
// This code cannot rely on crypto.subtle, even though this file is local.
function sha256(bytes) {
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    const l = bytes.length;
    const padded = new Uint8Array((((l + 8) >> 6) << 6) + 64);
    padded.set(bytes);
    padded[l] = 0x80;
    const view = new DataView(padded.buffer);
    const bitLen = l * 8;
    view.setUint32(padded.length - 4, bitLen >>> 0, false);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word, false));
    return out;
}

function sha256Base64(str) {
    const bytes = new TextEncoder().encode(str);
    const digestBytes = sha256(bytes);
    return btoa(String.fromCharCode(...digestBytes));
}

function connectObsWebSocket({
    url = 'ws://localhost:4455',
    password = '',
    onSceneChanged, // (sceneName) => void. Called on connect, with the current scene, and on every scene change.
    onStatusChange, // ('connected' | 'disconnected') => void. Called once identified, and again if the connection drops.
} = {}) {
    let requestCounter = 0;

    function connect() {
        const ws = new WebSocket(url);

        ws.addEventListener('message', async (evt) => {
            let msg;
            try {
                msg = JSON.parse(evt.data);
            } catch (err) {
                return;
            }

            if (msg.op === 0) {
                // Hello. Reply with Identify, and authenticate if required.
                const authData = msg.d.authentication;
                const identify = { rpcVersion: msg.d.rpcVersion };
                if (authData) {
                    const secret = await sha256Base64(password + authData.salt);
                    identify.authentication = await sha256Base64(secret + authData.challenge);
                }
                ws.send(JSON.stringify({ op: 1, d: identify }));
            } else if (msg.op === 2) {
                // Identified. Now ask for the currently active scene.
                onStatusChange && onStatusChange('connected');
                requestCounter += 1;
                ws.send(JSON.stringify({
                    op: 6,
                    d: { requestType: 'GetCurrentProgramScene', requestId: `get-scene-${requestCounter}` },
                }));
            } else if (msg.op === 7 && msg.d.requestType === 'GetCurrentProgramScene') {
                const data = msg.d.responseData || {};
                const sceneName = data.currentProgramSceneName || data.sceneName;
                if (sceneName) onSceneChanged && onSceneChanged(sceneName);
            } else if (msg.op === 5 && msg.d.eventType === 'CurrentProgramSceneChanged') {
                const data = msg.d.eventData || {};
                const sceneName = data.sceneName || data.currentProgramSceneName;
                if (sceneName) onSceneChanged && onSceneChanged(sceneName);
            }
        });

        ws.addEventListener('close', () => {
            console.warn('OBS WebSocket: disconnected, reconnecting in 3s...');
            onStatusChange && onStatusChange('disconnected');
            setTimeout(connect, 3000);
        });

        ws.addEventListener('error', (err) => {
            console.error('OBS WebSocket: connection error', err);
        });
    }

    connect();
}
