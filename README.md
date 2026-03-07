# SketchGuess Bench

Current repo structure:

- `bench/`: benchmark runner and HTTP API
- `visualizer/`: Bun-managed Next.js app and generated visualizer data
- `data/`: source-of-truth benchmark outputs and OpenRouter traces
- `original_bench/`, `original_visualizer/`: reference-only donor projects

Benchmark flow per word:

1. Drawer model receives the hidden word and returns SVG once.
2. Server renders SVG to JPEG once.
3. Guesser model receives that JPEG and returns one ordered list of 20 guesses.
4. Evaluation uses the first correct guess position in that order.

Scoring:

- Solved in `n` guesses => score `n`
- Not solved in 20 guesses => score `21`
- Lower total guesses is better

Trace + rerun:

- Every OpenRouter request/response is saved under `data/openrouter_traces/<runId>/<word>.json`
- Each word trace file keeps an `executions` history
- Existing runs are stored in `data/benchmarks`

Run the benchmark runner:

```bash
cd /Users/gmb/playground/bench_drawing
bun install

cd bench
export OPENROUTER_API_KEY="your_key_here"
bun run dev
```

Generate visualizer data:

```bash
cd /Users/gmb/playground/bench_drawing
bun run generate:visualizer-data
```

Run the visualizer:

```bash
cd /Users/gmb/playground/bench_drawing
bun run dev:visualizer
```

Open [http://localhost:3000](http://localhost:3000).

Notes:

- The current visualizer is a real Next.js app in `visualizer/`
- Legacy static files from the pre-restructure UI were preserved in `visualizer/public_legacy`
- Root workspace scripts are Bun-first
