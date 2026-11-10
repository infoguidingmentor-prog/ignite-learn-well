import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { db, DEFAULT_SETTINGS, type QSettings } from "@/lib/qtracker";
import { useQSettings } from "./use-qtracker";

const DURATIONS = [0.5, 1, 1.5, 2, 3, 4, 6];

export function SettingsTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQSettings();
  const [s, setS] = useState<QSettings>(DEFAULT_SETTINGS);
  useEffect(() => { if (data) setS(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("qtracker_settings").upsert(
        { ...s, goal: s.goal?.trim() || null, user_id: user!.id, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["qt-settings", user?.id] }); toast.success("Preferences saved"); },
    onError: () => toast.error("Couldn't save your preferences."),
  });

  const set = <K extends keyof QSettings>(k: K, v: QSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Settings</h2>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Calibrate your Qtracker experience</p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="mr-1.5 size-4" />Save preferences</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="soft-card space-y-3 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Daily calibration</h3>
          <Row title="Your goal" hint="Shown on your tracker, e.g. NEET, JEE, Boards">
            <Input value={s.goal ?? ""} maxLength={40} className="w-40" onChange={(e) => set("goal", e.target.value)} />
          </Row>
          <Row title="Wake-up time" hint="When your daily log starts">
            <Input type="time" value={s.wake_time.slice(0, 5)} className="w-32" onChange={(e) => set("wake_time", e.target.value)} />
          </Row>
          <Row title="Water target" hint="Glasses per day (4–15)">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Fewer glasses" onClick={() => set("water_target", Math.max(4, s.water_target - 1))}><Minus className="size-4" /></Button>
              <span className="w-6 text-center tabular-nums">{s.water_target}</span>
              <Button size="icon" aria-label="More glasses" onClick={() => set("water_target", Math.min(15, s.water_target + 1))}><Plus className="size-4" /></Button>
            </div>
          </Row>
          <Row title="Default duration" hint="Standard study block size">
            <select
              value={s.default_duration_hours}
              onChange={(e) => set("default_duration_hours", Number(e.target.value))}
              className="h-10 rounded-md border border-border bg-card px-2 text-sm"
            >
              {DURATIONS.map((d) => <option key={d} value={d}>{d} {d === 1 ? "hour" : "hours"}</option>)}
            </select>
          </Row>
        </section>

        <section className="soft-card space-y-3 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Notifications</h3>
          <Row title="Daily log reminder" hint="Alert sent 30 min after wake-up">
            <Switch checked={s.remind_daily_log} onCheckedChange={(v) => set("remind_daily_log", v)} />
          </Row>
          <Row title="Streak milestones" hint="Celebrate 7, 14, 30 day consistency">
            <Switch checked={s.remind_streaks} onCheckedChange={(v) => set("remind_streaks", v)} />
          </Row>
          <Row title="Task reminders" hint="Nudge for overdue assignments">
            <Switch checked={s.remind_tasks} onCheckedChange={(v) => set("remind_tasks", v)} />
          </Row>
          <p className="pt-1 text-[11px] text-muted-foreground">These save your choices. Delivery uses the app's existing reminder system.</p>
        </section>
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
