import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Protected } from "@/components/protected";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/practice/meditate", label: "Meditate",    key: "meditation" },
  { to: "/practice/affirm",   label: "Affirmation", key: "affirmation" },
  { to: "/practice/journal",  label: "Journal",     key: "journal" },
  { to: "/practice/mood",     label: "Mood",        key: null },
  { to: "/practice/breathe",  label: "Breathe",     key: null },
  { to: "/focus",             label: "Focus",       key: null },
] as const;

type Game = {
  current_streak: number;
  today: { meditation: boolean; journal: boolean; affirmation: boolean };
};

export const Route = createFileRoute("/practice")({
  component: () => (
    <Protected>
      <PracticeLayout />
    </Protected>
  ),
});

function PracticeLayout() {
  const { user } = useAuth();

  const { data: g } = useQuery({
    enabled: !!user,
    queryKey: ["gamification", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_gamification", { _user: user!.id });
      if (error) throw error;
      return data as Game;
    },
  });

  const core = ["meditation", "affirmation", "journal"] as const;
  const done = g ? core.filter((k) => g.today[k]).length : 0;
  const pct = Math.round((done / core.length) * 100);

  return (
    <div className="space-y-5">
      <header className="gm-rise">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Practice</div>
        <h1 className="font-display text-3xl">The core loop</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {done === core.length
            ? "All three done today. Anything more is a bonus."
            : done === 0
            ? "Three small things. Start anywhere."
            : `${core.length - done} left today.`}
        </p>
      </header>

      {/* A thin progress strip instead of a 120px hero image — the content
          starts higher on a phone, which is where this is actually used. */}
      <div className="gm-rise" style={{ animationDelay: "60ms" }}>
        <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
          <span>{done} of {core.length} done today</span>
          {g?.current_streak ? <span>{g.current_streak}-day streak</span> : null}
        </div>
        <div className="gm-bar"><i style={{ width: `${pct}%` }} /></div>
      </div>

      <PracticeTabs today={g?.today} />
      <Outlet />
    </div>
  );
}

function PracticeTabs({ today }: { today?: Game["today"] }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-2">
        {TABS.map((t) => {
          const active = path === t.to;
          const complete = t.key ? today?.[t.key as keyof Game["today"]] : false;
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
                )}
              >
                {complete && (
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none"
                       stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                )}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
