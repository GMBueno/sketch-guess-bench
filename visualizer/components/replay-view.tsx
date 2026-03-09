"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

function splitGuesses(guesses: string[], columnSize = 10) {
  return [guesses.slice(0, columnSize), guesses.slice(columnSize, columnSize * 2)];
}

function buildRunSlugMap(runs: ReplayRun[]) {
  const slugCounts = new Map<string, number>();
  const runSlugEntries = runs.map((run) => {
    const baseSlug = slugify(run.model);
    const count = slugCounts.get(baseSlug) || 0;
    slugCounts.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${run.runId.slice(0, 8)}`;
    return [run.runId, slug] as const;
  });

  return new Map(runSlugEntries);
}

function resolveRequestedRunId(
  value: string | null,
  runs: ReplayRun[],
  runSlugMap: Map<string, string>
) {
  if (!value) return null;

  const normalizedValue = value.trim().toLowerCase();
  const slugMatch = runs.find((run) => runSlugMap.get(run.runId) === normalizedValue);
  if (slugMatch) return slugMatch.runId;

  const runIdMatch = runs.find((run) => run.runId.toLowerCase() === normalizedValue);
  if (runIdMatch) return runIdMatch.runId;

  const modelIdMatch = runs.find((run) => run.modelId?.toLowerCase() === normalizedValue);
  if (modelIdMatch) return modelIdMatch.runId;

  const modelSlugMatch = runs.find((run) => slugify(run.model) === normalizedValue);
  return modelSlugMatch?.runId || null;
}

function resolveRequestedWord(value: string | null, wordBank: string[]) {
  if (!value) return null;

  const normalizedValue = value.trim().toLowerCase();
  const exactMatch = wordBank.find((word) => word.toLowerCase() === normalizedValue);
  if (exactMatch) return exactMatch;

  const slugMatch = wordBank.find((word) => slugify(word) === normalizedValue);
  return slugMatch || null;
}

export function ReplayView() {
  const { runs } = replayData as ReplayPayload;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortedRuns = useMemo(
    () =>
      runs.slice().sort((a, b) => {
        if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
        if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
        return a.model.localeCompare(b.model);
      }),
    [runs]
  );
  const runSlugMap = useMemo(() => buildRunSlugMap(sortedRuns), [sortedRuns]);
  const requestedRunIds = useMemo(
    () =>
      compactRunSlots({
        a: resolveRequestedRunId(searchParams.get("runA"), sortedRuns, runSlugMap),
        b: resolveRequestedRunId(searchParams.get("runB"), sortedRuns, runSlugMap),
        c: resolveRequestedRunId(searchParams.get("runC"), sortedRuns, runSlugMap),
      }),
    [runSlugMap, searchParams, sortedRuns]
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
    a: requestedRunIds.a || sortedRuns[0]?.runId || null,
    b: requestedRunIds.b,
    c: requestedRunIds.c,
  });
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const pendingWordSyncRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setSelectedRunIds((current) => {
      const next = compactRunSlots({
        a: requestedRunIds.a || current.a || sortedRuns[0]?.runId || null,
        b: requestedRunIds.b,
        c: requestedRunIds.c,
      });

      if (next.a === current.a && next.b === current.b && next.c === current.c) {
        return current;
      }

      return next;
    });
  }, [requestedRunIds, sortedRuns]);

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
  const requestedWord = useMemo(
    () => resolveRequestedWord(searchParams.get("word"), wordOrder),
    [searchParams, wordOrder]
  );
  const runMaps = useMemo(
    () => new Map(selectedRuns.map(({ slotId, run }) => [slotId, buildRunMap(run)])),
    [selectedRuns]
  );

  useEffect(() => {
    if (!selectedRunIds.a) return;

    const params = new URLSearchParams(searchParams.toString());
    const currentQuery = compactRunSlots({
      a: searchParams.get("runA"),
      b: searchParams.get("runB"),
      c: searchParams.get("runC"),
    });
    const nextQuery = compactRunSlots({
      a: selectedRunIds.a ? runSlugMap.get(selectedRunIds.a) || selectedRunIds.a : null,
      b: selectedRunIds.b ? runSlugMap.get(selectedRunIds.b) || selectedRunIds.b : null,
      c: selectedRunIds.c ? runSlugMap.get(selectedRunIds.c) || selectedRunIds.c : null,
    });
    const currentWord = searchParams.get("word");

    if (
      currentQuery.a === nextQuery.a &&
      currentQuery.b === nextQuery.b &&
      currentQuery.c === nextQuery.c &&
      currentWord === activeWord
    ) {
      return;
    }

    if (nextQuery.a) params.set("runA", nextQuery.a);
    else params.delete("runA");

    if (nextQuery.b) params.set("runB", nextQuery.b);
    else params.delete("runB");

    if (nextQuery.c) params.set("runC", nextQuery.c);
    else params.delete("runC");

    if (activeWord) params.set("word", activeWord);
    else params.delete("word");

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [activeWord, pathname, router, runSlugMap, searchParams, selectedRunIds]);

  useEffect(() => {
    if (!wordOrder.length) {
      if (activeWord) setActiveWord(null);
      return;
    }

    if (pendingWordSyncRef.current !== undefined) {
      if (requestedWord === pendingWordSyncRef.current) {
        pendingWordSyncRef.current = undefined;
      }
      return;
    }

    if (!requestedWord) {
      if (searchParams.get("word") && activeWord) {
        setActiveWord(null);
      }
      return;
    }

    if (requestedWord !== activeWord) {
      setActiveWord(requestedWord);
    }
  }, [activeWord, requestedWord, searchParams, wordOrder]);

  const availableRunOptions = (slotId: SlotId) =>
    visibleRuns.filter((run) => {
      const takenElsewhere = SLOT_IDS.some(
        (otherSlotId) => otherSlotId !== slotId && selectedRunIds[otherSlotId] === run.runId
      );
      return !takenElsewhere;
    });

  const handleRunChange = (slotId: SlotId, runId: string) => {
    setSelectedRunIds((current) => ({ ...current, [slotId]: runId }));
  };

  const syncWordQuery = (word: string | null) => {
    pendingWordSyncRef.current = word;
    setActiveWord(word);
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

  useEffect(() => {
    if (!activeWord) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        syncWordQuery(null);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeWord]);

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
                      <TableHead rowSpan={2} className="w-[140px] align-bottom pb-2">Word</TableHead>
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
                      return (
                        <TableRow
                          key={word}
                          className={cn(
                            "cursor-pointer bg-white/[0.03] text-neutral-200 transition-colors hover:bg-white/[0.07]",
                            activeWord === word && "bg-white/[0.07]"
                          )}
                          onClick={() => syncWordQuery(word)}
                        >
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
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      {activeWord ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-8"
          onClick={() => syncWordQuery(null)}
        >
          <div
            className="w-full max-w-6xl rounded-[28px] border border-white/10 bg-neutral-950/95 p-4 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <span className="mt-2 text-2xl font-semibold text-gray-400 sm:text-3xl">word: </span>
                <span className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{activeWord}</span>
              </div>
              <Button type="button" variant="outline" onClick={() => syncWordQuery(null)}>
                Close
              </Button>
            </div>
            <div
              className={cn(
                "grid gap-4",
                selectedRuns.length === 1 && "mx-auto w-full max-w-2xl grid-cols-1",
                selectedRuns.length === 2 && "mx-auto w-full max-w-5xl grid-cols-1 lg:grid-cols-2",
                selectedRuns.length >= 3 && "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
              )}
            >
              {selectedRuns.map(({ slotId, run }) => {
                const game = runMaps.get(slotId)?.get(activeWord);
                if (!game) return null;

                const guessColumns = splitGuesses(game.guesses);
                const singleRunSelected = selectedRuns.length === 1;

                return (
                  <div
                    key={`${slotId}-${activeWord}-modal`}
                    className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 sm:p-5"
                  >
                      <div>
                        <div className="mt-2 text-md font-semibold text-white">{run.model}</div>
                      </div>
                      <div className="text-sm text-neutral-400 mb-2">
                        <span className={getStatusClass(game.solved)}>{game.solved ? "Solved" : "Missed"}</span>
                        <span className="ml-2">({game.penalizedGuesses > 1 ? `${game.penalizedGuesses} guesses` : `${game.penalizedGuesses} guess`})</span>
                      </div>

                    <div
                      className={cn(
                        "mx-auto w-full",
                        singleRunSelected
                          ? "max-w-4xl sm:grid sm:grid-cols-[minmax(0,360px)_minmax(0,1fr)] sm:items-start sm:gap-4"
                          : "max-w-[160px] sm:max-w-[360px]"
                      )}
                    >
                      <div className="rounded-[22px]">
                        <div className="mx-auto flex aspect-square w-full max-w-[160px] items-center justify-center overflow-hidden rounded-[18px] bg-white sm:max-w-[360px]">
                          {game.svgPath ? (
                            <img
                              src={`${BASE_PATH}${game.svgPath}`}
                              alt={`${activeWord} drawing`}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="text-xs text-neutral-500">No SVG saved</div>
                          )}
                        </div>
                      </div>
                      <div className={cn("mt-2 rounded-[22px] p-4", singleRunSelected && "sm:mt-0")}>
                        <div className="grid grid-cols-2 gap-3 text-sm leading-6 text-neutral-300">
                          {guessColumns.map((column, columnIndex) => (
                            <div key={`${slotId}-${activeWord}-col-${columnIndex}`} className="space-y-1">
                              {column.length ? (
                                column.map((guess, index) => {
                                  const guessNumber = columnIndex * 10 + index + 1;
                                  const matched = guess.toLowerCase() === activeWord.toLowerCase();
                                  return (
                                    <div key={`${guess}-${guessNumber}`} className={cn("break-words", matched && "text-green-300")}>
                                      {guessNumber}. {guess}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="text-neutral-600">-</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
