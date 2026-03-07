import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AboutContent() {
  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="noise-overlay" />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="rounded-[28px]">
          <CardHeader className="pb-2">
            <CardTitle className="text-3xl text-white sm:text-4xl">SketchBench</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-sm leading-7 text-neutral-300 sm:text-base">
            <div>
              <div className="text-lg font-medium text-white">Visual Reasoning Benchmark</div>
              <p>One model draws a hidden word as SVG. The guesser model sees a rendered JPEG and returns ordered guesses.</p>
            </div>
            <p>SketchBench tests if models can both depict and infer concepts through drawings. It tracks solved words, failures, and guess efficiency.</p>
            <p>SketchGuess Bench measures visual world modeling and visual understanding together. A drawer model must transform a concept into a compact SVG, and a guesser model must recover that concept from a rasterized image. This setup probes abstraction, depiction quality, and inference quality in one loop.</p>
            <p><span className="font-medium text-white">Motivation:</span> text-only benchmarks miss whether models can represent grounded concepts visually. This benchmark adds a lightweight visual channel while keeping runs cheap and repeatable.</p>
            <p><span className="font-medium text-white">Pros:</span> easy to run, low cost, interpretable per-word replay, and direct side-by-side model comparison.</p>
            <p><span className="font-medium text-white">Cons:</span> scoring depends on wordbank composition, visual style priors can bias outcomes, and OOD svgs.</p>
            <p className="uppercase tracking-[0.18em] text-neutral-500">Dashboard is read-only.</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
