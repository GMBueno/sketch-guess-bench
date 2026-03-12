"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { ModelFilterBar, useVisibleRunIds } from "@/components/model-filter-bar";
import {
  buildRunSlugMap,
  getReplaySharePagePath,
  getSortedReplayRuns,
  resolveRequestedRunId,
  resolveRequestedWord,
  type ReplayRun,
  slugify,
} from "@/lib/replay-share";
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

type SlotId = "a" | "b";

const SLOT_IDS: SlotId[] = ["a", "b"];
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
  } satisfies Record<SlotId, string | null>;
}

function splitGuesses(guesses: string[], columnSize = 10) {
  return [guesses.slice(0, columnSize), guesses.slice(columnSize, columnSize * 2)];
}

interface ReplayViewProps {
  initialParams?: {
    runA?: string | null;
    runB?: string | null;
    word?: string | null;
    syncUrl?: boolean;
  };
}

export function ReplayView({ initialParams }: ReplayViewProps = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const safePathname = pathname || "/replay";
  const getSearchParam = (key: string) => searchParams?.get(key) ?? null;
  const sortedRuns = useMemo(() => getSortedReplayRuns(), []);
  const runSlugMap = useMemo(() => buildRunSlugMap(sortedRuns), [sortedRuns]);
  const syncUrl = initialParams?.syncUrl !== false;
  const requestedRunParamA = getSearchParam("runA") ?? initialParams?.runA ?? null;
  const requestedRunParamB = getSearchParam("runB") ?? initialParams?.runB ?? null;
  const requestedRunIds = useMemo(
    () =>
      compactRunSlots({
        a: resolveRequestedRunId(requestedRunParamA, sortedRuns, runSlugMap),
        b: resolveRequestedRunId(requestedRunParamB, sortedRuns, runSlugMap),
      }),
    [requestedRunParamA, requestedRunParamB, runSlugMap, sortedRuns]
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
  });
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const pendingWordSyncRef = useRef<string | null | undefined>(undefined);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    setSelectedRunIds((current) => {
      const next = compactRunSlots({
        a: requestedRunIds.a || current.a || sortedRuns[0]?.runId || null,
        b: requestedRunIds.b,
      });

      if (next.a === current.a && next.b === current.b) {
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
  const requestedWordParam = getSearchParam("word") ?? initialParams?.word ?? null;
  const requestedWord = useMemo(
    () => resolveRequestedWord(requestedWordParam, wordOrder),
    [requestedWordParam, wordOrder]
  );
  const runMaps = useMemo(
    () => new Map(selectedRuns.map(({ slotId, run }) => [slotId, buildRunMap(run)])),
    [selectedRuns]
  );
  const canonicalReplayState = useMemo(() => {
    const runA = selectedRunIds.a ? runSlugMap.get(selectedRunIds.a) || selectedRunIds.a : null;
    const runB = selectedRunIds.b ? runSlugMap.get(selectedRunIds.b) || selectedRunIds.b : null;

    return { runA, runB, word: activeWord };
  }, [activeWord, runSlugMap, selectedRunIds]);
  const queryReplayPath = useMemo(() => {
    const params = new URLSearchParams();
    if (canonicalReplayState.runA) params.set("runA", canonicalReplayState.runA);
    if (canonicalReplayState.runB) params.set("runB", canonicalReplayState.runB);
    if (canonicalReplayState.word) params.set("word", canonicalReplayState.word);

    const query = params.toString();
    return query ? `${safePathname}?${query}` : safePathname;
  }, [canonicalReplayState, safePathname]);
  const sharePagePath = useMemo(() => {
    if (!canonicalReplayState.word || !canonicalReplayState.runA) {
      return null;
    }

    return getReplaySharePagePath({
      word: slugify(canonicalReplayState.word),
      runA: canonicalReplayState.runA,
      ...(canonicalReplayState.runB ? { runB: canonicalReplayState.runB } : {}),
    });
  }, [canonicalReplayState]);
  const preferredAddressPath = sharePagePath ? `${BASE_PATH}${sharePagePath}` : queryReplayPath;

  useEffect(() => {
    if (!syncUrl || typeof window === "undefined") return;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl === preferredAddressPath) return;
    window.history.replaceState(window.history.state, "", preferredAddressPath);
  }, [preferredAddressPath, syncUrl]);

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
      if (requestedWordParam && activeWord) {
        setActiveWord(null);
      }
      return;
    }

    if (requestedWord !== activeWord) {
      setActiveWord(requestedWord);
    }
  }, [activeWord, requestedWord, requestedWordParam, wordOrder]);

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
  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const shareUrl = `${window.location.origin}${sharePagePath ? `${BASE_PATH}${sharePagePath}` : queryReplayPath}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("copied");
      window.setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      setShareStatus("error");
      window.setTimeout(() => setShareStatus("idle"), 2500);
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
            <div>
              <CardDescription>Replay</CardDescription>
              <CardTitle>Run Comparison</CardTitle>
            </div>
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
                        const run = sortedRuns.find((item) => item.runId === runId) || null;
                        const canRemove = slotId !== "a" && Boolean(run);
                        const canShowAdd = !run && index === activeSlots.length && activeSlots.length < 2;

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
                              <div className="flex h-full items-center pt-8">
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
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="mt-2 text-2xl font-semibold text-gray-400 sm:text-3xl">word: </span>
                <span className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{activeWord}</span>
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={handleShare}>
                  {shareStatus === "copied" ? "Copied" : shareStatus === "error" ? "Copy failed" : "Share link"}
                </Button>
                <Button type="button" variant="outline" onClick={() => syncWordQuery(null)}>
                  Close
                </Button>
              </div>
            </div>
            <div
              className={cn(
                "grid gap-4",
                selectedRuns.length === 1 && "mx-auto w-full max-w-2xl grid-cols-1",
                selectedRuns.length === 2 && "mx-auto w-full max-w-5xl grid-cols-1 lg:grid-cols-2"
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
