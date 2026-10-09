import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Protected } from "@/components/protected";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Flame, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/grow")({
  component: () => <Protected><Grow /></Protected>,
});

type Game = {
  points: number;
  current_streak: number;
  best_streak: number;
  active_days: number;
  today: { meditation: boolean; journal: boolean; affirmation: boolean };
  badges: string[];
};

const BADGES: Record<string, { label: string; note: string }> = {
  first_step:  { label: "First step",   note: "You started." },
  baseline:    { label: "Baseline set", note: "First assessment done." },
  returned:    { label: "Came back",    note: "Reassessed yourself." },
  streak_3:    { label: "3 in a row",   note: "Three days running." },
  streak_7:    { label: "7 in a row",   note: "A full week." },
  streak_30:   { label: "30 in a row",  note: "A month of showing up." },
  days_10:     { label: "10 days",      note: "Ten active days." },
  days_50:     { label: "50 days",      note: "Fifty active days." },
};

const PRACTICES = [
  { key: "meditation",  label: "Meditation",  note: "A few quiet minutes", to: "/practice/meditate" },
  { key: "journal",     label: "Journal",     note: "Three lines is enough", to: "/practice/journal" },
  { key: "affirmation", label: "Affirmation", note: "Read it out loud", to: "/practice/affirm" },
] as const;

function Grow() {
  const { user } = useAuth();

  const { data: g, isLoading } = useQuery({
    enabled: !!user,
    queryKey: ["gamification", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_gamification", { _user: user!.id });
      if (error) throw error;
      return data as Game;
    },
  });

  const { data: runs = [] } = useQuery({
    enabled: !!user,
    queryKey: ["my-assessments", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("assessment_runs")
        .select("id, taken_at, overall")
        .eq("user_id", user!.id).order("taken_at", { ascending: false });
      return data ?? [];
    },
  });

  const doneToday = g
    ? PRACTICES.filter((p) => g.today[p.key as keyof Game["today"]]).length
    : 0;
  const pct = Math.round((doneToday / PRACTICES.length) * 100);

  const lastRun = runs[0] as any;
  const daysSince = lastRun
    ? Math.floor((Date.now() - new Date(lastRun.taken_at).getTime()) / 86400000)
    : null;
  const dueAgain = daysSince !== null && daysSince >= 14;

  return (
    <div className="space-y-7">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Grow</div>
        <h1 className="font-display text-3xl">Today's practices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Three small things. Doing them most days matters more than doing them perfectly.
        </p>
      </header>

      {/* ------------------------- today ------------------------- */}
      <section className="soft-card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm font-medium">{doneToday} of {PRACTICES.length} done</span>
          {g && g.current_streak > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Flame className="size-4 text-primary" />
              <span className="font-semibold">{g.current_streak}-day streak</span>
            </span>
          )}
        </div>

        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>

        <ul className="space-y-2">
          {PRACTICES.map((p) => {
            const done = g?.today[p.key as keyof Game["today"]] ?? false;
            return (
              <li key={p.key}>
                <Link to={p.to}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border border-border p-3 transition-colors",
                    done ? "bg-primary/5 border-primary/30" : "hover:bg-secondary/50",
                  )}>
                  <span className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border",
                    done ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}>
                    {done && <Check className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block font-medium", done && "text-muted-foreground line-through")}>
                      {p.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{p.note}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {doneToday === PRACTICES.length && (
          <p className="mt-3 text-sm text-primary">All three done today. That's the whole ask.</p>
        )}
      </section>

      {/* ------------------------ numbers ------------------------ */}
      <section className="grid grid-cols-3 gap-3">
        {[
          ["Points", g?.points ?? 0, "earned so far"],
          ["Best streak", g?.best_streak ?? 0, "days in a row"],
          ["Active days", g?.active_days ?? 0, "since you joined"],
        ].map(([label, value, note]) => (
          <div key={label as string} className="soft-card p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className="mt-1 font-display text-2xl tabular-nums">{isLoading ? "—" : value}</div>
            <div className="text-[10px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </section>

      {/* ---------------------- assessment ----------------------- */}
      <section className="soft-card p-5">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">
              {runs.length === 0 ? "Start with an honest baseline"
                : dueAgain ? "Time to check in again"
                : "Your study quality"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {runs.length === 0
                ? "Eighteen short questions. It's the line everything else gets measured against."
                : dueAgain
                ? `Your last check-in was ${daysSince} days ago. Take it again to see what moved.`
                : `${lastRun?.overall ?? 0}/100 as of ${new Date(lastRun.taken_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/assess">
                <Button size="sm" className="rounded-full">
                  {runs.length === 0 ? "Take the assessment" : "Retake"}
                </Button>
              </Link>
              {runs.length > 0 && (
                <Link to="/progress">
                  <Button size="sm" variant="outline" className="rounded-full">See progress</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------ badges ------------------------- */}
      {g && g.badges?.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Earned</h2>
          <ul className="flex flex-wrap gap-2">
            {g.badges.map((code) => {
              const b = BADGES[code];
              if (!b) return null;
              return (
                <li key={code} title={b.note}
                    className="rounded-full border border-primary/30 bg-primary/5 px-3.5 py-1.5 text-sm">
                  {b.label}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
