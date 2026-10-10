# Streamer.bot setup

`word-game.cs` runs the whole game inside Streamer.bot:

- It starts a round when OBS switches to the AFK scene. The overlay explains
  the rules during a countdown, and the bot posts a short explanation in chat.
- It checks each chat message against the current word (exact match, case-insensitive).
- It gives 100 points to the first chatter who types the word.
- It posts the round results to chat when OBS leaves the AFK scene.
- It sends events to the overlay over the Streamer.bot WebSocket server.

All-time points are kept in the persisted global variable `wordGameAllTimePoints`.
You can see it in Streamer.bot under Global Variables.

## One-time setup

1. **Connect OBS.** Streamer.bot > Stream Apps > OBS Studio. Make sure it shows as connected.
2. **Turn on the WebSocket server.** Streamer.bot > Servers/Clients > WebSocket Server.
   - Turn on "Auto Start", then click "Start Server". The default address is `127.0.0.1`, port `8080`, endpoint `/`.
   - If you turn on authentication, put the password in `shared/secrets.local.js`
     (see `shared/secrets.local.example.js`).
3. **Create the action.** Actions > right-click > Add. Name it `Word Game`.
   The overlay uses this name. If you use another name, change `actionName` in
   `afk-word-game/afk-word-game.config.js`.
4. **Add the code.** In the action, add the sub-action Core > C# > Execute C# Code.
   Delete the example code, paste all of `word-game.cs`, click "Compile", and check
   that the log says "Compiled successfully". Then click "Save and Compile".
5. **Add two triggers** to the action:
   - OBS Studio > Scene Changed. **Leave "Scene Name" empty.** If you set it to
     your AFK scene, the trigger fires only when you switch *to* AFK, so rounds
     never end. The script checks the scene name itself.
   - Twitch > Chat > Chat Message
6. **Check the settings** at the top of `word-game.cs` before you paste it:
   - `AfkSceneNames`: the exact name of your AFK scene.
   - `WordsFile`: the full path to `words.txt`. Change it if the repo is not in `D:\git\stream-word-game`.
   - `PointsPerWin` and `ResultsToPost`.
   - `CountdownSeconds`: how long the overlay shows the rules before the first word.
     Chat guesses do not count during the countdown.
   - `AnnounceInChat`: set to `false` if the bot should not explain the game in chat.
   - `UseWordsFile`, `UseTwitchChannelEmotes`, `UseTwitchGlobalEmotes`, `UseSevenTvChannelEmotes`:
     which sources fill the word pool. See [Emotes](#emotes).

If compiling fails with an error about `Newtonsoft`, open the References tab of the
sub-action, right-click > Add reference from file, and pick `Newtonsoft.Json.dll`
from the Streamer.bot folder.

## Emotes

At the start of each AFK round, the script adds emotes to the word pool:

- **Twitch channel emotes** and **Twitch global emotes**, through the Twitch API.
  It uses the Twitch account that Streamer.bot is logged in with, so there is
  nothing extra to set up.
- **7TV channel emotes**, from the channel's active 7TV emote set. If the
  channel has no 7TV account, this source is empty.

The overlay shows the emote image next to its name. Chat types the name, as
usual (case-insensitive). Emote lists are cached for `EmoteRefreshMinutes`
(30 by default), so adding a 7TV emote shows up within that time, or right
away after you recompile. If a fetch fails, the log shows an error, the
previous list stays in use, and the next round tries again. Names that chat
cannot type as one word, and Twitch's old smileys like `:)` and `<3`, are skipped.

If an emote and a line in `words.txt` have the same text, the emote wins,
so it shows with its image. Emote sets can be large, so they can push the
plain words out of most rounds. Turn sources off in the settings if you want
more plain words.

## Change the words

Edit `words.txt`. Put one word or phrase on each line. Empty lines and lines
that start with `#` are skipped, so you can use `#` lines as headings. The
script reads the file again at the start of each AFK round, so you do not need
to recompile. If the file is missing, the log shows an error and the round
uses only emotes. If there are no words and no emotes, no round starts.

## After you change the code

Paste the new `word-game.cs` into the same sub-action and compile again.
Compiling resets the current round, but the all-time points stay.

## Test it

1. Open `afk-word-game/afk-word-game.html` as a Browser Source in OBS.
2. Switch to the AFK scene. A word appears.
3. Type the word in your Twitch chat. The box explodes and shows your name.
4. Switch to another scene. The bot posts the results in chat.

If nothing happens, open the Streamer.bot log (Settings > Logs). Each scene
change writes a line like `Word Game: scene changed to 'Talking' (AFK scene: False, round running: True)`.
If you see no line when you leave the AFK scene, check the Scene Name field on the trigger (step 5).
The overlay shows "STREAMER.BOT DISCONNECTED" while it cannot reach the WebSocket server.
