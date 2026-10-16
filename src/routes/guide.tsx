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
  current_streak: number; best_streak: number; active_days: number;
  today: { meditation: boolean; journal: boolean; affirmation: boolean };
};
type DayRow = { day: string; actions: number };
type Block = { id: string; start_time: string | null; subject: string | null; topic: string | null; status: string };
type Mark = { subject: string; percentage: number; exam_date: string };
type Cmp = { dimension: string; previous: number | null; current: number | null; change: number };
type Staff = { id: string; name: string; kind: "mentor" | "coach"; specialties: string | null; bio: string | null };

const DIM_LABEL: Record<string, string> = {
  stress: "stress", control: "self-control", focus: "focus", time: "time management",
  clarity: "study clarity", planning: "planning", motivation: "motivation",
  energy: "energy", habits: "study habits",
};
/** Low scores here are about wellbeing, not syllabus — they route to a coach. */
const WELLBEING_DIMS = ["stress", "motivation", "energy", "control"];

const istToday = () => {
  const d = new Date(Date.now() + (330 - new Date().getTimezoneOffset()) * 60000);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

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

  const { data: days = [] } = useQuery({
    enabled: !!user, queryKey: ["my-recent-days-30", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_recent_days", { _days: 30 });
      if (error) throw error; return (data ?? []) as DayRow[];
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

  /** Active, verified staff the student could be pointed at. */
  const { data: staff = [] } = useQuery({
    queryKey: ["guide-staff"],
    queryFn: async () => {
      const out: Staff[] = [];
      const { data: m } = await supabase.from("mentors")
        .select("id, specialties, bio, profile:profiles!mentors_profile_id_fkey(full_name)")
        .eq("active", true);
      (m ?? []).forEach((x: any) => out.push({
        id: x.id, kind: "mentor",
        name: x.profile?.full_name ?? "Mentor",
        specialties: Array.isArray(x.specialties) ? x.specialties.join(", ") : x.specialties ?? null,
        bio: x.bio ?? null,
      }));
      const { data: c } = await supabase.from("coaches")
        .select("id, certification_name, profile:profiles!coaches_profile_id_fkey(full_name)")
        .eq("active", true);
      (c ?? []).forEach((x: any) => out.push({
        id: x.id, kind: "coach",
        name: x.profile?.full_name ?? "Coach",
        specialties: x.certification_name ?? null, bio: null,
      }));
      return out;
    },
  });

  /* ------------------------- derived facts ------------------------- */

  const weakestSubject = useMemo(() => {
    if (!marks.length) return null;
    const by: Record<string, number[]> = {};
    marks.forEach((m) => (by[m.subject] ??= []).push(Number(m.percentage)));
    let worst: { subject: string; pct: number; n: number } | null = null;
    for (const [s, xs] of Object.entries(by)) {
      const p = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
      if (!worst || p < worst.pct) worst = { subject: s, pct: p, n: xs.length };
    }
    return worst;
  }, [marks]);

  const weakestDim = useMemo(() => {
    const scored = cmp.filter((c) => c.current != null);
    if (!scored.length) return null;
    return scored.reduce((a, b) => ((a.current ?? 100) <= (b.current ?? 100) ? a : b));
  }, [cmp]);

  const usage = useMemo(() => {
    const active = days.filter((d) => d.actions > 0);
    const quiet = days.filter((d) => d.actions === 0);
    // The longest unbroken run of blank days in the window.
    let gap = 0, run = 0, gapEnd = "";
    days.forEach((d) => {
      if (d.actions === 0) { run++; if (run > gap) { gap = run; gapEnd = d.day; } }
      else run = 0;
    });
    const gapStart = gapEnd
      ? days[days.findIndex((d) => d.day === gapEnd) - gap + 1]?.day ?? gapEnd
      : "";
    const busiest = days.reduce<DayRow | null>((a, b) => (!a || b.actions > a.actions ? b : a), null);
    return {
      activeCount: active.length, quietCount: quiet.length,
      windowSize: days.length, longestGap: gap, gapStart, gapEnd,
      busiest, max: Math.max(1, ...days.map((d) => d.actions)),
    };
  }, [days]);

  const pending = blocks.filter((b) => b.status === "pending");
  const undone = (["meditation", "affirmation", "journal"] as const).filter((k) => !g?.today[k]);

  /** Who to talk to, and why. Syllabus trouble → mentor. Wellbeing → coach. */
  const suggestion = useMemo(() => {
    const mentors = staff.filter((s) => s.kind === "mentor");
    const coaches = staff.filter((s) => s.kind === "coach");

    const dimLow = weakestDim && (weakestDim.current ?? 100) < 50;
    const wellbeingIssue = dimLow && WELLBEING_DIMS.includes(weakestDim!.dimension);

    if (wellbeingIssue && coaches.length) {
      return {
        person: coaches[0], kind: "coach" as const,
        why: `Your lowest check-in score is ${DIM_LABEL[weakestDim!.dimension]} at ${weakestDim!.current}/100. That's a wellbeing thing, not a syllabus thing — a coach is the right person.`,
      };
    }
    if (weakestSubject && mentors.length) {
      // Prefer a mentor whose stated specialties mention the weak subject.
      const matched = mentors.find((m) =>
        (m.specialties ?? "").toLowerCase().includes(weakestSubject.subject.toLowerCase()));
      return {
        person: matched ?? mentors[0], kind: "mentor" as const,
        why: matched
          ? `${matched.name} lists ${weakestSubject.subject} among their subjects, and that's where your average is lowest at ${weakestSubject.pct}%.`
          : `Your ${weakestSubject.subject} average is ${weakestSubject.pct}% across ${weakestSubject.n} result(s) — the lowest of your subjects. No mentor lists it specifically, so this is just who's available.`,
      };
    }
    if (coaches.length) {
      return {
        person: coaches[0], kind: "coach" as const,
        why: "No marks on file yet, so I can't point you at a subject specialist. A coach is a good first conversation either way.",
      };
    }
    return null;
  }, [staff, weakestSubject, weakestDim]);

  const priorities = useMemo(() => {
    const out: { text: string; why: string; to?: string }[] = [];
    if (pending.length) {
      const b = pending[0];
      out.push({
        text: `${b.subject} at ${b.start_time?.slice(0, 5)} — ${b.topic?.toLowerCase()}`,
        why: weakestSubject && b.subject === weakestSubject.subject
          ? `Your ${b.subject} average is ${weakestSubject.pct}%, the lowest of your subjects.`
          : "First unfinished block on today's plan.",
        to: "/study-plan",
      });
    }
    if (undone.length) {
      out.push({
        text: `${undone[0]} — a few minutes`,
        why: g?.current_streak
          ? `You're on a ${g.current_streak}-day run. One practice keeps it going.`
          : "Starting is the whole thing today.",
        to: `/practice/${undone[0] === "meditation" ? "meditate"
             : undone[0] === "affirmation" ? "affirm" : "journal"}`,
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
  }, [pending, undone, weakestSubject, weakestDim, g]);

  const QUESTIONS: { q: string; a: () => string }[] = [
    {
      q: "How many days have I been using this?",
      a: () => g?.active_days
        ? `${g.active_days} days with something recorded. In the last ${usage.windowSize}, you were active on ${usage.activeCount} and quiet on ${usage.quietCount}.`
        : "Nothing recorded yet. Today would be day one.",
    },
    {
      q: "What's my streak?",
      a: () => {
        if (!g) return "Still loading.";
        if (!g.current_streak) return `No run going right now. Your best was ${g.best_streak} days — one practice today starts a new one.`;
        return `${g.current_streak} days running. Your best is ${g.best_streak}.`
          + (g.current_streak >= g.best_streak ? " That's your record — today extends it." : "");
      },
    },
    {
      q: "Which days did I miss?",
      a: () => {
        if (!usage.quietCount) return `None in the last ${usage.windowSize} days. Every single day has something on it.`;
        const list = days.filter((d) => d.actions === 0).slice(-6).map((d) => fmtDay(d.day));
        const gapBit = usage.longestGap > 1
          ? ` Your longest quiet stretch was ${usage.longestGap} days, ${fmtDay(usage.gapStart)} to ${fmtDay(usage.gapEnd)}.`
          : "";
        return `${usage.quietCount} quiet days in the last ${usage.windowSize}. Most recent: ${list.join(", ")}.${gapBit} Gaps are normal — nothing resets.`;
      },
    },
    {
      q: "Who should I talk to?",
      a: () => suggestion
        ? `${suggestion.person.name}, your ${suggestion.kind}. ${suggestion.why}`
        : "Nobody is set up as an active mentor or coach yet. Ask the admin team to assign you one.",
    },
    {
      q: "I only have 2 hours today",
      a: () => {
        if (!pending.length) return "Nothing pending on your plan today, so the two hours are yours. If you want to use them, your weakest subject is where they'd count most.";
        const keep = pending.slice(0, 2), drop = pending.slice(2);
        return `Keep ${keep.map((b) => `${b.subject} at ${b.start_time?.slice(0, 5)}`).join(" and ")}.`
          + (drop.length ? ` Move ${drop.map((b) => b.subject).join(", ")} to tomorrow.` : "");
      },
    },
    {
      q: "What should I work on most?",
      a: () => weakestSubject
        ? `${weakestSubject.subject}. Average ${weakestSubject.pct}% across ${weakestSubject.n} result(s), below your other subjects. That's whole-paper scores though — I can't see which topics inside it are costing you.`
        : "No marks on file, so I'd be guessing. Add a couple of results and this becomes a real answer.",
    },
  ];

  const ask = (q: string, a: string) => setAsked((p) => [...p, { q, a }]);

  return (
    <div className="space-y-5">
      <header className="gm-rise">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Guide</div>
        <h1 className="font-display text-3xl">What to do today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Study planning and accountability. Not a counsellor.
        </p>
      </header>

      {/* ------------------------- priorities ------------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "60ms" }}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Your top {priorities.length || "priorities"}
          </span>
        </div>
        {priorities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing pending — practices done and no blocks left. Rest counts.
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
                    <Link to={p.to} className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      Open <ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ----------------------- activity chart ----------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "110ms" }}>
        <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
          Last {usage.windowSize} days
        </div>
        <p className="mb-4 text-sm">
          Active on <b>{usage.activeCount}</b>, quiet on <b>{usage.quietCount}</b>
          {g?.current_streak ? <> · <b>{g.current_streak}-day streak</b></> : null}
        </p>

        {/* Bars scale to the busiest day; blank days are a faint baseline so
            the gaps are visible rather than invisible. */}
        <div className="flex h-20 items-end gap-[3px]">
          {days.map((d, i) => {
            const h = d.actions === 0 ? 4 : Math.max(10, (d.actions / usage.max) * 80);
            return (
              <div key={d.day} className="group relative flex-1"
                   title={`${fmtDay(d.day)} — ${d.actions || "nothing"}`}>
                <div
                  className={cn("w-full rounded-sm transition-all",
                    d.actions === 0 ? "bg-secondary" : "bg-primary")}
                  style={{ height: h, opacity: d.actions === 0 ? 1 : 0.35 + Math.min(0.65, d.actions / usage.max * 0.65),
                           animation: `gm-rise .4s var(--ease-out) ${120 + i * 14}ms both` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>{days[0] ? fmtDay(days[0].day) : ""}</span>
          <span>today</span>
        </div>

        {usage.longestGap > 1 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Longest quiet stretch: {usage.longestGap} days, {fmtDay(usage.gapStart)} to {fmtDay(usage.gapEnd)}.
            Gaps are normal — nothing resets.
          </p>
        )}
      </section>

      {/* ------------------------ who to talk to ------------------------ */}
      {suggestion && (
        <section className="soft-card gm-rise p-5" style={{ animationDelay: "160ms" }}>
          <div className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
            Who to talk to
          </div>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-sage-soft font-display text-base text-primary">
              {suggestion.person.name.trim()[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <b className="text-sm">{suggestion.person.name}</b>
              <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] capitalize">
                {suggestion.kind}
              </span>
              {suggestion.person.specialties && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {suggestion.person.specialties}
                </div>
              )}
              <p className="mt-2 text-sm text-muted-foreground">{suggestion.why}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A mentor helps with the subject. A coach helps with how you're coping.
            Either way it's a person, not me.
          </p>
        </section>
      )}

      {/* ------------------------ conversation ------------------------ */}
      <section className="gm-rise" style={{ animationDelay: "200ms" }}>
        {asked.map((x, i) => (
          <div key={i} className="mb-3">
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
              {x.q}
            </div>
            <div className="mt-2 max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm">
              {x.a}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          {QUESTIONS.filter((q) => !asked.some((a) => a.q === q.q)).map((q) => (
            <button key={q.q} onClick={() => ask(q.q, q.a())}
              className="rounded-full border border-border px-3.5 py-2 text-left text-sm transition-colors hover:bg-secondary">
              {q.q}
            </button>
          ))}
        </div>
      </section>

      <section className="soft-card gm-rise p-5" style={{ animationDelay: "240ms" }}>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">How this works</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything here is worked out from your own blocks, marks and check-ins — nothing
          is invented. It can't yet answer questions you type.
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
