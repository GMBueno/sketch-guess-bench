"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Clock3,
  DollarSign,
  Gauge,
  Grid2x2,
  ImageIcon,
  ListOrdered,
  Search,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import benchmarkData from "../data/benchmark-results.json";
import replayData from "../data/replay-data.json";
import { cn } from "@/lib/utils";

type TabKey = "rankings" | "table" | "cost" | "speed" | "matrix" | "replay";

interface RankingRow {
  model: string;
  modelId: string | null;
  runId: string;
  completedAt: string | null;
  correct: number;
  incorrect: number;
  errors: number;
  totalTests: number;
  successRate: number;
  errorRate: number;
  averageDuration: number;
  totalRequestMs: number;
  totalCost: number;
  averageCostPerTest: number;
  totalGuesses: number;
  averageGuesses: number;
  pricedRequests: number;
  totalRequests: number;
  missingPriceRequests: number;
}

interface BenchmarkPayload {
  rankings: RankingRow[];
  metadata: {
    timestamp: string;
    totalModels: number;
    totalTestsRun: number;
    overallCorrect: number;
    totalCost: number;
    totalRequestMs: number;
    testSuite: string;
  };
}

interface ReplayGame {
  targetWord: string;
  solved: boolean;
  guessesUsed: number;
  penalizedGuesses: number;
  totalCostUsd: number;
  totalRequestMs: number;
  totalRequests: number;
  svg: string | null;
  guesses: string[];
}

interface ReplayRun {
  model: string;
  modelId: string | null;
  runId: string;
  completedAt: string | null;
  solvedCount: number;
  failedCount: number;
  totalWords: number;
  totalGuesses: number;
  averageGuesses: number;
  totalCostUsd: number;
  totalRequestMs: number;
  totalRequests: number;
  games: ReplayGame[];
  wordBank: string[];
}

interface ReplayPayload {
  generatedAt: string;
  runs: ReplayRun[];
}

const ACCENT = "#EF0044";
const TAB_ORDER: Array<{ key: TabKey; label: string; icon: typeof BarChart3 }> = [
  { key: "rankings", label: "Rankings", icon: BarChart3 },
  { key: "table", label: "Table", icon: ListOrdered },
  { key: "cost", label: "Cost", icon: DollarSign },
  { key: "speed", label: "Speed", icon: Gauge },
  { key: "matrix", label: "Matrix", icon: Grid2x2 },
  { key: "replay", label: "Replay", icon: Search },
];

const CHART_COLORS = [
  "#7dd3fc",
  ACCENT,
  "#a3e635",
  "#fbbf24",
  "#38bdf8",
  "#fb7185",
  "#f97316",
  "#4ade80",
  "#c084fc",
  "#22d3ee",
];

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatUsdShort(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function formatDuration(ms: number) {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getBarColor(index: number) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

function Surface({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("glass-card rounded-[24px]", className)}>{children}</section>;
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-[0.25em] text-neutral-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-xs text-neutral-400">{hint}</div>
    </div>
  );
}

function TabButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof BarChart3;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 border-b-2 px-0 py-2 text-sm font-medium uppercase tracking-[0.18em] transition-colors",
        active
          ? "border-[var(--tab-accent)] text-white"
          : "border-transparent text-neutral-500 hover:text-neutral-300"
      )}
      style={{ ["--tab-accent" as string]: ACCENT }}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export default function HomePage() {
  const { rankings, metadata } = benchmarkData as BenchmarkPayload;
  const { runs } = replayData as ReplayPayload;

  const [activeTab, setActiveTab] = useState<TabKey>("rankings");
  const [selectedModels, setSelectedModels] = useState<string[]>(rankings.map((row) => row.model));
  const [selectedRunId, setSelectedRunId] = useState<string>(runs[0]?.runId || "");
  const [selectedWord, setSelectedWord] = useState<string>(runs[0]?.games[0]?.targetWord || "");

  const filteredRankings = useMemo(() => {
    return rankings.filter((row) => selectedModels.includes(row.model));
  }, [rankings, selectedModels]);

  const selectedRun = useMemo(() => {
    return runs.find((run) => run.runId === selectedRunId) || runs[0] || null;
  }, [runs, selectedRunId]);

  const selectedGame = useMemo(() => {
    if (!selectedRun) return null;
    return selectedRun.games.find((game) => game.targetWord === selectedWord) || selectedRun.games[0] || null;
  }, [selectedRun, selectedWord]);

  const rankingsChartData = useMemo(
    () =>
      [...filteredRankings]
        .sort((a, b) => b.successRate - a.successRate)
        .map((row) => ({
          model: row.model,
          successRate: Number(row.successRate.toFixed(1)),
        })),
    [filteredRankings]
  );

  const costData = useMemo(
    () =>
      [...filteredRankings]
        .sort((a, b) => a.totalCost - b.totalCost)
        .map((row) => ({ model: row.model, value: Number(row.totalCost.toFixed(4)) })),
    [filteredRankings]
  );

  const speedData = useMemo(
    () =>
      [...filteredRankings]
        .sort((a, b) => a.averageDuration - b.averageDuration)
        .map((row) => ({ model: row.model, value: Number((row.averageDuration / 1000).toFixed(2)) })),
    [filteredRankings]
  );

  const valueMatrixData = useMemo(
    () =>
      filteredRankings.map((row) => ({
        model: row.model,
        totalCost: Number(row.totalCost.toFixed(4)),
        successRate: Number(row.successRate.toFixed(1)),
      })),
    [filteredRankings]
  );

  const speedMatrixData = useMemo(
    () =>
      filteredRankings.map((row) => ({
        model: row.model,
        durationSeconds: Number((row.averageDuration / 1000).toFixed(2)),
        successRate: Number(row.successRate.toFixed(1)),
        totalCost: Number(row.totalCost.toFixed(4)),
      })),
    [filteredRankings]
  );

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId);
    const run = runs.find((item) => item.runId === runId);
    if (run?.games?.[0]?.targetWord) {
      setSelectedWord(run.games[0].targetWord);
    }
  };

  const toggleModel = (model: string) => {
    setSelectedModels((current) =>
      current.includes(model)
        ? current.filter((item) => item !== model)
        : [...current, model]
    );
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="noise-overlay" />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Surface className="p-6 sm:p-8">
          <div className="mb-6 inline-flex items-center rounded-full border border-[#EF0044]/20 bg-[#EF0044]/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-[#EF0044]">
            SketchGuess Bench
          </div>
          <div className="grid gap-8 lg:grid-cols-[1.4fr_0.6fr] lg:items-end">
            <div>
              <h1 className="stencil-text max-w-4xl text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
                Benchmarking Visual Reasoning, Not Vibes.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400 sm:text-base">
                SketchGuess Bench measures how well models can draw a hidden word as SVG and then recover
                meaning from that drawing through ordered guesses. This UI is mobile-first and reads only
                committed benchmark artifacts.
              </p>
            </div>
            <div className="space-y-2 text-xs uppercase tracking-[0.2em] text-neutral-500 lg:text-right">
              <div>Models: {metadata.totalModels}</div>
              <div>Published Runs: {rankings.length}</div>
              <div>Last Sync: {formatDate(metadata.timestamp)}</div>
            </div>
          </div>
        </Surface>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total Models" value={String(metadata.totalModels)} hint={`${metadata.totalTestsRun} tasks evaluated`} />
          <MetricCard label="Solved" value={String(metadata.overallCorrect)} hint="Across all published runs" />
          <MetricCard label="Total Cost" value={formatUsdShort(metadata.totalCost)} hint="Summed across published runs" />
          <MetricCard label="Request Time" value={formatDuration(metadata.totalRequestMs)} hint="Aggregate provider response time" />
        </section>

        <section className="mt-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-white/10 pb-3">
            {TAB_ORDER.map(({ key, label, icon }) => (
              <TabButton
                key={key}
                active={activeTab === key}
                label={label}
                icon={icon}
                onClick={() => setActiveTab(key)}
              />
            ))}
          </div>

          <Surface className="p-4 xl:min-w-[320px]">
            <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-neutral-500">Filter Models</div>
            <div className="grid max-h-40 gap-2 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-1">
              {rankings.map((row) => (
                <label key={row.runId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={selectedModels.includes(row.model)}
                    onChange={() => toggleModel(row.model)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#EF0044]"
                  />
                  <span className="truncate">{row.model}</span>
                </label>
              ))}
            </div>
          </Surface>
        </section>

        <section className="mt-8">
          {activeTab === "rankings" ? (
            <Surface className="p-5 sm:p-6">
              <div className="mb-6">
                <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Rankings</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">Accuracy Distribution</h2>
                <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                  Solved percentage per run. This is the primary leaderboard view.
                </p>
              </div>
              <div className="h-[620px] sm:h-[560px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rankingsChartData}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: "#737373", fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="model"
                      tick={{ fill: "#a3a3a3", fontSize: 11 }}
                      width={140}
                    />
                    <Tooltip
                      formatter={(value: number) => [`${value}%`, "Solved"]}
                      contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
                    />
                    <Bar dataKey="successRate" radius={[999, 999, 999, 999]} barSize={24}>
                      {rankingsChartData.map((entry, index) => (
                        <Cell key={entry.model} fill={getBarColor(index)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Surface>
          ) : null}

          {activeTab === "table" ? (
            <Surface className="p-5 sm:p-6">
              <div className="mb-6">
                <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Table</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">Run Detail Table</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full border-separate border-spacing-y-2 text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                      <th className="px-3 py-2">Rank</th>
                      <th className="px-3 py-2">Model</th>
                      <th className="px-3 py-2">Solved</th>
                      <th className="px-3 py-2">Failed</th>
                      <th className="px-3 py-2">Guesses</th>
                      <th className="px-3 py-2">Cost</th>
                      <th className="px-3 py-2">Avg Req</th>
                      <th className="px-3 py-2">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRankings
                      .slice()
                      .sort((a, b) => {
                        if (b.correct !== a.correct) return b.correct - a.correct;
                        if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
                        if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
                        return String(b.completedAt || "").localeCompare(String(a.completedAt || ""));
                      })
                      .map((row, index) => (
                        <tr key={row.runId} className="bg-white/[0.03] text-sm text-neutral-200">
                          <td className="rounded-l-xl px-3 py-3 text-neutral-400">#{index + 1}</td>
                          <td className="px-3 py-3 font-medium text-white">{row.model}</td>
                          <td className="px-3 py-3 text-green-400">{row.correct}/{row.totalTests}</td>
                          <td className="px-3 py-3 text-red-400">{row.errors}</td>
                          <td className="px-3 py-3">{row.totalGuesses}</td>
                          <td className="px-3 py-3">{formatUsd(row.totalCost)}</td>
                          <td className="px-3 py-3">{formatDuration(row.averageDuration)}</td>
                          <td className="rounded-r-xl px-3 py-3 text-neutral-400">{formatDate(row.completedAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Surface>
          ) : null}

          {activeTab === "cost" ? (
            <Surface className="p-5 sm:p-6">
              <div className="mb-6">
                <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Cost</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">Benchmark Cost</h2>
              </div>
              <div className="h-[620px] sm:h-[560px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: "#737373", fontSize: 11 }} />
                    <YAxis type="category" dataKey="model" tick={{ fill: "#a3a3a3", fontSize: 11 }} width={140} />
                    <Tooltip formatter={(value: number) => [formatUsd(value), "Cost"]} contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                    <Bar dataKey="value" radius={[999, 999, 999, 999]} barSize={24}>
                      {costData.map((entry, index) => (
                        <Cell key={entry.model} fill={getBarColor(index)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Surface>
          ) : null}

          {activeTab === "speed" ? (
            <Surface className="p-5 sm:p-6">
              <div className="mb-6">
                <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Speed</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">Average Request Speed</h2>
              </div>
              <div className="h-[620px] sm:h-[560px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={speedData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: "#737373", fontSize: 11 }} />
                    <YAxis type="category" dataKey="model" tick={{ fill: "#a3a3a3", fontSize: 11 }} width={140} />
                    <Tooltip formatter={(value: number) => [`${value}s`, "Avg seconds"]} contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                    <Bar dataKey="value" radius={[999, 999, 999, 999]} barSize={24}>
                      {speedData.map((entry, index) => (
                        <Cell key={entry.model} fill={getBarColor(index)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Surface>
          ) : null}

          {activeTab === "matrix" ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <Surface className="p-5 sm:p-6">
                <div className="mb-6">
                  <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Matrix</div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Value Matrix</h2>
                  <p className="mt-2 text-sm text-neutral-400">X is cost, Y is accuracy.</p>
                </div>
                <div className="h-[420px] sm:h-[500px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="totalCost" tick={{ fill: "#737373", fontSize: 11 }} />
                      <YAxis dataKey="successRate" tick={{ fill: "#737373", fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
                        formatter={(value: number, name: string) => {
                          if (name === "totalCost") return [formatUsd(value), "Cost"];
                          if (name === "successRate") return [`${value}%`, "Solved"];
                          return [String(value), name];
                        }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.model || ""}
                      />
                      <Scatter data={valueMatrixData}>
                        {valueMatrixData.map((entry, index) => (
                          <Cell key={entry.model} fill={getBarColor(index)} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Surface>

              <Surface className="p-5 sm:p-6">
                <div className="mb-6">
                  <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Matrix</div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Speed Matrix</h2>
                  <p className="mt-2 text-sm text-neutral-400">X is average seconds, Y is accuracy.</p>
                </div>
                <div className="h-[420px] sm:h-[500px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="durationSeconds" tick={{ fill: "#737373", fontSize: 11 }} />
                      <YAxis dataKey="successRate" tick={{ fill: "#737373", fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
                        formatter={(value: number, name: string) => {
                          if (name === "durationSeconds") return [`${value}s`, "Avg seconds"];
                          if (name === "successRate") return [`${value}%`, "Solved"];
                          if (name === "totalCost") return [formatUsd(value), "Cost"];
                          return [String(value), name];
                        }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.model || ""}
                      />
                      <Scatter data={speedMatrixData}>
                        {speedMatrixData.map((entry, index) => (
                          <Cell key={entry.model} fill={getBarColor(index)} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Surface>
            </div>
          ) : null}

          {activeTab === "replay" && selectedRun ? (
            <div className="grid gap-6 xl:grid-cols-[0.34fr_0.66fr]">
              <Surface className="p-5 sm:p-6">
                <div className="mb-4 text-xs uppercase tracking-[0.2em] text-neutral-500">Replay Controls</div>
                <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-neutral-500">Run</label>
                <select
                  value={selectedRun.runId}
                  onChange={(event) => handleRunChange(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                >
                  {runs.map((run) => (
                    <option key={run.runId} value={run.runId}>
                      {run.model} · {new Date(run.completedAt || "").toLocaleDateString()}
                    </option>
                  ))}
                </select>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <MetricCard label="Solved" value={`${selectedRun.solvedCount}/${selectedRun.totalWords}`} hint={`${selectedRun.failedCount} failed`} />
                  <MetricCard label="Guesses" value={String(selectedRun.totalGuesses)} hint={`${selectedRun.averageGuesses.toFixed(2)} avg / word`} />
                  <MetricCard label="Cost" value={formatUsdShort(selectedRun.totalCostUsd)} hint={`${selectedRun.totalRequests} total requests`} />
                  <MetricCard label="Req Time" value={formatDuration(selectedRun.totalRequestMs)} hint={selectedRun.model} />
                </div>

                <div className="mt-5">
                  <div className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-500">Words</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                    {selectedRun.games.map((game) => (
                      <button
                        key={game.targetWord}
                        type="button"
                        onClick={() => setSelectedWord(game.targetWord)}
                        className={cn(
                          "rounded-xl border px-3 py-3 text-left text-sm transition",
                          selectedGame?.targetWord === game.targetWord
                            ? "border-[#EF0044] bg-[#EF0044]/10"
                            : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                        )}
                      >
                        <div className="font-medium text-white">{game.targetWord}</div>
                        <div className="mt-1 text-xs text-neutral-500">
                          {game.solved ? "solved" : "missed"} · {game.penalizedGuesses} guesses
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </Surface>

              <div className="space-y-6">
                <Surface className="p-5 sm:p-6">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Selected Word</div>
                      <h2 className="mt-2 text-2xl font-semibold text-white">{selectedGame?.targetWord}</h2>
                      <p className="mt-2 text-sm text-neutral-400">
                        {selectedGame?.solved ? "Solved" : "Missed"} · {selectedGame?.penalizedGuesses ?? 0} guesses · {formatUsd(selectedGame?.totalCostUsd || 0)}
                      </p>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.2em] text-neutral-400">
                      {formatDuration(selectedGame?.totalRequestMs || 0)}
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[0.48fr_0.52fr]">
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
                        <ImageIcon className="h-4 w-4" />
                        Saved Drawing
                      </div>
                      <div className="flex aspect-square items-center justify-center rounded-xl bg-neutral-950 p-4">
                        {selectedGame?.svg ? (
                          <div
                            className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                            dangerouslySetInnerHTML={{ __html: selectedGame.svg }}
                          />
                        ) : (
                          <div className="text-sm text-neutral-500">No SVG saved</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-500">Guess Order</div>
                      <div className="flex flex-wrap gap-2">
                        {(selectedGame?.guesses || []).map((guess, index) => {
                          const matched = guess.toLowerCase() === (selectedGame?.targetWord || "").toLowerCase();
                          return (
                            <span
                              key={`${guess}-${index}`}
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs",
                                matched
                                  ? "border-green-500/40 bg-green-500/10 text-green-300"
                                  : "border-white/10 bg-white/[0.04] text-neutral-300"
                              )}
                            >
                              {index + 1}. {guess}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </Surface>

                <Surface className="p-5 sm:p-6">
                  <div className="mb-4 text-xs uppercase tracking-[0.2em] text-neutral-500">Run Table</div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[760px] w-full border-separate border-spacing-y-2 text-left">
                      <thead>
                        <tr className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                          <th className="px-3 py-2">Word</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Guesses</th>
                          <th className="px-3 py-2">Cost</th>
                          <th className="px-3 py-2">Req Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRun.games.map((game) => (
                          <tr
                            key={game.targetWord}
                            onClick={() => setSelectedWord(game.targetWord)}
                            className={cn(
                              "cursor-pointer bg-white/[0.03] text-sm text-neutral-200",
                              selectedGame?.targetWord === game.targetWord && "bg-[#EF0044]/10"
                            )}
                          >
                            <td className="rounded-l-xl px-3 py-3 text-white">{game.targetWord}</td>
                            <td className={cn("px-3 py-3", game.solved ? "text-green-400" : "text-red-400")}>
                              {game.solved ? "Solved" : "Missed"}
                            </td>
                            <td className="px-3 py-3">{game.penalizedGuesses}</td>
                            <td className="px-3 py-3">{formatUsd(game.totalCostUsd)}</td>
                            <td className="rounded-r-xl px-3 py-3">{formatDuration(game.totalRequestMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Surface>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
