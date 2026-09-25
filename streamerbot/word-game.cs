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
using System.Linq;
using System.Text;

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

    // One word or phrase per line. Empty lines and lines that start with "#"
    // are skipped. The file is read again at the start of every round, so
    // changes apply without recompiling.
    private static string WordsFile = @"D:\git\stream-word-game\streamerbot\words.txt";

    // Persisted global variable that holds all-time points, one line per
    // user: "login<TAB>display name<TAB>points".
    private const string AllTimePointsVar = "wordGameAllTimePoints";

    // ---- Round state (kept in memory; a round ends when Streamer.bot restarts) ----
    private static readonly object Sync = new object();
    private static readonly Random Rng = new Random();
    private static readonly List<string> Pool = new List<string>();
    private static List<string> words = new List<string>();
    private static readonly Dictionary<string, RoundEntry> RoundScores =
        new Dictionary<string, RoundEntry>(StringComparer.OrdinalIgnoreCase);
    private static bool roundActive;
    private static string currentWord;
    private static DateTime wordRevealAt; // UTC. Chat guesses before this time do not count.
    private static int winCounter;

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
                Broadcast("type", "state", "word", roundActive ? currentWord : null,
                    "countdownMs", CountdownRemainingMs().ToString(), "points", PointsPerWin.ToString());
            }
            return true;
        }

        OnChatMessage();
        return true;
    }

    private void OnSceneChanged(string sceneName)
    {
        bool isAfk = AfkSceneNames.Any(n => string.Equals(n, sceneName, StringComparison.OrdinalIgnoreCase));
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
        Broadcast("type", "round-start", "word", currentWord,
            "countdownMs", CountdownRemainingMs().ToString(), "points", PointsPerWin.ToString());

        if (AnnounceInChat)
        {
            CPH.SendMessage("AFK word game starts in " + CountdownSeconds + " seconds! Words pop up on screen. "
                + "The first one to type the word in chat gets " + PointsPerWin + " points.");
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
        if (string.IsNullOrWhiteSpace(message)) return;

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
            if (!string.Equals(message.Trim(), currentWord, StringComparison.OrdinalIgnoreCase)) return;

            string solved = currentWord;
            AddRoundPoints(login, displayName);
            AddAllTimePoints(login, displayName);
            currentWord = NextWord(solved);
            Broadcast("type", "winner", "word", solved, "name", displayName, "color", color,
                "points", PointsPerWin.ToString(), "nextWord", currentWord);
        }
    }

    // ---- Words ----------------------------------------------------------
    private bool LoadWords()
    {
        try
        {
            words = System.IO.File.ReadAllLines(WordsFile)
                .Select(l => l.Trim())
                .Where(l => l.Length > 0 && !l.StartsWith("#"))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (Exception ex)
        {
            CPH.LogError("Word Game: cannot read " + WordsFile + ": " + ex.Message);
            return false;
        }
        if (words.Count == 0)
        {
            CPH.LogError("Word Game: " + WordsFile + " has no words.");
            return false;
        }
        return true;
    }

    private string NextWord(string previous)
    {
        if (Pool.Count == 0)
        {
            Pool.AddRange(words);
            for (int i = Pool.Count - 1; i > 0; i--)
            {
                int j = Rng.Next(i + 1);
                string tmp = Pool[i]; Pool[i] = Pool[j]; Pool[j] = tmp;
            }
            // Avoid showing the same word twice in a row across a reshuffle.
            if (Pool.Count > 1 && string.Equals(Pool[Pool.Count - 1], previous, StringComparison.OrdinalIgnoreCase))
            {
                string tmp = Pool[0]; Pool[0] = Pool[Pool.Count - 1]; Pool[Pool.Count - 1] = tmp;
            }
        }
        string word = Pool[Pool.Count - 1];
        Pool.RemoveAt(Pool.Count - 1);
        return word;
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
