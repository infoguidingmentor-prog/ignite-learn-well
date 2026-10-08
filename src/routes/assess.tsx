import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assess")({ component: Assess });

/* ---------------------------------------------------------------------------
 * Nine dimensions, two statements each. Short enough to finish in one sitting —
 * a 40-question form gets abandoned halfway and the baseline is worthless.
 * `reverse: true` means agreeing is the worse answer.
 * ------------------------------------------------------------------------ */
export const DIMENSIONS = [
  { key: "stress",     label: "Stress & pressure" },
  { key: "control",    label: "Self-control" },
  { key: "focus",      label: "Focus" },
  { key: "time",       label: "Time management" },
  { key: "clarity",    label: "Study clarity" },
  { key: "planning",   label: "Planning" },
  { key: "motivation", label: "Motivation" },
  { key: "energy",     label: "Energy" },
  { key: "habits",     label: "Study habits" },
] as const;

type Q = { key: string; dim: string; text: string; reverse?: boolean };

const QUESTIONS: Q[] = [
  { key: "s1", dim: "stress", text: "I feel tense or on edge about my studies.", reverse: true },
  { key: "s2", dim: "stress", text: "I can calm myself down when exam pressure builds.", },
  { key: "c1", dim: "control", text: "I give in to distractions like my phone while studying.", reverse: true },
  { key: "c2", dim: "control", text: "When I decide to study, I follow through." },
  { key: "f1", dim: "focus", text: "I can stay with one subject for a long stretch." },
  { key: "f2", dim: "focus", text: "My mind wanders within minutes of sitting down.", reverse: true },
  { key: "t1", dim: "time", text: "I finish what I planned for the day." },
  { key: "t2", dim: "time", text: "I leave things until the last moment.", reverse: true },
  { key: "cl1", dim: "clarity", text: "I know exactly what to study when I sit down." },
  { key: "cl2", dim: "clarity", text: "I feel lost about where to start.", reverse: true },
  { key: "p1", dim: "planning", text: "I plan my week before it begins." },
  { key: "p2", dim: "planning", text: "I study whatever comes to mind that day.", reverse: true },
  { key: "m1", dim: "motivation", text: "I have a clear reason for the effort I'm putting in." },
  { key: "m2", dim: "motivation", text: "I feel like giving up on my preparation.", reverse: true },
  { key: "e1", dim: "energy", text: "I wake up with enough energy for the day." },
  { key: "e2", dim: "energy", text: "I feel drained by the afternoon.", reverse: true },
  { key: "h1", dim: "habits", text: "I study at roughly the same times each day." },
  { key: "h2", dim: "habits", text: "My study routine changes completely day to day.", reverse: true },
];

const SCALE = [
  { v: 1, label: "Never" },
  { v: 2, label: "Rarely" },
  { v: 3, label: "Sometimes" },
  { v: 4, label: "Often" },
  { v: 5, label: "Always" },
];

/** 1–5 answers become a 0–100 score per dimension, reversed items flipped. */
export function scoreAnswers(answers: Record<string, number>) {
  const byDim: Record<string, number[]> = {};
  for (const q of QUESTIONS) {
    const raw = answers[q.key];
    if (!raw) continue;
    const v = q.reverse ? 6 - raw : raw;
    (byDim[q.dim] ??= []).push(v);
  }
  const scores: Record<string, number> = {};
  for (const [dim, vals] of Object.entries(byDim)) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    scores[dim] = Math.round(((mean - 1) / 4) * 100);
  }
  const all = Object.values(scores);
  const overall = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : 0;
  return { scores, overall };
}

function Assess() {
  const { user } = useAuth();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const { data: history = [] } = useQuery({
    enabled: !!user,
    queryKey: ["my-assessments", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("assessment_runs")
        .select("id, taken_at, overall")
        .eq("user_id", user!.id)
        .order("taken_at", { ascending: false });
      return data ?? [];
    },
  });

  const answered = Object.keys(answers).length;
  const done = answered === QUESTIONS.length;
  const progress = Math.round((answered / QUESTIONS.length) * 100);

  const preview = useMemo(() => scoreAnswers(answers), [answers]);

  const submit = async () => {
    if (!user || !done) return;
    setSaving(true);
    try {
      const { scores, overall } = scoreAnswers(answers);

      const { data: a, error: aErr } = await supabase
        .from("assessment_runs")
        .insert({ user_id: user.id, overall, is_baseline: history.length === 0 })
        .select("id")
        .single();
      if (aErr) throw aErr;

      const { error: sErr } = await supabase.from("assessment_scores").insert(
        Object.entries(scores).map(([dimension, score]) => ({
          run_id: a.id, dimension, score,
        })),
      );
      if (sErr) throw sErr;

      await supabase.from("assessment_answers").insert(
        Object.entries(answers).map(([question_key, value]) => ({
          run_id: a.id, question_key, value,
        })),
      );

      // Finishing an assessment is worth points, once per day.
      await supabase.from("points_ledger")
        .insert({ user_id: user.id, activity: "assessment", points: 50 });

      toast.success("Saved. Here's where you stand.");
      router.navigate({ to: "/progress" });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Assessment</div>
        <h1 className="font-display text-3xl">
          {history.length === 0 ? "Where you're starting from" : "Check in again"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {history.length === 0
            ? "Eighteen statements. No right answers — honest ones are more useful than flattering ones."
            : `Your ${history.length === 1 ? "second" : "latest"} check-in. Answer for the last two weeks.`}
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-4 bg-background/90 px-4 py-2 backdrop-blur">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all"
               style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {answered} of {QUESTIONS.length}
        </div>
      </div>

      <ol className="space-y-4">
        {QUESTIONS.map((q, i) => (
          <li key={q.key} className="soft-card p-5">
            <p className="text-base">
              <span className="mr-2 text-muted-foreground">{i + 1}.</span>
              {q.text}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCALE.map((s) => (
                <button
                  key={s.v}
                  onClick={() => setAnswers((a) => ({ ...a, [q.key]: s.v }))}
                  className={cn(
                    "rounded-full border border-border px-3.5 py-1.5 text-sm transition-colors",
                    answers[q.key] === s.v
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-secondary",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {done && (
        <div className="soft-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Preview</div>
          <div className="mt-1 font-display text-3xl">{preview.overall}<span className="text-base text-muted-foreground">/100</span></div>
          <p className="mt-1 text-sm text-muted-foreground">
            Overall study quality. Save to keep it and track change over time.
          </p>
        </div>
      )}

      <Button onClick={submit} disabled={!done || saving}
              size="lg" className="w-full rounded-full">
        {saving ? "Saving…" : done ? "Save my assessment" : `Answer all ${QUESTIONS.length} to continue`}
      </Button>
    </div>
  );
}
