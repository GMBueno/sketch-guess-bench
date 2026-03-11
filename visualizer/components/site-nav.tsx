"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import benchmarkData from "../data/benchmark-results.json";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/ranking", label: "Accuracy" },
  { href: "/cost", label: "Cost" },
  { href: "/speed", label: "Speed" },
  { href: "/replay", label: "Replay" },
  { href: "/matrix", label: "Matrix" },
  { href: "/table", label: "Table" },
  { href: "/about", label: "About" },
];

function normalizePath(path: string | null | undefined) {
  if (!path) return "/";
  const normalized = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  return normalized || "/";
}

function formatDate(value: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return `${year}-${month}-${day} ${time}`;
}

export function SiteNav() {
  const pathname = usePathname();
  const lastSync = (benchmarkData as { metadata?: { timestamp?: string } }).metadata?.timestamp || null;
  const currentPath = normalizePath(pathname);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/50 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-[-0.03em] text-white">
          Sketch<span style={{ color: "#EF0044" }}>Bench</span>
        </Link>
        <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = currentPath === normalizePath(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative shrink-0 px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-white",
                  active && "font-bold text-[#EF0044] after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:rounded-full after:bg-[#EF0044]"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden shrink-0 text-[11px] uppercase tracking-[0.18em] text-neutral-500 xl:block">
          Last Sync: {formatDate(lastSync)}
        </div>
      </div>
    </header>
  );
}
