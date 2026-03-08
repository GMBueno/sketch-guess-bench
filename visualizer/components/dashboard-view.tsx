"use client";

import { useMemo, useState } from "react";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { TooltipProps } from "recharts";
import {
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
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type SectionKey = "ranking" | "table" | "cost" | "speed" | "matrix";
type TableSortKey = "rank" | "model" | "solved" | "failed" | "guesses" | "cost" | "time" | "completed";
type SortDirection = "asc" | "desc";

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

interface MatrixPoint {
  runId: string;
  model: string;
  rank: number;
  successRate: number;
  totalCost: number;
  log2Cost?: number;
  durationSeconds: number;
  log2DurationSeconds?: number;
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

const COST_AXIS_LABELS = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2];
const COST_AXIS_TICKS = COST_AXIS_LABELS.map((value) => Math.log2(value));
const SPEED_AXIS_LABELS = [2, 4, 8, 16, 32, 64, 128];
const SPEED_AXIS_TICKS = SPEED_AXIS_LABELS.map((value) => Math.log2(value));
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatUsdShort(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString("en-GB", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
  if (normalized.includes("deepseek")) return "D";
  if (normalized.includes("glm")) return "Z";
  if (normalized.includes("minimax")) return "M";
  return "A";
}

function getModelGlyphClasses(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini")) return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  if (normalized.includes("gpt") || normalized.includes("openai")) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (normalized.includes("claude")) return "border-orange-400/30 bg-orange-400/10 text-orange-200";
  if (normalized.includes("kimi")) return "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200";
  if (normalized.includes("grok")) return "border-neutral-300/20 bg-neutral-300/10 text-neutral-200";
  if (normalized.includes("deepseek")) return "border-cyan-400/30 bg-cyan-400/10 text-cyan-200";
  if (normalized.includes("glm")) return "border-violet-400/30 bg-violet-400/10 text-violet-200";
  if (normalized.includes("minimax")) return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  return "border-white/10 bg-white/[0.04] text-neutral-200";
}

function getModelLogo(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini")) return `${BASE_PATH}/assets/logos/gemini.svg`;
  if (normalized.includes("gpt") || normalized.includes("openai")) return `${BASE_PATH}/assets/logos/openai.svg`;
  if (normalized.includes("claude")) return `${BASE_PATH}/assets/logos/claude.svg`;
  if (normalized.includes("deepseek")) return `${BASE_PATH}/assets/logos/deepseek.svg`;
  if (normalized.includes("grok")) return `${BASE_PATH}/assets/logos/grok.svg`;
  if (normalized.includes("kimi")) return `${BASE_PATH}/assets/logos/kimi.svg`;
  if (normalized.includes("glm")) return `${BASE_PATH}/assets/logos/glm.svg`;
  if (normalized.includes("minimax")) return `${BASE_PATH}/assets/logos/minimax.svg`;
  return null;
}

function formatChartTooltipValue(value: ValueType, kind: "percent" | "usd" | "seconds") {
  const numeric = Array.isArray(value) ? Number(value[0]) : Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (kind === "percent") return `${numeric}%`;
  if (kind === "usd") return formatUsd(numeric);
  return `${numeric}s`;
}

function MatrixLogoPoint(props: { cx?: number; cy?: number; payload?: MatrixPoint }) {
  const { cx, cy, payload } = props;
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;

  const logo = getModelLogo(payload.model);
  if (!logo) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={11} fill="rgba(10,10,10,0.92)" stroke="rgba(255,255,255,0.18)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#e5e5e5">
          {getModelGlyph(payload.model)}
        </text>
      </g>
    );
  }

  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="rgba(10,10,10,0.92)" stroke="rgba(255,255,255,0.18)" />
      <image href={logo} x={cx - 9} y={cy - 9} width={18} height={18} preserveAspectRatio="xMidYMid meet" />
    </g>
  );
}

function MatrixTooltip({ active, payload }: TooltipProps<ValueType, NameType>) {
  const point = payload?.[0]?.payload as MatrixPoint | undefined;
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-xs text-neutral-200 shadow-2xl">
      <div className="font-medium text-white">#{point.rank}: {point.model}</div>
      <div className="mt-1">ACC: {point.successRate.toFixed(1)}%</div>
      <div>COST: {formatUsdShort(point.totalCost)}</div>
      <div>TIME: {point.durationSeconds.toFixed(1)}s</div>
    </div>
  );
}

function MetricRows({
  rows,
  valueFormatter,
  fillPercent,
}: {
  rows: RankingRow[];
  valueFormatter: (row: RankingRow) => string;
  fillPercent: (row: RankingRow) => number;
}) {
  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const style = getRankStyle(index);
        return (
          <div key={row.runId} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3 rounded-2xl px-2 py-0 sm:grid-cols-[64px_minmax(220px,320px)_minmax(0,1fr)_84px] sm:gap-0 sm:px-4">
            <div className={cn("text-md font-semibold tabular-nums sm:text-md", style.text)}>
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="flex min-w-0 items-center gap-3">
              {getModelLogo(row.model) ? (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <img src={getModelLogo(row.model) || ""} alt="" className="h-5 w-5 object-contain" />
                </div>
              ) : (
                <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-sm font-semibold", getModelGlyphClasses(row.model))}>
                  {getModelGlyph(row.model)}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white sm:text-base">{row.model}</div>
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className={cn("h-3 w-full overflow-hidden rounded-full", style.track)}>
                <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, Math.min(100, fillPercent(row)))}%`, backgroundColor: style.fill }} />
              </div>
            </div>
            <div className={cn("justify-self-end text-sm font-medium tabular-nums sm:text-base", style.text)}>
              {valueFormatter(row)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardView({ section }: { section: SectionKey }) {
  const { rankings, metadata } = benchmarkData as BenchmarkPayload;
  const [tableSort, setTableSort] = useState<{ key: TableSortKey; direction: SortDirection }>({
    key: "rank",
    direction: "asc",
  });

  const sortedRankings = useMemo(
    () =>
      rankings.slice().sort((a, b) => {
        if (b.correct !== a.correct) return b.correct - a.correct;
        if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
        if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
        return String(b.completedAt || "").localeCompare(String(a.completedAt || ""));
      }),
    [rankings]
  );

  const rankingPositionByRunId = useMemo(
    () => new Map(sortedRankings.map((row, index) => [row.runId, index + 1])),
    [sortedRankings]
  );

  const costData = useMemo(
    () => [...rankings].sort((a, b) => a.totalCost - b.totalCost),
    [rankings]
  );

  const speedData = useMemo(
    () => [...rankings].sort((a, b) => a.totalRequestMs - b.totalRequestMs),
    [rankings]
  );

  const valueMatrixData = useMemo(
    () => rankings.map((row) => ({
      runId: row.runId,
      model: row.model,
      rank: rankingPositionByRunId.get(row.runId) || 0,
      totalCost: Number(row.totalCost.toFixed(4)),
      log2Cost: Math.log2(Math.max(row.totalCost, 0.0001)),
      successRate: Number(row.successRate.toFixed(1)),
      durationSeconds: Number((row.averageDuration / 1000).toFixed(1)),
    })),
    [rankings, rankingPositionByRunId]
  );

  const speedMatrixData = useMemo(
    () => rankings.map((row) => ({
      runId: row.runId,
      model: row.model,
      rank: rankingPositionByRunId.get(row.runId) || 0,
      durationSeconds: Number((row.averageDuration / 1000).toFixed(1)),
      log2DurationSeconds: Math.log2(Math.max(row.averageDuration / 1000, 0.0001)),
      successRate: Number(row.successRate.toFixed(1)),
      totalCost: Number(row.totalCost.toFixed(4)),
    })),
    [rankings, rankingPositionByRunId]
  );

  const tableRows = useMemo(() => {
    const rows = sortedRankings.map((row, index) => ({ ...row, rank: index + 1 }));
    return rows.slice().sort((a, b) => {
      const direction = tableSort.direction === "asc" ? 1 : -1;
      switch (tableSort.key) {
        case "rank": return (a.rank - b.rank) * direction;
        case "model": return a.model.localeCompare(b.model) * direction;
        case "solved": return (a.correct - b.correct) * direction;
        case "failed": return (a.errors - b.errors) * direction;
        case "guesses": return (a.totalGuesses - b.totalGuesses) * direction;
        case "cost": return (a.totalCost - b.totalCost) * direction;
        case "time": return (a.totalRequestMs - b.totalRequestMs) * direction;
        case "completed": return String(a.completedAt || "").localeCompare(String(b.completedAt || "")) * direction;
        default: return 0;
      }
    });
  }, [sortedRankings, tableSort]);

  const handleTableSort = (key: TableSortKey) => {
    setTableSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const getSortMarker = (key: TableSortKey) => {
    if (tableSort.key !== key) return "";
    return tableSort.direction === "asc" ? " ↑" : " ↓";
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

        {section === "ranking" ? (
          <div className="mx-auto w-full max-w-5xl">
            <Card>
              <CardHeader>
                <CardTitle>Accuracy Distribution</CardTitle>
                <CardDescription>Success rate based on wordbank.</CardDescription>
              </CardHeader>
              <CardContent>
                <MetricRows rows={sortedRankings} valueFormatter={(row) => `${row.successRate.toFixed(0)}%`} fillPercent={(row) => row.successRate} />
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
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("rank")}>Rank{getSortMarker("rank")}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("model")}>Model{getSortMarker("model")}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("solved")}>Solved{getSortMarker("solved")}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("failed")}>Failed{getSortMarker("failed")}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("guesses")}>Guesses{getSortMarker("guesses")}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("cost")}>Cost{getSortMarker("cost")}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("time")}>Time{getSortMarker("time")}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleTableSort("completed")}>Completed{getSortMarker("completed")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableRows.map((row) => (
                        <TableRow key={row.runId} className="bg-white/[0.03] text-neutral-200">
                          <TableCell className="rounded-l-xl text-neutral-400">#{row.rank}</TableCell>
                          <TableCell className="font-medium text-white">{row.model}</TableCell>
                          <TableCell className="text-green-400">{row.correct}/{row.totalTests}</TableCell>
                          <TableCell className="text-red-400">{row.errors}</TableCell>
                          <TableCell>{row.totalGuesses}</TableCell>
                          <TableCell>{formatUsdShort(row.totalCost)}</TableCell>
                          <TableCell>{formatDuration(row.totalRequestMs)}</TableCell>
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
          <div className="mx-auto w-full max-w-5xl">
          <Card>
            <CardHeader>
              <CardTitle>Cost Efficiency</CardTitle>
              <CardDescription>Total cost per full benchmark run (lower is better)</CardDescription>
            </CardHeader>
            <CardContent>
              <MetricRows
                rows={costData}
                valueFormatter={(row) => formatUsdShort(row.totalCost)}
                fillPercent={(row) => {
                  const maxCost = costData.at(-1)?.totalCost || 1;
                  return maxCost > 0 ? (row.totalCost / maxCost) * 100 : 0;
                }}
              />
            </CardContent>
          </Card>
          </div>
        ) : null}

        {section === "speed" ? (
          <div className="mx-auto w-full max-w-5xl">
          <Card>
            <CardHeader>
              <CardTitle>Duration</CardTitle>
              <CardDescription>Total time per full benchmark run (lower is better)</CardDescription>
            </CardHeader>
            <CardContent>
              <MetricRows
                rows={speedData}
                valueFormatter={(row) => `${(row.totalRequestMs / 1000).toFixed(1)}s`}
                fillPercent={(row) => {
                  const maxTime = speedData.at(-1)?.totalRequestMs || 1;
                  return maxTime > 0 ? (row.totalRequestMs / maxTime) * 100 : 0;
                }}
              />
            </CardContent>
          </Card>
          </div>
        ) : null}

        {section === "matrix" ? (
          <div className="space-y-6">
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
                      <XAxis dataKey="log2Cost" type="number" domain={[Math.log2(0.05), Math.log2(3.2)]} ticks={COST_AXIS_TICKS} tickFormatter={(value) => formatUsdShort(2 ** Number(value))} tick={{ fill: "#737373", fontSize: 11 }} label={{ value: "TOTAL COST ($) LOG2 SCALE", position: "insideBottom", offset: -4, fill: "#737373", fontSize: 11 }} />
                      <YAxis dataKey="successRate" tick={{ fill: "#737373", fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip cursor={false} content={<MatrixTooltip />} />
                      <Scatter data={valueMatrixData} shape={<MatrixLogoPoint />}>
                        {valueMatrixData.map((entry, index) => <Cell key={entry.runId} fill={getBarColor(index)} />)}
                      </Scatter>
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
                      <XAxis dataKey="log2DurationSeconds" type="number" domain={[Math.log2(2), Math.log2(128)]} ticks={SPEED_AXIS_TICKS} tickFormatter={(value) => `${2 ** Number(value)}s`} tick={{ fill: "#737373", fontSize: 11 }} label={{ value: "AVERAGE REQUEST TIME (S) LOG2 SCALE", position: "insideBottom", offset: -4, fill: "#737373", fontSize: 11 }} />
                      <YAxis dataKey="successRate" tick={{ fill: "#737373", fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip cursor={false} content={<MatrixTooltip />} />
                      <Scatter data={speedMatrixData} shape={<MatrixLogoPoint />}>
                        {speedMatrixData.map((entry, index) => <Cell key={entry.runId} fill={getBarColor(index)} />)}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </main>
  );
}
