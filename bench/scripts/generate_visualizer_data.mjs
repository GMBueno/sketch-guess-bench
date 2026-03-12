import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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
const VISUALIZER_SHARE_PREVIEW_DIR = path.join(
  ROOT_DIR,
  "visualizer",
  "public",
  "replay_assets",
  "share_previews"
);
const VISUALIZER_SHARE_HTML_DIR = path.join(ROOT_DIR, "visualizer", "public", "share", "replay");
const BENCHMARK_OUTPUT_PATH = path.join(VISUALIZER_DATA_DIR, "benchmark-results.json");
const REPLAY_OUTPUT_PATH = path.join(VISUALIZER_DATA_DIR, "replay-data.json");
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "";

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

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortReplayRunsForShare(runs) {
  return runs.slice().sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
    return String(a.model).localeCompare(String(b.model));
  });
}

function buildRunSlugMap(runs) {
  const sortedRuns = sortReplayRunsForShare(runs);
  const counts = new Map();
  const slugs = new Map();

  for (const run of sortedRuns) {
    const baseSlug = slugify(run.model);
    const count = counts.get(baseSlug) || 0;
    counts.set(baseSlug, count + 1);
    slugs.set(run.runId, count === 0 ? baseSlug : `${baseSlug}-${run.runId.slice(0, 8)}`);
  }

  return slugs;
}

function getSharePreviewImagePath({ word, runA, runB }) {
  return runB
    ? `/replay_assets/share_previews/${word}/${runA}__${runB}.png`
    : `/replay_assets/share_previews/${word}/${runA}.png`;
}

function getSharePagePath({ word, runA, runB }) {
  return runB
    ? `/share/replay/${word}/${runA}/${runB}/`
    : `/share/replay/${word}/${runA}/`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function resetReplaySvgDir() {
  await fs.rm(VISUALIZER_REPLAY_ASSET_DIR, { recursive: true, force: true });
  await fs.mkdir(VISUALIZER_REPLAY_ASSET_DIR, { recursive: true });
}

async function resetReplaySharePreviewDir() {
  await fs.rm(VISUALIZER_SHARE_PREVIEW_DIR, { recursive: true, force: true });
  await fs.mkdir(VISUALIZER_SHARE_PREVIEW_DIR, { recursive: true });
}

async function resetReplayShareHtmlDir() {
  await fs.rm(VISUALIZER_SHARE_HTML_DIR, { recursive: true, force: true });
  await fs.mkdir(VISUALIZER_SHARE_HTML_DIR, { recursive: true });
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

async function readReplaySvgMarkup(svgPath) {
  if (!svgPath) return null;

  const filePath = path.join(ROOT_DIR, "visualizer", "public", svgPath.replace(/^\/+/, ""));
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function buildSharePreviewMarkup({ word, leftRun, rightRun, leftGame, rightGame, leftSvg, rightSvg }) {
  const renderCard = (run, game, svg) => `
    <section class="card">
      <div class="card-header">
        <div class="model">${escapeHtml(run.model)}</div>
        <div class="status ${game?.solved ? "solved" : "missed"}">${game?.solved ? "Solved" : "Missed"}</div>
      </div>
      <div class="image-wrap">
        ${
          svg
            ? `<div class="svg-frame">${svg}</div>`
            : `<div class="placeholder">No image saved</div>`
        }
      </div>
    </section>
  `;

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          width: 1200px;
          height: 630px;
          overflow: hidden;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          color: #fafafa;
          background: linear-gradient(135deg, #2c2e34 0%, #16181a 100%);
        }
        .frame {
          width: 100%;
          height: 100%;
          padding: 19px 42px 38px;
          display: flex;
          flex-direction: column;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 20px;
          padding: 0 26px;
        }
        .eyebrow {
          font-size: 22px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: #a1a1aa;
          text-align: right;
          margin-top: 10px;
        }
        .word {
          font-size: 55px;
          font-weight: 700;
          line-height: 1;
          letter-spacing: 0.04em;
          color: transparent;
          background: linear-gradient(180deg, #f6f7f7 0%, #b3b8be 100%);
          -webkit-background-clip: text;
          background-clip: text;
          text-transform: uppercase;
        }
        .title-block {
          display: flex;
          flex: 1;
          justify-content: flex-start;
          min-width: 0;
        }
        .brand-block {
          display: flex;
          flex: 1;
          justify-content: flex-end;
          min-width: 0;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          flex: 1;
          align-items: start;
        }
        .card {
          display: flex;
          flex-direction: column;
          min-height: 0;
          border: 1px solid #7e838a;
          border-radius: 22px;
          background: rgba(255,255,255,0.04);
          padding: 16px;
          transform: scale(0.9);
          transform-origin: top center;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .model {
          font-size: 20px;
          font-weight: 600;
        }
        .status {
          font-size: 14px;
          font-weight: 700;
          color: #ffffff;
          padding: 8px 12px;
          border-radius: 999px;
          line-height: 1;
        }
        .status.solved {
          background: #349c4e;
          box-shadow: 0 0 18px rgba(52, 156, 78, 0.45);
        }
        .status.missed {
          background: #c01932;
          box-shadow: 0 0 18px rgba(192, 25, 50, 0.45);
        }
        .image-wrap {
          flex: 1;
          margin-top: 12px;
          border-radius: 18px;
          background: #f5f5f5;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          min-height: 0;
        }
        .svg-frame {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 0;
        }
        .image-wrap svg {
          display: block;
          max-width: 100%;
          max-height: 100%;
          width: auto !important;
          height: auto !important;
        }
        .placeholder {
          color: #71717a;
          font-size: 19px;
        }
      </style>
    </head>
    <body>
      <main class="frame">
        <header class="header">
          <div class="title-block">
            <div class="word">${escapeHtml(word)}</div>
          </div>
          <div class="brand-block">
            <div class="eyebrow">SketchBench Replay</div>
          </div>
        </header>
        <section class="grid">
          ${renderCard(leftRun, leftGame, leftSvg)}
          ${renderCard(rightRun, rightGame, rightSvg)}
        </section>
      </main>
    </body>
  </html>`;
}

async function generateReplaySharePreviews(runs) {
  if (!runs.length) return;

  const runSlugMap = buildRunSlugMap(runs);
  const wordBank = runs[0]?.wordBank || [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

  try {
    for (const word of wordBank) {
      const wordSlug = slugify(word);
      const wordDir = path.join(VISUALIZER_SHARE_PREVIEW_DIR, wordSlug);
      await fs.mkdir(wordDir, { recursive: true });

      for (const leftRun of runs) {
        for (const rightRun of runs) {
          if (leftRun.runId === rightRun.runId) continue;

          const leftGame = leftRun.games.find((game) => game.targetWord === word) || null;
          const rightGame = rightRun.games.find((game) => game.targetWord === word) || null;
          const [leftSvg, rightSvg] = await Promise.all([
            readReplaySvgMarkup(leftGame?.svgPath || null),
            readReplaySvgMarkup(rightGame?.svgPath || null),
          ]);

          const html = buildSharePreviewMarkup({
            word,
            leftRun,
            rightRun,
            leftGame,
            rightGame,
            leftSvg,
            rightSvg,
          });
          const leftSlug = runSlugMap.get(leftRun.runId) || leftRun.runId;
          const rightSlug = runSlugMap.get(rightRun.runId) || rightRun.runId;
          const outputPath = path.join(wordDir, `${leftSlug}__${rightSlug}.png`);

          await page.setContent(html, { waitUntil: "load" });
          await page.screenshot({ path: outputPath, type: "png" });
        }
      }
    }
  } finally {
    await browser.close();
  }
}

function toAbsoluteUrl(relativePath) {
  if (!SITE_URL) return `${BASE_PATH}${relativePath}`;
  return new URL(`${BASE_PATH}${relativePath}`, SITE_URL).toString();
}

async function writeReplayShareLandingPages(runs) {
  if (!runs.length) return;

  const runSlugMap = buildRunSlugMap(runs);
  const wordBank = runs[0]?.wordBank || [];
  const writeLandingPage = async ({ word, wordSlug, leftRun, rightRun = null }) => {
    const leftSlug = runSlugMap.get(leftRun.runId) || leftRun.runId;
    const rightSlug = rightRun ? runSlugMap.get(rightRun.runId) || rightRun.runId : null;
    const dirPath = rightSlug
      ? path.join(VISUALIZER_SHARE_HTML_DIR, wordSlug, leftSlug, rightSlug)
      : path.join(VISUALIZER_SHARE_HTML_DIR, wordSlug, leftSlug);
    const replayUrl = rightSlug
      ? `${BASE_PATH}/replay/?runA=${leftSlug}&runB=${rightSlug}&word=${wordSlug}`
      : `${BASE_PATH}/replay/?runA=${leftSlug}&word=${wordSlug}`;
    const imageQuery = rightSlug ? { word: wordSlug, runA: leftSlug, runB: rightSlug } : { word: wordSlug, runA: leftSlug };
    const imagePath = getSharePreviewImagePath(imageQuery);
    const pagePath = getSharePagePath(imageQuery);
    const title = rightRun
      ? `${word}: ${leftRun.model} vs ${rightRun.model}`
      : `${word}: ${leftRun.model}`;
    const description = rightRun
      ? `Compare how ${leftRun.model} and ${rightRun.model} drew "${word}" in SketchBench.`
      : `See how ${leftRun.model} drew "${word}" in SketchBench.`;
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${escapeHtml(toAbsoluteUrl(imagePath))}" />
    <meta property="og:url" content="${escapeHtml(toAbsoluteUrl(pagePath))}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(toAbsoluteUrl(imagePath))}" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(replayUrl)}" />
    <link rel="canonical" href="${escapeHtml(toAbsoluteUrl(pagePath))}" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #09090b;
        color: #fafafa;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        text-align: center;
        padding: 24px;
      }
      p { color: #a1a1aa; }
      a { color: #fafafa; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <a href="${escapeHtml(replayUrl)}">Open replay</a>
    </main>
  </body>
</html>`;

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, "index.html"), html, "utf8");
  };

  for (const word of wordBank) {
    const wordSlug = slugify(word);

    for (const leftRun of runs) {
      await writeLandingPage({ word, wordSlug, leftRun });

      for (const rightRun of runs) {
        if (leftRun.runId === rightRun.runId) continue;
        await writeLandingPage({ word, wordSlug, leftRun, rightRun });
      }
    }
  }
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
  await resetReplaySharePreviewDir();
  await resetReplayShareHtmlDir();
  const replay = {
    generatedAt: metadata.timestamp,
    runs: await buildReplayRuns(benchmarks, rankingByRunId),
  };
  await generateReplaySharePreviews(replay.runs);
  await writeReplayShareLandingPages(replay.runs);

  await fs.mkdir(VISUALIZER_DATA_DIR, { recursive: true });
  await fs.writeFile(BENCHMARK_OUTPUT_PATH, JSON.stringify({ rankings, metadata }, null, 2), "utf8");
  await fs.writeFile(REPLAY_OUTPUT_PATH, JSON.stringify(replay, null, 2), "utf8");

  console.log(`Wrote ${rankings.length} rankings to ${BENCHMARK_OUTPUT_PATH}`);
  console.log(`Wrote ${replay.runs.length} replay runs to ${REPLAY_OUTPUT_PATH}`);
}

await main();
