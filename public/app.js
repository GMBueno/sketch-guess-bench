const statusEl = document.getElementById("status");
const progressPanel = document.getElementById("progress-panel");
const progressText = document.getElementById("progress-text");
const progressBar = document.getElementById("progress-bar");
const goRankingsBtn = document.getElementById("go-rankings");

const navButtons = [...document.querySelectorAll(".nav-btn")];
const STATIC_BENCHMARK_MODEL_KEYS = [
  "claudehaiku45",
  "gemini25flash",
  "gemini25flashlite",
  "gemini3flash",
  "gemini31flashlite",
  "gpt5mini",
  "gpt5nano",
  "gpt51codexmini",
  "kimik25"
];
const APP_BASE_PATH = getAppBasePath();
const ROUTE_TO_SCREEN = {
  "/": "home",
  "/rankings": "rankings",
  "/replays": "replay",
  "/about": "about"
};
const SCREEN_TO_ROUTE = {
  home: "/",
  rankings: "/rankings",
  replay: "/replays",
  about: "/about"
};
const screenEls = {
  home: document.getElementById("screen-home"),
  rankings: document.getElementById("screen-rankings"),
  replay: document.getElementById("screen-replay"),
  about: document.getElementById("screen-about")
};

const rankingBody = document.querySelector("#ranking-table tbody");
const costChartStatus = document.getElementById("cost-chart-status");
const costSolvedChart = document.getElementById("cost-solved-chart");

const compareStatusEl = document.getElementById("compare-status");
const compareTableHead = document.querySelector("#compare-table thead");
const compareTableBody = document.querySelector("#compare-table tbody");

const jpegModal = document.getElementById("jpeg-modal");
const jpegModalImage = document.getElementById("jpeg-modal-image");
const jpegModalClose = document.getElementById("jpeg-modal-close");

let benchmarks = [];
let progressPoller = null;
const replaySlots = [
  { slot: "A", active: true, runId: "" },
  { slot: "B", active: false, runId: "" },
  { slot: "C", active: false, runId: "" }
];

window.render_game_to_text = () => {
  const selected = getSelectedRuns();
  return JSON.stringify({
    mode: "replay-compare",
    selectedRunIds: selected.map((item) => item.benchmark.id)
  });
};

window.advanceTime = () => {};

for (const button of navButtons) {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    navigateToScreen(button.dataset.screen);
  });
}

goRankingsBtn.addEventListener("click", () => {
  navigateToScreen("rankings");
});

compareTableHead.addEventListener("click", handleReplayHeaderClick);
compareTableHead.addEventListener("change", handleReplayHeaderChange);

jpegModalClose.addEventListener("click", () => {
  jpegModal.close();
});

jpegModal.addEventListener("click", (event) => {
  if (event.target === jpegModal) jpegModal.close();
});

init();

async function init() {
  updateNavLinks();
  await fetchStatus();
  await loadBenchmarks();
  await refreshProgressOnce();

  const progress = await fetchProgress();
  if (progress?.status === "running") {
    startProgressPolling();
  }

  switchScreen(getScreenFromPath(location.pathname));
}

function navigateToScreen(name) {
  const route = toAppPath(SCREEN_TO_ROUTE[name] || "/");
  if (location.pathname !== route) {
    history.pushState({ screen: name }, "", route);
  }
  switchScreen(name);
}

function getScreenFromPath(pathname) {
  const withoutBase = stripBasePath(pathname);
  const normalizedPath = withoutBase === "/" ? "/" : withoutBase.replace(/\/+$/, "");
  return ROUTE_TO_SCREEN[normalizedPath] || "home";
}

window.addEventListener("popstate", () => {
  switchScreen(getScreenFromPath(location.pathname));
});

function switchScreen(name) {
  for (const [key, el] of Object.entries(screenEls)) {
    el.hidden = key !== name;
  }

  for (const button of navButtons) {
    button.classList.toggle("active", button.dataset.screen === name);
  }
}

async function fetchStatus() {
  const data = await fetchJson("/api/status");
  if (!data) {
    setStatus("");
    return;
  }

  setStatus(data.hasApiKey ? "" : "OPENROUTER_API_KEY missing.");
}

async function loadBenchmarks() {
  const apiBenchmarks = await fetchJson("/api/benchmarks");
  benchmarks = Array.isArray(apiBenchmarks) ? apiBenchmarks : await loadStaticBenchmarks();
  benchmarks.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  renderRankingTable();
  renderSolvedVsCostChart();
  initializeReplaySlots();
  renderReplayComparison();
}

function renderRankingTable() {
  rankingBody.innerHTML = "";

  const sorted = [...benchmarks].sort((a, b) => {
    const rowA = a.ranking?.[0];
    const rowB = b.ranking?.[0];
    const solvedA = Number(rowA?.solvedCount || 0);
    const solvedB = Number(rowB?.solvedCount || 0);
    if (solvedB !== solvedA) return solvedB - solvedA;
    const guessesA = Number(rowA?.totalGuesses || Number.POSITIVE_INFINITY);
    const guessesB = Number(rowB?.totalGuesses || Number.POSITIVE_INFINITY);
    if (guessesA !== guessesB) return guessesA - guessesB;
    const costA = Number(getBenchmarkCostUsd(a));
    const costB = Number(getBenchmarkCostUsd(b));
    if (Number.isFinite(costA) && Number.isFinite(costB) && costA !== costB) return costA - costB;
    return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
  });

  for (const benchmark of sorted) {
    const row = benchmark.ranking?.[0];
    if (!row) continue;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(benchmark.completedAt).toLocaleString()}</td>
      <td>${formatModelWithEffort(row.modelLabel, row.effort, benchmark?.modelRuns?.[0]?.modelId)}</td>
      <td>${row.solvedCount}/${row.totalWords}</td>
      <td>${formatUsd(getBenchmarkCostUsd(benchmark))}</td>
      <td>${formatDuration(getBenchmarkRequestMs(benchmark))}</td>
      <td>${row.totalGuesses}</td>
      <td>${row.averageGuesses}</td>
      <td>${row.failedCount ?? 0}</td>
    `;
    rankingBody.append(tr);
  }
}

function getSelectedRuns() {
  return replaySlots
    .filter((slot) => slot.active && slot.runId)
    .map((slot) => {
      const benchmark = benchmarks.find((entry) => entry.id === slot.runId);
      if (!benchmark) return null;
      return { slot: slot.slot, benchmark };
    })
    .filter(Boolean);
}

function renderReplayComparison() {
  const selected = getSelectedRuns();
  renderReplayHeader();

  if (selected.length === 0) {
    compareStatusEl.textContent = "Select at least one run in the header.";
    compareTableBody.innerHTML = "";
    return;
  }

  compareStatusEl.textContent = "Click a word row to expand drawings and guesses.";
  renderReplayRows(selected);
}

function renderReplayHeader() {
  const usedRunIds = new Set(
    replaySlots.filter((slot) => slot.active && slot.runId).map((slot) => slot.runId)
  );
  const columns = replaySlots.map((slot) => {
    if (!slot.active) {
      return `<th class="compare-add-col"><button type="button" class="add-run-btn" data-action="add" data-slot="${slot.slot}">+ Add Run</button></th>`;
    }

    const benchmark = benchmarks.find((entry) => entry.id === slot.runId) || null;
    const run = benchmark?.modelRuns?.[0];
    const label = formatModelWithEffort(run?.modelLabel || "Select a run", run?.effort, run?.modelId);
    const time = benchmark ? new Date(benchmark.completedAt).toLocaleString() : "No run selected";
    const options = buildReplaySelectOptions(slot, usedRunIds);
    const removeDisabled = replaySlots.filter((item) => item.active).length <= 1;
    const removeButton = removeDisabled
      ? ""
      : `<button type="button" class="remove-run-btn" data-action="remove" data-slot="${slot.slot}" aria-label="Remove Run ${slot.slot}">X</button>`;

    return `<th class="compare-run-col">
      <div class="run-header-top">
        <span class="run-slot">Run ${slot.slot}</span>
        ${removeButton}
      </div>
      <select class="header-run-select" data-action="select" data-slot="${slot.slot}">
        ${options}
      </select>
      <small>${label}<br>${time}</small>
    </th>`;
  }).join("");

  compareTableHead.innerHTML = `<tr><th>Target Word</th>${columns}</tr>`;
}

function renderReplayRows(selected) {
  compareTableBody.innerHTML = "";

  const words = collectWords(selected);
  for (const word of words) {
    const summaryRow = document.createElement("tr");
    summaryRow.className = "compare-summary-row";
    summaryRow.innerHTML = `<td>${word}</td>${selected.map((selectedRun) => `<td>${formatScore(getGame(selectedRun.benchmark, word))}</td>`).join("")}`;

    const detailsRow = document.createElement("tr");
    detailsRow.className = "compare-details-row";
    detailsRow.hidden = true;

    const detailsCell = document.createElement("td");
    detailsCell.colSpan = selected.length + 1;
    detailsCell.append(renderDetailsGrid(selected, word));
    detailsRow.append(detailsCell);

    summaryRow.addEventListener("click", () => {
      detailsRow.hidden = !detailsRow.hidden;
    });

    compareTableBody.append(summaryRow, detailsRow);
  }
}

function initializeReplaySlots() {
  const availableIds = new Set(benchmarks.map((benchmark) => benchmark.id));
  for (const slot of replaySlots) {
    if (slot.runId && !availableIds.has(slot.runId)) {
      slot.runId = "";
    }
  }

  const activeCount = replaySlots.filter((slot) => slot.active).length;
  if (activeCount === 0) {
    replaySlots[0].active = true;
  }

  if (!replaySlots[0].runId && benchmarks.length > 0) {
    replaySlots[0].runId = getBestReplayBenchmarkId();
  }
}

function getBestReplayBenchmarkId() {
  if (benchmarks.length === 0) return "";
  const sorted = [...benchmarks].sort((a, b) => {
    const rowA = a.ranking?.[0];
    const rowB = b.ranking?.[0];
    const solvedA = Number(rowA?.solvedCount || 0);
    const solvedB = Number(rowB?.solvedCount || 0);
    if (solvedB !== solvedA) return solvedB - solvedA;
    const guessesA = Number(rowA?.totalGuesses || Number.POSITIVE_INFINITY);
    const guessesB = Number(rowB?.totalGuesses || Number.POSITIVE_INFINITY);
    if (guessesA !== guessesB) return guessesA - guessesB;
    return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
  });
  return sorted[0]?.id || "";
}

function buildReplaySelectOptions(slot, usedRunIds) {
  const options = [];
  options.push(`<option value="">Select run...</option>`);
  for (const benchmark of benchmarks) {
    const run = benchmark.modelRuns?.[0];
    const label = formatModelWithEffort(run?.modelLabel || "Unknown model", run?.effort, run?.modelId);
    const selected = benchmark.id === slot.runId;
    const disabled = !selected && usedRunIds.has(benchmark.id);
    options.push(
      `<option value="${benchmark.id}"${selected ? " selected" : ""}${disabled ? " disabled" : ""}>${label}</option>`
    );
  }
  return options.join("");
}

function handleReplayHeaderClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const slot = button.dataset.slot;
  if (!slot) return;
  const targetSlot = replaySlots.find((item) => item.slot === slot);
  if (!targetSlot) return;

  if (action === "add") {
    targetSlot.active = true;
    if (!targetSlot.runId) {
      const used = new Set(replaySlots.filter((item) => item.active).map((item) => item.runId).filter(Boolean));
      const candidate = benchmarks.find((benchmark) => !used.has(benchmark.id));
      targetSlot.runId = candidate?.id || "";
    }
    renderReplayComparison();
    return;
  }

  if (action === "remove") {
    const activeSlots = replaySlots.filter((item) => item.active);
    if (activeSlots.length <= 1) return;
    targetSlot.active = false;
    targetSlot.runId = "";
    renderReplayComparison();
  }
}

function handleReplayHeaderChange(event) {
  const select = event.target.closest("select[data-action='select']");
  if (!select) return;
  const slot = select.dataset.slot;
  const targetSlot = replaySlots.find((item) => item.slot === slot);
  if (!targetSlot) return;
  targetSlot.runId = select.value || "";
  renderReplayComparison();
}

function collectWords(selected) {
  const words = new Set();
  for (const selectedRun of selected) {
    const run = selectedRun.benchmark.modelRuns?.[0];
    for (const game of run?.games || []) {
      words.add(game.targetWord);
    }
  }
  return [...words].sort((a, b) => a.localeCompare(b));
}

function getGame(benchmark, word) {
  const run = benchmark.modelRuns?.[0];
  return run?.games?.find((game) => game.targetWord === word);
}

function formatScore(game) {
  if (!game) return "-";
  if (game.failed) return `failed (${game.penalizedGuesses})`;
  if (!game.solved) return `not solved (${game.penalizedGuesses})`;
  return `${game.guessesUsed}`;
}

function renderDetailsGrid(selected, word) {
  const grid = document.createElement("div");
  grid.className = "compare-detail-grid";

  for (const selectedRun of selected) {
    const run = selectedRun.benchmark.modelRuns?.[0];
    const game = getGame(selectedRun.benchmark, word);

    const card = document.createElement("article");
    card.className = "compare-detail-card";

    const title = document.createElement("h3");
    title.textContent = `Run ${selectedRun.slot} · ${formatModelWithEffort(run?.modelLabel || "Unknown", run?.effort, run?.modelId)} - ${new Date(selectedRun.benchmark.completedAt).toLocaleString()}`;
    card.append(title);

    if (!game) {
      const p = document.createElement("p");
      p.textContent = "No data for this word.";
      card.append(p);
      grid.append(card);
      continue;
    }

    const draw = game.turns?.find((turn) => turn.role === "draw");
    if (draw?.svg) {
      const svgImg = document.createElement("img");
      svgImg.className = "draw-preview";
      svgImg.alt = `${word} SVG`;
      svgImg.src = toSvgDataUrl(draw.svg);
      if (draw.jpgDataUrl) {
        svgImg.classList.add("clickable");
        svgImg.title = "Click to view JPEG";
        svgImg.addEventListener("click", () => {
          jpegModalImage.src = draw.jpgDataUrl;
          jpegModal.showModal();
        });
      }
      card.append(svgImg);
    }

    const guessTurns = game.turns?.filter((turn) => turn.role === "guess") || [];
    const guesses = document.createElement("ol");
    guesses.className = "compare-guesses";
    for (const turn of guessTurns) {
      const li = document.createElement("li");
      li.textContent = turn.correct ? `${turn.text} (correct)` : turn.text;
      guesses.append(li);
    }
    card.append(guesses);

    grid.append(card);
  }

  return grid;
}

function toSvgDataUrl(svg) {
  if (!svg) return "";
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function getBenchmarkCostUsd(benchmark) {
  const row = benchmark?.ranking?.[0];
  if (hasCostTelemetry(row)) {
    const rowCost = Number(row?.totalCostUsd);
    if (Number.isFinite(rowCost)) return rowCost;
  }

  const run = benchmark?.modelRuns?.[0];
  if (hasCostTelemetry(run)) {
    const runCost = Number(run?.totalCostUsd);
    if (Number.isFinite(runCost)) return runCost;
  }

  return NaN;
}

function formatUsd(value) {
  const cost = ceilToCent(value);
  if (!Number.isFinite(cost)) return "n/a";
  return `$${cost.toFixed(2)}`;
}

function getBenchmarkRequestMs(benchmark) {
  const rowMsRaw = benchmark?.ranking?.[0]?.totalRequestMs;
  if (rowMsRaw !== null && rowMsRaw !== undefined) {
    const rowMs = Number(rowMsRaw);
    if (Number.isFinite(rowMs)) return rowMs;
  }
  const runMsRaw = benchmark?.modelRuns?.[0]?.totalRequestMs;
  if (runMsRaw !== null && runMsRaw !== undefined) {
    const runMs = Number(runMsRaw);
    if (Number.isFinite(runMs)) return runMs;
  }
  return NaN;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "n/a";
  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function renderSolvedVsCostChart() {
  const points = benchmarks
    .map((benchmark) => {
      const row = benchmark?.ranking?.[0];
      const solved = Number(row?.solvedCount);
      const cost = ceilToCent(getBenchmarkCostUsd(benchmark));
      if (!Number.isFinite(solved) || !Number.isFinite(cost)) return null;
      return {
        id: benchmark.id,
        label: formatModelWithEffort(row?.modelLabel || "Unknown model", row?.effort, benchmark?.modelRuns?.[0]?.modelId),
        solved,
        cost
      };
    })
    .filter(Boolean);

  if (points.length === 0) {
    costChartStatus.textContent = "No cost data yet. New runs with response traces will populate this chart.";
    costSolvedChart.innerHTML = "";
    return;
  }

  const minCost = Math.min(...points.map((point) => point.cost));
  const maxCost = Math.max(...points.map((point) => point.cost));
  const minSolved = 0;
  const maxSolved = Math.max(...points.map((point) => point.solved), 1);
  const plot = { left: 64, top: 20, width: 660, height: 250 };
  const xRange = Math.max(maxCost - minCost, 1e-9);
  const yRange = Math.max(maxSolved - minSolved, 1);

  const xAt = (value) => plot.left + ((value - minCost) / xRange) * plot.width;
  const yAt = (value) => plot.top + plot.height - ((value - minSolved) / yRange) * plot.height;

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => minCost + xRange * ratio);
  const yTicks = Array.from({ length: 6 }, (_, i) => minSolved + (yRange * i) / 5);

  const grid = [
    ...xTicks.map((tick) => `<line x1="${xAt(tick)}" y1="${plot.top}" x2="${xAt(tick)}" y2="${plot.top + plot.height}" stroke="#edf2ef"/>`),
    ...yTicks.map((tick) => `<line x1="${plot.left}" y1="${yAt(tick)}" x2="${plot.left + plot.width}" y2="${yAt(tick)}" stroke="#edf2ef"/>`)
  ].join("");

  const labels = [
    ...xTicks.map((tick) => `<text x="${xAt(tick)}" y="${plot.top + plot.height + 20}" text-anchor="middle" font-size="11" fill="#4f6179">${tick.toFixed(2)}</text>`),
    ...yTicks.map((tick) => `<text x="${plot.left - 10}" y="${yAt(tick) + 4}" text-anchor="end" font-size="11" fill="#4f6179">${Math.round(tick)}</text>`)
  ].join("");

  const dots = points.map((point) => {
    const x = xAt(point.cost);
    const y = yAt(point.solved);
    const title = `${point.label}: solved ${point.solved}, cost $${point.cost.toFixed(2)}`;
    return `<circle cx="${x}" cy="${y}" r="5" fill="#0a7c86"><title>${title}</title></circle>`;
  }).join("");

  costSolvedChart.innerHTML = `
    <line x1="${plot.left}" y1="${plot.top + plot.height}" x2="${plot.left + plot.width}" y2="${plot.top + plot.height}" stroke="#9fb0bd"/>
    <line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.top + plot.height}" stroke="#9fb0bd"/>
    ${grid}
    ${labels}
    ${dots}
    <text x="${plot.left + plot.width / 2}" y="${plot.top + plot.height + 42}" text-anchor="middle" font-size="12" fill="#263753">Cost (USD)</text>
    <text x="18" y="${plot.top + plot.height / 2}" text-anchor="middle" font-size="12" fill="#263753" transform="rotate(-90 18 ${plot.top + plot.height / 2})">Solved</text>
  `;
  costChartStatus.textContent = `${points.length} run${points.length === 1 ? "" : "s"} plotted.`;
}

function formatModelWithEffort(modelLabel, effort, modelId) {
  const safeLabel = modelLabel || "Unknown model";
  const safeEffort = typeof effort === "string" ? effort.trim() : "";
  if (supportsEffortModelId(modelId) && safeEffort) {
    return `${safeLabel} (${safeEffort})`;
  }
  if (isGemini3FlashModelId(modelId)) {
    return `${safeLabel} (${safeEffort || "dynamic"})`;
  }
  return safeLabel;
}

function ceilToCent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.ceil(number * 100) / 100;
}

function hasCostTelemetry(record) {
  if (!record || typeof record !== "object") return false;
  const totalRequests = Number(record.totalRequests || 0);
  const pricedRequests = Number(record.pricedRequests || 0);
  const missingPriceRequests = Number(record.missingPriceRequests || 0);
  return totalRequests > 0 || pricedRequests > 0 || missingPriceRequests > 0;
}

function supportsEffortModelId(modelId) {
  if (typeof modelId !== "string") return false;
  if (modelId.startsWith("openai/")) return true;
  return modelId === "google/gemini-3.1-flash-lite-preview";
}

function isGemini3FlashModelId(modelId) {
  return modelId === "google/gemini-3-flash-preview";
}

function startProgressPolling() {
  if (progressPoller) return;
  progressPanel.hidden = false;
  progressPoller = setInterval(refreshProgressOnce, 1000);
}

async function refreshProgressOnce() {
  const progress = await fetchProgress();
  if (!progress) return;
  renderProgress(progress);
}

async function fetchProgress() {
  try {
    const response = await fetch(toAppPath("/api/benchmarks/progress"));
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchJson(path) {
  try {
    const response = await fetch(toAppPath(path));
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function loadStaticBenchmarks() {
  const files = await Promise.all(
    STATIC_BENCHMARK_MODEL_KEYS.map(async (modelKey) => {
      try {
        const response = await fetch(toAppPath(`/data/benchmarks/${modelKey}.json`));
        if (!response.ok) return [];
        const parsed = await response.json();
        return Array.isArray(parsed?.benchmarks) ? parsed.benchmarks : [];
      } catch {
        return [];
      }
    })
  );
  return files.flat();
}

function getAppBasePath() {
  if (!location.hostname.endsWith("github.io")) return "";
  const parts = location.pathname.split("/").filter(Boolean);
  return parts.length > 0 ? `/${parts[0]}` : "";
}

function stripBasePath(pathname) {
  if (!APP_BASE_PATH) return pathname || "/";
  if (pathname === APP_BASE_PATH) return "/";
  if (pathname.startsWith(`${APP_BASE_PATH}/`)) {
    return pathname.slice(APP_BASE_PATH.length) || "/";
  }
  return pathname || "/";
}

function toAppPath(path) {
  if (!path || path === "/") return APP_BASE_PATH || "/";
  return `${APP_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

function updateNavLinks() {
  for (const button of navButtons) {
    const screen = button.dataset.screen;
    const route = SCREEN_TO_ROUTE[screen] || "/";
    button.setAttribute("href", toAppPath(route));
  }
}

function renderProgress(progress) {
  if (!progress || progress.status === "idle") {
    progressPanel.hidden = true;
    progressText.textContent = "";
    progressBar.style.width = "0%";
    return;
  }

  progressPanel.hidden = false;
  const completed = Number(progress.completedGames || 0);
  const total = Number(progress.totalGames || 0);
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  progressBar.style.width = `${percent}%`;

  if (progress.status === "running") {
    const active = progress.activeModel && progress.activeWord
      ? ` | running: ${progress.activeModel} / ${progress.activeWord}`
      : "";
    progressText.textContent = `Progress: ${completed}/${total} (${percent.toFixed(1)}%) | failed: ${progress.failedGames || 0}${active}`;
    return;
  }

  if (progress.status === "failed") {
    progressText.textContent = `Failed at ${completed}/${total}. Error: ${progress.error || "unknown error"}`;
    return;
  }

  progressText.textContent = `Completed: ${completed}/${total} (${percent.toFixed(1)}%) | failed: ${progress.failedGames || 0}`;
}
