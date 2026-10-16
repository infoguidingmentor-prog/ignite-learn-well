import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Home, Sparkles, CalendarDays, User, TrendingUp, Flower2, ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/home",       label: "Home",     icon: Home },
  { to: "/practice",   label: "Practice", icon: Flower2 },
  { to: "/grow",       label: "Grow",     icon: TrendingUp },
  { to: "/study-plan", label: "Plan",     icon: CalendarDays },
  { to: "/guide",      label: "Guide",    icon: Sparkles },
  { to: "/me",         label: "Me",       icon: User },
] as const;

/** Where "back" goes when there's no history to pop — e.g. a shared link. */
const FALLBACK: Record<string, string> = {
  "/assess": "/grow",
  "/progress": "/grow",
  "/focus": "/practice",
};

export function StudentShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // A main tab is a destination, not a detour — no back arrow on those.
  const isTab = TABS.some((t) => t.to === pathname);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      const parent = FALLBACK[pathname]
        ?? (pathname.startsWith("/practice/") ? "/practice" : "/home");
      router.navigate({ to: parent });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!isTab && (
        <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center px-4 py-2.5 md:px-6">
            <button
              onClick={goBack}
              aria-label="Go back"
              className="-ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              Back
            </button>
          </div>
        </div>
      )}

      <main
        className={cn(
          "mx-auto max-w-2xl px-4 pb-28 md:px-6 page-fade",
          isTab ? "pt-6 md:pt-10" : "pt-4 md:pt-6",
        )}
      >
        {children}
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-6">
          {TABS.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to !== "/home" && pathname.startsWith(to));
            return (
              <li key={to}>
                <Link
                  to={to}
                  className={cn(
                    "flex flex-col items-center gap-1 py-3 text-[11px] transition-colors",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-5 transition-transform", active && "-translate-y-0.5 stroke-[2.2]")} />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
