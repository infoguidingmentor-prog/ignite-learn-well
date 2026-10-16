import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Protected } from "@/components/protected";
import { useAuth } from "@/hooks/use-auth";
import { NudgeCard } from "@/components/nudge-card";
import { MessagesCard } from "@/components/messages-card";
import { cn } from "@/lib/utils";
import { Flame, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/home")({
  component: () => <Protected><Home /></Protected>,
});

type Game = {
  points: number; current_streak: number; best_streak: number; active_days: number;
  today: { meditation: boolean; journal: boolean; affirmation: boolean };
  badges: string[];
};
type DayRow = { day: string; actions: number };
type Block = { id: string; start_time: string | null; subject: string | null; topic: string | null; status: string };

function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Late night";
}
const istToday = () => {
  const d = new Date(Date.now() + (330 - new Date().getTimezoneOffset()) * 60000);
  return d.toISOString().slice(0, 10);
};

const PRACTICES = [
  { key: "meditation",  label: "Meditation",  note: "A few quiet minutes",   to: "/practice/meditate" },
  { key: "affirmation", label: "Affirmation", note: "Read it out loud",      to: "/practice/affirm" },
  { key: "journal",     label: "Journal",     note: "Three lines is enough", to: "/practice/journal" },
] as const;

/** Counts up to a number once, then stays put. Respects reduced motion. */
function useCountUp(target: number, ms = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(target); return; }
    let raf = 0; const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

function Ring({ done, total }: { done: number; total: number }) {
  const C = 314;                                   // 2πr for r=50
  const pct = total ? done / total : 0;
  const ref = useRef<SVGCircleElement | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.strokeDashoffset = String(C);
    const t = setTimeout(() => { el.style.strokeDashoffset = String(C - C * pct); }, 120);
    return () => clearTimeout(t);
  }, [pct]);
  const shown = useCountUp(done);
  return (
    <div className="relative mx-auto" style={{ width: 132, height: 132 }}>
      <svg viewBox="0 0 120 120" className="size-full">
        <circle cx="60" cy="60" r="50" fill="none" strokeWidth="9" className="stroke-secondary" />
        <circle ref={ref} cx="60" cy="60" r="50" fill="none" strokeWidth="9" strokeLinecap="round"
          className="stroke-primary"
          style={{
            strokeDasharray: C, strokeDashoffset: C,
            transform: "rotate(-90deg)", transformOrigin: "50% 50%",
            transition: "stroke-dashoffset 1.1s cubic-bezier(.3,.9,.3,1)",
          }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <span className="block font-display text-3xl leading-none">{shown}</span>
          <span className="text-xs text-muted-foreground">of {total} done</span>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const { user } = useAuth();
  const first = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? "friend";
  const today = istToday();

  const { data: g } = useQuery({
    enabled: !!user,
    queryKey: ["gamification", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_gamification", { _user: user!.id });
      if (error) throw error;
      return data as Game;
    },
  });

  const { data: days = [] } = useQuery({
    enabled: !!user,
    queryKey: ["my-recent-days", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_recent_days", { _days: 14 });
      if (error) throw error;
      return (data ?? []) as DayRow[];
    },
  });

  const { data: blocks = [] } = useQuery({
    enabled: !!user,
    queryKey: ["today-blocks", user?.id, today],
    queryFn: async () => {
      const { data } = await supabase.from("plan_tasks")
        .select("id,start_time,subject,topic,status")
        .eq("user_id", user!.id).eq("day", today)
        .order("start_time");
      return (data ?? []) as Block[];
    },
  });

  const doneCount = g ? PRACTICES.filter((p) => g.today[p.key]).length : 0;
  const nextUndone = PRACTICES.find((p) => !g?.today[p.key]);
  const nextBlock = blocks.find((b) => b.status === "pending") ?? blocks[0];

  // Yesterday blank but the day before busy — offer a way back in, no scolding.
  const brokeStreak = (() => {
    if (days.length < 3) return false;
    const y = days[days.length - 2], dby = days[days.length - 3];
    return y?.actions === 0 && (dby?.actions ?? 0) > 0 && doneCount === 0;
  })();

  return (
    <div className="space-y-6">
      <header className="gm-rise">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <h1 className="font-display text-3xl">{greeting()}, {first}.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {doneCount === PRACTICES.length
            ? "Everything done today. Stop here."
            : doneCount === 0
            ? "Three small things today. None of them take long."
            : `${PRACTICES.length - doneCount} left today. Neither takes long.`}
        </p>
      </header>

      <NudgeCard />
      <MessagesCard />

      {brokeStreak && (
        <section className="soft-card gm-rise p-5" style={{ animationDelay: "60ms" }}>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Missed yesterday?</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing resets. Pick one small thing and the week carries on.
          </p>
          <Link to="/practice/meditate">
            <button className="mt-3 rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">
              Start with a short meditation
            </button>
          </Link>
        </section>
      )}

      {/* ----------------------- today's practice ----------------------- */}
      <section className="soft-card gm-rise p-6" style={{ animationDelay: "100ms" }}>
        <div className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
          Today's practice
        </div>
        <Ring done={doneCount} total={PRACTICES.length} />

        <ul className="mt-5 space-y-2">
          {PRACTICES.map((p) => {
            const done = g?.today[p.key] ?? false;
            return (
              <li key={p.key}>
                <Link to={p.to} className={cn(
                  "flex items-center gap-3 rounded-xl border border-border p-3 transition-colors",
                  done ? "border-primary/30 bg-primary/5" : "hover:bg-secondary/50",
                )}>
                  <span className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border transition-all",
                    done ? "border-primary bg-primary text-primary-foreground scale-105" : "border-border",
                  )}>
                    {done && (
                      <svg viewBox="0 0 24 24" className="size-4" fill="none"
                           stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                        <path d="M4 12.5l5 5L20 6.5" />
                      </svg>
                    )}
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

        {nextUndone && (
          <Link to={nextUndone.to}>
            <button className="mt-4 w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-px">
              Continue — {nextUndone.label.toLowerCase()}
            </button>
          </Link>
        )}
      </section>

      {/* --------------------------- streak --------------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "160ms" }}>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-apricot/15 gm-breathe">
            <Flame className="size-4 text-apricot" />
          </span>
          <div className="flex-1">
            <b className="text-base">
              {g?.current_streak ? `${g.current_streak}-day streak` : "No streak yet"}
            </b>
            <div className="text-xs text-muted-foreground">
              {g?.best_streak ? `Best: ${g.best_streak} days` : "Today is a fine place to start"}
              {g?.points ? ` · ${g.points} points` : ""}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {days.map((d, i) => (
            <div key={d.day}
              title={`${d.day} — ${d.actions || "nothing"}`}
              className={cn(
                "gm-pop aspect-square rounded-lg",
                d.actions >= 2 ? "bg-primary"
                  : d.actions === 1 ? "bg-primary/40"
                  : "bg-secondary",
              )}
              style={{ animationDelay: `${200 + i * 28}ms` }} />
          ))}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Last 14 days · darker means more practices
        </div>
      </section>

      {/* ------------------------ next study block ------------------------ */}
      {nextBlock && (
        <section className="soft-card gm-rise p-5" style={{ animationDelay: "220ms" }}>
          <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            Next study block
          </div>
          <div className="flex items-center gap-3">
            <b className="font-display text-xl tabular-nums">{nextBlock.start_time?.slice(0, 5)}</b>
            <div className="min-w-0 flex-1">
              <b className="block text-sm">{nextBlock.subject}</b>
              <span className="block text-xs text-muted-foreground">{nextBlock.topic}</span>
            </div>
            <Link to="/study-plan">
              <button className="inline-flex items-center gap-1 rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-secondary">
                Open <ArrowRight className="size-3.5" />
              </button>
            </Link>
          </div>
        </section>
      )}

      {blocks.length === 0 && (
        <section className="soft-card gm-rise p-5" style={{ animationDelay: "220ms" }}>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Study plan</div>
          <p className="mt-1 text-sm text-muted-foreground">
            No blocks for today. Build a plan and it lays out the next two weeks.
          </p>
          <Link to="/study-plan">
            <button className="mt-3 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">
              Build my plan
            </button>
          </Link>
        </section>
      )}
    </div>
  );
}
