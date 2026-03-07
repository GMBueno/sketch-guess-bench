# SketchGuess Bench

Current repo structure:

- `bench/`: benchmark runner and HTTP API
- `visualizer/`: frontend assets and generated visualizer data
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

Run the current benchmark app:

```bash
cd bench
npm install
export OPENROUTER_API_KEY="your_key_here"
npm run dev
```

Generate visualizer data:

```bash
cd bench
npm run generate:visualizer-data
```

The current static frontend assets live in `visualizer/public` and are served by the benchmark server.
