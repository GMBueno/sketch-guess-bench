import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SketchGuess Bench",
  description: "Benchmark visualizer for model drawing and guessing runs."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
