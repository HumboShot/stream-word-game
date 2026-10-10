// AFK Word Game for Streamer.bot. Paste this into one "Execute C# Code"
// sub-action, in an action named "Word Game", with these triggers:
//   - OBS Studio > Scene Changed
//   - Twitch > Chat > Chat Message
// See streamerbot/README.md for the full setup.
//
// Streamer.bot runs the whole game. The overlay only displays the events
// that this code broadcasts over the Streamer.bot WebSocket server.
// One action handles all triggers, so a single lock protects the game state
// when several chat messages arrive at the same time.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    // ---- Settings -------------------------------------------------------
    private static readonly string[] AfkSceneNames = { "AFK" };
    private const int PointsPerWin = 100;
    private const int ResultsToPost = 5;

    // Seconds between entering the AFK scene and the first word. The overlay
    // explains the game during this time, and chat guesses do not count yet.
    private static int CountdownSeconds = 10;

    // Set to false to skip the chat message that explains the game at round start.
    private const bool AnnounceInChat = true;

    // Emote sources. The overlay shows the emote and chat types its name.
    // Twitch emotes use the Twitch account that Streamer.bot is logged in with.
    private const bool UseTwitchChannelEmotes = true;
    private const bool UseTwitchGlobalEmotes = true;
    private const bool UseSevenTvChannelEmotes = true;

    // Emote lists are fetched at round start, at most once per this many minutes.
    private const int EmoteRefreshMinutes = 30;

    // Persisted global variable that holds all-time points, one line per
    // user: "login<TAB>display name<TAB>points".
    private const string AllTimePointsVar = "wordGameAllTimePoints";

    // ---- Round state (kept in memory; a round ends when Streamer.bot restarts) ----
    private static readonly object Sync = new object();
    private static readonly Random Rng = new Random();
    private static readonly List<WordEntry> Pool = new List<WordEntry>();
    private static List<WordEntry> words = new List<WordEntry>();
    private static List<WordEntry> emoteCache = new List<WordEntry>();
    private static DateTime emotesFetchedAt = DateTime.MinValue; // UTC.
    private static readonly Dictionary<string, RoundEntry> RoundScores =
        new Dictionary<string, RoundEntry>(StringComparer.OrdinalIgnoreCase);
    private static bool roundActive;
    private static WordEntry currentWord;
    private static DateTime wordRevealAt; // UTC. Chat guesses before this time do not count.
    private static int winCounter;

    private class WordEntry
    {
        public string Text;
        public string Image; // Emote image URL.
    }

    private class RoundEntry
    {
        public string Name;
        public int Points;
        public int FirstWin; // Breaks ties: the user who scored first ranks higher.
    }

    public bool Execute()
    {
        string sceneName;
        if (CPH.TryGetArg("obs.sceneName", out sceneName))
        {
            OnSceneChanged(sceneName);
            return true;
        }

        string request;
        if (CPH.TryGetArg("wordGameRequest", out request))
        {
            // The overlay sends this through a DoAction request when it connects,
            // so a reloaded overlay shows the current word or countdown straight away.
            lock (Sync)
            {
                WordEntry shown = roundActive ? currentWord : null;
                Broadcast("type", "state", "word", shown != null ? shown.Text : null,
                    "image", shown != null ? shown.Image : null, "countdownMs", CountdownRemainingMs().ToString(), "points", PointsPerWin.ToString());
            }
            return true;
        }

        OnChatMessage();
        return true;
    }

    private void OnSceneChanged(string sceneName)
    {
        bool isAfk = AfkSceneNames.Any(n => string.Equals(n, sceneName, StringComparison.OrdinalIgnoreCase));
        // Fetch emotes outside the lock, so slow HTTP calls do not block chat handling.
        if (isAfk && !roundActive) RefreshEmotes();
        lock (Sync)
        {
            CPH.LogInfo("Word Game: scene changed to '" + sceneName + "' (AFK scene: " + isAfk
                + ", round running: " + roundActive + ")");
            if (isAfk && !roundActive) StartRound();
            else if (!isAfk && roundActive) EndRound();
        }
    }

    private void StartRound()
    {
        if (!LoadWords()) return;
        roundActive = true;
        RoundScores.Clear();
        winCounter = 0;
        Pool.Clear();
        currentWord = NextWord(null);
        wordRevealAt = DateTime.UtcNow.AddSeconds(CountdownSeconds);
        Broadcast("type", "round-start", "word", currentWord.Text, "image", currentWord.Image,
            "countdownMs", CountdownRemainingMs().ToString(), "points", PointsPerWin.ToString());

        if (AnnounceInChat)
        {
            CPH.SendMessage("AFK word game starts in " + CountdownSeconds + " seconds! Emotes pop up on screen. "
                + "The first one to type the emote's name in chat gets " + PointsPerWin + " points.");
        }
    }

    private int CountdownRemainingMs()
    {
        if (!roundActive) return 0;
        return Math.Max(0, (int)Math.Ceiling((wordRevealAt - DateTime.UtcNow).TotalMilliseconds));
    }

    private void EndRound()
    {
        roundActive = false;
        currentWord = null;
        Broadcast("type", "round-end");
        PostResults();
    }

    private void OnChatMessage()
    {
        string message;
        if (!CPH.TryGetArg("message", out message) || message == null)
            CPH.TryGetArg("rawInput", out message);
        message = CleanMessage(message);
        if (message.Length == 0) return;

        string displayName, login, color;
        CPH.TryGetArg("user", out displayName);
        CPH.TryGetArg("userName", out login);
        CPH.TryGetArg("color", out color);
        if (string.IsNullOrEmpty(login)) login = displayName;
        if (string.IsNullOrEmpty(displayName)) displayName = login;
        if (string.IsNullOrEmpty(login)) return;

        lock (Sync)
        {
            if (!roundActive || currentWord == null || DateTime.UtcNow < wordRevealAt) return;
            if (!string.Equals(message, currentWord.Text, StringComparison.OrdinalIgnoreCase)) return;

            WordEntry solved = currentWord;
            AddRoundPoints(login, displayName);
            AddAllTimePoints(login, displayName);
            currentWord = NextWord(solved);
            Broadcast("type", "winner", "word", solved.Text, "image", solved.Image, "name", displayName,
                "color", color, "points", PointsPerWin.ToString(),
                "nextWord", currentWord.Text, "nextImage", currentWord.Image);
        }
    }

    // ---- Words ----------------------------------------------------------
    // Builds the round's word pool from the cached emotes. Matching ignores case,
    // so emotes that differ only in case count once (the first source wins).
    private bool LoadWords()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pool = emoteCache.Where(e => seen.Add(e.Text)).ToList();
        if (pool.Count == 0)
        {
            CPH.LogError("Word Game: no emotes, so no round starts. Check the emote errors above and the emote settings.");
            return false;
        }
        words = pool;
        CPH.LogInfo("Word Game: " + pool.Count + " emotes in the pool.");
        return true;
    }

    private WordEntry NextWord(WordEntry previous)
    {
        if (Pool.Count == 0)
        {
            Pool.AddRange(words);
            for (int i = Pool.Count - 1; i > 0; i--)
            {
                int j = Rng.Next(i + 1);
                WordEntry tmp = Pool[i]; Pool[i] = Pool[j]; Pool[j] = tmp;
            }
            // Avoid showing the same word twice in a row across a reshuffle.
            if (Pool.Count > 1 && Pool[Pool.Count - 1] == previous)
            {
                WordEntry tmp = Pool[0]; Pool[0] = Pool[Pool.Count - 1]; Pool[Pool.Count - 1] = tmp;
            }
        }
        WordEntry word = Pool[Pool.Count - 1];
        Pool.RemoveAt(Pool.Count - 1);
        return word;
    }

    // Chat clients such as Chatterino and 7TV append invisible characters to
    // repeated messages to get around Twitch's duplicate message check.
    private static readonly string[] InvisibleChars =
        { "\uDB40\uDC00", "\u034F", "\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF" };

    private static string CleanMessage(string message)
    {
        foreach (string c in InvisibleChars) message = message.Replace(c, "");
        return message.Trim();
    }

    // ---- Emotes ---------------------------------------------------------
    private void RefreshEmotes()
    {
        if (!UseTwitchChannelEmotes && !UseTwitchGlobalEmotes && !UseSevenTvChannelEmotes) return;
        lock (Sync)
        {
            if (DateTime.UtcNow - emotesFetchedAt < TimeSpan.FromMinutes(EmoteRefreshMinutes)) return;
        }

        string broadcasterId;
        CPH.TryGetArg("broadcastUserId", out broadcasterId);
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;

        var fetched = new List<WordEntry>();
        bool failed = false;
        bool needsChannel = UseTwitchChannelEmotes || UseSevenTvChannelEmotes;
        if (needsChannel && string.IsNullOrEmpty(broadcasterId))
        {
            CPH.LogError("Word Game: no broadcastUserId, so channel emotes are skipped. Is Twitch connected?");
            failed = true;
        }
        else
        {
            // Channel emotes first, so they win over global emotes with the same name.
            if (UseTwitchChannelEmotes)
                failed |= !FetchEmotes("Twitch channel", () => ParseTwitchEmotes(
                    HttpGet("https://api.twitch.tv/helix/chat/emotes?broadcaster_id=" + broadcasterId, true)), fetched);
            if (UseSevenTvChannelEmotes)
                failed |= !FetchEmotes("7TV channel", () => FetchSevenTvEmotes(broadcasterId), fetched);
        }
        if (UseTwitchGlobalEmotes)
            failed |= !FetchEmotes("Twitch global", () => ParseTwitchEmotes(
                HttpGet("https://api.twitch.tv/helix/chat/emotes/global", true)), fetched);

        lock (Sync)
        {
            // On a failure, keep the old list if the new one came back empty,
            // and leave the timestamp alone so the next round tries again.
            if (fetched.Count > 0 || !failed) emoteCache = fetched;
            if (!failed) emotesFetchedAt = DateTime.UtcNow;
        }
    }

    private bool FetchEmotes(string source, Func<List<WordEntry>> fetch, List<WordEntry> into)
    {
        try
        {
            List<WordEntry> emotes = fetch();
            into.AddRange(emotes);
            CPH.LogInfo("Word Game: " + emotes.Count + " " + source + " emotes.");
            return true;
        }
        catch (Exception ex)
        {
            CPH.LogError("Word Game: cannot fetch " + source + " emotes: " + ex.Message);
            return false;
        }
    }

    private List<WordEntry> ParseTwitchEmotes(string json)
    {
        var result = new List<WordEntry>();
        foreach (JToken e in (JArray)JObject.Parse(json)["data"])
        {
            string name = (string)e["name"];
            if (!IsTypeableEmote(name)) continue;
            // "default" serves the animated version when the emote has one.
            result.Add(new WordEntry
            {
                Text = name,
                Image = "https://static-cdn.jtvnw.net/emoticons/v2/" + (string)e["id"] + "/default/dark/3.0",
            });
        }
        return result;
    }

    private List<WordEntry> FetchSevenTvEmotes(string broadcasterId)
    {
        string json;
        try
        {
            json = HttpGet("https://7tv.io/v3/users/twitch/" + broadcasterId, false);
        }
        catch (WebException ex)
        {
            var response = ex.Response as HttpWebResponse;
            if (response != null && response.StatusCode == HttpStatusCode.NotFound)
                return new List<WordEntry>(); // The channel has no 7TV account.
            throw;
        }

        var result = new List<WordEntry>();
        JToken set = JObject.Parse(json)["emote_set"];
        JArray emotes = set != null && set.Type == JTokenType.Object ? set["emotes"] as JArray : null;
        if (emotes == null) return result;

        foreach (JToken e in emotes)
        {
            string name = (string)e["name"]; // The channel's alias, if it renamed the emote.
            if (!IsTypeableEmote(name)) continue;
            string host = (string)e.SelectToken("data.host.url");
            string baseUrl = string.IsNullOrEmpty(host) ? "//cdn.7tv.app/emote/" + (string)e["id"] : host;
            result.Add(new WordEntry { Text = name, Image = "https:" + baseUrl + "/4x.webp" });
        }
        return result;
    }

    // Skips names that chat cannot type as one word, and Twitch's old
    // smiley emotes like ":)" and "<3".
    private static bool IsTypeableEmote(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Any(char.IsWhiteSpace)) return false;
        return name.Count(char.IsLetterOrDigit) >= Math.Min(2, name.Length);
    }

    private string HttpGet(string url, bool twitchAuth)
    {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Timeout = 8000;
        request.ReadWriteTimeout = 8000;
        request.UserAgent = "stream-word-game";
        if (twitchAuth)
        {
            request.Headers["Client-Id"] = CPH.TwitchClientId;
            request.Headers["Authorization"] = "Bearer " + CPH.TwitchOAuthToken;
        }
        using (var response = (HttpWebResponse)request.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
        {
            return reader.ReadToEnd();
        }
    }

    // ---- Points ---------------------------------------------------------
    private void AddRoundPoints(string login, string displayName)
    {
        RoundEntry entry;
        if (!RoundScores.TryGetValue(login, out entry))
        {
            entry = new RoundEntry { Name = displayName, FirstWin = winCounter };
            RoundScores[login] = entry;
        }
        entry.Name = displayName;
        entry.Points += PointsPerWin;
        winCounter++;
    }

    private Dictionary<string, KeyValuePair<string, int>> LoadAllTimePoints()
    {
        var result = new Dictionary<string, KeyValuePair<string, int>>(StringComparer.OrdinalIgnoreCase);
        string raw = CPH.GetGlobalVar<string>(AllTimePointsVar, true);
        if (string.IsNullOrEmpty(raw)) return result;

        foreach (string line in raw.Split('\n'))
        {
            string[] parts = line.Split('\t');
            int points;
            if (parts.Length == 3 && int.TryParse(parts[2], out points))
                result[parts[0]] = new KeyValuePair<string, int>(parts[1], points);
        }
        return result;
    }

    private void AddAllTimePoints(string login, string displayName)
    {
        var all = LoadAllTimePoints();
        KeyValuePair<string, int> existing;
        int points = all.TryGetValue(login, out existing) ? existing.Value : 0;
        all[login] = new KeyValuePair<string, int>(displayName, points + PointsPerWin);

        string raw = string.Join("\n", all.Select(kv => kv.Key + "\t" + kv.Value.Key + "\t" + kv.Value.Value));
        CPH.SetGlobalVar(AllTimePointsVar, raw, true);
    }

    private void PostResults()
    {
        if (RoundScores.Count == 0)
        {
            CPH.SendMessage("AFK word game: nobody got a word this round.");
            return;
        }

        var all = LoadAllTimePoints();
        var ranked = RoundScores
            .OrderByDescending(kv => kv.Value.Points)
            .ThenBy(kv => kv.Value.FirstWin)
            .Take(ResultsToPost)
            .Select((kv, i) =>
            {
                KeyValuePair<string, int> total;
                string totalText = all.TryGetValue(kv.Key, out total) ? " (total " + total.Value + ")" : "";
                return (i + 1) + ". " + kv.Value.Name + " " + kv.Value.Points + totalText;
            });

        CPH.SendMessage("AFK word game results: " + string.Join(" | ", ranked));
    }

    // ---- Overlay events -------------------------------------------------
    // Broadcasts {"source":"stream-word-game", key: value, ...} to all clients of
    // the Streamer.bot WebSocket server. Arguments are key/value pairs.
    private void Broadcast(params string[] pairs)
    {
        var sb = new StringBuilder("{\"source\":\"stream-word-game\"");
        for (int i = 0; i + 1 < pairs.Length; i += 2)
        {
            sb.Append(",\"").Append(pairs[i]).Append("\":").Append(JsonString(pairs[i + 1]));
        }
        sb.Append('}');
        CPH.WebsocketBroadcastJson(sb.ToString());
    }

    private static string JsonString(string value)
    {
        if (value == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char c in value)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }
}
