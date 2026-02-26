# Guess Word Benchmark (OpenRouter)

A benchmark where each model plays against itself:
- Agent A (same model) gives one-word clues.
- Agent B (same model) guesses the hidden word.
- Alternating turns up to 10 clue/guess rounds per word.

## Models currently included
- `openai/gpt-5-mini`
- `google/gemini-3-flash-preview`

## How scoring works
- If solved in `n` guesses => score contribution is `n`.
- If not solved within 10 hints => contribution is `11` penalty.
- Lower total guesses wins.

## Setup

```bash
npm install
export OPENROUTER_API_KEY="your_key_here"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes
- Provider routing is fixed in code via `provider` request param.
- Structured outputs are enforced with `response_format: { type: "json_schema" }`.
- Data is stored in `data/benchmarks.json`.

## Note
A fail does not mean the model tried 10 guesses and couldn't get the right word.
It means the request failed for some reason.
Check #2 on ToDo's for more info.

## ToDo's
1. On running the bench
I want to be able to bench a model, on a word bank.
Not run the entire current word bank and for all models.
So, instead of a big button that runs the entire benchmark, we need to always only select the model and the wordbank we want. and then, on rankings, we can select the wordbank and see best results of a given model for that wordbank.
2. On fails
It's unacceptable that Kimi and Minimax have a failure rate so high. A fail doesn't mean that it exausted its 10 guesses, otherwise it would be fine. It means that the requests failed - maybe timeout, maybe provider problems, maybe whatever else. But i know that Kimi and Minimax models should NOT fail that much. Actually, they should not fail at all. So, it's unacceptable to have a benchmark that lists then the way it current is, as it's not a proper result, but a problem with the requests/provider/whatever. Doing task #1 will help on this because we can rerun the benchmark for a given model and a given wordbank. And it will be faster and cheaper to try different timeouts and providers.