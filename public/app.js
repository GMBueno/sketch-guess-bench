const statusEl = document.getElementById("status");
const progressPanel = document.getElementById("progress-panel");
const progressText = document.getElementById("progress-text");
const progressBar = document.getElementById("progress-bar");
const goRankingsBtn = document.getElementById("go-rankings");

const navButtons = [...document.querySelectorAll(".nav-btn")];
const screenEls = {
  home: document.getElementById("screen-home"),
  rankings: document.getElementById("screen-rankings"),
  replay: document.getElementById("screen-replay"),
  about: document.getElementById("screen-about")
};

const rankingBody = document.querySelector("#ranking-table tbody");
const costChartStatus = document.getElementById("cost-chart-status");
const costSolvedChart = document.getElementById("cost-solved-chart");

const runASelect = document.getElementById("run-a");
const runBSelect = document.getElementById("run-b");
const runCSelect = document.getElementById("run-c");
const compareStatusEl = document.getElementById("compare-status");
const compareTableHead = document.querySelector("#compare-table thead");
const compareTableBody = document.querySelector("#compare-table tbody");

const jpegModal = document.getElementById("jpeg-modal");
const jpegModalImage = document.getElementById("jpeg-modal-image");
const jpegModalClose = document.getElementById("jpeg-modal-close");

let benchmarks = [];
let progressPoller = null;

window.render_game_to_text = () => {
  const selected = getSelectedBenchmarks();
  return JSON.stringify({
    mode: "replay-compare",
    selectedRunIds: selected.map((item) => item.id)
  });
};

window.advanceTime = () => {};

for (const button of navButtons) {
  button.addEventListener("click", () => {
    switchScreen(button.dataset.screen);
  });
}

goRankingsBtn.addEventListener("click", () => {
  switchScreen("rankings");
});

runASelect.addEventListener("change", renderReplayComparison);
runBSelect.addEventListener("change", renderReplayComparison);
runCSelect.addEventListener("change", renderReplayComparison);

jpegModalClose.addEventListener("click", () => {
  jpegModal.close();
});

jpegModal.addEventListener("click", (event) => {
  if (event.target === jpegModal) jpegModal.close();
});

init();

async function init() {
  await fetchStatus();
  await loadBenchmarks();
  await refreshProgressOnce();

  const progress = await fetchProgress();
  if (progress?.status === "running") {
    startProgressPolling();
  }

  switchScreen("home");
}

function switchScreen(name) {
  for (const [key, el] of Object.entries(screenEls)) {
    el.hidden = key !== name;
  }

  for (const button of navButtons) {
    button.classList.toggle("active", button.dataset.screen === name);
  }
}

async function fetchStatus() {
  const response = await fetch("/api/status");
  const data = await response.json();

  if (!data.hasApiKey) {
    setStatus("OPENROUTER_API_KEY missing.");
  } else {
    setStatus("");
  }
}

async function loadBenchmarks() {
  const response = await fetch("/api/benchmarks");
  benchmarks = await response.json();
  benchmarks.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  renderRankingTable();
  renderSolvedVsCostChart();
  fillRunSelect(runASelect, { optional: false });
  fillRunSelect(runBSelect, { optional: true });
  fillRunSelect(runCSelect, { optional: true });

  if (benchmarks.length > 0) runASelect.value = benchmarks[0].id;
  runBSelect.value = "";
  runCSelect.value = "";

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
      <td>${formatModelWithEffort(row.modelLabel, row.effort)}</td>
      <td>${row.solvedCount}/${row.totalWords}</td>
      <td>${row.failedCount ?? 0}</td>
      <td>${row.totalGuesses}</td>
      <td>${row.averageGuesses}</td>
      <td>${formatUsd(getBenchmarkCostUsd(benchmark))}</td>
    `;
    rankingBody.append(tr);
  }
}

function fillRunSelect(select, { optional }) {
  select.innerHTML = "";

  if (optional) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "None";
    select.append(none);
  }

  for (const benchmark of benchmarks) {
    const run = benchmark.modelRuns?.[0];
    const option = document.createElement("option");
    option.value = benchmark.id;
    option.textContent = formatModelWithEffort(run?.modelLabel || "Unknown model", run?.effort);
    select.append(option);
  }
}

function getSelectedBenchmarks() {
  const selectedIds = [runASelect.value, runBSelect.value, runCSelect.value].filter(Boolean);
  const uniqueIds = [...new Set(selectedIds)];
  return uniqueIds
    .map((id) => benchmarks.find((benchmark) => benchmark.id === id))
    .filter(Boolean);
}

function renderReplayComparison() {
  const selected = getSelectedBenchmarks();

  if (selected.length === 0) {
    compareStatusEl.textContent = "Select at least one run.";
    compareTableHead.innerHTML = "";
    compareTableBody.innerHTML = "";
    return;
  }

  compareStatusEl.textContent = "Click a word row to expand drawings and guesses.";
  renderReplayHeader(selected);
  renderReplayRows(selected);
}

function renderReplayHeader(selected) {
  const columns = selected
    .map((benchmark) => {
      const run = benchmark.modelRuns?.[0];
      const label = formatModelWithEffort(run?.modelLabel || "Unknown", run?.effort);
      const time = new Date(benchmark.completedAt).toLocaleString();
      return `<th>${label}<br><small>${time}</small></th>`;
    })
    .join("");

  compareTableHead.innerHTML = `<tr><th>Target Word</th>${columns}</tr>`;
}

function renderReplayRows(selected) {
  compareTableBody.innerHTML = "";

  const words = collectWords(selected);
  for (const word of words) {
    const summaryRow = document.createElement("tr");
    summaryRow.className = "compare-summary-row";
    summaryRow.innerHTML = `<td>${word}</td>${selected.map((benchmark) => `<td>${formatScore(getGame(benchmark, word))}</td>`).join("")}`;

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

function collectWords(selected) {
  const words = new Set();
  for (const benchmark of selected) {
    const run = benchmark.modelRuns?.[0];
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

  for (const benchmark of selected) {
    const run = benchmark.modelRuns?.[0];
    const game = getGame(benchmark, word);

    const card = document.createElement("article");
    card.className = "compare-detail-card";

    const title = document.createElement("h3");
    title.textContent = `${formatModelWithEffort(run?.modelLabel || "Unknown", run?.effort)} - ${new Date(benchmark.completedAt).toLocaleString()}`;
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

function renderSolvedVsCostChart() {
  const points = benchmarks
    .map((benchmark) => {
      const row = benchmark?.ranking?.[0];
      const solved = Number(row?.solvedCount);
      const cost = ceilToCent(getBenchmarkCostUsd(benchmark));
      if (!Number.isFinite(solved) || !Number.isFinite(cost)) return null;
      return {
        id: benchmark.id,
        label: formatModelWithEffort(row?.modelLabel || "Unknown model", row?.effort),
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

function formatModelWithEffort(modelLabel, effort) {
  const safeLabel = modelLabel || "Unknown model";
  const safeEffort = effort || "medium";
  return `${safeLabel} (${safeEffort})`;
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
    const response = await fetch("/api/benchmarks/progress");
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
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
