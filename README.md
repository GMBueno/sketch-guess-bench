# SketchGuess Bench

Benchmark flow per word:
1. Drawer model receives the hidden word and returns SVG once.
2. Server renders SVG to JPEG once.
3. Guesser model receives that JPEG and returns one ordered list of 20 guesses.
4. Evaluation uses the first correct guess position in that order.

Scoring:
- Solved in `n` guesses => score `n`
- Not solved in 20 guesses => score `21`
- Lower total guesses is better

Current setup:
- Models: `google/gemini-3-flash-preview`, `openai/gpt-5-mini` (provider: `azure`), `moonshotai/kimi-k2.5` (provider: `moonshotai/int4`), `anthropic/claude-haiku-4.5` (provider: `google-vertex`), `openai/gpt-5.1-codex-mini` (provider: `openai`), `openai/gpt-5-nano` (provider: `openai`), `google/gemini-2.5-flash-lite` (provider: `google-ai-studio`)
- Word bank lives in `data/wordbank.js`
- Dashboard is read-only (rankings + replay only)
- Benchmarks run one model at a time
- Runs include `effort` (`xhigh|high|medium|low|minimal|none`). Existing historic runs are annotated as `medium`.

Replay dashboard:
- Shows turn-by-turn guesses
- Shows SVG for each draw turn, with optional JPEG popup
- Rankings now include run cost (`Cost (USD)`) and a solved-vs-cost chart

Trace + rerun:
- Every OpenRouter request/response is saved under `data/openrouter_traces/<runId>/<word>.json`
- Each word trace file keeps an `executions` history (initial run + any retries)
- You can rerun just one word in an existing run:

```bash
curl -s -X POST http://localhost:3000/api/benchmarks/<runId>/retry-word \
  -H "Content-Type: application/json" \
  -d '{"targetWord":"cat"}'
```

## Run

```bash
npm install
export OPENROUTER_API_KEY="your_key_here"
npm run dev
curl -s -X POST http://localhost:3000/api/benchmarks/run \
  -H "Content-Type: application/json" \
  -d '{"modelKey":"gpt5mini","effort":"xhigh"}'
```

Open [http://localhost:3000](http://localhost:3000).
