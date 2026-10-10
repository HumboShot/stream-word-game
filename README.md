# stream-word-game

An AFK-scene game for Twitch streams. The channel's emotes (Twitch channel,
Twitch global, and 7TV) pop up at random spots on the screen. The first chat
user to type the emote's name exactly (case-insensitive) gets 100 points, and
the emote box explodes to show who got
it. When OBS switches away from the AFK scene, the bot posts the round results
to chat.

## Parts

- `streamerbot/word-game.cs`: the game logic. It runs inside Streamer.bot and
  handles the rounds, the chat matching, the points, and the chat results.
- `afk-word-game/`: the OBS overlay. It only displays the events that
  Streamer.bot sends. Plain HTML, CSS, and JavaScript, with no build step.
- `shared/streamerbot-client.js`: a small client for the Streamer.bot WebSocket server.

## Setup

1. Set up Streamer.bot. See [streamerbot/README.md](streamerbot/README.md).
2. If your Streamer.bot WebSocket server has a password, copy
   `shared/secrets.local.example.js` to `shared/secrets.local.js` and fill it in.
3. If Streamer.bot runs on another PC, change `streamerbotUrl` in
   `afk-word-game/afk-word-game.config.js`.
4. To show only the emote image, without its name, set `showEmoteName: false`
   in `afk-word-game/afk-word-game.config.js`. Chat then has to know the name.
5. In OBS, add `afk-word-game/afk-word-game.html` as a Browser Source at
   2560x1440 on your AFK scene.
