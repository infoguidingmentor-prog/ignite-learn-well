import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Protected } from "@/components/protected";
import { BeforeAfter } from "@/components/before-after";
import { Journey30 } from "@/components/journey-30";
import { Button } from "@/components/ui/button";
import { Check, Plus, Trash2, Download, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/me")({
  component: () => <Protected><Me /></Protected>,
});

type Todo = { id: string; title: string; done: boolean; is_mandatory: boolean; due_date: string | null };
type Game = {
  points: number; current_streak: number; best_streak: number; active_days: number;
  badges: string[];
};

function Me() {
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [exporting, setExporting] = useState(false);

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "Your account";

  const { data: todos = [] } = useQuery({
    enabled: !!user,
    queryKey: ["todos", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("todos")
        .select("id,title,done,is_mandatory,due_date")
        .eq("user_id", user!.id)
        .order("done", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Todo[];
    },
  });

  const { data: g } = useQuery({
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

  const add = useMutation({
    mutationFn: async () => {
      if (!user || !title.trim()) return;
      const { error } = await supabase.from("todos")
        .insert({ user_id: user.id, title: title.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setTitle(""); qc.invalidateQueries({ queryKey: ["todos"] }); },
  });

  const toggle = useMutation({
    mutationFn: async (t: Todo) => {
      const { error } = await supabase.from("todos")
        .update({ done: !t.done, completed_at: t.done ? null : new Date().toISOString() })
        .eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("todos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });

  /** Everything we hold on this student, as one file they can keep. */
  const exportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const tables = [
        "meditation_sessions", "journal_entries", "affirmation_completions",
        "mood_checkins", "breathing_sessions", "focus_sessions",
        "todos", "marks", "assessment_runs", "study_plans", "plan_tasks",
      ];
      const out: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        account: { email: user.email, name: fullName },
      };
      for (const t of tables) {
        const { data } = await supabase.from(t).select("*").eq("user_id", user.id);
        out[t] = data ?? [];
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `guiding-mentor-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't export that.");
    } finally {
      setExporting(false);
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); router.navigate({ to: "/" }); };

  const lastRun = runs[0] as any;
  const daysSince = lastRun
    ? Math.floor((Date.now() - new Date(lastRun.taken_at).getTime()) / 86400000)
    : null;

  const openTodos = todos.filter((t) => !t.done).length;

  return (
    <div className="space-y-6">
      <header className="gm-rise">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Me</div>
        <h1 className="font-display text-3xl">{fullName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
      </header>

      {/* -------------------------- at a glance -------------------------- */}
      <section className="grid grid-cols-3 gap-3 gm-rise" style={{ animationDelay: "60ms" }}>
        {[
          ["Streak", g?.current_streak ?? 0, "days"],
          ["Points", g?.points ?? 0, "earned"],
          ["Active", g?.active_days ?? 0, "days total"],
        ].map(([label, value, note]) => (
          <div key={label as string} className="soft-card p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className="mt-1 font-display text-2xl tabular-nums">{value as number}</div>
            <div className="text-[10px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </section>

      <div className="gm-rise" style={{ animationDelay: "100ms" }}>
        <BeforeAfter />
      </div>

      <div className="gm-rise" style={{ animationDelay: "140ms" }}>
        <Journey30 />
      </div>

      {/* --------------------------- assessment --------------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "180ms" }}>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Study quality</div>
        {runs.length === 0 ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              You haven't taken the assessment yet. It's the line everything else gets measured against.
            </p>
            <Link to="/assess">
              <Button size="sm" className="mt-3 rounded-full">Take the assessment</Button>
            </Link>
          </>
        ) : (
          <>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-display text-3xl">{lastRun.overall ?? 0}</span>
              <span className="text-sm text-muted-foreground">
                out of 100 · {daysSince === 0 ? "today" : `${daysSince} days ago`}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/progress">
                <Button size="sm" variant="outline" className="rounded-full">See progress</Button>
              </Link>
              {daysSince !== null && daysSince >= 14 && (
                <Link to="/assess">
                  <Button size="sm" className="rounded-full">Retake</Button>
                </Link>
              )}
            </div>
          </>
        )}
      </section>

      {/* ----------------------------- to-do ----------------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "220ms" }}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl">To-do</h2>
          {openTodos > 0 && (
            <span className="text-xs text-muted-foreground">{openTodos} open</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Short list. Only what matters today.</p>

        <div className="mt-4 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add.mutate()}
            placeholder="One thing…"
            className="flex-1 rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
          />
          <Button onClick={() => add.mutate()} disabled={!title.trim() || add.isPending}
                  className="rounded-full">
            <Plus className="size-4" />
          </Button>
        </div>

        <ul className="mt-4 space-y-2">
          {todos.length === 0 && (
            <li className="text-sm text-muted-foreground">Nothing here. That's allowed.</li>
          )}
          {todos.map((t) => (
            <li key={t.id}
                className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:bg-secondary/40">
              <button
                onClick={() => toggle.mutate(t)}
                aria-label={t.done ? "Mark not done" : "Mark done"}
                className={cn("grid size-6 shrink-0 place-items-center rounded-full border transition-all",
                  t.done ? "scale-105 border-primary bg-primary text-primary-foreground" : "border-border")}
              >
                {t.done && <Check className="size-3.5" />}
              </button>
              <span className={cn("flex-1 text-sm", t.done && "text-muted-foreground line-through")}>
                {t.title}
              </span>
              <button onClick={() => remove.mutate(t.id)} aria-label="Delete"
                      className="text-muted-foreground hover:text-foreground">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------- privacy ---------------------------- */}
      <section className="soft-card gm-rise p-5" style={{ animationDelay: "260ms" }}>
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-display text-xl">Your data</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your journal is private. Parents never see it. A coach sees an entry only if you
              tap "share with mentor" on that specific entry.
            </p>
            <Button onClick={exportData} disabled={exporting}
                    variant="outline" size="sm" className="mt-3 rounded-full">
              <Download className="mr-2 size-4" />
              {exporting ? "Preparing…" : "Download everything we hold"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              To delete your account and all records, ask your coach or email the team.
            </p>
          </div>
        </div>
      </section>

      <Button variant="outline" onClick={signOut} className="w-full rounded-full">Sign out</Button>
    </div>
  );
}
