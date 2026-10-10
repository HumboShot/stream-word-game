// AFK Word Game configuration.
//
// The emotes come from the channel (Twitch and 7TV). The AFK scene name, the
// emote sources, and the points are set in streamerbot/word-game.cs, because Streamer.bot runs the game. This file
// only tells the overlay how to reach Streamer.bot.

initAfkWordGame({
    // Streamer.bot > Servers/Clients > WebSocket Server. The default is
    // ws://127.0.0.1:8080/. Use the Streamer.bot PC's address if it runs elsewhere.
    streamerbotUrl: 'ws://127.0.0.1:8080/',
    streamerbotPassword: typeof STREAMERBOT_WS_PASSWORD !== 'undefined' ? STREAMERBOT_WS_PASSWORD : '',

    // The name of the Streamer.bot action that holds word-game.cs.
    actionName: 'Word Game',
});
