// AFK Word Game configuration.
//
// This is the only file you should need to edit day to day. The actual
// behavior lives in afk-word-game.js, which loads before this file.

initAfkWordGame({
    channel: 'humboshot',
    twitchUserId: '40262155',
    twitchClientId: typeof TWITCH_CLIENT_ID !== 'undefined' ? TWITCH_CLIENT_ID : '',
    twitchClientSecret: typeof TWITCH_CLIENT_SECRET !== 'undefined' ? TWITCH_CLIENT_SECRET : '',

    // Twitch/streaming culture words. One shows at a time; typing it
    // exactly (case-insensitive) in chat wins the round for that word.
    words: [
        'PogChamp', 'Kappa', 'poggers', 'copium', 'hopium', 'based',
        'clip it', 'raid', 'sub', 'gifted', 'lurking', 'first',
        'gg', 'ez', 'W', 'L', 'no cap', 'sheesh', 'let him cook',
        'chat is this real', 'jumpscare', 'mods', 'ratio', 'cracked',
        'deadge', 'sadge', 'monkaS', 'OMEGALUL', '5head', 'copy that',
    ],

    // Not a secret, so it stays here rather than in secrets.local.js. Point
    // this at wherever you run the points-server container (see
    // points-server/README.md); it does not need to be localhost.
    pointsServerUrl: 'http://localhost:4000',
    requestTimeoutMs: 3000,

    obsWebSocketUrl: 'ws://localhost:4455',
    obsWebSocketPassword: typeof OBS_WEBSOCKET_PASSWORD !== 'undefined' ? OBS_WEBSOCKET_PASSWORD : '',

    // Exact OBS scene name(s) (case-insensitive) that count as "AFK".
    // Replace with your actual AFK scene name if it differs.
    afkSceneNames: ['AFK'],

    // How long the round's leaderboard stays on screen after you switch
    // away from the AFK scene, before this overlay goes blank again.
    leaderboardDisplayDuration: 15000,
});
