# stream-word-game

An OBS overlay game for the AFK scene. Twitch-culture words pop up at
random spots on the screen. The first chat user to type the word exactly
(case-insensitive) gets 100 points, and the word box explodes to show who
got it. When OBS switches away from the AFK scene, the overlay shows a
leaderboard for that AFK round.

## Parts

- `afk-word-game/`: the overlay. Plain HTML, CSS, and JavaScript, with no build step.
- `points-server/`: a small Node.js and SQLite server that stores the points.
  See [points-server/README.md](points-server/README.md).
- `shared/`: the Twitch chat client and the OBS WebSocket client.

## Setup

1. Copy `shared/secrets.local.example.js` to `shared/secrets.local.js` and fill in your values.
2. Start the points server. See [points-server/README.md](points-server/README.md).
3. Edit `afk-word-game/afk-word-game.config.js`:
   - Set `channel` and `twitchUserId` to your Twitch channel.
   - Set `pointsServerUrl` to the address of the points server.
   - Set `afkSceneNames` to the exact name of your AFK scene.
4. In OBS, turn on the WebSocket server (Tools > WebSocket Server Settings).
5. Add `afk-word-game/afk-word-game.html` as a Browser Source at 2560x1440.
   Put it on the AFK scene and on each scene that should show the leaderboard.

## Test locally

Run the points server on the OBS PC, and leave `pointsServerUrl` as
`http://localhost:4000`. Switch to the AFK scene, and type the word in your
own Twitch chat. Chat works when you are offline.
