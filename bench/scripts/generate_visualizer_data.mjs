import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const BENCHMARK_DIR = path.join(ROOT_DIR, "data", "benchmarks");
const TRACE_DIR = path.join(ROOT_DIR, "data", "openrouter_traces");
const VISUALIZER_DATA_DIR = path.join(ROOT_DIR, "visualizer", "data");
const VISUALIZER_REPLAY_ASSET_DIR = path.join(
  ROOT_DIR,
  "visualizer",
  "public",
  "replay_assets",
  "svgs"
);
const BENCHMARK_OUTPUT_PATH = path.join(VISUALIZER_DATA_DIR, "benchmark-results.json");
const REPLAY_OUTPUT_PATH = path.join(VISUALIZER_DATA_DIR, "replay-data.json");

const DYNAMIC_MODEL_IDS = new Set(["google/gemini-3-flash-preview"]);
const EFFORT_LABEL_MODEL_IDS = new Set(["google/gemini-3.1-flash-lite-preview"]);
const traceFileCache = new Map();
const runTimingCache = new Map();

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatModelName(run) {
  const label = run?.modelLabel || "Unknown Model";
  const effort = typeof run?.effort === "string" ? run.effort.trim() : "";
  const modelId = run?.modelId || "";

  if (modelId.startsWith("openai/") && effort) {
    return `${label} (${effort})`;
  }

  if (DYNAMIC_MODEL_IDS.has(modelId)) {
    return `${label} (${effort || "dynamic"})`;
  }

  if (EFFORT_LABEL_MODEL_IDS.has(modelId) && effort) {
    return `${label} (${effort})`;
  }

  return label;
}

function getLatestExecution(tracePayload) {
  if (!Array.isArray(tracePayload?.executions) || tracePayload.executions.length === 0) {
    return null;
  }

  if (tracePayload.latestExecutionId) {
    const latest = tracePayload.executions.find(
      (execution) => execution?.executionId === tracePayload.latestExecutionId
    );
    if (latest) return latest;
  }

  return tracePayload.executions[tracePayload.executions.length - 1] ?? null;
}

function deriveRequestDurationMs(request) {
  const explicitDurationMs = numberOrZero(request?.requestDurationMs);
  if (explicitDurationMs > 0) return explicitDurationMs;

  const startedAtMs = Date.parse(request?.requestStartedAt || "");
  const completedAtMs = Date.parse(request?.responseCompletedAt || "");
  if (Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) && completedAtMs >= startedAtMs) {
    return completedAtMs - startedAtMs;
  }

  return 0;
}

function deriveExecutionTimingMs(execution) {
  const totalRequestMs = numberOrZero(execution?.requestStats?.totalRequestMs);
  if (totalRequestMs > 0) return totalRequestMs;

  if (!Array.isArray(execution?.requests)) return 0;
  return execution.requests.reduce((sum, request) => sum + deriveRequestDurationMs(request), 0);
}

async function readTracePayload(relativeTraceFile) {
  if (!relativeTraceFile) return null;
  if (traceFileCache.has(relativeTraceFile)) return traceFileCache.get(relativeTraceFile);

  const tracePath = path.join(ROOT_DIR, "data", relativeTraceFile);
  try {
    const raw = await fs.readFile(tracePath, "utf8");
    const parsed = JSON.parse(raw);
    traceFileCache.set(relativeTraceFile, parsed);
    return parsed;
  } catch {
    traceFileCache.set(relativeTraceFile, null);
    return null;
  }
}

async function deriveGameTimingMs(game) {
  const traceFile = game?.traceRef?.file;
  if (!traceFile) return 0;

  const tracePayload = await readTracePayload(traceFile);
  const latestExecution = getLatestExecution(tracePayload);
  return deriveExecutionTimingMs(latestExecution);
}

async function deriveRunTimingFromTraces(runId) {
  if (!runId) return 0;
  if (runTimingCache.has(runId)) return runTimingCache.get(runId);

  const runTraceDir = path.join(TRACE_DIR, runId);
  let entries;
  try {
    entries = await fs.readdir(runTraceDir, { withFileTypes: true });
  } catch {
    runTimingCache.set(runId, 0);
    return 0;
  }

  let totalRequestMs = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const relativeTraceFile = path.join("openrouter_traces", runId, entry.name);
    const tracePayload = await readTracePayload(relativeTraceFile);
    const latestExecution = getLatestExecution(tracePayload);
    totalRequestMs += deriveExecutionTimingMs(latestExecution);
  }

  runTimingCache.set(runId, totalRequestMs);
  return totalRequestMs;
}

async function readBenchmarks() {
  const entries = await fs.readdir(BENCHMARK_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(BENCHMARK_DIR, entry.name));

  const benchmarks = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.benchmarks)) {
      benchmarks.push(...parsed.benchmarks);
    }
  }
  return benchmarks;
}

function getRunTotalWords(benchmark) {
  return numberOrZero(benchmark?.modelRuns?.[0]?.totalWords);
}

function filterBenchmarksForVisualizer(benchmarks) {
  const maxTotalWords = benchmarks.reduce(
    (max, benchmark) => Math.max(max, getRunTotalWords(benchmark)),
    0
  );

  if (maxTotalWords <= 0) {
    return benchmarks;
  }

  return benchmarks.filter((benchmark) => getRunTotalWords(benchmark) === maxTotalWords);
}

async function toRankingEntry(benchmark) {
  const run = benchmark?.modelRuns?.[0];
  const totalTests = numberOrZero(run?.totalWords);
  const correct = numberOrZero(run?.solvedCount);
  const errors = numberOrZero(run?.failedCount);
  const incorrect = Math.max(0, totalTests - correct - errors);
  const totalCost = numberOrZero(run?.totalCostUsd);
  const totalRequestMs =
    numberOrZero(run?.totalRequestMs) || (await deriveRunTimingFromTraces(benchmark?.id));
  const averageDuration = totalTests > 0 ? totalRequestMs / totalTests : 0;

  return {
    model: formatModelName(run),
    modelId: run?.modelId || null,
    runId: benchmark?.id || null,
    completedAt: benchmark?.completedAt || null,
    correct,
    incorrect,
    errors,
    totalTests,
    successRate: totalTests > 0 ? (correct / totalTests) * 100 : 0,
    errorRate: totalTests > 0 ? (errors / totalTests) * 100 : 0,
    averageDuration,
    totalRequestMs,
    totalCost,
    averageCostPerTest: totalTests > 0 ? totalCost / totalTests : 0,
    totalGuesses: numberOrZero(run?.totalGuesses),
    averageGuesses: numberOrZero(run?.averageGuesses),
    pricedRequests: numberOrZero(run?.pricedRequests),
    totalRequests: numberOrZero(run?.totalRequests),
    missingPriceRequests: numberOrZero(run?.missingPriceRequests),
  };
}

function sortRankings(rankings) {
  return rankings.sort((a, b) => {
    if (b.successRate !== a.successRate) return b.successRate - a.successRate;
    if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
    if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
    if (a.averageDuration !== b.averageDuration) return a.averageDuration - b.averageDuration;
    return String(a.model).localeCompare(String(b.model));
  });
}

function buildMetadata(rankings) {
  const totalModels = rankings.length;
  const totalTestsRun = rankings.reduce((sum, item) => sum + item.totalTests, 0);
  const overallCorrect = rankings.reduce((sum, item) => sum + item.correct, 0);
  const overallIncorrect = rankings.reduce((sum, item) => sum + item.incorrect, 0);
  const overallErrors = rankings.reduce((sum, item) => sum + item.errors, 0);
  const totalCost = rankings.reduce((sum, item) => sum + item.totalCost, 0);
  const totalRequestMs = rankings.reduce((sum, item) => sum + item.totalRequestMs, 0);
  const timestamp = new Date().toISOString();

  return {
    timestamp,
    totalModels,
    totalTestsRun,
    overallCorrect,
    overallIncorrect,
    overallErrors,
    overallSuccessRate: totalTestsRun > 0 ? (overallCorrect / totalTestsRun) * 100 : 0,
    overallErrorRate: totalTestsRun > 0 ? (overallErrors / totalTestsRun) * 100 : 0,
    totalCost,
    totalRequestMs,
    averageCostPerTest: totalTestsRun > 0 ? totalCost / totalTestsRun : 0,
    config: {
      maxConcurrency: null,
      testRunsPerModel: 1,
      timeoutSeconds: 600,
    },
    testSuite: "SketchGuess Bench",
    suiteId: "sketchguess-bench",
    version: timestamp.slice(0, 10),
  };
}

function sanitizeSvgFileSegment(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

async function resetReplaySvgDir() {
  await fs.rm(VISUALIZER_REPLAY_ASSET_DIR, { recursive: true, force: true });
  await fs.mkdir(VISUALIZER_REPLAY_ASSET_DIR, { recursive: true });
}

async function writeReplaySvg(runId, targetWord, svg) {
  if (typeof svg !== "string" || !svg.trim()) return null;

  const safeRunId = sanitizeSvgFileSegment(runId);
  const safeWord = sanitizeSvgFileSegment(targetWord);
  const runDir = path.join(VISUALIZER_REPLAY_ASSET_DIR, safeRunId);
  const fileName = `${safeWord}.svg`;
  const filePath = path.join(runDir, fileName);

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(filePath, svg, "utf8");

  return `/replay_assets/svgs/${safeRunId}/${fileName}`;
}

async function buildReplayRuns(benchmarks, rankingByRunId) {
  const runs = [];

  for (const benchmark of benchmarks) {
    const run = benchmark?.modelRuns?.[0];
    if (!run) continue;

    const games = await Promise.all(
      (run.games || []).map(async (game) => {
        const drawTurn = (game.turns || []).find((turn) => turn.role === "draw");
        const guesses = (game.turns || [])
          .filter((turn) => turn.role === "guess" && typeof turn.text === "string")
          .map((turn) => turn.text);
        const svgPath = await writeReplaySvg(benchmark.id, game.targetWord, drawTurn?.svg);

        return {
          targetWord: game.targetWord,
          solved: Boolean(game.solved),
          guessesUsed: numberOrZero(game.guessesUsed),
          penalizedGuesses: numberOrZero(game.penalizedGuesses),
          totalCostUsd: numberOrZero(game.totalCostUsd),
          totalRequestMs: await deriveGameTimingMs(game),
          totalRequests: numberOrZero(game.totalRequests),
          svgPath,
          guesses,
          traceRef: game.traceRef || null,
        };
      })
    );

    const ranking = rankingByRunId.get(benchmark.id);
    runs.push({
      model: formatModelName(run),
      modelId: run.modelId || null,
      runId: benchmark.id,
      completedAt: benchmark.completedAt || null,
      solvedCount: numberOrZero(run.solvedCount),
      failedCount: numberOrZero(run.failedCount),
      totalWords: numberOrZero(run.totalWords),
      totalGuesses: numberOrZero(run.totalGuesses),
      averageGuesses: numberOrZero(run.averageGuesses),
      totalCostUsd: numberOrZero(run.totalCostUsd),
      totalRequestMs: ranking?.totalRequestMs || 0,
      totalRequests: numberOrZero(run.totalRequests),
      games,
      wordBank: Array.isArray(benchmark.wordBank) ? benchmark.wordBank : games.map((game) => game.targetWord),
    });
  }

  runs.sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
    return String(b.completedAt || "").localeCompare(String(a.completedAt || ""));
  });

  return runs;
}

async function main() {
  const allBenchmarks = await readBenchmarks();
  const benchmarks = filterBenchmarksForVisualizer(allBenchmarks);
  const rankings = sortRankings(await Promise.all(benchmarks.map(toRankingEntry)));
  const rankingByRunId = new Map(rankings.map((ranking) => [ranking.runId, ranking]));
  const metadata = buildMetadata(rankings);
  await resetReplaySvgDir();
  const replay = {
    generatedAt: metadata.timestamp,
    runs: await buildReplayRuns(benchmarks, rankingByRunId),
  };

  await fs.mkdir(VISUALIZER_DATA_DIR, { recursive: true });
  await fs.writeFile(BENCHMARK_OUTPUT_PATH, JSON.stringify({ rankings, metadata }, null, 2), "utf8");
  await fs.writeFile(REPLAY_OUTPUT_PATH, JSON.stringify(replay, null, 2), "utf8");

  console.log(`Wrote ${rankings.length} rankings to ${BENCHMARK_OUTPUT_PATH}`);
  console.log(`Wrote ${replay.runs.length} replay runs to ${REPLAY_OUTPUT_PATH}`);
}

await main();
