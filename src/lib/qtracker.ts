import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * The Qtracker tables ship in a newer migration than the generated types.
 * This untyped handle keeps the build green until `types.ts` is regenerated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as SupabaseClient<any>;

/** Today in IST as YYYY-MM-DD (matches the rest of the app). */
export const istToday = () => {
  const d = new Date(Date.now() + (330 - new Date().getTimezoneOffset()) * 60000);
  return d.toISOString().slice(0, 10);
};

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const dayParts = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return {
    dow: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
    num: d.getUTCDate(),
    mon: d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }).toUpperCase(),
  };
};

export const fmtLong = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

export type ItemKind = "priority" | "schedule" | "call" | "appointment";
export type QItem = {
  id: string; day: string; kind: ItemKind; title: string;
  start_time: string | null; end_time: string | null; done: boolean;
};
export type QExpense = { id: string; day: string; label: string; amount: number };
export type QLog = { day: string; notes: string; water_glasses: number };
export type QSettings = {
  wake_time: string; water_target: number; default_duration_hours: number;
  goal: string | null; remind_daily_log: boolean; remind_streaks: boolean; remind_tasks: boolean;
};

export const DEFAULT_SETTINGS: QSettings = {
  wake_time: "06:30", water_target: 8, default_duration_hours: 2, goal: null,
  remind_daily_log: true, remind_streaks: true, remind_tasks: true,
};

/** Consecutive logged days ending today (or yesterday, so an unlogged morning doesn't zero it). */
export function computeStreak(logged: Set<string>, today: string) {
  let cursor = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (logged.has(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}
