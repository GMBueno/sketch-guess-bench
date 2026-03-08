"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/50 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-[-0.03em] text-white">
          Sketch<span style={{ color: "#EF0044" }}>Bench</span>
        </Link>
        <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-white",
                  active && "bg-white/10 text-white"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
