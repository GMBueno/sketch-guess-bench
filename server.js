import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { WORD_BANK } from "./data/wordbank.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_HINTS = 20;
const BENCHMARK_CONCURRENCY = Number(process.env.BENCHMARK_CONCURRENCY || 10);
const REQUEST_MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 60000);
const GAME_TIMEOUT_MS = Number(process.env.GAME_TIMEOUT_MS || 120000);

const MODELS = [
  {
    key: "gpt5mini",
    label: "GPT-5 Mini",
    modelId: "openai/gpt-5-mini",
    provider: { order: ["azure"], allow_fallbacks: false }
  },
  {
    key: "kimik25",
    label: "Kimi K2.5",
    modelId: "moonshotai/kimi-k2.5",
    provider: { order: ["moonshotai/int4"], allow_fallbacks: false }
  },
  {
    key: "gemini3flash",
    label: "Gemini 3 Flash",
    modelId: "google/gemini-3-flash-preview",
    provider: { order: ["google-ai-studio", "google-vertex"], allow_fallbacks: false }
  }
];

const FIXED_PROVIDER = {
  allow_fallbacks: false
};

const DATA_DIR = path.join(__dirname, "data");
const MODEL_RESULTS_DIR = path.join(DATA_DIR, "benchmarks");
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

const DRAWER_SYSTEM_PROMPT = `You are a drawing agent in a one-word guessing game.
Return JSON only, with a single field: svg.

Rules:
1) Draw the target word using only SVG graphics.
2) Output one complete <svg>...</svg> string.
3) Do not include text labels, letters, or numbers in the drawing.
4) Keep the SVG simple and valid. No scripts, no foreignObject.
5) Use a 512x512 canvas.

Output schema:
{ "svg": "string" }`;

const GUESSER_SYSTEM_PROMPT = `You are the guesser in a visual one-word guessing game.
Return JSON only, with a single field: guesses.

Rules:
1) You receive one JPEG image of a drawing.
2) Return exactly 20 one-word guesses in order of confidence (best guess first).
3) The order is important and will be scored by first correct position.
4) Do not repeat guesses.
5) Each guess must be EN-US one word, no spaces.
6) Avoid punctuation and numbers.

Output schema:
{ "guesses": ["string", "... exactly 20 items ..."] }`;

const SVG_FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f5f7ff"/>
  <circle cx="256" cy="256" r="150" fill="#cdd7ff"/>
  <rect x="180" y="280" width="160" height="40" rx="20" fill="#6a86ff"/>
  <circle cx="220" cy="245" r="16" fill="#1f2a44"/>
  <circle cx="292" cy="245" r="16" fill="#1f2a44"/>
</svg>`;

let renderBrowserPromise = null;

const wordPattern = /^[\p{L}-]+$/u;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/status", async (_req, res) => {
  const benchmarks = await readAllBenchmarks();
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
    words: WORD_BANK,
    maxHints: MAX_HINTS,
    benchmarkConcurrency: BENCHMARK_CONCURRENCY,
    modelIds: MODELS,
    benchmarkCount: benchmarks.length,
    provider: {
      default: FIXED_PROVIDER,
      byModel: Object.fromEntries(MODELS.map((m) => [m.modelId, m.provider]))
    }
  });
});

app.get("/api/benchmarks", async (_req, res) => {
  const benchmarks = await readAllBenchmarks();
  res.json(benchmarks);
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

app.post("/api/benchmarks/run", async (req, res) => {
  if (!process.env.OPENROUTER_API_KEY) {
    res.status(400).json({ error: "Missing OPENROUTER_API_KEY" });
    return;
  }
  const modelKey = typeof req.body?.modelKey === "string" ? req.body.modelKey : "";
  const model = MODELS.find((item) => item.key === modelKey);
  if (!model) {
    res.status(400).json({
      error: "Invalid or missing modelKey",
      allowedModelKeys: MODELS.map((item) => item.key)
    });
    return;
  }
  if (benchmarkProgress.status === "running") {
    res.status(409).json({ error: "A benchmark is already running" });
    return;
  }

  const runId = crypto.randomUUID();
  startBenchmarkProgress(runId, model);
  try {
    const benchmark = await runBenchmark(runId, model);
    const modelBenchmarks = await readModelBenchmarks(model.key);
    modelBenchmarks.unshift(benchmark);
    await writeModelBenchmarks(model.key, modelBenchmarks);
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

async function runBenchmark(runId, model) {
  const startedAt = new Date().toISOString();
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

  const modelRun = {
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

  return {
    id: runId,
    startedAt,
    completedAt: new Date().toISOString(),
    maxHints: MAX_HINTS,
    wordBank: WORD_BANK,
    provider: FIXED_PROVIDER,
    ranking: [
      {
        rank: 1,
        modelKey: modelRun.modelKey,
        modelLabel: modelRun.modelLabel,
        totalGuesses: modelRun.totalGuesses,
        solvedCount: modelRun.solvedCount,
        failedCount: modelRun.failedCount,
        totalWords: modelRun.totalWords,
        averageGuesses: modelRun.averageGuesses
      }
    ],
    modelRuns: [modelRun]
  };
}

async function runSingleGame(model, targetWord) {
  const turns = [];

  const drawing = await generateValidDrawing({ model, targetWord });
  turns.push({
    turnNumber: 1,
    role: "draw",
    svg: drawing.svg,
    jpgDataUrl: drawing.jpgDataUrl
  });

  const guesses = await generateOrderedGuesses({
    model,
    drawingJpgDataUrl: drawing.jpgDataUrl
  });

  let firstCorrectTurn = null;
  for (let turnNumber = 1; turnNumber <= guesses.length; turnNumber += 1) {
    const guess = guesses[turnNumber - 1];
    const correct = firstCorrectTurn === null && isSameWord(guess, targetWord);
    if (correct) firstCorrectTurn = turnNumber;
    turns.push({ turnNumber, role: "guess", text: guess, correct });
  }

  const solved = firstCorrectTurn !== null;
  const guessesUsed = solved ? firstCorrectTurn : MAX_HINTS;
  const penalizedGuesses = solved ? guessesUsed : MAX_HINTS + 1;

  return {
    targetWord,
    solved,
    guessesUsed,
    penalizedGuesses,
    turns
  };
}

async function generateValidDrawing({ model, targetWord }) {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await sendStructuredRequest({
      modelId: model.modelId,
      provider: model.provider || FIXED_PROVIDER,
      systemPrompt: DRAWER_SYSTEM_PROMPT,
      payload: {
        targetWord,
        language: "EN-US",
        canvas: { width: 512, height: 512 }
      }
    });

    const svg = sanitizeSvg(response.svg);
    if (!svg) continue;
    if (!isSafeSvg(svg)) continue;

    try {
      const jpgDataUrl = await svgToJpegDataUrl(svg);
      return { svg, jpgDataUrl };
    } catch {
      continue;
    }
  }

  return {
    svg: SVG_FALLBACK,
    jpgDataUrl: await svgToJpegDataUrl(SVG_FALLBACK)
  };
}

async function generateOrderedGuesses({ model, drawingJpgDataUrl }) {
  const maxAttempts = 4;
  let bestGuesses = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await sendStructuredRequest({
      modelId: model.modelId,
      provider: model.provider || FIXED_PROVIDER,
      systemPrompt: GUESSER_SYSTEM_PROMPT,
      userContent: [
        {
          type: "text",
          text: JSON.stringify({
            language: "EN-US",
            maxHints: MAX_HINTS,
            note: "Return 20 ordered guesses. Position 1 is the highest-confidence guess."
          })
        },
        {
          type: "image_url",
          image_url: {
            url: drawingJpgDataUrl
          }
        }
      ]
    });

    const guesses = sanitizeGuessList(response.guesses);
    if (guesses.length > bestGuesses.length) {
      bestGuesses = guesses;
    }
    if (guesses.length === MAX_HINTS) {
      return guesses;
    }
  }

  return fillMissingGuesses(bestGuesses);
}

async function sendStructuredRequest({ modelId, provider, systemPrompt, payload, userContent, temperature = 0.3 }) {
  const maxAttempts = REQUEST_MAX_RETRIES;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const requestBody = {
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: userContent || JSON.stringify(payload || {})
          }
        ],
        temperature,
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

function sanitizeSvg(raw) {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim();
  if (!normalized) return "";

  const fenced = normalized.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  const value = fenced ? fenced[1].trim() : normalized;

  const start = value.indexOf("<svg");
  const end = value.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end <= start) return "";

  return value.slice(start, end + "</svg>".length).trim();
}

function isSafeSvg(svg) {
  if (typeof svg !== "string" || svg.length < 20 || svg.length > 15000) return false;
  if (!svg.includes("<svg") || !svg.includes("</svg>")) return false;
  if (/<script|foreignObject|iframe|object|embed|audio|video/i.test(svg)) return false;
  if (/\bon\w+\s*=/.test(svg)) return false;
  return true;
}

function sanitizeGuessList(raw) {
  if (!Array.isArray(raw)) return [];

  const guesses = [];
  const used = new Set();
  for (const item of raw) {
    const guess = sanitizeOneWord(item);
    if (!guess) continue;
    if (!wordPattern.test(guess)) continue;
    const normalized = normalizeWord(guess);
    if (!normalized || used.has(normalized)) continue;
    used.add(normalized);
    guesses.push(guess);
    if (guesses.length === MAX_HINTS) break;
  }
  return guesses;
}

function fillMissingGuesses(guesses) {
  const output = [...guesses];
  const used = new Set(output.map((guess) => normalizeWord(guess)));
  const fallbackPool = [
    ...WORD_BANK,
    "animal",
    "vehicle",
    "planet",
    "fish",
    "tree",
    "house",
    "bird",
    "boat",
    "mountain",
    "flower",
    "robot",
    "forest",
    "city",
    "tool",
    "star",
    "moon",
    "ocean",
    "creature",
    "machine"
  ];

  for (const candidate of fallbackPool) {
    const normalized = normalizeWord(candidate);
    if (!normalized || used.has(normalized)) continue;
    used.add(normalized);
    output.push(candidate);
    if (output.length === MAX_HINTS) break;
  }

  return output.slice(0, MAX_HINTS);
}

async function svgToJpegDataUrl(svg) {
  const browser = await getRenderBrowser();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

  try {
    await page.setContent(
      `<html><body style="margin:0;background:#fff"><img id="stage" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" style="width:512px;height:512px;display:block"/></body></html>`,
      { waitUntil: "domcontentloaded" }
    );

    const jpgBuffer = await page.locator("#stage").screenshot({
      type: "jpeg",
      quality: 85
    });

    return `data:image/jpeg;base64,${jpgBuffer.toString("base64")}`;
  } finally {
    await page.close();
  }
}

async function getRenderBrowser() {
  if (!renderBrowserPromise) {
    renderBrowserPromise = chromium.launch({ headless: true });
  }
  return renderBrowserPromise;
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

function startBenchmarkProgress(runId, model) {
  benchmarkProgress.status = "running";
  benchmarkProgress.runId = runId;
  benchmarkProgress.startedAt = new Date().toISOString();
  benchmarkProgress.completedAt = null;
  benchmarkProgress.totalGames = WORD_BANK.length;
  benchmarkProgress.completedGames = 0;
  benchmarkProgress.failedGames = 0;
  benchmarkProgress.activeModel = model?.label || null;
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
  const benchmarks = await readAllBenchmarks();
  return { benchmarks };
}

function getModelResultsFile(modelKey) {
  return path.join(MODEL_RESULTS_DIR, `${modelKey}.json`);
}

async function readModelBenchmarks(modelKey) {
  const filePath = getModelResultsFile(modelKey);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.benchmarks) ? parsed.benchmarks : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeModelBenchmarks(modelKey, benchmarks) {
  const filePath = getModelResultsFile(modelKey);
  await fs.mkdir(MODEL_RESULTS_DIR, { recursive: true });
  const payload = {
    modelKey,
    benchmarks
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function readAllBenchmarks() {
  await fs.mkdir(MODEL_RESULTS_DIR, { recursive: true });
  const entries = await fs.readdir(MODEL_RESULTS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(MODEL_RESULTS_DIR, entry.name));

  const all = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.benchmarks)) {
      all.push(...parsed.benchmarks);
    }
  }

  all.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  return all;
}

process.on("exit", () => {
  if (!renderBrowserPromise) return;
  renderBrowserPromise
    .then((browser) => browser.close())
    .catch(() => {});
});
