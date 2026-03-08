"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ModelFilterOption {
  runId: string;
  model: string;
}

const STORAGE_KEY = "sketchbench-visible-run-ids";

export function useVisibleRunIds(options: ModelFilterOption[]) {
  const allRunIds = useMemo(() => options.map((option) => option.runId), [options]);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>(allRunIds);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setSelectedRunIds(allRunIds);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setSelectedRunIds(allRunIds);
        return;
      }
      const filtered = allRunIds.filter((runId) => parsed.includes(runId));
      setSelectedRunIds(filtered.length ? filtered : allRunIds);
    } catch {
      setSelectedRunIds(allRunIds);
    }
  }, [allRunIds]);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedRunIds));
  }, [isHydrated, selectedRunIds]);

  const selectedSet = useMemo(() => new Set(selectedRunIds), [selectedRunIds]);

  const visibleOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.runId)),
    [options, selectedSet]
  );

  const toggleRunId = (runId: string) => {
    setSelectedRunIds((current) => {
      if (current.includes(runId)) return current.filter((item) => item !== runId);
      return allRunIds.filter((item) => current.includes(item) || item === runId);
    });
  };

  const selectAll = () => setSelectedRunIds(allRunIds);
  const clear = () => setSelectedRunIds([]);

  return {
    selectedRunIds,
    selectedSet,
    visibleOptions,
    isHydrated,
    toggleRunId,
    selectAll,
    clear,
    totalCount: allRunIds.length,
    selectedCount: selectedRunIds.length,
  };
}

export function ModelFilterBar({
  options,
  selectedRunIds,
  onToggle,
  onSelectAll,
  onClear,
}: {
  options: ModelFilterOption[];
  selectedRunIds: string[];
  onToggle: (runId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedRunIds), [selectedRunIds]);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative mb-6 flex justify-end">
      <div className="flex flex-col items-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[11px] uppercase tracking-[0.18em] text-neutral-400 hover:bg-white/[0.06] hover:text-white"
          onClick={() => setExpanded((current) => !current)}
        >
          Filter Models [{selectedRunIds.length}/{options.length}] {expanded ? "−" : "+"}
        </Button>
        {expanded ? (
          <div className="mt-3 w-full min-w-[320px] max-w-3xl rounded-2xl border border-white/10 bg-[#0a0a0a]/95 px-4 py-4 shadow-2xl backdrop-blur-xl">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] uppercase tracking-[0.18em] text-neutral-400 hover:text-white" onClick={onSelectAll}>
                  Select All
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] uppercase tracking-[0.18em] text-neutral-400 hover:text-white" onClick={onClear}>
                  Clear
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {options.map((option) => {
                  const checked = selectedSet.has(option.runId);
                  return (
                    <label key={option.runId} className={cn("flex items-center gap-2 text-sm text-neutral-300 transition", !checked && "text-neutral-600")}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(option.runId)}
                        className="h-3.5 w-3.5 rounded border-white/20 bg-black accent-[#EF0044]"
                      />
                      <span className="min-w-0 truncate">{option.model}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
