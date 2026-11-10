import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Trash2, ListTodo, Hourglass, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/qtracker";

type Status = "todo" | "in_progress" | "done";
type Task = { id: string; title: string; status: Status; due_date: string | null };

const COLUMNS: { id: Status; label: string; icon: typeof ListTodo; tint: string }[] = [
  { id: "todo",        label: "To do",       icon: ListTodo,     tint: "bg-secondary/60" },
  { id: "in_progress", label: "In progress", icon: Hourglass,    tint: "bg-amber-500/10" },
  { id: "done",        label: "Done",        icon: CheckCircle2, tint: "bg-emerald-500/10" },
];

export function Planner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);
  const key = ["qt-board", user?.id];

  const { data: tasks = [], isLoading } = useQuery({
    enabled: !!user,
    queryKey: key,
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await db.from("todos").select("id,title,status,due_date").eq("user_id", user!.id).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const t = title.trim();
      if (!t) return;
      const { error } = await db.from("todos").insert({ user_id: user!.id, title: t, status: "todo", done: false, due_date: due || null });
      if (error) throw error;
    },
    onSuccess: () => { setTitle(""); setDue(""); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["todos", user?.id] }); },
    onError: () => toast.error("Couldn't add that task."),
  });

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await db.from("todos").update({ status, done: status === "done" }).eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    // Optimistic: the card jumps columns instantly, rolls back if the save fails.
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Task[]>(key);
      qc.setQueryData<Task[]>(key, (old = []) => old.map((t) => (t.id === id ? { ...t, status } : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error("Couldn't move that task."); },
    onSettled: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["todos", user?.id] }); },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("todos").delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["todos", user?.id] }); },
  });

  const idx = (s: Status) => COLUMNS.findIndex((c) => c.id === s);

  return (
    <div className="space-y-4">
      <section className="soft-card p-4">
        <h2 className="text-base font-semibold">Project board</h2>
        <p className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">Drag &amp; drop across stages</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={title} maxLength={200} placeholder="New task…" onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add.mutate(); }} />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="sm:w-44" aria-label="Due date" />
          <Button onClick={() => add.mutate()} disabled={!title.trim() || add.isPending}><Plus className="mr-1 size-4" />New task</Button>
        </div>
      </section>

      <p className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-muted-foreground">
        Drag a card between columns, or use the arrows on the card (works on phones too). Move a task to <b>In progress</b> when you start and to <b>Done</b> once it's finished.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = tasks.filter((t) => t.status === col.id);
          const Icon = col.icon;
          return (
            <section
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
              onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragId;
                setOverCol(null); setDragId(null);
                const t = tasks.find((x) => x.id === id);
                if (t && t.status !== col.id) move.mutate({ id: t.id, status: col.id });
              }}
              className={cn("min-h-56 rounded-2xl border border-border p-3 transition-colors", col.tint, overCol === col.id && "ring-2 ring-primary")}
            >
              <header className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide"><Icon className="size-4" />{col.label}</span>
                <span className="grid min-w-6 place-items-center rounded-full bg-foreground px-1.5 text-xs text-background">{list.length}</span>
              </header>
              {isLoading ? null : list.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border py-8 text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
                  No tasks in {col.label}
                </p>
              ) : (
                <ul className="space-y-2">
                  {list.map((t) => (
                    <li key={t.id} draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); setDragId(t.id); }}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      className={cn("cursor-grab rounded-xl border border-border bg-card p-3 shadow-sm active:cursor-grabbing", dragId === t.id && "opacity-50")}>
                      <p className={cn("break-words text-sm", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</p>
                      {t.due_date && <p className="mt-1 text-[11px] text-muted-foreground">Due {t.due_date}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex gap-1">
                          <Button size="icon" variant="outline" className="size-7" aria-label="Move back" disabled={idx(t.status) === 0}
                            onClick={() => move.mutate({ id: t.id, status: COLUMNS[idx(t.status) - 1].id })}><ArrowLeft className="size-3.5" /></Button>
                          <Button size="icon" variant="outline" className="size-7" aria-label="Move forward" disabled={idx(t.status) === COLUMNS.length - 1}
                            onClick={() => move.mutate({ id: t.id, status: COLUMNS[idx(t.status) + 1].id })}><ArrowRight className="size-3.5" /></Button>
                        </div>
                        <button aria-label="Delete task" onClick={() => remove.mutate(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
