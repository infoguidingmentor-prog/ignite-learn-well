import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DIMENSIONS } from "./assess";

export const Route = createFileRoute("/progress")({ component: Progress });

type Cmp = { dimension: string; previous: number | null; current: number | null; change: number };
type Mark = {
  id: string; subject: string; exam_name: string | null; exam_date: string;
  obtained: number; total: number; percentage: number; remarks: string | null;
};

const labelFor = (k: string) =>
  DIMENSIONS.find((d) => d.key === k)?.label ?? k;

function Progress() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: cmp = [] } = useQuery({
    enabled: !!user,
    queryKey: ["assessment-comparison", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("assessment_comparison", { _user: user!.id });
      if (error) throw error;
      return (data ?? []) as Cmp[];
    },
  });

  const { data: sittings = [] } = useQuery({
    enabled: !!user,
    queryKey: ["my-assessments", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("assessment_runs")
        .select("id, taken_at, overall")
        .eq("user_id", user!.id).order("taken_at", { ascending: true });
      return data ?? [];
    },
  });

  const { data: marks = [] } = useQuery({
    enabled: !!user,
    queryKey: ["my-marks", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("marks")
        .select("id,subject,exam_name,exam_date,obtained,total,percentage,remarks")
        .eq("user_id", user!.id).order("exam_date", { ascending: false });
      return (data ?? []) as Mark[];
    },
  });

  const [form, setForm] = useState({
    subject: "", exam_name: "", exam_date: new Date().toISOString().slice(0, 10),
    obtained: "", total: "", remarks: "",
  });

  const addMark = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!form.subject.trim()) throw new Error("Subject is required.");
      const obtained = Number(form.obtained), total = Number(form.total);
      if (!total || total <= 0) throw new Error("Total marks must be more than zero.");
      if (obtained > total) throw new Error("Obtained can't be more than the total.");
      const { error } = await supabase.from("marks").insert({
        user_id: user.id, subject: form.subject.trim(),
        exam_name: form.exam_name.trim() || null, exam_date: form.exam_date,
        obtained, total, remarks: form.remarks.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ ...form, subject: "", exam_name: "", obtained: "", total: "", remarks: "" });
      qc.invalidateQueries({ queryKey: ["my-marks"] });
      toast.success("Marks added.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save."),
  });

  const first = sittings[0] as any;
  const latest = sittings[sittings.length - 1] as any;
  const overallChange = first && latest && sittings.length > 1
    ? latest.overall - first.overall : null;

  // Academic trend: average of the three oldest vs three newest results.
  const academic = (() => {
    if (marks.length < 2) return null;
    const asc = [...marks].reverse();
    const take = Math.min(3, Math.floor(asc.length / 2)) || 1;
    const avg = (xs: Mark[]) => xs.reduce((a, m) => a + Number(m.percentage), 0) / xs.length;
    const before = avg(asc.slice(0, take));
    const now = avg(asc.slice(-take));
    return { before: Math.round(before), now: Math.round(now), change: Math.round(now - before) };
  })();

  const improved = cmp.filter((c) => c.change > 0).sort((a, b) => b.change - a.change);
  const slipped  = cmp.filter((c) => c.change < 0).sort((a, b) => a.change - b.change);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Progress</div>
        <h1 className="font-display text-3xl">How you're changing</h1>
      </header>

      {sittings.length === 0 ? (
        <div className="soft-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing to compare yet. The first assessment becomes the line everything else is measured against.
          </p>
          <Link to="/assess">
            <Button className="mt-4 rounded-full">Take the assessment</Button>
          </Link>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="soft-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Study quality</div>
              <div className="mt-1 font-display text-4xl">{latest?.overall ?? 0}</div>
              <div className="text-xs text-muted-foreground">
                {overallChange === null ? "baseline" :
                 overallChange > 0 ? `up ${overallChange} from your first` :
                 overallChange < 0 ? `down ${Math.abs(overallChange)} from your first` : "unchanged"}
              </div>
            </div>
            <div className="soft-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Check-ins</div>
              <div className="mt-1 font-display text-4xl">{sittings.length}</div>
              <div className="text-xs text-muted-foreground">
                since {new Date(first.taken_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </div>
            </div>
            <div className="soft-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Marks average</div>
              <div className="mt-1 font-display text-4xl">{academic ? `${academic.now}%` : "—"}</div>
              <div className="text-xs text-muted-foreground">
                {academic ? (academic.change >= 0 ? `up ${academic.change}%` : `down ${Math.abs(academic.change)}%`) : "add two results"}
              </div>
            </div>
          </section>

          {sittings.length < 2 && (
            <div className="soft-card p-5 text-sm text-muted-foreground">
              This is your baseline. Take the assessment again in a few weeks and this page
              will show what moved. <Link to="/assess" className="underline text-foreground">Retake</Link>
            </div>
          )}

          {sittings.length >= 2 && (
            <section>
              <h2 className="mb-3 font-display text-xl">Where you moved</h2>
              <ul className="space-y-2">
                {cmp.map((c) => {
                  const cur = c.current ?? 0;
                  return (
                    <li key={c.dimension} className="soft-card p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{labelFor(c.dimension)}</span>
                        <span className={cn("text-sm tabular-nums",
                          c.change > 0 ? "text-primary" : c.change < 0 ? "text-muted-foreground" : "text-muted-foreground")}>
                          {c.previous ?? "—"} → {cur}
                          {c.change !== 0 && <span className="ml-2">{c.change > 0 ? "+" : ""}{c.change}</span>}
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary transition-all"
                             style={{ width: `${cur}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>

              {(improved.length > 0 || slipped.length > 0) && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {improved.length > 0 && <>Strongest gain: <span className="text-foreground">{labelFor(improved[0].dimension)}</span>. </>}
                  {slipped.length > 0 && <>Needs attention: <span className="text-foreground">{labelFor(slipped[0].dimension)}</span>.</>}
                </p>
              )}
            </section>
          )}
        </>
      )}

      {/* ----------------------------- Marks ----------------------------- */}
      <section>
        <h2 className="mb-3 font-display text-xl">Academic results</h2>

        <div className="soft-card p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
              placeholder="Subject (required)" value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
              placeholder="Test name (optional)" value={form.exam_name}
              onChange={(e) => setForm({ ...form, exam_name: e.target.value })} />
            <input type="date" className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
              value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
            <div className="flex gap-2">
              <input type="number" className="w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
                placeholder="Scored" value={form.obtained}
                onChange={(e) => setForm({ ...form, obtained: e.target.value })} />
              <input type="number" className="w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
                placeholder="Out of" value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </div>
            <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm sm:col-span-2"
              placeholder="Remarks (optional)" value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </div>
          <Button onClick={() => addMark.mutate()} disabled={addMark.isPending}
                  className="mt-3 rounded-full">Add result</Button>
        </div>

        {marks.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="bg-paper/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Subject</th>
                  <th className="px-3 py-3 font-medium">Test</th>
                  <th className="px-3 py-3 font-medium text-right">Score</th>
                  <th className="px-3 py-3 font-medium text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {marks.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {new Date(m.exam_date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </td>
                    <td className="px-3 py-3 font-medium">{m.subject}</td>
                    <td className="px-3 py-3 text-muted-foreground">{m.exam_name ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{m.obtained}/{m.total}</td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">{m.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
