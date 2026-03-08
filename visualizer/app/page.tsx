"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EXAMPLES = [
  {
    key: "rocket",
    label: "Rocket",
    title: "Gemini 3 Flash (dynamic)",
    svg: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='512' height='512'><path d='M256 50 L320 150 L320 350 L192 350 L192 150 Z' fill='#cccccc' stroke='#333' stroke-width='4'/><path d='M256 50 C256 50 320 100 320 180 L192 180 C192 100 256 50 256 50' fill='#ff4444' stroke='#333' stroke-width='4'/><path d='M192 280 L140 380 L192 380 Z' fill='#ff4444' stroke='#333' stroke-width='4'/><path d='M320 280 L372 380 L320 380 Z' fill='#ff4444' stroke='#333' stroke-width='4'/><circle cx='256' cy='230' r='25' fill='#88ccff' stroke='#333' stroke-width='3'/><path d='M210 350 L200 420 L312 420 L302 350' fill='#555'/><path d='M220 420 L200 480 L256 500 L312 480 L292 420' fill='#ffaa00'><animate attributeName='fill' values='#ffaa00;#ff4400;#ffaa00' dur='0.2s' repeatCount='indefinite'/></path></svg>`,
    guessLine: "1. rocket",
  },
  {
    key: "tokyo",
    label: "Tokyo",
    title: "Gemini 3 Flash (dynamic)",
    svg: `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" background-color="#ffffff"><rect width="512" height="512" fill="#f0f0f0"/><circle cx="256" cy="200" r="80" fill="#bc002d"/><path d="M100 450 L100 350 L150 350 L150 450 M160 450 L160 300 L210 300 L210 450 M220 450 L220 250 L270 250 L270 450 M280 450 L280 320 L330 320 L330 450 M340 450 L340 280 L390 280 L390 450 M400 450 L400 360 L450 360 L450 450" fill="#333333"/><path d="M180 450 L256 100 L332 450" fill="none" stroke="#ff4444" stroke-width="8"/><line x1="210" y1="350" x2="302" y2="350" stroke="#ff4444" stroke-width="8"/><line x1="230" y1="250" x2="282" y2="250" stroke="#ff4444" stroke-width="8"/><rect x="80" y="450" width="352" height="20" fill="#666666"/></svg>`,
    guessLine: "1. tokyo",
  },
  {
    key: "wander",
    label: "Wander",
    title: "Gemini 3 Flash (dynamic)",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#f0f0f0"/><path d="M50 400 Q 150 350, 200 420 T 350 380 T 480 450" fill="none" stroke="#8b4513" stroke-width="12" stroke-dasharray="20,15"/><circle cx="480" cy="450" r="8" fill="#8b4513"/><path d="M240 380 L255 380 L260 340 L275 340" fill="none" stroke="#333" stroke-width="6" stroke-linecap="round"/><circle cx="260" cy="325" r="10" fill="#333"/><path d="M260 340 L245 365 M260 340 L275 365" stroke="#333" stroke-width="6" stroke-linecap="round"/><path d="M100 150 Q 120 120, 150 150 T 200 150" fill="none" stroke="#ccc" stroke-width="20" stroke-linecap="round"/><path d="M350 100 Q 370 70, 400 100 T 450 100" fill="none" stroke="#ccc" stroke-width="20" stroke-linecap="round"/><path d="M50 400 L40 410 M50 400 L60 410" fill="none" stroke="#8b4513" stroke-width="4"/></svg>`,
    guessLine: "1. Path, 2. Trail, ... 18. wander",
  },
] as const;

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="noise-overlay" />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="rounded-[28px]">
            <CardHeader>
              <CardDescription>Visual Reasoning Benchmark</CardDescription>
              <CardTitle className="text-3xl text-white sm:text-4xl">SketchBench</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm leading-7 text-neutral-300 sm:text-base">
              <p>One model is given a hidden word and draws as SVG. The same model, but a different instance, is given a rendered JPEG of that SVG and guesses what that is (the hidden word).</p>
              <ul className="list-disc list-inside">
                <li>Guesser has 20 tries.</li>
                <li>Wordbank has 100 words and runs each word only once per run.</li>
                <li>Accuracy is measured by how many drawings it got right.</li>
                <li>We also measure cost, time, and avg guesses.</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="rounded-[28px]">
            <CardHeader>
              <CardDescription>Examples</CardDescription>
              <CardTitle className="text-white">Gemini 3 Flash</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="rocket" className="w-full">
                <TabsList className="mb-5 flex gap-2">
                  {EXAMPLES.map((example) => (
                    <TabsTrigger key={example.key} value={example.key}>{example.label}</TabsTrigger>
                  ))}
                </TabsList>
                {EXAMPLES.map((example) => (
                  <TabsContent key={example.key} value={example.key} className="mt-0">
                    <div className="grid gap-5">
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <div className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-500">{example.label} Drawing</div>
                        <div className="mx-auto aspect-square max-w-[320px] rounded-2xl bg-neutral-950 p-4">
                          <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: example.svg }} />
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-500">Guess Sequence</div>
                        <div className="inline-flex rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-sm text-green-300">{example.guessLine}</div>
                      </div>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
