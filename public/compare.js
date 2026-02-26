const runASelect = document.getElementById("run-a");
const runBSelect = document.getElementById("run-b");
const runCSelect = document.getElementById("run-c");
const statusEl = document.getElementById("compare-status");
const compareTableHead = document.querySelector("#compare-table thead");
const compareTableBody = document.querySelector("#compare-table tbody");
const jpegModal = document.getElementById("jpeg-modal");
const jpegModalImage = document.getElementById("jpeg-modal-image");
const jpegModalClose = document.getElementById("jpeg-modal-close");

let benchmarks = [];

runASelect.addEventListener("change", renderComparison);
runBSelect.addEventListener("change", renderComparison);
runCSelect.addEventListener("change", renderComparison);

jpegModalClose.addEventListener("click", () => {
  jpegModal.close();
});

jpegModal.addEventListener("click", (event) => {
  if (event.target === jpegModal) {
    jpegModal.close();
  }
});

init();

async function init() {
  await loadBenchmarks();
  renderComparison();
}

async function loadBenchmarks() {
  const response = await fetch("/api/benchmarks");
  benchmarks = await response.json();
  benchmarks.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  fillRunSelect(runASelect, { optional: false });
  fillRunSelect(runBSelect, { optional: false });
  fillRunSelect(runCSelect, { optional: true });

  if (benchmarks.length > 0) runASelect.value = benchmarks[0].id;
  if (benchmarks.length > 1) runBSelect.value = benchmarks[1].id;
  else if (benchmarks.length > 0) runBSelect.value = benchmarks[0].id;
  runCSelect.value = "";
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
    option.textContent = `${new Date(benchmark.completedAt).toLocaleString()} - ${run?.modelLabel || "Unknown model"}`;
    select.append(option);
  }
}

function renderComparison() {
  const selectedRuns = getSelectedBenchmarks();

  if (selectedRuns.length < 2) {
    statusEl.textContent = "Select at least two runs.";
    compareTableHead.innerHTML = "";
    compareTableBody.innerHTML = "";
    return;
  }

  statusEl.textContent = "Click a row to expand run details.";

  renderHeader(selectedRuns);
  renderRows(selectedRuns);
}

function getSelectedBenchmarks() {
  const selectedIds = [runASelect.value, runBSelect.value, runCSelect.value].filter(Boolean);
  const seen = new Set();
  const selected = [];

  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const benchmark = benchmarks.find((item) => item.id === id);
    if (benchmark) selected.push(benchmark);
  }

  return selected;
}

function renderHeader(selectedRuns) {
  const columns = selectedRuns
    .map((benchmark) => {
      const run = benchmark.modelRuns?.[0];
      const label = run?.modelLabel || "Unknown";
      const time = new Date(benchmark.completedAt).toLocaleString();
      return `<th>${label}<br><small>${time}</small></th>`;
    })
    .join("");

  compareTableHead.innerHTML = `<tr><th>Target Word</th>${columns}</tr>`;
}

function renderRows(selectedRuns) {
  compareTableBody.innerHTML = "";

  const words = collectWords(selectedRuns);
  for (const word of words) {
    const summaryRow = document.createElement("tr");
    summaryRow.className = "compare-summary-row";
    summaryRow.innerHTML = `<td>${word}</td>${selectedRuns.map((run) => `<td>${formatScore(getGame(run, word))}</td>`).join("")}`;

    const detailsRow = document.createElement("tr");
    detailsRow.className = "compare-details-row";
    detailsRow.hidden = true;
    const detailsCell = document.createElement("td");
    detailsCell.colSpan = selectedRuns.length + 1;
    detailsCell.append(renderDetailsGrid(selectedRuns, word));
    detailsRow.append(detailsCell);

    summaryRow.addEventListener("click", () => {
      detailsRow.hidden = !detailsRow.hidden;
    });

    compareTableBody.append(summaryRow, detailsRow);
  }
}

function collectWords(selectedRuns) {
  const set = new Set();
  for (const benchmark of selectedRuns) {
    const run = benchmark.modelRuns?.[0];
    for (const game of run?.games || []) {
      set.add(game.targetWord);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function getGame(benchmark, targetWord) {
  const run = benchmark.modelRuns?.[0];
  return run?.games?.find((game) => game.targetWord === targetWord);
}

function formatScore(game) {
  if (!game) return "-";
  if (game.failed) return `failed (${game.penalizedGuesses})`;
  if (!game.solved) return `not solved (${game.penalizedGuesses})`;
  return `${game.guessesUsed}`;
}

function renderDetailsGrid(selectedRuns, word) {
  const grid = document.createElement("div");
  grid.className = "compare-detail-grid";

  for (const benchmark of selectedRuns) {
    const run = benchmark.modelRuns?.[0];
    const game = getGame(benchmark, word);

    const card = document.createElement("article");
    card.className = "compare-detail-card";

    const title = document.createElement("h3");
    title.textContent = `${run?.modelLabel || "Unknown"} - ${new Date(benchmark.completedAt).toLocaleString()}`;
    card.append(title);

    if (!game) {
      const empty = document.createElement("p");
      empty.textContent = "No data for this word.";
      card.append(empty);
      grid.append(card);
      continue;
    }

    const draw = game.turns?.find((turn) => turn.role === "draw");
    if (draw?.svg) {
      const preview = document.createElement("img");
      preview.className = "draw-preview";
      preview.alt = `${word} SVG`;
      preview.src = toSvgDataUrl(draw.svg);
      card.append(preview);

      const actions = document.createElement("div");
      actions.className = "draw-actions";
      const showJpegBtn = document.createElement("button");
      showJpegBtn.type = "button";
      showJpegBtn.textContent = "Show JPEG";
      showJpegBtn.disabled = !draw.jpgDataUrl;
      showJpegBtn.addEventListener("click", () => {
        if (!draw.jpgDataUrl) return;
        jpegModalImage.src = draw.jpgDataUrl;
        jpegModal.showModal();
      });
      actions.append(showJpegBtn);
      card.append(actions);
    }

    const guessTurns = game.turns?.filter((turn) => turn.role === "guess") || [];
    const guesses = document.createElement("ol");
    guesses.className = "compare-guesses";
    for (const turn of guessTurns) {
      const item = document.createElement("li");
      item.textContent = turn.correct ? `${turn.text} (correct)` : turn.text;
      guesses.append(item);
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
