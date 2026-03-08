"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import replayData from "../data/replay-data.json";
import { ModelFilterBar, useVisibleRunIds } from "@/components/model-filter-bar";
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

type SlotId = "a" | "b" | "c";

const SLOT_IDS: SlotId[] = ["a", "b", "c"];
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

function formatRunLabel(run: ReplayRun) {
  return run.model;
}

function formatPct(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function getStatusClass(solved: boolean) {
  return solved ? "text-green-400" : "text-red-400";
}

function buildRunMap(run: ReplayRun) {
  return new Map(run.games.map((game) => [game.targetWord, game]));
}

function compactRunSlots(runIds: Record<SlotId, string | null>) {
  const ordered = SLOT_IDS.map((slotId) => runIds[slotId]).filter(Boolean) as string[];
  return {
    a: ordered[0] || null,
    b: ordered[1] || null,
    c: ordered[2] || null,
  } satisfies Record<SlotId, string | null>;
}

export function ReplayView() {
  const { runs } = replayData as ReplayPayload;
  const sortedRuns = useMemo(
    () =>
      runs.slice().sort((a, b) => {
        if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
        if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
        return a.model.localeCompare(b.model);
      }),
    [runs]
  );
  const filterOptions = useMemo(
    () => sortedRuns.map((run) => ({
      runId: run.runId,
      model: run.model,
    })),
    [sortedRuns]
  );
  const modelFilter = useVisibleRunIds(filterOptions);
  const visibleRuns = useMemo(
    () => sortedRuns.filter((run) => modelFilter.selectedSet.has(run.runId)),
    [sortedRuns, modelFilter.selectedSet]
  );
  const [selectedRunIds, setSelectedRunIds] = useState<Record<SlotId, string | null>>({
    a: sortedRuns[0]?.runId || null,
    b: null,
    c: null,
  });
  const [expandedWord, setExpandedWord] = useState<string | null>(sortedRuns[0]?.games[0]?.targetWord || null);

  useEffect(() => {
    setSelectedRunIds((current) => {
      const next = compactRunSlots({
        a: visibleRuns.some((run) => run.runId === current.a) ? current.a : visibleRuns[0]?.runId || null,
        b: visibleRuns.some((run) => run.runId === current.b) ? current.b : null,
        c: visibleRuns.some((run) => run.runId === current.c) ? current.c : null,
      });
      return next;
    });
  }, [visibleRuns]);

  const activeSlots = SLOT_IDS.filter((slotId) => selectedRunIds[slotId]);
  const selectedRuns = activeSlots
    .map((slotId) => ({
      slotId,
      run: visibleRuns.find((item) => item.runId === selectedRunIds[slotId]) || null,
    }))
    .filter((entry): entry is { slotId: SlotId; run: ReplayRun } => Boolean(entry.run));

  const wordOrder = selectedRuns[0]?.run.wordBank || [];
  const runMaps = useMemo(
    () => new Map(selectedRuns.map(({ slotId, run }) => [slotId, buildRunMap(run)])),
    [selectedRuns]
  );

  const availableRunOptions = (slotId: SlotId) =>
    visibleRuns.filter((run) => {
      const takenElsewhere = SLOT_IDS.some(
        (otherSlotId) => otherSlotId !== slotId && selectedRunIds[otherSlotId] === run.runId
      );
      return !takenElsewhere;
    });

  const handleRunChange = (slotId: SlotId, runId: string) => {
    setSelectedRunIds((current) => ({ ...current, [slotId]: runId }));
    if (!expandedWord) {
      const run = visibleRuns.find((item) => item.runId === runId);
      setExpandedWord(run?.games[0]?.targetWord || null);
    }
  };

  const addRun = () => {
    const emptySlot = SLOT_IDS.find((slotId) => !selectedRunIds[slotId]);
    if (!emptySlot) return;
    const firstAvailable = visibleRuns.find(
      (run) => !Object.values(selectedRunIds).includes(run.runId)
    );
    if (!firstAvailable) return;
    setSelectedRunIds((current) => ({ ...current, [emptySlot]: firstAvailable.runId }));
  };

  const removeRun = (slotId: SlotId) => {
    if (slotId === "a") return;
    setSelectedRunIds((current) => compactRunSlots({ ...current, [slotId]: null }));
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="noise-overlay" />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ModelFilterBar
          options={filterOptions}
          selectedRunIds={modelFilter.selectedRunIds}
          onToggle={modelFilter.toggleRunId}
          onSelectAll={modelFilter.selectAll}
          onClear={modelFilter.clear}
        />
        <Card className="rounded-[28px]">
          <CardHeader>
            <CardDescription>Replay</CardDescription>
            <CardTitle>Run Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="min-w-[880px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead rowSpan={2} className="w-[140px] align-bottom pb-4">Word</TableHead>
                      {SLOT_IDS.map((slotId, index) => {
                        const runId = selectedRunIds[slotId];
                        const run = runs.find((item) => item.runId === runId) || null;
                        const canRemove = slotId !== "a" && Boolean(run);
                        const canShowAdd = !run && index === activeSlots.length && activeSlots.length < 3;

                        return (
                          <TableHead key={slotId} className="min-w-[240px] align-top">
                            {run ? (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Run {slotId.toUpperCase()}</div>
                                  {canRemove ? (
                                    <button type="button" className="text-xs uppercase tracking-[0.18em] text-neutral-500 transition-colors hover:text-white" onClick={() => removeRun(slotId)}>
                                      Remove
                                    </button>
                                  ) : null}
                                </div>
                                <Select value={run.runId} onValueChange={(value) => handleRunChange(slotId, value)}>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select run" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableRunOptions(slotId).map((option) => (
                                      <SelectItem key={option.runId} value={option.runId}>
                                        {formatRunLabel(option)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-normal normal-case tracking-normal text-neutral-500">
                                  <span>acc {formatPct(run.solvedCount, run.totalWords)}</span>
                                  <span>cost ${run.totalCostUsd.toFixed(2)}</span>
                                  <span>speed {Math.round(run.totalRequestMs / 1000)}s</span>
                                  <span>avg guesses {run.averageGuesses.toFixed(2)}</span>
                                </div>
                              </div>
                            ) : canShowAdd ? (
                              <div className="flex h-full items-start pt-6">
                                <Button type="button" variant="outline" onClick={addRun}>+ Add Run</Button>
                              </div>
                            ) : null}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                    <TableRow>
                      {selectedRuns.map(({ slotId }) => (
                        <TableHead key={`${slotId}-headers`}>
                          <div className="grid grid-cols-[1fr_1fr] gap-3 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                            <span>Status</span>
                            <span>Guesses</span>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wordOrder.map((word) => {
                      const expanded = expandedWord === word;
                      return (
                        <Fragment key={word}>
                          <TableRow key={word} className={cn("cursor-pointer bg-white/[0.03] text-neutral-200", expanded && "bg-white/[0.05]")} onClick={() => setExpandedWord((current) => current === word ? null : word)}>
                            <TableCell className="font-medium text-white">{word}</TableCell>
                            {selectedRuns.map(({ slotId, run }) => {
                              const game = runMaps.get(slotId)?.get(word);
                              return (
                                <TableCell key={`${slotId}-${word}`}>
                                  {game ? (
                                    <div className="grid grid-cols-[1fr_1fr] gap-3 text-sm">
                                      <span className={getStatusClass(game.solved)}>{game.solved ? "Solved" : "Missed"}</span>
                                      <span>{game.penalizedGuesses}</span>
                                    </div>
                                  ) : (
                                    <span className="text-neutral-600">n/a</span>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                          {expanded ? (
                            <TableRow key={`${word}-expanded`} className="bg-black/20 text-neutral-200">
                              <TableCell className="align-top text-neutral-500">Details</TableCell>
                              {selectedRuns.map(({ slotId }) => {
                                const game = runMaps.get(slotId)?.get(word);
                                return (
                                  <TableCell key={`${slotId}-${word}-expanded`} className="align-top">
                                    {game ? (
                                      <div className="grid items-start gap-4 py-2 lg:grid-cols-[180px_minmax(0,1fr)]">
                                        <div className="self-start rounded-2xl border border-white/10 bg-neutral-950 p-3">
                                          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white">
                                            {game.svgPath ? (
                                              <img src={`${BASE_PATH}${game.svgPath}`} alt={`${word} drawing`} className="h-full w-full object-contain" />
                                            ) : (
                                              <div className="text-xs text-neutral-500">No SVG saved</div>
                                            )}
                                          </div>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-neutral-300">
                                          {game.guesses.map((guess, index) => {
                                            const matched = guess.toLowerCase() === word.toLowerCase();
                                            return (
                                              <div key={`${guess}-${index}`} className={cn(matched && "text-green-300")}>{index + 1}. {guess}</div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ) : null}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
