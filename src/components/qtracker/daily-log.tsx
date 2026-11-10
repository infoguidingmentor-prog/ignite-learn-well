import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, Droplets, Wallet, Target, Clock, Phone, CalendarClock, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { db, istToday, addDays, dayParts, fmtLong, type ItemKind, type QItem, type QExpense } from "@/lib/qtracker";
import { useLoggedDays, useQSettings } from "./use-qtracker";

export function DailyLog() {
  const today = istToday();
  const [selected, setSelected] = useState(today);
  const [windowStart, setWindowStart] = useState(addDays(today, -7));
  const { data: days } = useLoggedDays();

  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(windowStart, i)), [windowStart]);

  return (
    <div className="space-y-4">
      <section className="soft-card p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">History &amp; context</h2>
          <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
            <Legend color="bg-emerald-500" label="Logged" />
            <Legend color="bg-rose-400" label="Missed" />
            <Legend color="bg-amber-400" label="Planned" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Earlier days" onClick={() => setWindowStart(addDays(windowStart, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {strip.map((d) => {
              const p = dayParts(d);
              const isSel = d === selected;
              const logged = days?.logged.has(d);
              const planned = days?.planned.has(d);
              const missed = d < today && !logged;
              return (
                <button
                  key={d}
                  onClick={() => setSelected(d)}
                  aria-pressed={isSel}
                  aria-label={fmtLong(d)}
                  className={cn(
                    "relative flex min-w-[3.4rem] flex-1 flex-col items-center rounded-xl border px-1 py-2 text-center transition-colors",
                    isSel ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
                    d === today && !isSel && "border-primary/50",
                  )}
                >
                  <span className="text-[10px] font-medium">{p.dow}</span>
                  <span className="text-lg font-semibold leading-tight text-foreground">{p.num}</span>
                  <span className="text-[10px]">{p.mon}</span>
                  <span className={cn(
                    "absolute right-1.5 top-1.5 size-1.5 rounded-full",
                    logged ? "bg-emerald-500" : planned ? "bg-amber-400" : missed ? "bg-rose-400/70" : "bg-transparent",
                  )} />
                </button>
              );
            })}
          </div>
          <Button variant="outline" size="icon" aria-label="Later days" onClick={() => setWindowStart(addDays(windowStart, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="sm:flex-1" onClick={() => { setSelected(today); setWindowStart(addDays(today, -7)); }}>
            Jump to today
          </Button>
          <label className="flex items-center gap-2 rounded-md border border-border bg-card px-3 sm:flex-1">
            <span className="sr-only">Pick a date</span>
            <input
              type="date"
              value={selected}
              onChange={(e) => {
                if (!e.target.value) return;
                setSelected(e.target.value);
                setWindowStart(addDays(e.target.value, -7));
              }}
              className="h-10 w-full bg-transparent text-sm outline-none"
            />
          </label>
        </div>
      </section>

      <DayBoard day={selected} />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", color)} />{label}</span>;
}

function DayBoard({ day }: { day: string }) {
  const { user } = useAuth();
  const { data: settings } = useQSettings();

  const { data: items = [] } = useQuery({
    enabled: !!user,
    queryKey: ["qt-items", user?.id, day],
    queryFn: async (): Promise<QItem[]> => {
      const { data, error } = await db.from("qtracker_items").select("*").eq("user_id", user!.id).eq("day", day)
        .order("start_time", { ascending: true, nullsFirst: false }).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const by = (k: ItemKind) => items.filter((i) => i.kind === k);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1">
        <ItemCard day={day} kind="priority" title="Top priorities" icon={<Target className="size-4" />} accent="bg-orange-500/15 text-orange-600" items={by("priority")} empty="No priorities logged" checkable />
        <ItemCard day={day} kind="call" title="Calls / Emails" icon={<Phone className="size-4" />} accent="bg-sky-500/15 text-sky-600" items={by("call")} empty="No items logged" checkable />
      </div>
      <div className="space-y-4 lg:col-span-1">
        <ItemCard day={day} kind="schedule" title="Daily schedules" icon={<Clock className="size-4" />} accent="bg-indigo-500/15 text-indigo-600" items={by("schedule")} empty="Use + to build your timeline" timed defaultStart={settings?.wake_time} />
        <ItemCard day={day} kind="appointment" title="Appointments" icon={<CalendarClock className="size-4" />} accent="bg-pink-500/15 text-pink-600" items={by("appointment")} empty="No appointments" timed />
      </div>
      <div className="space-y-4 lg:col-span-1">
        <NotesCard day={day} />
        <WaterCard day={day} target={settings?.water_target ?? 8} />
        <ExpenseCard day={day} />
      </div>
    </div>
  );
}

function CardShell({ icon, accent, title, action, children }: {
  icon: React.ReactNode; accent: string; title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="soft-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={cn("grid size-8 place-items-center rounded-lg", accent)}>{icon}</span>
          <h3 className="text-sm font-semibold uppercase tracking-wide">{title}</h3>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ItemCard({ day, kind, title, icon, accent, items, empty, checkable, timed, defaultStart }: {
  day: string; kind: ItemKind; title: string; icon: React.ReactNode; accent: string;
  items: QItem[]; empty: string; checkable?: boolean; timed?: boolean; defaultStart?: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [time, setTime] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["qt-items", user?.id, day] });
    qc.invalidateQueries({ queryKey: ["qt-days", user?.id] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const title = text.trim();
      if (!title) return;
      const { error } = await db.from("qtracker_items").insert({
        user_id: user!.id, day, kind, title,
        start_time: timed ? (time || defaultStart || null) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setText(""); setTime(""); setAdding(false); refresh(); },
    onError: () => toast.error("Couldn't save that. Please try again."),
  });

  const toggle = useMutation({
    mutationFn: async (i: QItem) => {
      const { error } = await db.from("qtracker_items").update({ done: !i.done }).eq("id", i.id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("qtracker_items").delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return (
    <CardShell icon={icon} accent={accent} title={title}
      action={<Button size="icon" variant="outline" aria-label={`Add to ${title}`} onClick={() => setAdding((a) => !a)}><Plus className="size-4" /></Button>}>
      {adding && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          {timed && <Input type="time" value={time || defaultStart?.slice(0, 5) || ""} onChange={(e) => setTime(e.target.value)} className="sm:w-32" />}
          <Input autoFocus value={text} maxLength={200} placeholder="Add…" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add.mutate(); }} />
          <Button onClick={() => add.mutate()} disabled={!text.trim() || add.isPending}>Add</Button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs italic text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="group flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
              {checkable && (
                <button aria-label={i.done ? "Mark not done" : "Mark done"} onClick={() => toggle.mutate(i)}
                  className={cn("grid size-5 shrink-0 place-items-center rounded-md border", i.done ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {i.done && <Check className="size-3.5" />}
                </button>
              )}
              {timed && i.start_time && <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums">{i.start_time.slice(0, 5)}</span>}
              <span className={cn("min-w-0 flex-1 break-words text-sm", i.done && "text-muted-foreground line-through")}>{i.title}</span>
              <button aria-label="Delete" onClick={() => remove.mutate(i.id)} className="text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover:opacity-100">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function NotesCard({ day }: { day: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const loadedFor = useRef<string | null>(null);

  const { data } = useQuery({
    enabled: !!user,
    queryKey: ["qt-log", user?.id, day],
    queryFn: async () => {
      const { data, error } = await db.from("qtracker_daily_logs").select("notes,water_glasses").eq("user_id", user!.id).eq("day", day).maybeSingle();
      if (error) throw error;
      return data as { notes: string; water_glasses: number } | null;
    },
  });

  // Reset the editor only when the day (or first load) changes — never on our own saves.
  useEffect(() => {
    if (data === undefined) return;
    if (loadedFor.current !== day) { setValue(data?.notes ?? ""); loadedFor.current = day; }
  }, [data, day]);

  const save = async (notes: string) => {
    const { error } = await db.from("qtracker_daily_logs").upsert(
      { user_id: user!.id, day, notes, updated_at: new Date().toISOString() },
      { onConflict: "user_id,day" },
    );
    if (error) { toast.error("Couldn't save your notes."); return; }
    qc.invalidateQueries({ queryKey: ["qt-days", user?.id] });
  };

  useEffect(() => {
    if (loadedFor.current !== day || value === (data?.notes ?? "")) return;
    const t = setTimeout(() => save(value), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <CardShell icon={<StickyNote className="size-4" />} accent="bg-emerald-500/15 text-emerald-600" title="Daily notes">
      <textarea
        value={value} maxLength={4000} onChange={(e) => setValue(e.target.value)} onBlur={() => save(value)}
        placeholder="Jot down anything…"
        className="min-h-28 w-full resize-y rounded-lg border border-border bg-card p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </CardShell>
  );
}

function WaterCard({ day, target }: { day: string; target: number }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    enabled: !!user,
    queryKey: ["qt-log", user?.id, day],
    queryFn: async () => {
      const { data, error } = await db.from("qtracker_daily_logs").select("notes,water_glasses").eq("user_id", user!.id).eq("day", day).maybeSingle();
      if (error) throw error;
      return data as { notes: string; water_glasses: number } | null;
    },
  });
  const glasses = data?.water_glasses ?? 0;

  const set = useMutation({
    mutationFn: async (n: number) => {
      const { error } = await db.from("qtracker_daily_logs").upsert(
        { user_id: user!.id, day, water_glasses: Math.max(0, n), updated_at: new Date().toISOString() },
        { onConflict: "user_id,day" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["qt-log", user?.id, day] });
      qc.invalidateQueries({ queryKey: ["qt-days", user?.id] });
    },
  });

  return (
    <CardShell icon={<Droplets className="size-4" />} accent="bg-cyan-500/15 text-cyan-600" title="Water"
      action={<span className="text-xs tabular-nums text-muted-foreground">{glasses}/{target}</span>}>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" aria-label="Remove a glass" onClick={() => set.mutate(glasses - 1)} disabled={glasses === 0}>−</Button>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${Math.min(100, (glasses / target) * 100)}%` }} />
        </div>
        <Button size="icon" aria-label="Add a glass" onClick={() => set.mutate(glasses + 1)}>+</Button>
      </div>
    </CardShell>
  );
}

function ExpenseCard({ day }: { day: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const { data: rows = [] } = useQuery({
    enabled: !!user,
    queryKey: ["qt-exp", user?.id, day],
    queryFn: async (): Promise<QExpense[]> => {
      const { data, error } = await db.from("qtracker_expenses").select("*").eq("user_id", user!.id).eq("day", day).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["qt-exp", user?.id] });
    qc.invalidateQueries({ queryKey: ["qt-days", user?.id] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!label.trim() || !Number.isFinite(amt) || amt < 0) throw new Error("invalid");
      const { error } = await db.from("qtracker_expenses").insert({ user_id: user!.id, day, label: label.trim(), amount: amt });
      if (error) throw error;
    },
    onSuccess: () => { setLabel(""); setAmount(""); setAdding(false); refresh(); },
    onError: () => toast.error("Enter a label and a valid amount."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("qtracker_expenses").delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return (
    <CardShell icon={<Wallet className="size-4" />} accent="bg-green-500/15 text-green-600" title="Expense tracker"
      action={<Button size="icon" variant="outline" aria-label="Add expense" onClick={() => setAdding((a) => !a)}><Plus className="size-4" /></Button>}>
      {adding && (
        <div className="mb-3 flex gap-2">
          <Input value={label} maxLength={120} placeholder="What for?" onChange={(e) => setLabel(e.target.value)} />
          <Input value={amount} inputMode="decimal" placeholder="₹" className="w-24" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") add.mutate(); }} />
          <Button onClick={() => add.mutate()} disabled={add.isPending}>Add</Button>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="tabular-nums">₹{Number(r.amount).toLocaleString("en-IN")}</span>
              <button aria-label="Delete expense" onClick={() => remove.mutate(r.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-border pt-3 text-xs uppercase tracking-wide text-muted-foreground">
        Total spent
        <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-sm font-semibold normal-case text-emerald-700 tabular-nums">₹{total.toLocaleString("en-IN")}</span>
      </div>
    </CardShell>
  );
}
