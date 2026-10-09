import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Protected } from "@/components/protected";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, X, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/study-plan")({
  component: () => <Protected><StudyPlan /></Protected>,
});

type Plan = {
  id: string; exam_name: string; exam_date: string | null;
  subjects: string[]; hours_per_day: number;
  weak_topics: string | null; strong_topics: string | null;
};
type Task = {
  id: string; day: string; start_time: string | null; end_time: string | null;
  subject: string | null; topic: string | null; status: "pending" | "done" | "missed";
};

const istToday = () => {
  const d = new Date(Date.now() + (330 - new Date().getTimezoneOffset()) * 60000);
  return d.toISOString().slice(0, 10);
};
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Builds a fortnight of study blocks from plain arithmetic — no model, no
 * invented syllabus. Weak subjects get roughly double the slots, every fourth
 * block revisits something studied two days earlier, and the final stretch
 * before the exam turns into revision.
 */
function buildTasks(plan: {
  subjects: string[]; weak: string[]; hoursPerDay: number;
  startHour: number; examDate: string | null; days: number;
}) {
  const { subjects, weak, hoursPerDay, startHour, examDate, days } = plan;
  if (!subjects.length) return [];

  // Weighted pool: weak subjects appear twice, so they come round twice as often.
  const pool: string[] = [];
  for (const s of subjects) {
    pool.push(s);
    if (weak.some((w) => w.toLowerCase() === s.toLowerCase())) pool.push(s);
  }

  const out: Omit<Task, "id">[] = [];
  const today = istToday();
  let cursor = 0;
  const studiedOn: Record<string, string[]> = {};

  for (let d = 0; d < days; d++) {
    const day = addDays(today, d);
    if (examDate && day > examDate) break;

    // Inside the last fifth of the runway, shift to revision.
    const revisionPhase = (() => {
      if (!examDate) return false;
      const left = (new Date(examDate).getTime() - new Date(day).getTime()) / 86400000;
      const total = (new Date(examDate).getTime() - new Date(today).getTime()) / 86400000;
      return total > 0 && left <= Math.max(2, total * 0.2);
    })();

    let hour = startHour;
    for (let b = 0; b < Math.max(1, Math.round(hoursPerDay)); b++) {
      if (hour === 13) hour++;              // leave the lunch hour alone
      if (hour > 21) break;

      const everyFourth = b > 0 && b % 4 === 3;
      let subject: string;
      let topic: string;

      if (revisionPhase) {
        subject = pool[cursor++ % pool.length];
        topic = "Full revision + past papers";
      } else if (everyFourth) {
        // Spaced repetition: revisit what was covered two days back.
        const back = studiedOn[addDays(day, -2)] ?? [];
        subject = back[0] ?? pool[cursor++ % pool.length];
        topic = "Revision of earlier work";
      } else {
        subject = pool[cursor++ % pool.length];
        topic = "New material";
      }

      (studiedOn[day] ??= []).push(subject);
      out.push({
        day, start_time: hhmm(hour), end_time: hhmm(hour + 1),
        subject, topic, status: "pending",
      });
      hour += b % 2 === 1 ? 2 : 1;          // a break after every second block
    }
  }
  return out;
}

function StudyPlan() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = istToday();

  const { data: plan } = useQuery({
    enabled: !!user,
    queryKey: ["study-plan", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("study_plans")
        .select("id,exam_name,exam_date,subjects,hours_per_day,weak_topics,strong_topics")
        .eq("user_id", user!.id).eq("is_active", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return (data as Plan) ?? null;
    },
  });

  const { data: tasks = [] } = useQuery({
    enabled: !!user,
    queryKey: ["plan-tasks", user?.id, today],
    queryFn: async () => {
      const { data } = await supabase.from("plan_tasks")
        .select("id,day,start_time,end_time,subject,topic,status")
        .eq("user_id", user!.id).eq("day", today)
        .order("start_time");
      return (data ?? []) as Task[];
    },
  });

  const [form, setForm] = useState({
    exam_name: "", exam_date: "", subjects: "", hours: "4",
    start_hour: "8", weak: "", strong: "",
  });
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const subjects = form.subjects.split(",").map((s) => s.trim()).filter(Boolean);
      if (!form.exam_name.trim()) throw new Error("Which exam are you preparing for?");
      if (!subjects.length) throw new Error("Add at least one subject.");

      await supabase.from("study_plans")
        .update({ is_active: false }).eq("user_id", user.id).eq("is_active", true);

      const { data: p, error } = await supabase.from("study_plans").insert({
        user_id: user.id, exam_name: form.exam_name.trim(),
        exam_date: form.exam_date || null, subjects,
        hours_per_day: Number(form.hours) || 4,
        weak_topics: form.weak.trim() || null,
        strong_topics: form.strong.trim() || null,
      }).select("id").single();
      if (error) throw error;

      const rows = buildTasks({
        subjects,
        weak: form.weak.split(",").map((s) => s.trim()).filter(Boolean),
        hoursPerDay: Number(form.hours) || 4,
        startHour: Number(form.start_hour) || 8,
        examDate: form.exam_date || null,
        days: 14,
      });

      if (rows.length) {
        const { error: tErr } = await supabase.from("plan_tasks")
          .insert(rows.map((r) => ({ ...r, plan_id: p.id, user_id: user.id })));
        if (tErr) throw tErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["study-plan"] });
      qc.invalidateQueries({ queryKey: ["plan-tasks"] });
      toast.success("Plan built. Two weeks of blocks are ready.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't build that."),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Task["status"] }) => {
      const { error } = await supabase.from("plan_tasks").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan-tasks"] }),
  });

  const done = tasks.filter((t) => t.status === "done").length;
  const missed = tasks.filter((t) => t.status === "missed").length;

  const checkIn = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase.from("daily_checkins").upsert({
        user_id: user.id, day: today, completed: done, missed,
        hours: done, difficulties: notes.trim() || null,
      }, { onConflict: "user_id,day" });
      if (error) throw error;
    },
    onSuccess: () => { setNotes(""); toast.success("Logged for today."); },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save."),
  });

  /** Plain-language response to the day — no model, no false cheer. */
  const reflection = (() => {
    if (!tasks.length) return null;
    if (done === tasks.length) return "Everything you planned, done. Stop here and rest.";
    if (done === 0) return "Nothing ticked yet. One block is better than none — pick the shortest.";
    if (missed > done) return `More missed than done today. That usually means the plan asked too much, not that you failed. Consider dropping to ${Math.max(2, tasks.length - 2)} blocks.`;
    return `${done} of ${tasks.length} done. The rest moves to tomorrow.`;
  })();

  if (!plan) {
    return (
      <div className="space-y-6">
        <header>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Study plan</div>
          <h1 className="font-display text-3xl">Build your plan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell it the shape of your preparation and it lays out the next two weeks.
          </p>
        </header>

        <div className="soft-card space-y-3 p-5">
          <input className="w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            placeholder="Exam name (e.g. NEET 2027)" value={form.exam_name}
            onChange={(e) => setForm({ ...form, exam_name: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Exam date</span>
              <input type="date" className="mt-1 w-full rounded-lg border border-border bg-paper/60 px-3 py-2"
                value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Hours a day</span>
              <input type="number" min="1" max="12"
                className="mt-1 w-full rounded-lg border border-border bg-paper/60 px-3 py-2"
                value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
            </label>
          </div>
          <input className="w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            placeholder="Subjects, comma separated — Physics, Chemistry, Biology"
            value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} />
          <input className="w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            placeholder="Weak subjects (these get more slots)"
            value={form.weak} onChange={(e) => setForm({ ...form, weak: e.target.value })} />
          <label className="block text-sm">
            <span className="text-muted-foreground">Start studying at</span>
            <input type="number" min="5" max="20"
              className="mt-1 w-28 rounded-lg border border-border bg-paper/60 px-3 py-2"
              value={form.start_hour} onChange={(e) => setForm({ ...form, start_hour: e.target.value })} />
          </label>
          <Button onClick={() => create.mutate()} disabled={create.isPending}
                  className="w-full rounded-full">
            {create.isPending ? "Building…" : "Build my plan"}
          </Button>
        </div>
      </div>
    );
  }

  const daysLeft = plan.exam_date
    ? Math.ceil((new Date(plan.exam_date).getTime() - new Date(today).getTime()) / 86400000)
    : null;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Study plan</div>
        <h1 className="font-display text-3xl">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.exam_name}
          {daysLeft !== null && daysLeft >= 0 && ` · ${daysLeft} days to go`}
        </p>
      </header>

      {tasks.length === 0 ? (
        <div className="soft-card p-6 text-sm text-muted-foreground">
          No blocks for today — the fortnight may have run out. Rebuild below.
        </div>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className={cn(
              "soft-card flex flex-wrap items-center gap-3 p-4",
              t.status === "done" && "bg-primary/5",
              t.status === "missed" && "opacity-60",
            )}>
              <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">
                {t.start_time?.slice(0, 5)}–{t.end_time?.slice(0, 5)}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block font-medium", t.status === "done" && "line-through text-muted-foreground")}>
                  {t.subject}
                </span>
                <span className="block text-xs text-muted-foreground">{t.topic}</span>
              </span>
              <span className="flex gap-1.5">
                <button onClick={() => setStatus.mutate({ id: t.id, status: t.status === "done" ? "pending" : "done" })}
                  className={cn("grid size-8 place-items-center rounded-full border border-border",
                    t.status === "done" && "border-primary bg-primary text-primary-foreground")}
                  aria-label="Mark done">
                  <Check className="size-4" />
                </button>
                <button onClick={() => setStatus.mutate({ id: t.id, status: t.status === "missed" ? "pending" : "missed" })}
                  className={cn("grid size-8 place-items-center rounded-full border border-border",
                    t.status === "missed" && "bg-secondary")}
                  aria-label="Mark missed">
                  <X className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {reflection && (
        <div className="soft-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">End of day</div>
          <p className="mt-1 text-sm">{reflection}</p>
          <textarea
            className="mt-3 w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            rows={2} placeholder="What got in the way today? (optional)"
            value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button onClick={() => checkIn.mutate()} disabled={checkIn.isPending}
                  size="sm" className="mt-2 rounded-full">
            {checkIn.isPending ? "Saving…" : "Log today"}
          </Button>
        </div>
      )}

      <button
        onClick={() => { if (confirm("Replace this plan with a new one?")) qc.setQueryData(["study-plan", user?.id], null); }}
        className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <RotateCcw className="size-3.5" /> Rebuild the plan
      </button>
    </div>
  );
}
