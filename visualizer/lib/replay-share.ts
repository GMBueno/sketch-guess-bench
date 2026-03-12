import replayData from "@/data/replay-data.json";

export interface ReplayGame {
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

export interface ReplayRun {
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

export interface ReplayShareQuery {
  word: string;
  runA: string;
  runB?: string;
}

interface ReplayPayload {
  generatedAt: string;
  runs: ReplayRun[];
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getSortedReplayRuns() {
  const { runs } = replayData as ReplayPayload;
  return runs.slice().sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    if (a.totalGuesses !== b.totalGuesses) return a.totalGuesses - b.totalGuesses;
    return a.model.localeCompare(b.model);
  });
}

export function buildRunSlugMap(runs: ReplayRun[]) {
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

export function resolveRequestedRunId(
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

export function resolveRequestedWord(value: string | null, wordBank: string[]) {
  if (!value) return null;

  const normalizedValue = value.trim().toLowerCase();
  const exactMatch = wordBank.find((word) => word.toLowerCase() === normalizedValue);
  if (exactMatch) return exactMatch;

  const slugMatch = wordBank.find((word) => slugify(word) === normalizedValue);
  return slugMatch || null;
}

export function getReplayShareParams(options?: {
  includeSingles?: boolean;
  includePairs?: boolean;
  orderedPairs?: boolean;
}) {
  const runs = getSortedReplayRuns();
  const runSlugMap = buildRunSlugMap(runs);
  const wordBank = runs[0]?.wordBank || [];
  const includeSingles = options?.includeSingles ?? true;
  const includePairs = options?.includePairs ?? true;
  const orderedPairs = options?.orderedPairs ?? true;
  const params: ReplayShareQuery[] = [];

  for (const word of wordBank) {
    const wordSlug = slugify(word);

    if (includeSingles) {
      for (const run of runs) {
        params.push({
          word: wordSlug,
          runA: runSlugMap.get(run.runId) || run.runId,
        });
      }
    }

    if (!includePairs) continue;

    for (let leftIndex = 0; leftIndex < runs.length; leftIndex += 1) {
      for (let rightIndex = 0; rightIndex < runs.length; rightIndex += 1) {
        if (leftIndex === rightIndex) continue;
        if (!orderedPairs && rightIndex < leftIndex) continue;

        params.push({
          word: wordSlug,
          runA: runSlugMap.get(runs[leftIndex].runId) || runs[leftIndex].runId,
          runB: runSlugMap.get(runs[rightIndex].runId) || runs[rightIndex].runId,
        });
      }
    }
  }

  return params;
}

export function resolveReplayShareContext(input: {
  word: string | null;
  runA: string | null;
  runB?: string | null;
}) {
  const runs = getSortedReplayRuns();
  const runSlugMap = buildRunSlugMap(runs);
  const runAId = resolveRequestedRunId(input.runA, runs, runSlugMap);
  const runBId = input.runB ? resolveRequestedRunId(input.runB, runs, runSlugMap) : null;

  if (!runAId) {
    return null;
  }

  if (runBId && runAId === runBId) {
    return null;
  }

  const selectedRuns = [runAId, runBId]
    .filter(Boolean)
    .map((runId) => runs.find((run) => run.runId === runId) || null)
    .filter((run): run is ReplayRun => Boolean(run));

  if (!selectedRuns.length) {
    return null;
  }

  const word = resolveRequestedWord(input.word, selectedRuns[0].wordBank);
  if (!word) {
    return null;
  }

  return {
    word,
    runs,
    selectedRuns,
    runSlugMap,
    query: {
      runA: runSlugMap.get(selectedRuns[0].runId) || selectedRuns[0].runId,
      runB: selectedRuns[1] ? runSlugMap.get(selectedRuns[1].runId) || selectedRuns[1].runId : undefined,
      word: slugify(word),
    },
  };
}

export function getReplayShareImagePath(input: ReplayShareQuery) {
  const fileName = input.runB ? `${input.runA}__${input.runB}.png` : `${input.runA}.png`;
  return `/replay_assets/share_previews/${input.word}/${fileName}`;
}

export function getReplaySharePagePath(input: ReplayShareQuery) {
  return input.runB
    ? `/share/replay/${input.word}/${input.runA}/${input.runB}/`
    : `/share/replay/${input.word}/${input.runA}/`;
}
