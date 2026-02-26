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
- Models: `google/gemini-3-flash-preview`, `openai/gpt-5-mini` (provider: `azure`), `moonshotai/kimi-k2.5` (provider: `moonshotai/int4`)
- Word bank lives in `data/wordbank.js`
- Dashboard is read-only (rankings + replay only)
- Benchmarks run one model at a time

Replay dashboard:
- Shows turn-by-turn guesses
- Shows SVG for each draw turn, with optional JPEG popup

## Run

```bash
npm install
export OPENROUTER_API_KEY="your_key_here"
npm run dev
curl -s -X POST http://localhost:3000/api/benchmarks/run \
  -H "Content-Type: application/json" \
  -d '{"modelKey":"gpt5mini"}'
```

Open [http://localhost:3000](http://localhost:3000).
