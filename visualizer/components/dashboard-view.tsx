"use client";

import { useMemo, useState } from "react";
import {
  ImageIcon,
} from "lucide-react";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type SectionKey = "ranking" | "table" | "cost" | "speed" | "matrix" | "replay";

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

const CHART_COLORS = [
  "#7dd3fc",
  "#EF0044",
  "#a3e635",
  "#fbbf24",
  "#38bdf8",
  "#fb7185",
  "#f97316",
  "#4ade80",
  "#c084fc",
  "#22d3ee",
];

const RANK_STYLES = [
  { text: "text-emerald-400", fill: "#34d399", track: "bg-white/[0.05]" },
  { text: "text-sky-300", fill: "#7dd3fc", track: "bg-white/[0.05]" },
  { text: "text-orange-300", fill: "#fdba74", track: "bg-white/[0.05]" },
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

function getRankStyle(index: number) {
  return RANK_STYLES[index] || { text: "text-neutral-500", fill: "#737373", track: "bg-white/[0.05]" };
}

function getModelGlyph(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini")) return "G";
  if (normalized.includes("gpt") || normalized.includes("openai")) return "O";
  if (normalized.includes("claude")) return "C";
  if (normalized.includes("kimi")) return "K";
  if (normalized.includes("grok")) return "X";
  return "A";
}

function getModelGlyphClasses(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini")) return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  if (normalized.includes("gpt") || normalized.includes("openai")) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (normalized.includes("claude")) return "border-orange-400/30 bg-orange-400/10 text-orange-200";
  if (normalized.includes("kimi")) return "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200";
  if (normalized.includes("grok")) return "border-neutral-300/20 bg-neutral-300/10 text-neutral-200";
  return "border-white/10 bg-white/[0.04] text-neutral-200";
}

function formatChartTooltipValue(value: ValueType, kind: "percent" | "usd" | "seconds") {
  const numeric = Array.isArray(value) ? Number(value[0]) : Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (kind === "percent") return `${numeric}%`;
  if (kind === "usd") return formatUsd(numeric);
  return `${numeric}s`;
}

function getTooltipLabel(payload?: Array<{ payload?: { model?: string } }>) {
  return payload?.[0]?.payload?.model || "";
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-neutral-500">{label}</div>
        <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
        <div className="mt-2 text-xs text-neutral-400">{hint}</div>
      </CardContent>
    </Card>
  );
}

export function DashboardView({ section }: { section: SectionKey }) {
  const { rankings, metadata } = benchmarkData as BenchmarkPayload;
  const { runs } = replayData as ReplayPayload;

  const [selectedModels, setSelectedModels] = useState<string[]>(rankings.map((row) => row.model));
  const [selectedRunId, setSelectedRunId] = useState<string>(runs[0]?.runId || "");
  const [selectedWord, setSelectedWord] = useState<string>(runs[0]?.games[0]?.targetWord || "");

  const filteredRankings = useMemo(() => rankings.filter((row) => selectedModels.includes(row.model)), [rankings, selectedModels]);
  const sortedRankings = useMemo(
    () =>
      filteredRankings.slice().sort((a, b) => {
        if (b.correct !== a.correct) return b.correct - a.correct;
        if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
        if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
        return String(b.completedAt || "").localeCompare(String(a.completedAt || ""));
      }),
    [filteredRankings]
  );
  const selectedRun = useMemo(() => runs.find((run) => run.runId === selectedRunId) || runs[0] || null, [runs, selectedRunId]);
  const selectedGame = useMemo(() => {
    if (!selectedRun) return null;
    return selectedRun.games.find((game) => game.targetWord === selectedWord) || selectedRun.games[0] || null;
  }, [selectedRun, selectedWord]);
  const costData = useMemo(
    () => [...filteredRankings].sort((a, b) => a.totalCost - b.totalCost).map((row) => ({ model: row.model, value: Number(row.totalCost.toFixed(4)) })),
    [filteredRankings]
  );
  const speedData = useMemo(
    () => [...filteredRankings].sort((a, b) => a.averageDuration - b.averageDuration).map((row) => ({ model: row.model, value: Number((row.averageDuration / 1000).toFixed(2)) })),
    [filteredRankings]
  );
  const valueMatrixData = useMemo(
    () => filteredRankings.map((row) => ({ model: row.model, totalCost: Number(row.totalCost.toFixed(4)), successRate: Number(row.successRate.toFixed(1)) })),
    [filteredRankings]
  );
  const speedMatrixData = useMemo(
    () => filteredRankings.map((row) => ({ model: row.model, durationSeconds: Number((row.averageDuration / 1000).toFixed(2)), successRate: Number(row.successRate.toFixed(1)), totalCost: Number(row.totalCost.toFixed(4)) })),
    [filteredRankings]
  );

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId);
    const run = runs.find((item) => item.runId === runId);
    if (run?.games?.[0]?.targetWord) setSelectedWord(run.games[0].targetWord);
  };

  const toggleModel = (model: string) => {
    setSelectedModels((current) => (current.includes(model) ? current.filter((item) => item !== model) : [...current, model]));
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="noise-overlay" />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-neutral-500">
          <div>Models: {metadata.totalModels}</div>
          <div>Published Runs: {rankings.length}</div>
          <div>Last Sync: {formatDate(metadata.timestamp)}</div>
        </div>

        <Card className="mb-8 rounded-[28px]">
          <CardHeader>
            <CardDescription>Filters</CardDescription>
            <CardTitle>Visible Models</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {rankings.map((row) => {
                const active = selectedModels.includes(row.model);
                return (
                  <Button
                    key={row.runId}
                    type="button"
                    variant={active ? "default" : "outline"}
                    className={cn(active && "bg-[#EF0044] text-white hover:bg-[#EF0044]/90")}
                    onClick={() => toggleModel(row.model)}
                  >
                    {row.model}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {section === "ranking" ? (
          <div className="mx-auto w-full max-w-5xl">
            <Card>
              <CardHeader>
                <CardDescription>Rankings</CardDescription>
                <CardTitle>Published Leaderboard</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sortedRankings.map((row, index) => {
                    const style = getRankStyle(index);
                    return (
                      <div key={row.runId} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3 rounded-2xl px-2 py-0 sm:grid-cols-[64px_minmax(220px,320px)_minmax(0,1fr)_64px] sm:gap-0 sm:px-4">
                        <div className={cn("text-md font-semibold tabular-nums sm:text-md", style.text)}>
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-sm font-semibold", getModelGlyphClasses(row.model))}>
                            {getModelGlyph(row.model)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white sm:text-base">{row.model}</div>
                          </div>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <div className={cn("h-3 w-full overflow-hidden rounded-full", style.track)}>
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, Math.min(100, row.successRate))}%`, backgroundColor: style.fill }} />
                          </div>
                        </div>
                        <div className={cn("justify-self-end text-sm font-medium tabular-nums sm:text-base", style.text)}>{row.successRate.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {section === "table" ? (
          <Card>
            <CardHeader>
              <CardDescription>Table</CardDescription>
              <CardTitle>Run Detail Table</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="w-full whitespace-nowrap">
                <div className="min-w-[980px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rank</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Solved</TableHead>
                        <TableHead>Failed</TableHead>
                        <TableHead>Guesses</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Avg Req</TableHead>
                        <TableHead>Completed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRankings.map((row, index) => (
                        <TableRow key={row.runId} className="bg-white/[0.03] text-neutral-200">
                          <TableCell className="rounded-l-xl text-neutral-400">#{index + 1}</TableCell>
                          <TableCell className="font-medium text-white">{row.model}</TableCell>
                          <TableCell className="text-green-400">{row.correct}/{row.totalTests}</TableCell>
                          <TableCell className="text-red-400">{row.errors}</TableCell>
                          <TableCell>{row.totalGuesses}</TableCell>
                          <TableCell>{formatUsd(row.totalCost)}</TableCell>
                          <TableCell>{formatDuration(row.averageDuration)}</TableCell>
                          <TableCell className="rounded-r-xl text-neutral-400">{formatDate(row.completedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        ) : null}

        {section === "cost" ? (
          <Card>
            <CardHeader>
              <CardDescription>Cost</CardDescription>
              <CardTitle>Benchmark Cost</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[620px] sm:h-[560px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: "#737373", fontSize: 11 }} />
                    <YAxis type="category" dataKey="model" tick={{ fill: "#a3a3a3", fontSize: 11 }} width={140} />
                    <Tooltip formatter={(value: ValueType) => [formatChartTooltipValue(value, "usd"), "Cost"]} contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                    <Bar dataKey="value" radius={[999, 999, 999, 999]} barSize={24}>
                      {costData.map((entry, index) => <Cell key={entry.model} fill={getBarColor(index)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {section === "speed" ? (
          <Card>
            <CardHeader>
              <CardDescription>Speed</CardDescription>
              <CardTitle>Average Request Speed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[620px] sm:h-[560px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={speedData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: "#737373", fontSize: 11 }} />
                    <YAxis type="category" dataKey="model" tick={{ fill: "#a3a3a3", fontSize: 11 }} width={140} />
                    <Tooltip formatter={(value: ValueType) => [formatChartTooltipValue(value, "seconds"), "Avg seconds"]} contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                    <Bar dataKey="value" radius={[999, 999, 999, 999]} barSize={24}>
                      {speedData.map((entry, index) => <Cell key={entry.model} fill={getBarColor(index)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {section === "matrix" ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription>Matrix</CardDescription>
                <CardTitle>Value Matrix</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[420px] sm:h-[500px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="totalCost" tick={{ fill: "#737373", fontSize: 11 }} />
                      <YAxis dataKey="successRate" tick={{ fill: "#737373", fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} formatter={(value: ValueType, name: NameType) => name === "totalCost" ? [formatChartTooltipValue(value, "usd"), "Cost"] : [formatChartTooltipValue(value, "percent"), "Solved"]} labelFormatter={(_, payload) => getTooltipLabel(payload as Array<{ payload?: { model?: string } }> | undefined)} />
                      <Scatter data={valueMatrixData}>{valueMatrixData.map((entry, index) => <Cell key={entry.model} fill={getBarColor(index)} />)}</Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Matrix</CardDescription>
                <CardTitle>Speed Matrix</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[420px] sm:h-[500px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="durationSeconds" tick={{ fill: "#737373", fontSize: 11 }} />
                      <YAxis dataKey="successRate" tick={{ fill: "#737373", fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} formatter={(value: ValueType, name: NameType) => name === "durationSeconds" ? [formatChartTooltipValue(value, "seconds"), "Avg seconds"] : name === "successRate" ? [formatChartTooltipValue(value, "percent"), "Solved"] : [formatChartTooltipValue(value, "usd"), "Cost"]} labelFormatter={(_, payload) => getTooltipLabel(payload as Array<{ payload?: { model?: string } }> | undefined)} />
                      <Scatter data={speedMatrixData}>{speedMatrixData.map((entry, index) => <Cell key={entry.model} fill={getBarColor(index)} />)}</Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {section === "replay" && selectedRun ? (
          <div className="grid gap-6 xl:grid-cols-[0.34fr_0.66fr]">
            <Card>
              <CardHeader>
                <CardDescription>Replay Controls</CardDescription>
                <CardTitle>Inspect A Published Run</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-2 text-xs uppercase tracking-[0.2em] text-neutral-500">Run</div>
                <Select value={selectedRun.runId} onValueChange={handleRunChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select run" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((run) => (
                      <SelectItem key={run.runId} value={run.runId}>
                        {run.model} · {new Date(run.completedAt || "").toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <MetricCard label="Solved" value={`${selectedRun.solvedCount}/${selectedRun.totalWords}`} hint={`${selectedRun.failedCount} failed`} />
                  <MetricCard label="Guesses" value={String(selectedRun.totalGuesses)} hint={`${selectedRun.averageGuesses.toFixed(2)} avg / word`} />
                  <MetricCard label="Cost" value={formatUsdShort(selectedRun.totalCostUsd)} hint={`${selectedRun.totalRequests} total requests`} />
                  <MetricCard label="Req Time" value={formatDuration(selectedRun.totalRequestMs)} hint={selectedRun.model} />
                </div>

                <div className="mt-5">
                  <div className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-500">Words</div>
                  <ScrollArea className="h-[340px] pr-2">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                      {selectedRun.games.map((game) => (
                        <Button key={game.targetWord} type="button" variant={selectedGame?.targetWord === game.targetWord ? "default" : "outline"} className={cn("h-auto justify-start px-3 py-3 text-left", selectedGame?.targetWord === game.targetWord && "bg-[#EF0044] text-white hover:opacity-90")} onClick={() => setSelectedWord(game.targetWord)}>
                          <div>
                            <div className="font-medium">{game.targetWord}</div>
                            <div className="mt-1 text-xs opacity-70">{game.solved ? "solved" : "missed"} · {game.penalizedGuesses} guesses</div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardDescription>Selected Word</CardDescription>
                  <CardTitle>{selectedGame?.targetWord}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-400">
                    <span>{selectedGame?.solved ? "Solved" : "Missed"} · {selectedGame?.penalizedGuesses ?? 0} guesses · {formatUsd(selectedGame?.totalCostUsd || 0)}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.2em]">{formatDuration(selectedGame?.totalRequestMs || 0)}</span>
                  </div>
                  <div className="grid gap-6 lg:grid-cols-[0.48fr_0.52fr]">
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neutral-500"><ImageIcon className="h-4 w-4" />Saved Drawing</div>
                      <div className="flex aspect-square items-center justify-center rounded-xl bg-neutral-950 p-4">
                        {selectedGame?.svg ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: selectedGame.svg }} /> : <div className="text-sm text-neutral-500">No SVG saved</div>}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-500">Guess Order</div>
                      <div className="flex flex-wrap gap-2">
                        {(selectedGame?.guesses || []).map((guess, index) => {
                          const matched = guess.toLowerCase() === (selectedGame?.targetWord || "").toLowerCase();
                          return <span key={`${guess}-${index}`} className={cn("rounded-full border px-3 py-1 text-xs", matched ? "border-green-500/40 bg-green-500/10 text-green-300" : "border-white/10 bg-white/[0.04] text-neutral-300")}>{index + 1}. {guess}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardDescription>Run Table</CardDescription>
                  <CardTitle>{selectedRun.model}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="w-full whitespace-nowrap">
                    <div className="min-w-[760px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Word</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Guesses</TableHead>
                            <TableHead>Cost</TableHead>
                            <TableHead>Req Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedRun.games.map((game) => (
                            <TableRow key={game.targetWord} className={cn("cursor-pointer bg-white/[0.03] text-neutral-200", selectedGame?.targetWord === game.targetWord && "bg-[#EF0044]/10")} onClick={() => setSelectedWord(game.targetWord)}>
                              <TableCell className="rounded-l-xl text-white">{game.targetWord}</TableCell>
                              <TableCell className={game.solved ? "text-green-400" : "text-red-400"}>{game.solved ? "Solved" : "Missed"}</TableCell>
                              <TableCell>{game.penalizedGuesses}</TableCell>
                              <TableCell>{formatUsd(game.totalCostUsd)}</TableCell>
                              <TableCell className="rounded-r-xl">{formatDuration(game.totalRequestMs)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
