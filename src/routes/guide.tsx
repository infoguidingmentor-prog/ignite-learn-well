import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Protected } from "@/components/protected";
import { cn } from "@/lib/utils";
import { Sparkles, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/guide")({
  component: () => <Protected><Guide /></Protected>,
});

type Game = {
  current_streak: number; active_days: number;
  today: { meditation: boolean; journal: boolean; affirmation: boolean };
};
type Block = { id: string; start_time: string | null; subject: string | null; topic: string | null; status: string };
type Mark = { subject: string; percentage: number; exam_date: string };
type Cmp = { dimension: string; previous: number | null; current: number | null; change: number };

const DIM_LABEL: Record<string, string> = {
  stress: "stress", control: "self-control", focus: "focus", time: "time management",
  clarity: "study clarity", planning: "planning", motivation: "motivation",
  energy: "energy", habits: "study habits",
};

const istToday = () => {
  const d = new Date(Date.now() + (330 - new Date().getTimezoneOffset()) * 60000);
  return d.toISOString().slice(0, 10);
};

function Guide() {
  const { user } = useAuth();
  const today = istToday();
  const [asked, setAsked] = useState<{ q: string; a: string }[]>([]);

  const { data: g } = useQuery({
    enabled: !!user, queryKey: ["gamification", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_gamification", { _user: user!.id });
      if (error) throw error; return data as Game;
    },
  });

  const { data: blocks = [] } = useQuery({
    enabled: !!user, queryKey: ["today-blocks", user?.id, today],
    queryFn: async () => {
      const { data } = await supabase.from("plan_tasks")
        .select("id,start_time,subject,topic,status")
        .eq("user_id", user!.id).eq("day", today).order("start_time");
      return (data ?? []) as Block[];
    },
  });

  const { data: marks = [] } = useQuery({
    enabled: !!user, queryKey: ["my-marks", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("marks")
        .select("subject,percentage,exam_date")
        .eq("user_id", user!.id).order("exam_date", { ascending: false }).limit(20);
      return (data ?? []) as Mark[];
    },
  });

  const { data: cmp = [] } = useQuery({
    enabled: !!user, queryKey: ["assessment-comparison", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("assessment_comparison", { _user: user!.id });
      if (error) throw error; return (data ?? []) as Cmp[];
    },
  });

  /* ---- everything below is computed from the student's own rows ---- */

  const weakestSubject = useMemo(() => {
    if (!marks.length) return null;
    const avg: Record<string, number[]> = {};
    marks.forEach((m) => (avg[m.subject] ??= []).push(Number(m.percentage)));
    let worst: { subject: string; pct: number } | null = null;
    for (const [s, xs] of Object.entries(avg)) {
      const p = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
      if (!worst || p < worst.pct) worst = { subject: s, pct: p };
    }
    return worst;
  }, [marks]);

  const weakestDim = useMemo(() => {
    const scored = cmp.filter((c) => c.current != null);
    if (!scored.length) return null;
    return scored.reduce((a, b) => ((a.current ?? 100) <= (b.current ?? 100) ? a : b));
  }, [cmp]);

  const pendingBlocks = blocks.filter((b) => b.status === "pending");
  const undonePractices = (["meditation", "affirmation", "journal"] as const)
    .filter((k) => !g?.today[k]);

  const priorities = useMemo(() => {
    const out: { text: string; why: string; to?: string }[] = [];
    if (pendingBlocks.length) {
      const b = pendingBlocks[0];
      out.push({
        text: `${b.subject} at ${b.start_time?.slice(0, 5)} — ${b.topic?.toLowerCase()}`,
        why: weakestSubject && b.subject === weakestSubject.subject
          ? `Your ${b.subject} average is ${weakestSubject.pct}%, the lowest of your subjects.`
          : "First unfinished block on today's plan.",
        to: "/study-plan",
      });
    }
    if (undonePractices.length) {
      out.push({
        text: `${undonePractices[0]} — a few minutes`,
        why: g?.current_streak
          ? `You're on a ${g.current_streak}-day run. One practice keeps it going.`
          : "Starting is the whole thing today.",
        to: `/practice/${undonePractices[0] === "meditation" ? "meditate"
             : undonePractices[0] === "affirmation" ? "affirm" : "journal"}`,
      });
    }
    if (weakestDim && (weakestDim.current ?? 0) < 50) {
      out.push({
        text: `Go easier on yourself around ${DIM_LABEL[weakestDim.dimension] ?? weakestDim.dimension}`,
        why: `That scored ${weakestDim.current}/100 on your last check-in — the lowest of the nine.`,
        to: "/progress",
      });
    }
    return out.slice(0, 3);
  }, [pendingBlocks, undonePractices, weakestSubject, weakestDim, g]);

  const QUESTIONS: { q: string; a: () => string }[] = [
    {
      q: "I only have 2 hours today",
      a: () => {
        if (!pendingBlocks.length) return "Nothing is pending on your plan today, so two hours is yours. If you want to use them, the lowest-scoring subject is where they'd count most.";
        const keep = pendingBlocks.slice(0, 2);
        const drop = pendingBlocks.slice(2);
        return `Keep ${keep.map((b) => `${b.subject} at ${b.start_time?.slice(0, 5)}`).join(" and ")}.`
          + (drop.length ? ` Move ${drop.map((b) => b.subject).join(", ")} to tomorrow — ${drop.length === 1 ? "it isn't" : "they aren't"} urgent.` : "");
      },
    },
    {
      q: "What should I work on most?",
      a: () => weakestSubject
        ? `${weakestSubject.subject}. Your average there is ${weakestSubject.pct}% across ${marks.filter((m) => m.subject === weakestSubject.subject).length} result(s), lower than your other subjects. That's whole-paper scores though — I can't see which topics inside it are costing you.`
        : "I don't have any marks yet, so I'd be guessing. Add a couple of test results and this becomes a real answer.",
    },
    {
      q: "How am I actually doing?",
      a: () => {
        const bits: string[] = [];
        if (g?.active_days) bits.push(`${g.active_days} active days so far`);
        if (g?.current_streak) bits.push(`a ${g.current_streak}-day streak`);
        const improved = cmp.filter((c) => c.change > 0).sort((a, b) => b.change - a.change)[0];
        if (improved) bits.push(`${DIM_LABEL[improved.dimension] ?? improved.dimension} up ${improved.change} points since your first check-in`);
        return bits.length
          ? `${bits.join(", ")}. Not nothing.`
          : "Too early to say. Take the assessment once and this gets a real answer.";
      },
    },
    {
      q: "I'm behind and it's stressing me out",
      a: () => "Being behind usually means the plan asked too much, not that you failed. Cut tomorrow to two blocks and finish them — a short day you complete beats a long one you abandon. If the stress is bigger than the studying, talk to your coach. That's what they're for.",
    },
  ];

  const ask = (q: string, a: string) => setAsked((prev) => [...prev, { q, a }]);

  return (
    <div className="space-y-5">
      <header className="gm-rise">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Guide</div>
        <h1 className="font-display text-3xl">What to do today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Study planning and accountability. Not a counsellor.
        </p>
      </header>

      {/* ---------------------- priorities ---------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "60ms" }}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Your top {priorities.length || "priorities"}
          </span>
        </div>

        {priorities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing pending — practices done and no blocks left today. Rest counts.
          </p>
        ) : (
          <ol className="gm-stagger space-y-3">
            {priorities.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium first-letter:uppercase">{p.text}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{p.why}</div>
                  {p.to && (
                    <Link to={p.to}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      Open <ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---------------------- conversation ---------------------- */}
      <section className="gm-rise" style={{ animationDelay: "120ms" }}>
        {asked.map((x, i) => (
          <div key={i} className="mb-3">
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
              {x.q}
            </div>
            <div className="mt-2 max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm">
              {x.a}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          {QUESTIONS.filter((q) => !asked.some((a) => a.q === q.q)).map((q) => (
            <button key={q.q} onClick={() => ask(q.q, q.a())}
              className={cn(
                "rounded-full border border-border px-3.5 py-2 text-left text-sm",
                "transition-colors hover:bg-secondary",
              )}>
              {q.q}
            </button>
          ))}
        </div>
      </section>

      {/* ---------------------- honesty ---------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "180ms" }}>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">How this works</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything here is worked out from your own blocks, marks and check-ins — nothing
          is invented. It can't yet answer questions you type, and it doesn't know which
          topics inside a subject are costing you marks.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/study-plan">
            <button className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">
              Open my plan
            </button>
          </Link>
          <Link to="/progress">
            <button className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">
              See my progress
            </button>
          </Link>
        </div>
      </section>
    </div>
  );
}
