import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Protected } from "@/components/protected";
import { cn } from "@/lib/utils";
import { Sparkles, ArrowRight, SendHorizonal } from "lucide-react";

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
type Staff = { id: string; name: string; kind: "mentor" | "coach"; specialties: string | null };
type Msg = { who: "me" | "guide"; text: string };

const DIM_LABEL: Record<string, string> = {
  stress: "stress", control: "self-control", focus: "focus", time: "time management",
  clarity: "study clarity", planning: "planning", motivation: "motivation",
  energy: "energy", habits: "study habits",
};
const WELLBEING_DIMS = ["stress", "motivation", "energy", "control"];

const istToday = () => {
  const d = new Date(Date.now() + (330 - new Date().getTimezoneOffset()) * 60000);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const has = (s: string, ...w: string[]) => w.some((x) => s.includes(x));

function Guide() {
  const { user } = useAuth();
  const today = istToday();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  /** Set when we've asked "what kind of problem?" and are waiting on the reply. */
  const [awaitingProblem, setAwaitingProblem] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

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
  const { data: staff = [] } = useQuery({
    queryKey: ["guide-staff"],
    queryFn: async () => {
      const out: Staff[] = [];
      const { data: m } = await supabase.from("mentors")
        .select("id, specialties, profile:profiles!mentors_profile_id_fkey(full_name)")
        .eq("active", true);
      (m ?? []).forEach((x: any) => out.push({
        id: x.id, kind: "mentor", name: x.profile?.full_name ?? "Mentor",
        specialties: Array.isArray(x.specialties) ? x.specialties.join(", ") : x.specialties ?? null,
      }));
      const { data: c } = await supabase.from("coaches")
        .select("id, certification_name, profile:profiles!coaches_profile_id_fkey(full_name)")
        .eq("active", true);
      (c ?? []).forEach((x: any) => out.push({
        id: x.id, kind: "coach", name: x.profile?.full_name ?? "Coach",
        specialties: x.certification_name ?? null,
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
    const s = cmp.filter((c) => c.current != null);
    return s.length ? s.reduce((a, b) => ((a.current ?? 100) <= (b.current ?? 100) ? a : b)) : null;
  }, [cmp]);

  const usage = useMemo(() => {
    const quiet = days.filter((d) => d.actions === 0);
    let gap = 0, run = 0, gapEnd = "";
    days.forEach((d) => {
      if (d.actions === 0) { run++; if (run > gap) { gap = run; gapEnd = d.day; } } else run = 0;
    });
    const gapStart = gapEnd ? days[days.findIndex((d) => d.day === gapEnd) - gap + 1]?.day ?? gapEnd : "";
    return {
      activeCount: days.length - quiet.length, quietCount: quiet.length,
      windowSize: days.length, longestGap: gap, gapStart, gapEnd,
      max: Math.max(1, ...days.map((d) => d.actions)),
    };
  }, [days]);

  const pending = blocks.filter((b) => b.status === "pending");
  const undone = (["meditation", "affirmation", "journal"] as const).filter((k) => !g?.today[k]);
  const mentors = staff.filter((s) => s.kind === "mentor");
  const coaches = staff.filter((s) => s.kind === "coach");

  const pickFor = (kind: "subject" | "wellbeing", subject?: string) => {
    if (kind === "wellbeing") return coaches[0] ?? mentors[0] ?? null;
    if (subject) {
      const m = mentors.find((x) => (x.specialties ?? "").toLowerCase().includes(subject.toLowerCase()));
      if (m) return m;
    }
    return mentors[0] ?? coaches[0] ?? null;
  };

  const noStaffLine =
    "No mentors or coaches are set up on the platform yet — they're being added soon. " +
    "In the meantime, tell your admin team what you're stuck on and they'll assign someone.";

  /* --------------------- the answering engine --------------------- */
  function answer(raw: string): string {
    const q = raw.toLowerCase().trim();

    // Mid-triage: classify whatever they just told us about their problem.
    if (awaitingProblem) {
      setAwaitingProblem(false);
      if (has(q, "stress", "anxious", "anxiety", "panic", "overwhelm", "pressure", "sad", "低", "cry", "scared", "afraid")) {
        const p = pickFor("wellbeing");
        return p
          ? `That's a wellbeing thing, not a syllabus thing — so a coach, not a subject mentor. Talk to ${p.name}${p.specialties ? ` (${p.specialties})` : ""}. If it ever feels bigger than studying, Tele-MANAS is 14416 and Kiran is 1800-599-0019, free and any time.`
          : noStaffLine;
      }
      if (has(q, "time", "slow", "behind", "late", "schedule", "manage", "procrast")) {
        const p = pickFor("subject");
        return `That's a planning problem, and it's usually the plan being too big rather than you being too slow. Cut tomorrow to two blocks and finish them.`
          + (p ? ` ${p.name} can help you shape a realistic week.` : ` ${noStaffLine}`);
      }
      if (has(q, "motiv", "point", "give up", "bored", "tired", "energy", "lazy")) {
        const p = pickFor("wellbeing");
        return p
          ? `Motivation usually follows action rather than arriving first — one small thing today is worth more than a plan for next week. ${p.name} is the right person to talk this through with.`
          : noStaffLine;
      }
      // Did they name one of their own subjects?
      const named = marks.find((m) => q.includes(m.subject.toLowerCase()));
      if (named || has(q, "subject", "chapter", "topic", "understand", "doubt", "concept", "physics", "chemistry", "biology", "maths", "math")) {
        const subj = named?.subject ?? weakestSubject?.subject;
        const p = pickFor("subject", subj);
        return p
          ? `For ${subj ?? "that subject"}, talk to ${p.name}${p.specialties ? ` — they list ${p.specialties}` : ""}.`
            + (weakestSubject && subj === weakestSubject.subject ? ` Your average there is ${weakestSubject.pct}%, your lowest.` : "")
          : noStaffLine;
      }
      const p = pickFor("wellbeing");
      return p
        ? `I'm not sure which kind of problem that is, so I'd start with ${p.name}, your ${p.kind} — they can point you to the right person.`
        : noStaffLine;
    }

    // ---- mentors and connecting ----
    if (has(q, "mentor", "coach", "who can help", "talk to", "connect", "contact", "teacher")) {
      if (!staff.length) return noStaffLine;
      const list = staff.map((s) => `${s.name} (${s.kind}${s.specialties ? `, ${s.specialties}` : ""})`).join("; ");
      return `There ${staff.length === 1 ? "is" : "are"} ${staff.length} available: ${list}. `
        + `A mentor helps with a subject; a coach helps with how you're coping. `
        + `Tell me what you're stuck on and I'll say which one — or share a journal entry with a mentor from the Journal screen to start a conversation.`;
    }

    // ---- problem triage ----
    if (has(q, "problem", "struggl", "stuck", "help me", "i need help", "not going well", "difficult", "hard")) {
      setAwaitingProblem(true);
      return "Tell me what kind — is it a subject you can't crack, running out of time, stress, or motivation? A few words is enough.";
    }

    // ---- usage / days ----
    if (has(q, "how many day", "how long", "using", "been here", "joined")) {
      return g?.active_days
        ? `${g.active_days} days with something recorded. In the last ${usage.windowSize} you were active on ${usage.activeCount} and quiet on ${usage.quietCount}.`
        : "Nothing recorded yet. Today would be day one.";
    }

    // ---- streak ----
    if (has(q, "streak", "in a row", "consecutive")) {
      if (!g) return "Still loading your numbers.";
      if (!g.current_streak) return `No run going right now. Your best was ${g.best_streak} days — one practice today starts a new one.`;
      return `${g.current_streak} days running, best is ${g.best_streak}.`
        + (g.current_streak >= g.best_streak ? " That's your record — today extends it." : "");
    }

    // ---- missed days ----
    if (has(q, "miss", "skip", "gap", "quiet", "didn't do", "did not do", "lost")) {
      if (!usage.quietCount) return `None in the last ${usage.windowSize} days. Every day has something on it.`;
      const list = days.filter((d) => d.actions === 0).slice(-6).map((d) => fmtDay(d.day));
      return `${usage.quietCount} quiet days in the last ${usage.windowSize}. Most recent: ${list.join(", ")}.`
        + (usage.longestGap > 1 ? ` Longest stretch: ${usage.longestGap} days, ${fmtDay(usage.gapStart)} to ${fmtDay(usage.gapEnd)}.` : "")
        + " Gaps are normal — nothing resets.";
    }

    // ---- how to improve ----
    if (has(q, "how can i improve", "get better", "what should i change", "improve my", "do better")) {
      const out: string[] = [];
      if (usage.quietCount > usage.activeCount)
        out.push(`You were quiet on ${usage.quietCount} of the last ${usage.windowSize} days — consistency will move your scores more than any single study session`);
      if (weakestSubject)
        out.push(`${weakestSubject.subject} is your lowest at ${weakestSubject.pct}% — give it the first block of the day, when you're freshest`);
      if (weakestDim && (weakestDim.current ?? 0) < 50)
        out.push(`${DIM_LABEL[weakestDim.dimension] ?? weakestDim.dimension} scored ${weakestDim.current}/100 on your check-in, the lowest of the nine`);
      if (!out.length) return "Nothing is obviously off. Add a test result or take the assessment again and I'll have more to go on.";
      return out.join(". ") + ".";
    }

    // ---- progress ----
    if (has(q, "progress", "how am i doing", "how i am doing", "doing well", "am i getting")) {
      const bits: string[] = [];
      if (g?.active_days) bits.push(`${g.active_days} active days`);
      if (g?.current_streak) bits.push(`a ${g.current_streak}-day streak`);
      const up = cmp.filter((c) => c.change > 0).sort((a, b) => b.change - a.change)[0];
      const down = cmp.filter((c) => c.change < 0).sort((a, b) => a.change - b.change)[0];
      if (up) bits.push(`${DIM_LABEL[up.dimension] ?? up.dimension} up ${up.change} points`);
      if (marks.length >= 2) {
        const asc = [...marks].reverse();
        const first = Number(asc[0].percentage), last = Number(asc[asc.length - 1].percentage);
        bits.push(`marks ${last >= first ? "up" : "down"} from ${Math.round(first)}% to ${Math.round(last)}%`);
      }
      if (!bits.length) return "Too early to say. Take the assessment once and add a test result, and this becomes a real answer.";
      return bits.join(", ") + "."
        + (down ? ` ${DIM_LABEL[down.dimension] ?? down.dimension} slipped ${Math.abs(down.change)} — worth a look.` : "");
    }

    // ---- time-limited planning ----
    if (has(q, "hour", "only have", "short on time", "2 hours", "two hours")) {
      if (!pending.length) return "Nothing pending on your plan today, so the time is yours. If you want to use it, your weakest subject is where it'd count most.";
      const keep = pending.slice(0, 2), drop = pending.slice(2);
      return `Keep ${keep.map((b) => `${b.subject} at ${b.start_time?.slice(0, 5)}`).join(" and ")}.`
        + (drop.length ? ` Move ${drop.map((b) => b.subject).join(", ")} to tomorrow.` : "");
    }

    // ---- what to study ----
    if (has(q, "what should i study", "work on", "focus on", "weakest", "priorit", "today")) {
      if (weakestSubject)
        return `${weakestSubject.subject}. Average ${weakestSubject.pct}% across ${weakestSubject.n} result(s), below your others. That's whole-paper scores though — I can't see which topics inside it are costing you.`;
      if (pending.length) return `Your plan has ${pending.length} block(s) left, starting with ${pending[0].subject} at ${pending[0].start_time?.slice(0, 5)}.`;
      return "No marks on file, so I'd be guessing. Add a couple of results and this becomes a real answer.";
    }

    // ---- honest fallback ----
    return "I can't answer that one yet. I'm good on: how many days you've used this, your streak, which days you missed, your progress, how to improve it, what to study today, and which mentor to talk to. Try one of those.";
  }

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { who: "me", text: t }]);
    setDraft("");
    const reply = answer(t);
    setTimeout(() => setMsgs((m) => [...m, { who: "guide", text: reply }]), 260);
  };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  const SUGGESTED = [
    "I have a problem",
    "Who can help me?",
    "What's my streak?",
    "Which days did I miss?",
    "How can I improve?",
    "What should I study today?",
  ];

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
        why: g?.current_streak ? `You're on a ${g.current_streak}-day run.` : "Starting is the whole thing today.",
        to: `/practice/${undone[0] === "meditation" ? "meditate" : undone[0] === "affirmation" ? "affirm" : "journal"}`,
      });
    }
    if (weakestDim && (weakestDim.current ?? 0) < 50) {
      out.push({
        text: `Go easier on yourself around ${DIM_LABEL[weakestDim.dimension] ?? weakestDim.dimension}`,
        why: `That scored ${weakestDim.current}/100 — the lowest of the nine.`,
        to: "/progress",
      });
    }
    return out.slice(0, 3);
  }, [pending, undone, weakestSubject, weakestDim, g]);

  return (
    <div className="space-y-5">
      <header className="gm-rise">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Guide</div>
        <h1 className="font-display text-3xl">What to do today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Study planning and accountability. Not a counsellor.
        </p>
      </header>

      {/* priorities */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "60ms" }}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Your top {priorities.length || "priorities"}
          </span>
        </div>
        {priorities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing pending. Rest counts.</p>
        ) : (
          <ol className="gm-stagger space-y-3">
            {priorities.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary">{i + 1}</span>
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

      {/* activity chart */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "110ms" }}>
        <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
          Last {usage.windowSize} days
        </div>
        <p className="mb-4 text-sm">
          Active on <b>{usage.activeCount}</b>, quiet on <b>{usage.quietCount}</b>
          {g?.current_streak ? <> · <b>{g.current_streak}-day streak</b></> : null}
        </p>
        <div className="flex h-20 items-end gap-[3px]">
          {days.map((d, i) => (
            <div key={d.day} className="flex-1" title={`${fmtDay(d.day)} — ${d.actions || "nothing"}`}>
              <div
                className={cn("w-full rounded-sm", d.actions === 0 ? "bg-secondary" : "bg-primary")}
                style={{
                  height: d.actions === 0 ? 4 : Math.max(10, (d.actions / usage.max) * 80),
                  opacity: d.actions === 0 ? 1 : 0.35 + Math.min(0.65, (d.actions / usage.max) * 0.65),
                  animation: `gm-rise .4s var(--ease-out) ${120 + i * 14}ms both`,
                }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>{days[0] ? fmtDay(days[0].day) : ""}</span><span>today</span>
        </div>
        {usage.longestGap > 1 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Longest quiet stretch: {usage.longestGap} days, {fmtDay(usage.gapStart)} to {fmtDay(usage.gapEnd)}.
            Gaps are normal — nothing resets.
          </p>
        )}
      </section>

      {/* ------------------------- chat ------------------------- */}
      <section className="soft-card gm-rise flex flex-col p-0" style={{ animationDelay: "160ms" }}>
        <div className="border-b border-border px-5 py-3">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Ask me</span>
        </div>

        <div className="max-h-[22rem] min-h-[7rem] overflow-y-auto px-5 py-4">
          {msgs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask about your streak, the days you missed, your progress, or what to study.
              If something's going wrong, say <b>"I have a problem"</b> and I'll work out who
              you should talk to.
            </p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("mb-2.5 max-w-[88%] rounded-2xl px-4 py-2.5 text-sm",
              m.who === "me"
                ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
                : "rounded-bl-sm border border-border bg-card")}>
              {m.text}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(draft); }}
              placeholder={awaitingProblem ? "Subject, time, stress, motivation…" : "Ask something…"}
              aria-label="Ask the guide"
              className="min-w-0 flex-1 rounded-full border border-border bg-paper/60 px-4 py-2.5 text-sm"
            />
            <button
              onClick={() => send(draft)}
              disabled={!draft.trim()}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              <SendHorizonal className="size-4" />
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="soft-card gm-rise p-5" style={{ animationDelay: "210ms" }}>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">How this works</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Every answer is worked out from your own blocks, marks and check-ins — nothing is
          invented. It understands a set list of questions, so if it says it can't answer
          something, that's true rather than evasive.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/study-plan">
            <button className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">Open my plan</button>
          </Link>
          <Link to="/progress">
            <button className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">See my progress</button>
          </Link>
        </div>
      </section>
    </div>
  );
}
