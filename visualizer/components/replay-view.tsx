"use client";

import { useMemo, useState } from "react";
import { ImageIcon } from "lucide-react";

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

interface ReplayGame {
  targetWord: string;
  solved: boolean;
  guessesUsed: number;
  penalizedGuesses: number;
  totalCostUsd: number;
  totalRequestMs: number;
  totalRequests: number;
  svgPath: string | null;
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

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatUsdShort(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatDuration(ms: number) {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
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

export function ReplayView() {
  const { runs } = replayData as ReplayPayload;
  const [selectedRunId, setSelectedRunId] = useState<string>(runs[0]?.runId || "");
  const [selectedWord, setSelectedWord] = useState<string>(runs[0]?.games[0]?.targetWord || "");

  const selectedRun = useMemo(() => runs.find((run) => run.runId === selectedRunId) || runs[0] || null, [runs, selectedRunId]);
  const selectedGame = useMemo(() => {
    if (!selectedRun) return null;
    return selectedRun.games.find((game) => game.targetWord === selectedWord) || selectedRun.games[0] || null;
  }, [selectedRun, selectedWord]);

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId);
    const run = runs.find((item) => item.runId === runId);
    if (run?.games?.[0]?.targetWord) setSelectedWord(run.games[0].targetWord);
  };

  if (!selectedRun) return null;

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="noise-overlay" />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
                      {selectedGame?.svgPath ? (
                        <img src={selectedGame.svgPath} alt={`${selectedGame.targetWord} drawing`} className="h-full w-full object-contain" />
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
      </div>
    </main>
  );
}
