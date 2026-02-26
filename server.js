import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_HINTS = 10;
const BENCHMARK_CONCURRENCY = Number(process.env.BENCHMARK_CONCURRENCY || 20);
const REQUEST_MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 60000);
const GAME_TIMEOUT_MS = Number(process.env.GAME_TIMEOUT_MS || 120000);
// 50 words beeing:
// 10 concrete nouns
// 10 abstract nouns
// 10 verbs
// 10 adjectives
// 10 adverbs
const WORD_BANK = [
  "heat",
  "ocean",
  "forest",
  "bridge",
  "mirror",
  "thunder",
  "winter",
  "pencil",
  "rocket",
  "shadow",
  "love",
  "freedom",
  "justice",
  "happiness",
  "courage",
  "intelligence",
  "time",
  "knowledge",
  "beauty",
  "anger",
  "run",
  "think",
  "build",
  "optimize",
  "launch",
  "surrender",
  "whisper",
  "harvest",
  "forgive",
  "wander",
  "gentle",
  "fierce",
  "fragile",
  "vivid",
  "stubborn",
  "peaceful",
  "chaotic",
  "loyal",
  "bitter",
  "radiant",
  "softly",
  "fiercely",
  "slowly",
  "suddenly",
  "carefully",
  "honestly",
  "quietly",
  "nervously",
  "bravely",
  "completely"
];

const MODELS = [
  {
    key: "gpt5mini",
    label: "GPT-5 Mini",
    modelId: "openai/gpt-5-mini",
    provider: { order: ["openai"], allow_fallbacks: false }
  },
  {
    key: "gemini3flash",
    label: "Gemini 3 Flash",
    modelId: "google/gemini-3-flash-preview",
    provider: { order: ["google-ai-studio", "google-vertex"], allow_fallbacks: false }
  },
  {
    key: "minimaxm25",
    label: "MiniMax M2.5",
    modelId: "minimax/minimax-m2.5",
    provider: { order: ["minimax/fp8"], allow_fallbacks: false }
  },
  {
    key: "kimik25",
    label: "Kimi K2.5",
    modelId: "moonshotai/kimi-k2.5",
    provider: { order: ["moonshotai/int4"], allow_fallbacks: false }
  },
  {
    key: "glm5",
    label: "GLM-5",
    modelId: "z-ai/glm-5",
    provider: { order: ["z-ai"], allow_fallbacks: false }
  }
];

const FIXED_PROVIDER = {
  allow_fallbacks: false
};

const DATA_DIR = path.join(__dirname, "data");
const RESULTS_FILE = path.join(DATA_DIR, "benchmarks.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const benchmarkProgress = {
  status: "idle",
  runId: null,
  startedAt: null,
  completedAt: null,
  totalGames: 0,
  completedGames: 0,
  failedGames: 0,
  activeModel: null,
  activeWord: null,
  lastCompletedModel: null,
  lastCompletedWord: null,
  error: null
};

const CLUE_SYSTEM_PROMPT = `You are the clue giver in a one-word guessing game.
Return JSON only, with a single field: clue.

Rules:
1) The target word is a single English word.
2) Your clue must be exactly one word in EN-US, no spaces.
3) Your clue must not be the exact target word.
4) Your clue must not contain the target word as a substring.
5) Avoid punctuation and numbers.
6) Prefer clues that help the guesser converge quickly.
7) If prior clues or guesses suggest confusion, use a clarifying clue.

Output schema:
{ "clue": "string" }`;

const GUESSER_SYSTEM_PROMPT = `You are the guesser in a one-word guessing game.
Return JSON only, with a single field: guess.

Rules:
1) Guess exactly one word in EN-US, no spaces.
2) Use the clue history and previous guesses to improve.
3) Do not repeat prior guesses.
4) Prefer the most likely target word.
5) Avoid punctuation and numbers.

Output schema:
{ "guess": "string" }`;

const wordPattern = /^[\p{L}-]+$/u;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/status", async (_req, res) => {
  const data = await readResults();
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
    words: WORD_BANK,
    maxHints: MAX_HINTS,
    benchmarkConcurrency: BENCHMARK_CONCURRENCY,
    modelIds: MODELS,
    benchmarkCount: data.benchmarks.length,
    provider: {
      default: FIXED_PROVIDER,
      byModel: Object.fromEntries(MODELS.map((m) => [m.modelId, m.provider]))
    }
  });
});

app.get("/api/benchmarks", async (_req, res) => {
  const data = await readResults();
  res.json(data.benchmarks);
});

app.get("/api/benchmarks/progress", (_req, res) => {
  const percent = benchmarkProgress.totalGames > 0
    ? Number(((benchmarkProgress.completedGames / benchmarkProgress.totalGames) * 100).toFixed(1))
    : 0;
  res.json({
    ...benchmarkProgress,
    percent
  });
});

app.post("/api/benchmarks/run", async (_req, res) => {
  if (!process.env.OPENROUTER_API_KEY) {
    res.status(400).json({ error: "Missing OPENROUTER_API_KEY" });
    return;
  }
  if (benchmarkProgress.status === "running") {
    res.status(409).json({ error: "A benchmark is already running" });
    return;
  }

  const runId = crypto.randomUUID();
  startBenchmarkProgress(runId);
  try {
    const benchmark = await runBenchmark(runId);
    const data = await readResults();
    data.benchmarks.unshift(benchmark);
    await writeResults(data);
    completeBenchmarkProgress();
    res.json(benchmark);
  } catch (err) {
    console.error(err);
    failBenchmarkProgress(err.message || "Benchmark failed");
    res.status(500).json({ error: err.message || "Benchmark failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

async function runBenchmark(runId) {
  const startedAt = new Date().toISOString();
  const modelRuns = await runWithConcurrency(
    MODELS,
    Math.min(BENCHMARK_CONCURRENCY, MODELS.length),
    async (model) => {
      const games = await runWithConcurrency(
        WORD_BANK,
        Math.min(BENCHMARK_CONCURRENCY, WORD_BANK.length),
        async (targetWord) => {
          setActiveGame(model.label, targetWord);
          try {
            const game = await withTimeout(
              runSingleGame(model, targetWord),
              GAME_TIMEOUT_MS,
              `Game timed out after ${GAME_TIMEOUT_MS}ms`
            );
            advanceProgress(model.label, targetWord, false);
            return game;
          } catch (err) {
            advanceProgress(model.label, targetWord, true);
            return buildFailedGame(targetWord, err);
          }
        }
      );

      const solvedGames = games.filter((game) => game.solved);
      const failedGames = games.filter((game) => game.failed);
      const totalGuesses = games.reduce((sum, game) => sum + game.penalizedGuesses, 0);

      return {
        modelKey: model.key,
        modelLabel: model.label,
        modelId: model.modelId,
        solvedCount: solvedGames.length,
        failedCount: failedGames.length,
        totalWords: WORD_BANK.length,
        totalGuesses,
        averageGuesses: Number((totalGuesses / WORD_BANK.length).toFixed(2)),
        games
      };
    }
  );

  modelRuns.sort((a, b) => a.totalGuesses - b.totalGuesses);

  return {
    id: runId,
    startedAt,
    completedAt: new Date().toISOString(),
    maxHints: MAX_HINTS,
    wordBank: WORD_BANK,
    provider: FIXED_PROVIDER,
    ranking: modelRuns.map((run, idx) => ({
      rank: idx + 1,
      modelKey: run.modelKey,
      modelLabel: run.modelLabel,
      totalGuesses: run.totalGuesses,
      solvedCount: run.solvedCount,
      failedCount: run.failedCount,
      totalWords: run.totalWords,
      averageGuesses: run.averageGuesses
    })),
    modelRuns
  };
}

async function runSingleGame(model, targetWord) {
  const turns = [];
  const pastGuesses = [];
  let solved = false;

  for (let turnNumber = 1; turnNumber <= MAX_HINTS; turnNumber += 1) {
    const clue = await generateValidClue({ model, targetWord, turns });
    turns.push({ turnNumber, role: "clue", text: clue });

    const guess = await generateValidGuess({ model, turns, pastGuesses });
    turns.push({ turnNumber, role: "guess", text: guess });

    pastGuesses.push(normalizeWord(guess));

    if (isSameWord(guess, targetWord)) {
      solved = true;
      break;
    }
  }

  const guessesUsed = turns.filter((turn) => turn.role === "guess").length;
  const penalizedGuesses = solved ? guessesUsed : MAX_HINTS + 1;

  return {
    targetWord,
    solved,
    guessesUsed,
    penalizedGuesses,
    turns
  };
}

async function generateValidClue({ model, targetWord, turns }) {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await sendStructuredRequest({
      modelId: model.modelId,
      provider: model.provider || FIXED_PROVIDER,
      systemPrompt: CLUE_SYSTEM_PROMPT,
      payload: {
        targetWord,
        language: "EN-US",
        turns
      }
    });

    const clue = sanitizeOneWord(response.clue);
    if (!clue) continue;

    const normalizedClue = normalizeWord(clue);
    const normalizedTarget = normalizeWord(targetWord);

    if (!wordPattern.test(clue)) continue;
    if (normalizedClue === normalizedTarget) continue;
    if (normalizedClue.includes(normalizedTarget)) continue;
    if (normalizedTarget.includes(normalizedClue)) continue;

    return clue;
  }

  return "opposite";
}

async function generateValidGuess({ model, turns, pastGuesses }) {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await sendStructuredRequest({
      modelId: model.modelId,
      provider: model.provider || FIXED_PROVIDER,
      systemPrompt: GUESSER_SYSTEM_PROMPT,
      payload: {
        language: "EN-US",
        turns,
        disallowedGuesses: pastGuesses,
        maxHints: MAX_HINTS,
        note: "Guess the hidden target word."
      }
    });

    const guess = sanitizeOneWord(response.guess);
    if (!guess) continue;
    if (!wordPattern.test(guess)) continue;
    if (pastGuesses.includes(normalizeWord(guess))) continue;

    return guess;
  }

  const fallback = WORD_BANK.find((word) => !pastGuesses.includes(normalizeWord(word)));
  return fallback || "unknown";
}

async function sendStructuredRequest({ modelId, provider, systemPrompt, payload }) {
  const maxAttempts = REQUEST_MAX_RETRIES;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const requestBody = {
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) }
        ],
        temperature: 0.3,
        provider: provider || FIXED_PROVIDER
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
            "X-Title": process.env.OPENROUTER_X_TITLE || "Guess Word Benchmark"
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errText = await response.text();
        if (attempt < maxAttempts && isRetryableStatus(response.status)) {
          await sleep(250 * attempt);
          continue;
        }
        throw new Error(`OpenRouter error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        if (attempt < maxAttempts) {
          await sleep(150 * attempt);
          continue;
        }
        throw new Error("Empty model response");
      }

      const parsed = parseStructuredContent(content);
      if (parsed && typeof parsed === "object") return parsed;
      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }
      throw new Error(`Invalid structured output: ${JSON.stringify(content)}`);
    } catch (err) {
      if (err?.name === "AbortError") {
        lastError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      } else {
        lastError = err;
      }
      if (attempt < maxAttempts) {
        await sleep(200 * attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error("Unknown request error");
}

function sanitizeOneWord(raw) {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim();
  if (!normalized || /\s/.test(normalized)) return "";
  return normalized;
}

function normalizeWord(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function isSameWord(a, b) {
  const normalizedA = normalizeWord(a);
  const normalizedB = normalizeWord(b);
  return normalizedA !== "" && normalizedA === normalizedB;
}

function parseStructuredContent(content) {
  if (typeof content === "string") {
    return safeJsonParse(content) || extractFirstJsonObject(content);
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    return safeJsonParse(joined) || extractFirstJsonObject(joined);
  }

  if (typeof content === "object" && content !== null) {
    if (typeof content.parsed === "object" && content.parsed !== null) {
      return content.parsed;
    }
    return content;
  }

  return null;
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(value) {
  if (typeof value !== "string") return null;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return safeJsonParse(value.slice(start, end + 1));
}

function isRetryableStatus(statusCode) {
  return statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFailedGame(targetWord, err) {
  return {
    targetWord,
    solved: false,
    failed: true,
    failureReason: err?.message || "Game failed",
    guessesUsed: MAX_HINTS,
    penalizedGuesses: MAX_HINTS + 1,
    turns: []
  };
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function startBenchmarkProgress(runId) {
  benchmarkProgress.status = "running";
  benchmarkProgress.runId = runId;
  benchmarkProgress.startedAt = new Date().toISOString();
  benchmarkProgress.completedAt = null;
  benchmarkProgress.totalGames = MODELS.length * WORD_BANK.length;
  benchmarkProgress.completedGames = 0;
  benchmarkProgress.failedGames = 0;
  benchmarkProgress.activeModel = null;
  benchmarkProgress.activeWord = null;
  benchmarkProgress.lastCompletedModel = null;
  benchmarkProgress.lastCompletedWord = null;
  benchmarkProgress.error = null;
}

function setActiveGame(modelLabel, targetWord) {
  benchmarkProgress.activeModel = modelLabel;
  benchmarkProgress.activeWord = targetWord;
}

function advanceProgress(modelLabel, targetWord, failed) {
  benchmarkProgress.completedGames += 1;
  if (failed) benchmarkProgress.failedGames += 1;
  benchmarkProgress.lastCompletedModel = modelLabel;
  benchmarkProgress.lastCompletedWord = targetWord;
}

function completeBenchmarkProgress() {
  benchmarkProgress.status = "completed";
  benchmarkProgress.completedAt = new Date().toISOString();
  benchmarkProgress.activeModel = null;
  benchmarkProgress.activeWord = null;
}

function failBenchmarkProgress(message) {
  benchmarkProgress.status = "failed";
  benchmarkProgress.completedAt = new Date().toISOString();
  benchmarkProgress.activeModel = null;
  benchmarkProgress.activeWord = null;
  benchmarkProgress.error = message;
}

async function runWithConcurrency(items, maxConcurrency, worker) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const concurrency = Math.max(1, maxConcurrency || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runner()
  );
  await Promise.all(runners);
  return results;
}

async function readResults() {
  try {
    const raw = await fs.readFile(RESULTS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { benchmarks: [] };
    }
    throw err;
  }
}

async function writeResults(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RESULTS_FILE, JSON.stringify(data, null, 2), "utf8");
}
