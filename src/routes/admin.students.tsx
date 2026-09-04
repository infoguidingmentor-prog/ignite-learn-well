import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppIcon } from "@/components/app-icon";

export const Route = createFileRoute("/admin/students")({
  component: () => <><Students /></>,
});

function Students() {
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-students"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, exam, created_at").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const list = profiles.filter((p: any) => !q || (p.full_name ?? "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><AppIcon name="dashboard" size={14} /> Students</div>
        <h1 className="font-display text-3xl">Directory</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-lg">A 360° view of each student. Never the raw journal — even here.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="soft-card p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm" />
          <ul className="mt-2 max-h-[60vh] overflow-y-auto space-y-1">
            {list.map((p: any) => (
              <li key={p.id}>
                <button onClick={() => setSelected(p.id)} className={`w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-secondary/60 ${selected === p.id ? "bg-secondary/70" : ""}`}>
                  <div className="font-medium">{p.full_name || "Unnamed"}</div>
                  <div className="text-[11px] text-muted-foreground">{p.exam ?? "—"}</div>
                </button>
              </li>
            ))}
            {list.length === 0 && <div className="p-3 text-sm text-muted-foreground">No students match.</div>}
          </ul>
        </aside>

        <section className="soft-card p-6 min-h-[40vh]">
          {!selected ? (
            <div className="text-sm text-muted-foreground">Select a student to see their 360° profile.</div>
          ) : (
            <StudentProfile id={selected} />
          )}
        </section>
      </div>
    </div>
  );
}

function StudentProfile({ id }: { id: string }) {
  const { data: profile } = useQuery({
    queryKey: ["student-profile", id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, exam, target_year, class_level").eq("id", id).maybeSingle();
      return data;
    },
  });

  const { data: scores = [] } = useQuery({
    queryKey: ["student-scores", id],
    queryFn: async () => {
      const { data } = await supabase.from("wellness_scores").select("score_date, composite, focus_score, rest_score, reflection_score, connection_score, risk_band").eq("user_id", id).order("score_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: moods = [] } = useQuery({
    queryKey: ["student-moods", id],
    queryFn: async () => {
      const { data } = await supabase.from("mood_checkins").select("mood_score, energy, created_at").eq("user_id", id).order("created_at", { ascending: true }).limit(30);
      return data ?? [];
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["student-events", id],
    queryFn: async () => {
      const { data } = await supabase.from("agent_events").select("event_type, detail, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  /** Real usage, read straight from the activity tables. */
  const { data: activity } = useQuery({
    queryKey: ["student-activity", id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("student_activity", { _user: id });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });

  const [monthOffset, setMonthOffset] = useState(0);
  const monthStart = (() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + monthOffset); return d;
  })();
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  /** One row per day, so gaps in use are as visible as the streaks. */
  const { data: daily = [] } = useQuery({
    queryKey: ["student-daily", id, iso(monthStart)],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("student_daily", {
        _user: id, _from: iso(monthStart), _to: iso(monthEnd),
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const dayTotal = (r: any) =>
    (r.meditations ?? 0) + (r.focus ?? 0) + (r.breathing ?? 0) +
    (r.affirmations ?? 0) + (r.journals ?? 0) + (r.moods ?? 0) + (r.todos_done ?? 0);

  const activeDays = daily.filter((r) => dayTotal(r) > 0).length;

  const streak = (() => {
    let n = 0;
    for (let i = daily.length - 1; i >= 0; i--) {
      if (new Date(daily[i].day) > new Date()) continue;
      if (dayTotal(daily[i]) > 0) n++; else break;
    }
    return n;
  })();

  const latest = scores[scores.length - 1] as any;
  const first = scores[0] as any;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl">{profile?.full_name ?? "Student"}</h2>
        <div className="text-xs text-muted-foreground">{profile?.exam ?? "—"} · target {profile?.target_year ?? "—"}</div>
      </div>

      <section>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Activity</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ["Meditations", activity?.meditations,
              activity?.meditation_seconds ? `${Math.round((activity.meditation_seconds as number) / 60)} min listened` : null],
            ["Focus sessions", activity?.focus_sessions,
              activity?.focus_minutes ? `${activity.focus_minutes} min focused` : null],
            ["Breathing", activity?.breathing,
              activity?.breathing_seconds ? `${Math.round((activity.breathing_seconds as number) / 60)} min` : null],
            ["Affirmations", activity?.affirmations, null],
            ["Journals", activity?.journals, null],
            ["Mood check-ins", activity?.moods, null],
            ["To-dos done", activity?.todos_done,
              activity?.todos_total != null ? `of ${activity.todos_total} added` : null],
          ] as [string, number | undefined, string | null][]).map(([label, value, sub]) => (
            <div key={label} className="rounded-xl border border-border bg-paper/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
              <div className="mt-1 font-display text-xl tabular-nums">{value ?? 0}</div>
              <div className="text-[10px] text-muted-foreground">{sub ?? "\u00A0"}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
            Daily use — {monthStart.toLocaleString(undefined, { month: "long", year: "numeric" })}
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => setMonthOffset((m) => m - 1)}
              className="rounded-full border border-border px-2 py-0.5">←</button>
            <button onClick={() => setMonthOffset(0)}
              className="rounded-full border border-border px-2 py-0.5">This month</button>
            <button onClick={() => setMonthOffset((m) => Math.min(0, m + 1))}
              disabled={monthOffset >= 0}
              className="rounded-full border border-border px-2 py-0.5 disabled:opacity-30">→</button>
          </div>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          Active on {activeDays} of {daily.length} days
          {streak > 0 && ` · ${streak}-day streak`}
        </p>

        <div className="grid grid-cols-7 gap-1">
          {["M","T","W","T","F","S","S"].map((d, i) => (
            <div key={i} className="pb-1 text-center text-[10px] text-muted-foreground">{d}</div>
          ))}
          {Array.from({ length: (new Date(monthStart).getDay() + 6) % 7 }).map((_, i) => (
            <div key={`pad${i}`} />
          ))}
          {daily.map((r) => {
            const t = dayTotal(r);
            const parts = [
              r.meditations && `${r.meditations} meditation${r.meditations > 1 ? "s" : ""}`,
              r.focus && `${r.focus} focus`,
              r.breathing && `${r.breathing} breathing`,
              r.affirmations && `${r.affirmations} affirmation${r.affirmations > 1 ? "s" : ""}`,
              r.journals && `${r.journals} journal${r.journals > 1 ? "s" : ""}`,
              r.moods && `${r.moods} mood`,
              r.todos_done && `${r.todos_done} to-do${r.todos_done > 1 ? "s" : ""}`,
            ].filter(Boolean).join(", ");
            return (
              <div
                key={r.day}
                title={`${r.day}${parts ? ` — ${parts}` : " — no activity"}`}
                className="aspect-square rounded-md border border-border text-[10px] grid place-items-center"
                style={{
                  background: t === 0 ? "transparent"
                    : `color-mix(in srgb, var(--color-primary) ${Math.min(15 + t * 18, 85)}%, transparent)`,
                  color: t > 3 ? "white" : undefined,
                }}
              >
                {new Date(r.day).getDate()}
              </div>
            );
          })}
        </div>

        {daily.some((r) => dayTotal(r) > 0) && (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {daily.filter((r) => dayTotal(r) > 0).slice(-8).reverse().map((r) => (
              <li key={`l${r.day}`}>
                <span className="text-foreground">
                  {new Date(r.day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
                {" — "}
                {[
                  r.meditations && `${r.meditations} meditation${r.meditations > 1 ? "s" : ""}`,
                  r.focus && `${r.focus} focus`,
                  r.breathing && `${r.breathing} breathing`,
                  r.affirmations && `${r.affirmations} affirmation${r.affirmations > 1 ? "s" : ""}`,
                  r.journals && `${r.journals} journal${r.journals > 1 ? "s" : ""}`,
                  r.moods && `${r.moods} mood check-in`,
                  r.todos_done && `${r.todos_done} to-do${r.todos_done > 1 ? "s" : ""} done`,
                ].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Wellness — before & now</h3>
        <div className="grid grid-cols-4 gap-2">
          {(["focus_score","rest_score","reflection_score","connection_score"] as const).map((k) => {
            const before = first ? Math.round(first[k]) : 0;
            const now = latest ? Math.round(latest[k]) : 0;
            const dir = now - before;
            const label = k.replace("_score","");
            return (
              <div key={k} className="rounded-xl border border-border bg-paper/40 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-xl tabular-nums">{now}</span>
                  <span className={`text-[11px] ${dir >= 0 ? "text-sage-ink" : "text-muted-foreground"}`}>{dir >= 0 ? `+${dir}` : dir}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">from {before}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Composite over time</h3>
        <svg viewBox="0 0 600 120" className="w-full h-28">
          {scores.length > 1 && (
            <polyline fill="none" stroke="hsl(var(--primary))" strokeWidth="2"
              points={scores.map((s: any, i: number) => {
                const x = (i / (scores.length - 1)) * 580 + 10;
                const y = 110 - (Number(s.composite) / 100) * 100;
                return `${x},${y}`;
              }).join(" ")}
            />
          )}
        </svg>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Mood check-ins</h3>
        <div className="flex flex-wrap gap-1">
          {moods.map((m: any, i: number) => (
            <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums" title={new Date(m.created_at).toLocaleString()}>
              {m.mood_score}
            </span>
          ))}
          {moods.length === 0 && <span className="text-xs text-muted-foreground">No mood entries.</span>}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Agent events</h3>
        <ul className="space-y-1">
          {events.map((e: any, i: number) => (
            <li key={i} className="text-xs text-muted-foreground flex justify-between rounded-lg bg-paper/40 px-3 py-2">
              <span className="font-medium text-foreground">{e.event_type}</span>
              <span>{new Date(e.created_at).toLocaleString()}</span>
            </li>
          ))}
          {events.length === 0 && <span className="text-xs text-muted-foreground">No events yet.</span>}
        </ul>
      </section>

      <div className="text-[11px] text-muted-foreground">Journal entries are private to the student.</div>
    </div>
  );
}
