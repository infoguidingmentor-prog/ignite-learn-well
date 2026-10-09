import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Sparkles, Timer, CalendarDays, User, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/home",     label: "Home",     icon: Home },
  { to: "/practice", label: "Practice", icon: Sparkles },
  { to: "/focus",    label: "Focus",    icon: Timer },
  { to: "/grow",     label: "Grow",     icon: TrendingUp },
  { to: "/plan",     label: "Plan",     icon: CalendarDays },
  { to: "/me",       label: "Me",       icon: User },
] as const;

export function StudentShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-2xl px-4 pb-28 pt-6 md:px-6 md:pt-10 page-fade">
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
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className={cn("size-5", active && "stroke-[2.2]")} />
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
