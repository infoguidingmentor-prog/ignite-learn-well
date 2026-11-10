import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  db, istToday, addDays, computeStreak, DEFAULT_SETTINGS,
  type QSettings,
} from "@/lib/qtracker";

export function useQSettings() {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user,
    queryKey: ["qt-settings", user?.id],
    queryFn: async (): Promise<QSettings> => {
      const { data, error } = await db.from("qtracker_settings").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    },
  });
}

/** Days (last 90) on which the student logged anything, plus days that have planned items ahead. */
export function useLoggedDays() {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user,
    queryKey: ["qt-days", user?.id],
    queryFn: async () => {
      const today = istToday();
      const from = addDays(today, -90);
      const to = addDays(today, 30);
      const [items, logs, exp] = await Promise.all([
        db.from("qtracker_items").select("day,done").eq("user_id", user!.id).gte("day", from).lte("day", to),
        db.from("qtracker_daily_logs").select("day,notes,water_glasses").eq("user_id", user!.id).gte("day", from),
        db.from("qtracker_expenses").select("day").eq("user_id", user!.id).gte("day", from),
      ]);
      for (const r of [items, logs, exp]) if (r.error) throw r.error;

      const logged = new Set<string>();
      const planned = new Set<string>();
      for (const i of items.data ?? []) {
        if (i.day > today) planned.add(i.day); else logged.add(i.day);
      }
      for (const l of logs.data ?? []) if ((l.notes ?? "").trim() || l.water_glasses > 0) logged.add(l.day);
      for (const e of exp.data ?? []) logged.add(e.day);
      return { logged, planned, streak: computeStreak(logged, today) };
    },
  });
}
