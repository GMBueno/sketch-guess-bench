Original prompt: tem um jogo na tv brasileira que é assim: duas pessoas jogando, e uma dessas pessoas recebe uma palavra, por exemplo: "calor". aí, essa pessoa que recebeu a palavra pode falar uma palavra apenas, e não pode ser essa que ela recebeu, pra outra pessoa, e essa outra tem que tentar adivinhar a palavra certa. elas ficam alternando (uma dica, um chute, uma dica, um chute...). no final, conta-se quantas palavras precisaram ser chutadas.

- Initialized project from scratch.
- Implemented backend benchmark runner using OpenRouter with structured outputs.
- Added fixed provider parameter object in all model requests.
- Added 10-word bank, 10-hint limit, model self-play loop, and scoring with miss penalty.
- Added frontend for running benchmark, ranking table, and replay by model+word.
- Added render_game_to_text and advanceTime hooks for testing compatibility.
- TODO: run local server and validate end-to-end with at least one benchmark run when OPENROUTER_API_KEY is set.
- TODO: add automated tests for validation helpers and replay rendering.
- Hardened structured output parsing for multiple OpenRouter content shapes (string/array/object).
- Tightened one-word validation (rejects spaces instead of collapsing them).
- Added reverse substring guard so clue also cannot be a substring of the target.
- Added dotenv autoload so OPENROUTER_API_KEY can be read from .env.
- Fixed provider routing by model: OpenAI for GPT-5 Mini; Google AI Studio/Vertex for Gemini 3 Flash.
- Executed a full benchmark run successfully and confirmed ranking + replay render in UI.
- Fixed leakage risk: guesser function no longer receives `targetWord` parameter, and fallback no longer returns target.
- Parallelized benchmark execution with bounded concurrency utility.
- Added `BENCHMARK_CONCURRENCY` env var (default 6) and exposed it in `/api/status`.
- Verified new parallel run: completed in ~24.7s vs prior minute-level sequential behavior.
- Updated default benchmark concurrency to 20.
- Added models: minimax/minimax-m2.5, moonshotai/kimi-k2.5, z-ai/glm-5 with fixed providers.
- Removed JSON schema structured outputs globally; now uses prompt-constrained JSON plus robust parsing.
- Added retry/backoff for transient request failures and empty/invalid content responses.
- Ran full benchmark with 50 words x 5 models; results persisted successfully.
- Added live benchmark progress tracking in backend (`/api/benchmarks/progress`) with total/completed/percent/active model+word/error fields.
- Added run lock to prevent concurrent benchmark runs (`409 A benchmark is already running`).
- Updated dashboard to poll and show progress (`x/total`, percent, active item) and failure messages.
- Verified progress increments during execution (observed 0/225 -> 18/225 -> 33/225).
- Investigated late-stage stalls around MiniMax: root cause was missing hard timeout at game level, so a small number of stuck in-flight calls could hold run completion.
- Enforced retry cap constants (`REQUEST_MAX_RETRIES=3`) and request timeout (`OPENROUTER_TIMEOUT_MS`, default 30000ms).
- Added per-game timeout (`GAME_TIMEOUT_MS`, default 120000ms); timed-out/failed games are now recorded as failed instead of hanging the whole benchmark.
- Ranking now includes `failedCount`; progress line now shows failed count while running/completed.
- Validated with forced low game timeout: run completed quickly and persisted failed games instead of stalling.
- Fixed guesser leakage: removed `wordBank` from guesser payload (guesser now uses only clue/guess history).
- Added accent/case-insensitive normalization for correctness checks (e.g., `Brasília` == `brasilia`).
- Updated token validation regex to accept Unicode letters (accented words) for clues/guesses.
- Aligned duplicate-guess tracking and fallback logic to normalized words.
- Fixed GitHub Pages custom-domain export: visualizer base path is now opt-in via `NEXT_PUBLIC_BASE_PATH` instead of automatically forcing `/sketch-guess-bench` on every Actions build.

- Updated replay page UX: clicking a word row now opens a modal popup with larger images and guesses below the image in a two-column layout, designed to stay usable on mobile.

- Added replay deep links: `/replay` now reads and writes `runA`/`runB`/`runC` query params using shareable model slugs (with fallbacks for raw runId/modelId).

- Extended replay deep links with `word=` so shared URLs can open a specific word modal directly and clear it again when the modal closes.

- Added a static social-share route for replay cards with generated OG/Twitter images showing the selected word drawings side by side.

- Refined static share-page plan: canonical share URLs now support 1-run and 2-run pages, and the generator writes directory-style landing pages for both without needing to regenerate preview assets yet.

- Added share-link UX: replay now exposes a Share link button and mirrors shareable 1-run/2-run word states into the address bar via history.replaceState without reloading.
