import type { Metadata } from "next";
import "./globals.css";

import { SiteNav } from "@/components/site-nav";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;

export const metadata: Metadata = {
  title: "SketchBench",
  description: "Visual reasoning benchmark for model drawing and guessing runs.",
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
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
