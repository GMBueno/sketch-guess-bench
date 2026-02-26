const runBtn = document.getElementById("run-benchmark");
const statusEl = document.getElementById("status");
const benchmarkSelect = document.getElementById("benchmark-select");
const rankingBody = document.querySelector("#ranking-table tbody");
const modelSelect = document.getElementById("model-select");
const wordSelect = document.getElementById("word-select");
const replaySummary = document.getElementById("replay-summary");
const replayVisuals = document.getElementById("replay-visuals");
const replayTurns = document.getElementById("replay-turns");
const progressPanel = document.getElementById("progress-panel");
const progressText = document.getElementById("progress-text");
const progressBar = document.getElementById("progress-bar");
const jpegModal = document.getElementById("jpeg-modal");
const jpegModalImage = document.getElementById("jpeg-modal-image");
const jpegModalClose = document.getElementById("jpeg-modal-close");

let benchmarks = [];
let progressPoller = null;

window.render_game_to_text = () => {
  const activeBenchmark = findActiveBenchmark();
  if (!activeBenchmark) {
    return JSON.stringify({ mode: "idle", message: "No benchmark loaded" });
  }

  const run = activeBenchmark.modelRuns.find((item) => item.modelKey === modelSelect.value);
  const game = run?.games.find((item) => item.targetWord === wordSelect.value);

  return JSON.stringify({
    mode: "replay",
    benchmarkId: activeBenchmark.id,
    model: run?.modelLabel,
    targetWord: game?.targetWord,
    solved: game?.solved,
    turns: game?.turns || []
  });
};

window.advanceTime = () => {};

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  setStatus("Running benchmark... this may take a few minutes.");
  startProgressPolling();

  try {
    const response = await fetch("/api/benchmarks/run", { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to run benchmark");
    }

    await refreshProgressOnce();
    setStatus(`Benchmark completed: ${new Date(data.completedAt).toLocaleString()}`);
    await loadBenchmarks(data.id);
  } catch (err) {
    await refreshProgressOnce();
    setStatus(`Error: ${err.message}`);
  } finally {
    stopProgressPolling();
    runBtn.disabled = false;
  }
});

benchmarkSelect.addEventListener("change", () => {
  renderSelectedBenchmark();
});

modelSelect.addEventListener("change", () => {
  renderWords();
  renderReplay();
});

wordSelect.addEventListener("change", () => {
  renderReplay();
});

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
  await fetchStatus();
  await loadBenchmarks();
  await refreshProgressOnce();
  const progress = await fetchProgress();
  if (progress?.status === "running") {
    runBtn.disabled = true;
    startProgressPolling();
  }
}

async function fetchStatus() {
  const response = await fetch("/api/status");
  const data = await response.json();

  if (!data.hasApiKey) {
    setStatus("OPENROUTER_API_KEY missing. Set it before running benchmarks.");
  } else {
    setStatus(`Ready. Provider fixed as: ${JSON.stringify(data.provider)}`);
  }
}

async function loadBenchmarks(selectedId) {
  const response = await fetch("/api/benchmarks");
  benchmarks = await response.json();

  benchmarkSelect.innerHTML = "";

  if (benchmarks.length === 0) {
    benchmarkSelect.innerHTML = `<option value="">No runs yet</option>`;
    rankingBody.innerHTML = "";
    replaySummary.textContent = "No replay data yet.";
    replayVisuals.innerHTML = "";
    replayTurns.innerHTML = "";
    return;
  }

  for (const benchmark of benchmarks) {
    const option = document.createElement("option");
    option.value = benchmark.id;
    option.textContent = `${new Date(benchmark.completedAt).toLocaleString()} - ${benchmark.wordBank.length} words`;
    benchmarkSelect.append(option);
  }

  benchmarkSelect.value = selectedId || benchmarks[0].id;
  renderSelectedBenchmark();
}

function renderSelectedBenchmark() {
  const benchmark = findActiveBenchmark();
  if (!benchmark) return;

  rankingBody.innerHTML = "";

  for (const row of benchmark.ranking) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.rank}</td>
      <td>${row.modelLabel}</td>
      <td>${row.solvedCount}/${row.totalWords}</td>
      <td>${row.failedCount ?? 0}</td>
      <td>${row.totalGuesses}</td>
      <td>${row.averageGuesses}</td>
    `;
    rankingBody.append(tr);
  }

  renderModels();
  renderWords();
  renderReplay();
}

function renderModels() {
  const benchmark = findActiveBenchmark();
  if (!benchmark) return;

  const prev = modelSelect.value;
  modelSelect.innerHTML = "";

  for (const run of benchmark.modelRuns) {
    const option = document.createElement("option");
    option.value = run.modelKey;
    option.textContent = `${run.modelLabel} (${run.modelId})`;
    modelSelect.append(option);
  }

  modelSelect.value = prev && benchmark.modelRuns.some((run) => run.modelKey === prev)
    ? prev
    : benchmark.modelRuns[0].modelKey;
}

function renderWords() {
  const benchmark = findActiveBenchmark();
  const run = benchmark?.modelRuns.find((item) => item.modelKey === modelSelect.value);
  if (!run) return;

  const prev = wordSelect.value;
  wordSelect.innerHTML = "";

  for (const game of run.games) {
    const option = document.createElement("option");
    option.value = game.targetWord;
    option.textContent = `${game.targetWord} (${game.solved ? `solved in ${game.guessesUsed}` : "not solved"})`;
    wordSelect.append(option);
  }

  wordSelect.value = prev && run.games.some((game) => game.targetWord === prev)
    ? prev
    : run.games[0].targetWord;
}

function renderReplay() {
  const benchmark = findActiveBenchmark();
  if (!benchmark) return;

  const run = benchmark.modelRuns.find((item) => item.modelKey === modelSelect.value);
  if (!run) return;

  const game = run.games.find((item) => item.targetWord === wordSelect.value);
  if (!game) return;

  replaySummary.textContent = [
    `Model: ${run.modelLabel}`,
    `Target: ${game.targetWord}`,
    `Solved: ${game.solved ? "yes" : "no"}`,
    `Guesses used: ${game.guessesUsed}`,
    `Penalized guesses: ${game.penalizedGuesses}`
  ].join(" | ");

  replayVisuals.innerHTML = "";
  replayTurns.innerHTML = "";

  for (const turn of game.turns) {
    if (turn.role === "draw" && turn.svg) {
      const card = document.createElement("article");
      card.className = "draw-card";

      const heading = document.createElement("h3");
      heading.textContent = `Turn ${turn.turnNumber} drawing`;
      card.append(heading);

      const previewRow = document.createElement("div");
      previewRow.className = "draw-preview-row";

      const svgImg = document.createElement("img");
      svgImg.className = "draw-preview";
      svgImg.alt = `Turn ${turn.turnNumber} SVG`;
      svgImg.src = toSvgDataUrl(turn.svg);
      previewRow.append(svgImg);

      const actions = document.createElement("div");
      actions.className = "draw-actions";
      const showJpegBtn = document.createElement("button");
      showJpegBtn.type = "button";
      showJpegBtn.textContent = "Show JPEG";
      showJpegBtn.disabled = !turn.jpgDataUrl;
      showJpegBtn.addEventListener("click", () => {
        if (!turn.jpgDataUrl) return;
        jpegModalImage.src = turn.jpgDataUrl;
        jpegModal.showModal();
      });
      actions.append(showJpegBtn);

      card.append(previewRow);
      card.append(actions);

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "SVG source";
      details.append(summary);

      const pre = document.createElement("pre");
      pre.textContent = turn.svg;
      details.append(pre);
      card.append(details);
      replayVisuals.append(card);
    }

    const li = document.createElement("li");
    if (turn.role === "guess") {
      const suffix = turn.correct === true ? " (correct)" : "";
      li.textContent = `Turn ${turn.turnNumber} - GUESS: ${turn.text}${suffix}`;
    } else if (turn.role === "draw") {
      li.textContent = `Turn ${turn.turnNumber} - DRAW: SVG rendered to JPEG for guesser`;
    } else {
      li.textContent = `Turn ${turn.turnNumber} - ${turn.role.toUpperCase()}: ${turn.text || ""}`;
    }
    replayTurns.append(li);
  }
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

function findActiveBenchmark() {
  return benchmarks.find((item) => item.id === benchmarkSelect.value);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function startProgressPolling() {
  if (progressPoller) return;
  progressPanel.hidden = false;
  progressPoller = setInterval(refreshProgressOnce, 1000);
}

function stopProgressPolling() {
  if (!progressPoller) return;
  clearInterval(progressPoller);
  progressPoller = null;
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

  if (progress.status === "completed") {
    progressText.textContent = `Completed: ${completed}/${total} (${percent.toFixed(1)}%) | failed: ${progress.failedGames || 0}`;
  }
}
