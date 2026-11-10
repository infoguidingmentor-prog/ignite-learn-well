import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Home, Sparkles, CalendarDays, User, TrendingUp, Flower2, ChevronLeft, Gauge, GraduationCap,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";

const TABS = [
  { to: "/home",       label: "Home",     icon: Home },
  { to: "/qtracker",   label: "Qtracker", icon: Gauge },
  { to: "/mentors",    label: "Mentors",  icon: GraduationCap },
  { to: "/practice",   label: "Practice", icon: Flower2 },
  { to: "/grow",       label: "Grow",     icon: TrendingUp },
  { to: "/study-plan", label: "Plan",     icon: CalendarDays },
  { to: "/guide",      label: "Guide",    icon: Sparkles },
  { to: "/me",         label: "Me",       icon: User },
] as const;

/** Screens built for a wide canvas (dashboards). Everything else keeps the narrow reading column. */
const WIDE = ["/qtracker", "/mentors"];

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
  const wide = WIDE.some((p) => pathname.startsWith(p));
  const isActive = (to: string) => pathname === to || (to !== "/home" && pathname.startsWith(to));

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
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card md:flex">
        <div className="px-5 py-5"><BrandLogo /></div>
        <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3">
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to} to={to}
              aria-current={isActive(to) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive(to) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="md:pl-60">
        {!isTab && (
          <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
            <div className={cn("mx-auto flex items-center px-4 py-2.5 md:px-6", wide ? "max-w-6xl" : "max-w-2xl")}>
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
            "mx-auto px-4 pb-28 md:px-8 md:pb-12 page-fade",
            wide ? "max-w-6xl" : "max-w-2xl",
            isTab ? "pt-6 md:pt-10" : "pt-4 md:pt-6",
          )}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom bar: scrolls sideways so all eight destinations stay reachable */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
      >
        <ul className="flex overflow-x-auto [scrollbar-width:none]">
          {TABS.map(({ to, label, icon: Icon }) => {
            const active = isActive(to);
            return (
              <li key={to} className="min-w-[4.5rem] flex-1">
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
