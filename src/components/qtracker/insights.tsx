import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { db, istToday, addDays, dayParts } from "@/lib/qtracker";
import { useLoggedDays } from "./use-qtracker";

const MIN_DAYS = 7;

export function Insights() {
  const { user } = useAuth();
  const { data: days, isLoading } = useLoggedDays();
  const loggedCount = days?.logged.size ?? 0;
  const ready = loggedCount >= MIN_DAYS;

  const { data } = useQuery({
    enabled: !!user && ready,
    queryKey: ["qt-insights", user?.id],
    queryFn: async () => {
      const today = istToday();
      const from = addDays(today, -13);
      const [focus, todos, exp] = await Promise.all([
        db.from("focus_sessions").select("actual_minutes,created_at,completed").eq("user_id", user!.id).gte("created_at", from + "T00:00:00+05:30"),
        db.from("todos").select("status").eq("user_id", user!.id),
        db.from("qtracker_expenses").select("day,amount").eq("user_id", user!.id).gte("day", from),
      ]);
      for (const r of [focus, todos, exp]) if (r.error) throw r.error;

      const range = Array.from({ length: 14 }, (_, i) => addDays(from, i));
      const minutes: Record<string, number> = Object.fromEntries(range.map((d) => [d, 0]));
      for (const f of focus.data ?? []) {
        if (!f.completed) continue;
        const d = new Date(new Date(f.created_at).getTime() + 330 * 60000).toISOString().slice(0, 10);
        if (d in minutes) minutes[d] += f.actual_minutes ?? 0;
      }
      const all = todos.data ?? [];
      const done = all.filter((t: { status: string }) => t.status === "done").length;
      const spent = (exp.data ?? []).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
      return { range, minutes, done, total: all.length, spent };
    },
  });

  if (isLoading) return <div className="soft-card h-32 animate-pulse" />;

  if (!ready) {
    const left = MIN_DAYS - loggedCount;
    return (
      <section className="soft-card flex items-start gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary"><Sparkles className="size-5" /></span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Insights warming up</p>
          <h2 className="text-lg font-semibold">We're calculating your data.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Insights need a few days of real activity to be accurate. Keep logging daily. Your full insights unlock after {left} more logged {left === 1 ? "day" : "days"}.
          </p>
          <div className="mt-3 h-2 w-56 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(loggedCount / MIN_DAYS) * 100}%` }} />
          </div>
        </div>
      </section>
    );
  }

  const max = Math.max(30, ...Object.values(data?.minutes ?? { x: 0 }));
  const consistency = Math.round((Math.min(loggedCount, 14) / 14) * 100);
  const completion = data && data.total ? Math.round((data.done / data.total) * 100) : 0;
  const totalMin = Object.values(data?.minutes ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Streak" value={`${days?.streak ?? 0} days`} />
        <Stat label="Consistency (14d)" value={`${consistency}%`} />
        <Stat label="Tasks completed" value={`${completion}%`} sub={data ? `${data.done} of ${data.total}` : undefined} />
        <Stat label="Spent (14d)" value={`₹${(data?.spent ?? 0).toLocaleString("en-IN")}`} />
      </div>

      <section className="soft-card p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Focus minutes, last 14 days</h3>
          <span className="text-xs text-muted-foreground">{Math.round(totalMin / 60 * 10) / 10} h total</span>
        </div>
        <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Bar chart of focus minutes per day">
          {data?.range.map((d) => {
            const m = data.minutes[d];
            return (
              <div key={d} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t-md bg-primary/80" style={{ height: `${(m / max) * 100}%`, minHeight: m ? 3 : 0 }} title={`${m} min`} />
                </div>
                <span className="text-[9px] text-muted-foreground">{dayParts(d).num}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="soft-card p-4">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
