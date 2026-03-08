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
            <p>We are currently running the benchmark on more models and will update the rankings soon.</p>
            <p>In the future, we might create a private set of words for benchmarking and keep the replay with the public set (100 words).</p>
            <p>Dashboard is read-only.</p>
            <p>Contact me at x.com/gmbueno</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
