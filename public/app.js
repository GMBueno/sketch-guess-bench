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
    setStatus("Dashboard is read-only. Run benchmarks from code using /api/benchmarks/run with modelKey.");
  }
}

async function loadBenchmarks() {
  const response = await fetch("/api/benchmarks");
  benchmarks = await response.json();
  benchmarks.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  renderRankingTable();
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
    return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
  });

  for (const benchmark of sorted) {
    const row = benchmark.ranking?.[0];
    if (!row) continue;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(benchmark.completedAt).toLocaleString()}</td>
      <td>${row.modelLabel}</td>
      <td>${row.solvedCount}/${row.totalWords}</td>
      <td>${row.failedCount ?? 0}</td>
      <td>${row.totalGuesses}</td>
      <td>${row.averageGuesses}</td>
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
    option.textContent = run?.modelLabel || "Unknown model";
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
      const label = run?.modelLabel || "Unknown";
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
    title.textContent = `${run?.modelLabel || "Unknown"} - ${new Date(benchmark.completedAt).toLocaleString()}`;
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
