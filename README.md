# stream-word-game

A chat game for the AFK scene of a Twitch stream.

When you switch to the AFK scene in OBS, the channel's emotes pop up at random spots on the screen. The first chatter to type the emote's name gets 100 points. The emote box then explodes and shows who got it. When you leave the AFK scene, the bot posts the round results to chat.

## How it works

- Streamer.bot runs the game. It watches the OBS scene and the Twitch chat, keeps the points, and posts the results.
- The OBS overlay only displays what Streamer.bot sends it, through the Streamer.bot WebSocket server.
- The emotes come from three sources: Twitch channel emotes, Twitch global emotes, and 7TV channel emotes.
- Chat must type the emote name exactly. Case does not matter.
- Chatters who type the same name within 5 seconds of the winner get fewer points. Faster guesses get more points.
- All-time points stay in Streamer.bot between streams.

## Requirements

- [OBS Studio](https://obsproject.com/)
- [Streamer.bot](https://streamer.bot/), connected to OBS and to your Twitch account

The overlay is plain HTML, CSS, and JavaScript. It has no build step and no dependencies.

## Repository layout

| Path | Contents |
| --- | --- |
| `streamerbot/word-game.cs` | The game logic. Paste it into a Streamer.bot C# sub-action. |
| `streamerbot/README.md` | Step-by-step Streamer.bot setup, settings, and troubleshooting. |
| `afk-word-game/` | The OBS overlay (`afk-word-game.html`) and its config file. |
| `shared/streamerbot-client.js` | A small client for the Streamer.bot WebSocket server. |
| `shared/secrets.local.example.js` | A template for the local secrets file. |
| `shared/share-tech-mono.css` | The self-hosted Share Tech Mono font. |

## Setup

1. Set up Streamer.bot. Follow [streamerbot/README.md](streamerbot/README.md).
2. If your Streamer.bot WebSocket server has a password, copy `shared/secrets.local.example.js` to `shared/secrets.local.js`. Then put the password in the new file. Git ignores this file.
3. If Streamer.bot runs on another PC, change `streamerbotUrl` in `afk-word-game/afk-word-game.config.js`.
4. In OBS, add `afk-word-game/afk-word-game.html` as a Browser Source on your AFK scene. Set the size to 2560x1440.

## Configuration

Streamer.bot runs the game, so most settings are at the top of `streamerbot/word-game.cs`:

- The AFK scene name
- The points for a win and for late guesses
- The countdown length before the first emote
- Which emote sources to use
- Whether the bot explains the game in chat

See [streamerbot/README.md](streamerbot/README.md) for the full list.

`afk-word-game/afk-word-game.config.js` has the overlay settings:

- `streamerbotUrl`: the address of the Streamer.bot WebSocket server.
- `actionName`: the name of the Streamer.bot action that holds `word-game.cs`.
- `showEmoteName`: set it to `false` to show only the emote image. Chat then has to know the name.

## Test it

1. Switch to the AFK scene. After the countdown, an emote appears.
2. Type its name in your Twitch chat. The box explodes and shows your name.
3. Switch to another scene. The bot posts the results in chat.

If nothing happens, see the troubleshooting notes in [streamerbot/README.md](streamerbot/README.md).

## Contributions

This is a personal project for my own stream. I do not accept issues or pull requests. You are free to fork it and change it for your own stream.

## License

This project uses the MIT License. See [LICENSE](LICENSE).
