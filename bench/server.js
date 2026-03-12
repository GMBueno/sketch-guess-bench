import dotenv from "dotenv";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { WORD_BANK } from "../data/wordbank.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_HINTS = 20;
const BENCHMARK_CONCURRENCY = Number(process.env.BENCHMARK_CONCURRENCY || 10);
const REQUEST_MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 60000);
const GAME_TIMEOUT_MS = Number(process.env.GAME_TIMEOUT_MS || 600000);
const DEFAULT_EFFORT = "medium";
const ALLOWED_EFFORTS = new Set(["xhigh", "high", "medium", "low", "minimal", "none"]);

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
  },
  {
    key: "gemini31flashlite",
    label: "Gemini 3.1 Flash Lite",
    modelId: "google/gemini-3.1-flash-lite-preview",
    provider: { order: ["google-ai-studio"], allow_fallbacks: false }
  },
  {
    key: "claudehaiku45",
    label: "Claude Haiku 4.5",
    modelId: "anthropic/claude-haiku-4.5",
    provider: { order: ["google-vertex"], allow_fallbacks: false }
  },
  {
    key: "gpt51codexmini",
    label: "GPT-5.1 Codex Mini",
    modelId: "openai/gpt-5.1-codex-mini",
    provider: { order: ["openai"], allow_fallbacks: false }
  },
  {
    key: "gpt5nano",
    label: "GPT-5 Nano",
    modelId: "openai/gpt-5-nano",
    provider: { order: ["openai"], allow_fallbacks: false }
  },
  {
    key: "gemini25flashlite",
    label: "Gemini 2.5 Flash Lite",
    modelId: "google/gemini-2.5-flash-lite",
    provider: { order: ["google-ai-studio"], allow_fallbacks: false }
  },
  {
    key: "gemini25flash",
    label: "Gemini 2.5 Flash",
    modelId: "google/gemini-2.5-flash",
    provider: { order: ["google-ai-studio"], allow_fallbacks: false }
  }
];

const FIXED_PROVIDER = {
  allow_fallbacks: false
};

const DATA_DIR = path.join(__dirname, "..", "data");
const MODEL_RESULTS_DIR = path.join(DATA_DIR, "benchmarks");
const TRACE_RESULTS_DIR = path.join(DATA_DIR, "openrouter_traces");
const PUBLIC_DIR = path.join(__dirname, "..", "visualizer", "public");
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
app.get(["/", "/rankings", "/replays", "/about"], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

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
  const modelSupportsEffort = supportsEffort(model.modelId);
  const providedEffort = parseEffort(req.body?.effort);
  if (modelSupportsEffort && req.body?.effort !== undefined && !providedEffort) {
    res.status(400).json({
      error: "Invalid effort",
      allowedEfforts: [...ALLOWED_EFFORTS]
    });
    return;
  }
  const effort = modelSupportsEffort ? (providedEffort || DEFAULT_EFFORT) : null;
  if (benchmarkProgress.status === "running") {
    res.status(409).json({ error: "A benchmark is already running" });
    return;
  }

  const runId = crypto.randomUUID();
  startBenchmarkProgress(runId, model, effort);
  try {
    const benchmark = await runBenchmark(runId, model, effort);
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

app.post("/api/benchmarks/:runId/retry-word", async (req, res) => {
  if (!process.env.OPENROUTER_API_KEY) {
    res.status(400).json({ error: "Missing OPENROUTER_API_KEY" });
    return;
  }
  if (benchmarkProgress.status === "running") {
    res.status(409).json({ error: "A benchmark is already running" });
    return;
  }

  const runId = typeof req.params?.runId === "string" ? req.params.runId : "";
  const targetWord = sanitizeOneWord(req.body?.targetWord);
  if (!targetWord) {
    res.status(400).json({ error: "Invalid targetWord" });
    return;
  }

  const record = await findBenchmarkRecord(runId);
  if (!record) {
    res.status(404).json({ error: "Benchmark run not found" });
    return;
  }

  const run = record.benchmark?.modelRuns?.[0];
  if (!run || !Array.isArray(run.games)) {
    res.status(400).json({ error: "Benchmark has no model run data" });
    return;
  }

  const gameIndex = run.games.findIndex((game) => isSameWord(game?.targetWord, targetWord));
  if (gameIndex === -1) {
    res.status(404).json({ error: "Word not found in this benchmark run" });
    return;
  }

  const model = MODELS.find((item) => item.key === run.modelKey || item.modelId === run.modelId);
  if (!model) {
    res.status(400).json({ error: "Model config not found for this run" });
    return;
  }

  const modelSupportsEffort = supportsEffort(model.modelId);
  const effort = modelSupportsEffort
    ? (parseEffort(run.effort) || parseEffort(record.benchmark?.effort) || DEFAULT_EFFORT)
    : null;
  startBenchmarkProgress(runId, model, effort);
  benchmarkProgress.totalGames = 1;
  benchmarkProgress.completedGames = 0;
  benchmarkProgress.failedGames = 0;
  setActiveGame(model.label, run.games[gameIndex].targetWord);
  try {
    const updatedGame = await withTimeout(
      runSingleGame({
        runId,
        model,
        targetWord: run.games[gameIndex].targetWord,
        effort
      }),
      GAME_TIMEOUT_MS,
      `Game timed out after ${GAME_TIMEOUT_MS}ms`
    );

    run.games[gameIndex] = updatedGame;
    const refreshedRun = buildModelRun({
      model,
      effort,
      games: run.games
    });
    record.benchmark.completedAt = new Date().toISOString();
    record.benchmark.effort = effort;
    record.benchmark.modelRuns = [refreshedRun];
    record.benchmark.ranking = [buildRankingRow(refreshedRun)];

    record.benchmarks[record.index] = normalizeBenchmark(record.benchmark);
    await writeModelBenchmarks(record.modelKey, record.benchmarks);
    advanceProgress(model.label, run.games[gameIndex].targetWord, false);
    completeBenchmarkProgress();
    res.json(record.benchmark);
  } catch (err) {
    advanceProgress(model.label, run.games[gameIndex].targetWord, true);
    failBenchmarkProgress(err?.message || "Word retry failed");
    res.status(500).json({ error: err?.message || "Word retry failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

async function runBenchmark(runId, model, effort) {
  const startedAt = new Date().toISOString();
  const games = await runWithConcurrency(
    WORD_BANK,
    Math.min(BENCHMARK_CONCURRENCY, WORD_BANK.length),
    async (targetWord) => {
      setActiveGame(model.label, targetWord);
      try {
        const game = await withTimeout(
          runSingleGame({ runId, model, targetWord, effort }),
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

  const modelRun = buildModelRun({
    model,
    effort,
    games
  });

  return {
    id: runId,
    startedAt,
    completedAt: new Date().toISOString(),
    effort,
    maxHints: MAX_HINTS,
    wordBank: WORD_BANK,
    provider: FIXED_PROVIDER,
    ranking: [buildRankingRow(modelRun)],
    modelRuns: [modelRun]
  };
}

async function runSingleGame({ runId, model, targetWord, effort }) {
  const executionId = crypto.randomUUID();
  const traceSession = createTraceSession();
  const traceFileRef = getTraceFileRef(runId, targetWord);
  const turns = [];
  let outputGame = null;
  let status = "failed";
  let failureMessage = null;

  try {
    const drawing = await generateValidDrawing({ model, targetWord, effort, traceSession });
    turns.push({
      turnNumber: 1,
      role: "draw",
      svg: drawing.svg,
      jpgDataUrl: drawing.jpgDataUrl
    });

    const guesses = await generateOrderedGuesses({
      model,
      effort,
      targetWord,
      drawingJpgDataUrl: drawing.jpgDataUrl,
      traceSession
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
    const requestStats = summarizeTraceRequests(traceSession.requests);
    outputGame = {
      targetWord,
      solved,
      guessesUsed,
      penalizedGuesses,
      totalCostUsd: requestStats.totalCostUsd,
      totalRequestMs: requestStats.totalRequestMs,
      pricedRequests: requestStats.pricedRequests,
      totalRequests: requestStats.totalRequests,
      missingPriceRequests: requestStats.missingPriceRequests,
      turns,
      traceRef: {
        runId,
        targetWord,
        executionId,
        file: traceFileRef.relativePath
      }
    };
    status = "completed";
    return outputGame;
  } catch (err) {
    failureMessage = err?.message || "Game failed";
    const requestStats = summarizeTraceRequests(traceSession.requests);
    err.traceStats = requestStats;
    throw err;
  } finally {
    try {
      await appendGameTraceExecution({
        runId,
        targetWord,
        model,
        effort,
        executionId,
        status,
        failureMessage,
        game: outputGame,
        traceSession
      });
    } catch (traceErr) {
      console.error("Failed to persist trace execution", traceErr);
    }
  }
}

async function generateValidDrawing({ model, targetWord, effort, traceSession }) {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await sendStructuredRequest({
      modelId: model.modelId,
      provider: model.provider || FIXED_PROVIDER,
      effort,
      traceSession,
      traceMeta: {
        phase: "draw",
        targetWord,
        generationAttempt: attempt
      },
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

async function generateOrderedGuesses({ model, drawingJpgDataUrl, effort, targetWord, traceSession }) {
  const maxAttempts = 4;
  let bestGuesses = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await sendStructuredRequest({
      modelId: model.modelId,
      provider: model.provider || FIXED_PROVIDER,
      effort,
      traceSession,
      traceMeta: {
        phase: "guess",
        targetWord,
        generationAttempt: attempt
      },
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

async function sendStructuredRequest({
  modelId,
  provider,
  effort,
  systemPrompt,
  payload,
  userContent,
  temperature = 0.3,
  traceSession = null,
  traceMeta = {}
}) {
  const maxAttempts = REQUEST_MAX_RETRIES;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestId = crypto.randomUUID();
    const requestStartedAt = new Date().toISOString();
    let traceWritten = false;
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
    if (supportsEffort(modelId)) {
      requestBody.reasoning = {
        effort: effort || DEFAULT_EFFORT,
        exclude: false
      };
    }

    try {
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

      const responseText = await response.text();
      const responseBody = safeJsonParse(responseText);
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const responseCompletedAt = new Date().toISOString();
      const costUsd = extractResponseCostUsd(responseBody);
      const measuredDurationMs = computeDurationMs(requestStartedAt, responseCompletedAt);
      const requestDurationMs = extractResponseDurationMs(responseBody, responseHeaders) ?? measuredDurationMs;

      appendTraceRequest(traceSession, {
        requestId,
        attempt,
        requestStartedAt,
        responseCompletedAt,
        traceMeta,
        request: requestBody,
        response: {
          status: response.status,
          ok: response.ok,
          openrouterRequestId: responseHeaders["x-request-id"] || responseBody?.id || null,
          headers: responseHeaders,
          rawBody: responseText,
          body: responseBody || null
        },
        costUsd,
        requestDurationMs,
        error: null
      });
      traceWritten = true;

      if (!response.ok) {
        if (attempt < maxAttempts && isRetryableStatus(response.status)) {
          await sleep(250 * attempt);
          continue;
        }
        throw new Error(`OpenRouter error ${response.status}: ${responseText}`);
      }

      const data = responseBody;
      if (!data || typeof data !== "object") {
        if (attempt < maxAttempts) {
          await sleep(150 * attempt);
          continue;
        }
        throw new Error("OpenRouter response was not valid JSON");
      }
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
      if (!traceWritten) {
        const responseCompletedAt = new Date().toISOString();
        appendTraceRequest(traceSession, {
          requestId,
          attempt,
          requestStartedAt,
          responseCompletedAt,
          traceMeta,
          request: requestBody,
          response: null,
          costUsd: null,
          requestDurationMs: computeDurationMs(requestStartedAt, responseCompletedAt),
          error: lastError.message || String(lastError)
        });
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

function buildModelRun({ model, effort, games }) {
  const safeGames = Array.isArray(games) ? games : [];
  const totalWords = safeGames.length || WORD_BANK.length;
  const solvedGames = safeGames.filter((game) => game?.solved);
  const failedGames = safeGames.filter((game) => game?.failed);
  const totalGuesses = safeGames.reduce((sum, game) => sum + Number(game?.penalizedGuesses || 0), 0);
  const totalCostUsdRaw = safeGames.reduce((sum, game) => sum + Number(game?.totalCostUsd || 0), 0);
  const missingPriceRequests = safeGames.reduce((sum, game) => sum + Number(game?.missingPriceRequests || 0), 0);
  const pricedRequests = safeGames.reduce((sum, game) => sum + Number(game?.pricedRequests || 0), 0);
  const totalRequests = safeGames.reduce((sum, game) => sum + Number(game?.totalRequests || 0), 0);
  const totalRequestMsRaw = safeGames.reduce((sum, game) => sum + Number(game?.totalRequestMs || 0), 0);

  return {
    modelKey: model.key,
    modelLabel: model.label,
    effort,
    modelId: model.modelId,
    solvedCount: solvedGames.length,
    failedCount: failedGames.length,
    totalWords,
    totalGuesses,
    averageGuesses: totalWords > 0 ? Number((totalGuesses / totalWords).toFixed(2)) : 0,
    totalCostUsd: Number(totalCostUsdRaw.toFixed(6)),
    totalRequestMs: Number(totalRequestMsRaw.toFixed(0)),
    pricedRequests,
    totalRequests,
    missingPriceRequests,
    games: safeGames
  };
}

function buildRankingRow(modelRun) {
  return {
    rank: 1,
    modelKey: modelRun.modelKey,
    modelLabel: modelRun.modelLabel,
    effort: modelRun.effort,
    totalGuesses: modelRun.totalGuesses,
    solvedCount: modelRun.solvedCount,
    failedCount: modelRun.failedCount,
    totalWords: modelRun.totalWords,
    averageGuesses: modelRun.averageGuesses,
    totalCostUsd: modelRun.totalCostUsd,
    totalRequestMs: modelRun.totalRequestMs,
    pricedRequests: modelRun.pricedRequests,
    totalRequests: modelRun.totalRequests,
    missingPriceRequests: modelRun.missingPriceRequests
  };
}

function createTraceSession() {
  return { requests: [] };
}

function appendTraceRequest(traceSession, event) {
  if (!traceSession) return;
  if (!Array.isArray(traceSession.requests)) traceSession.requests = [];
  traceSession.requests.push(event);
}

function summarizeTraceRequests(requests) {
  const events = Array.isArray(requests) ? requests : [];
  const successfulResponses = events.filter((item) => item?.response?.ok);
  const totalRequests = events.length;
  const pricedRequests = successfulResponses.filter((item) => Number.isFinite(item?.costUsd)).length;
  const totalCostUsdRaw = successfulResponses.reduce((sum, item) => sum + Number(item?.costUsd || 0), 0);
  const totalRequestMsRaw = events.reduce((sum, item) => sum + Number(item?.requestDurationMs || 0), 0);
  const missingPriceRequests = successfulResponses.length - pricedRequests;
  return {
    totalRequests,
    pricedRequests,
    missingPriceRequests,
    totalCostUsd: Number(totalCostUsdRaw.toFixed(6)),
    totalRequestMs: Number(totalRequestMsRaw.toFixed(0))
  };
}

function extractResponseCostUsd(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data?.usage?.cost,
    data?.usage?.total_cost,
    data?.usage?.cost_usd,
    data?.total_cost,
    data?.cost,
    data?.metadata?.cost,
    data?.meta?.cost,
    data?.provider_response?.usage?.cost
  ];
  for (const value of candidates) {
    const cost = Number(value);
    if (Number.isFinite(cost) && cost >= 0) return Number(cost.toFixed(6));
  }
  return null;
}

function extractResponseDurationMs(data, headers) {
  const headerCandidates = [
    headers?.["x-openrouter-processing-ms"],
    headers?.["x-openrouter-latency-ms"],
    headers?.["openrouter-processing-ms"]
  ];
  for (const value of headerCandidates) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration >= 0) return Math.round(duration);
  }

  if (!data || typeof data !== "object") return null;
  const bodyCandidates = [
    data?.usage?.total_duration_ms,
    data?.usage?.duration_ms,
    data?.duration_ms,
    data?.latency_ms,
    data?.processing_ms,
    data?.metadata?.duration_ms
  ];
  for (const value of bodyCandidates) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration >= 0) return Math.round(duration);
  }
  return null;
}

function computeDurationMs(startIso, endIso) {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round(end - start));
}

function getTraceFileRef(runId, targetWord) {
  const fileName = `${toSafeFileToken(targetWord)}.json`;
  const relativePath = path.join("openrouter_traces", runId, fileName);
  return {
    fileName,
    relativePath,
    absolutePath: path.join(TRACE_RESULTS_DIR, runId, fileName)
  };
}

function toSafeFileToken(value) {
  const normalized = normalizeWord(value)
    .replace(/[^a-z0-9-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^-+|-+$/g, "")
    .replace(/^_+|_+$/g, "");
  return normalized || "word";
}

async function appendGameTraceExecution({
  runId,
  targetWord,
  model,
  effort,
  executionId,
  status,
  failureMessage,
  game,
  traceSession
}) {
  const traceRef = getTraceFileRef(runId, targetWord);
  await fs.mkdir(path.dirname(traceRef.absolutePath), { recursive: true });

  const execution = {
    executionId,
    startedAt: traceSession?.requests?.[0]?.requestStartedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status,
    failureMessage: failureMessage || null,
    game: game || null,
    requestStats: summarizeTraceRequests(traceSession?.requests),
    requests: Array.isArray(traceSession?.requests) ? traceSession.requests : []
  };

  let existing = null;
  try {
    const raw = await fs.readFile(traceRef.absolutePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") existing = parsed;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const payload = {
    runId,
    targetWord,
    modelKey: model.key,
    modelLabel: model.label,
    modelId: model.modelId,
    effort,
    latestExecutionId: executionId,
    executions: []
  };

  if (existing && Array.isArray(existing.executions)) {
    payload.executions = existing.executions;
  }
  payload.executions.push(execution);
  await fs.writeFile(traceRef.absolutePath, JSON.stringify(payload, null, 2), "utf8");
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

  return normalizeSvgMarkup(value.slice(start, end + "</svg>".length).trim());
}

function normalizeSvgMarkup(svg) {
  if (typeof svg !== "string") return "";

  return svg
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .trim();
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
    const parseCheck = await page.evaluate((svgText) => {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      return {
        hasParserError: Boolean(doc.querySelector("parsererror"))
      };
    }, svg);

    if (parseCheck.hasParserError) {
      throw new Error("SVG XML parse failed");
    }

    await page.setContent(
      `<html><body style="margin:0;background:#fff"><img id="stage" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" style="width:512px;height:512px;display:block"/></body></html>`,
      { waitUntil: "domcontentloaded" }
    );

    const imageInfo = await page.locator("#stage").evaluate(async (img) => {
      try {
        await img.decode();
      } catch (err) {
        return {
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          decodeError: err instanceof Error ? err.message : String(err)
        };
      }

      return {
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        decodeError: null
      };
    });

    if (!imageInfo.complete || imageInfo.naturalWidth === 0 || imageInfo.naturalHeight === 0) {
      throw new Error(`SVG image decode failed${imageInfo.decodeError ? `: ${imageInfo.decodeError}` : ""}`);
    }

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
  const traceStats = err?.traceStats || {};
  return {
    targetWord,
    solved: false,
    failed: true,
    failureReason: err?.message || "Game failed",
    guessesUsed: MAX_HINTS,
    penalizedGuesses: MAX_HINTS + 1,
    totalCostUsd: Number(traceStats.totalCostUsd || 0),
    totalRequestMs: Number(traceStats.totalRequestMs || 0),
    pricedRequests: Number(traceStats.pricedRequests || 0),
    totalRequests: Number(traceStats.totalRequests || 0),
    missingPriceRequests: Number(traceStats.missingPriceRequests || 0),
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

function startBenchmarkProgress(runId, model, effort) {
  benchmarkProgress.status = "running";
  benchmarkProgress.runId = runId;
  benchmarkProgress.startedAt = new Date().toISOString();
  benchmarkProgress.completedAt = null;
  benchmarkProgress.totalGames = WORD_BANK.length;
  benchmarkProgress.completedGames = 0;
  benchmarkProgress.failedGames = 0;
  benchmarkProgress.activeModel = model?.label
    ? (supportsEffort(model?.modelId) && effort ? `${model.label} (${effort})` : model.label)
    : null;
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
    return Array.isArray(parsed?.benchmarks) ? parsed.benchmarks.map(normalizeBenchmark) : [];
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
    benchmarks: benchmarks.map(normalizeBenchmark)
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
      all.push(...parsed.benchmarks.map(normalizeBenchmark));
    }
  }

  all.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  return all;
}

async function findBenchmarkRecord(runId) {
  if (!runId) return null;
  await fs.mkdir(MODEL_RESULTS_DIR, { recursive: true });
  const entries = await fs.readdir(MODEL_RESULTS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(MODEL_RESULTS_DIR, entry.name));

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.benchmarks)) continue;
    const index = parsed.benchmarks.findIndex((benchmark) => benchmark?.id === runId);
    if (index === -1) continue;
    const modelKey = path.basename(filePath, ".json");
    return {
      modelKey,
      filePath,
      index,
      benchmarks: parsed.benchmarks.map(normalizeBenchmark),
      benchmark: normalizeBenchmark(parsed.benchmarks[index])
    };
  }
  return null;
}

function parseEffort(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return ALLOWED_EFFORTS.has(value) ? value : null;
}

function supportsEffort(modelId) {
  if (typeof modelId !== "string") return false;
  if (modelId.startsWith("openai/")) return true;
  return modelId === "google/gemini-3.1-flash-lite-preview";
}

function normalizeBenchmark(benchmark) {
  if (!benchmark || typeof benchmark !== "object") return benchmark;
  const benchmarkModel = resolveBenchmarkModel(benchmark);
  const benchmarkSupportsEffort = supportsEffort(benchmarkModel?.modelId);
  const effort = benchmarkSupportsEffort
    ? (parseEffort(benchmark.effort) || DEFAULT_EFFORT)
    : null;
  const modelRuns = Array.isArray(benchmark.modelRuns)
    ? benchmark.modelRuns.map((run) => {
      const runModelId = typeof run?.modelId === "string" ? run.modelId : benchmarkModel?.modelId;
      const runSupportsEffort = supportsEffort(runModelId);
      const runEffort = runSupportsEffort ? (parseEffort(run?.effort) || effort || DEFAULT_EFFORT) : null;
      const games = Array.isArray(run?.games) ? run.games : [];
      const gameCost = deriveGameCostStats(games);
      const hasCostInGames = games.some((game) =>
        Number.isFinite(Number(game?.totalCostUsd))
        || Number.isFinite(Number(game?.pricedRequests))
        || Number.isFinite(Number(game?.totalRequests))
        || Number.isFinite(Number(game?.totalRequestMs))
      );
      const totalCostUsd = Number.isFinite(Number(run?.totalCostUsd))
        ? Number(Number(run.totalCostUsd).toFixed(6))
        : (hasCostInGames ? gameCost.totalCostUsd : null);
      const pricedRequests = Number.isFinite(Number(run?.pricedRequests))
        ? Number(run.pricedRequests)
        : (hasCostInGames ? gameCost.pricedRequests : null);
      const totalRequests = Number.isFinite(Number(run?.totalRequests))
        ? Number(run.totalRequests)
        : (hasCostInGames ? gameCost.totalRequests : null);
      const missingPriceRequests = Number.isFinite(Number(run?.missingPriceRequests))
        ? Number(run.missingPriceRequests)
        : (hasCostInGames ? gameCost.missingPriceRequests : null);
      const totalRequestMs = Number.isFinite(Number(run?.totalRequestMs))
        ? Number(run.totalRequestMs)
        : (hasCostInGames ? gameCost.totalRequestMs : null);
      return {
        ...run,
        effort: runEffort,
        totalCostUsd,
        totalRequestMs,
        pricedRequests,
        totalRequests,
        missingPriceRequests
      };
    })
    : [];
  const primaryRun = modelRuns[0] || null;
  const ranking = Array.isArray(benchmark.ranking)
    ? benchmark.ranking.map((row) => {
      const rowSupportsEffort = supportsEffort(primaryRun?.modelId || benchmarkModel?.modelId);
      const rowEffort = rowSupportsEffort ? (parseEffort(row?.effort) || effort || DEFAULT_EFFORT) : null;
      return {
        ...row,
        effort: rowEffort,
        totalCostUsd: Number.isFinite(Number(row?.totalCostUsd))
          ? Number(Number(row.totalCostUsd).toFixed(6))
          : (primaryRun?.totalCostUsd ?? null),
        totalRequestMs: Number.isFinite(Number(row?.totalRequestMs))
          ? Number(row.totalRequestMs)
          : (primaryRun?.totalRequestMs ?? null),
        pricedRequests: Number.isFinite(Number(row?.pricedRequests))
          ? Number(row.pricedRequests)
          : (primaryRun?.pricedRequests ?? null),
        totalRequests: Number.isFinite(Number(row?.totalRequests))
          ? Number(row.totalRequests)
          : (primaryRun?.totalRequests ?? null),
        missingPriceRequests: Number.isFinite(Number(row?.missingPriceRequests))
          ? Number(row.missingPriceRequests)
          : (primaryRun?.missingPriceRequests ?? null)
      };
    })
    : [];
  return {
    ...benchmark,
    effort,
    modelRuns,
    ranking
  };
}

function deriveGameCostStats(games) {
  const safeGames = Array.isArray(games) ? games : [];
  const totalCostUsdRaw = safeGames.reduce((sum, game) => sum + Number(game?.totalCostUsd || 0), 0);
  const totalRequestMsRaw = safeGames.reduce((sum, game) => sum + Number(game?.totalRequestMs || 0), 0);
  const pricedRequests = safeGames.reduce((sum, game) => sum + Number(game?.pricedRequests || 0), 0);
  const totalRequests = safeGames.reduce((sum, game) => sum + Number(game?.totalRequests || 0), 0);
  const missingPriceRequests = safeGames.reduce((sum, game) => sum + Number(game?.missingPriceRequests || 0), 0);
  return {
    totalCostUsd: Number(totalCostUsdRaw.toFixed(6)),
    totalRequestMs: Number(totalRequestMsRaw.toFixed(0)),
    pricedRequests,
    totalRequests,
    missingPriceRequests
  };
}

function resolveBenchmarkModel(benchmark) {
  const run = Array.isArray(benchmark?.modelRuns) ? benchmark.modelRuns[0] : null;
  if (run?.modelId) return { modelId: run.modelId, key: run.modelKey };
  if (run?.modelKey) {
    const matched = MODELS.find((item) => item.key === run.modelKey);
    if (matched) return matched;
  }
  const rankingRow = Array.isArray(benchmark?.ranking) ? benchmark.ranking[0] : null;
  if (rankingRow?.modelKey) {
    const matched = MODELS.find((item) => item.key === rankingRow.modelKey);
    if (matched) return matched;
  }
  return null;
}

process.on("exit", () => {
  if (!renderBrowserPromise) return;
  renderBrowserPromise
    .then((browser) => browser.close())
    .catch(() => {});
});
