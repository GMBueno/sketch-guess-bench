import type { Metadata } from "next";
import "./globals.css";

import { SiteNav } from "@/components/site-nav";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "SketchBench",
  description: "Visual reasoning benchmark for model drawing and guessing runs.",
  icons: {
    icon: `${basePath}/assets/logos/sb.ico`,
    shortcut: `${basePath}/assets/logos/sb.ico`,
    apple: `${basePath}/assets/logos/sb.ico`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
