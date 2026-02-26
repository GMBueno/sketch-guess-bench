# SVG Draw Guess Benchmark (OpenRouter)

Benchmark flow per word:
1. Drawer model receives the hidden word and returns SVG.
2. Server renders SVG to JPEG.
3. Guesser model receives the JPEG and makes a one-word guess.
4. If wrong, another draw/guess turn runs (up to 10 guesses).

Scoring:
- Solved in `n` guesses => score `n`
- Not solved in 10 guesses => score `11`
- Lower total guesses is better

Current setup (fast + cheap iteration):
- Model: `google/gemini-3-flash-preview`
- Word bank: `shark`, `car`, `mars`

Replay dashboard:
- Shows turn-by-turn guesses
- Shows both JPEG fed to guesser and SVG source for each draw turn

## Run

```bash
npm install
export OPENROUTER_API_KEY="your_key_here"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
