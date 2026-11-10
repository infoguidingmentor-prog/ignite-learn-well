import { createFileRoute, Link } from "@tanstack/react-router";
import { Flame, Target, NotebookPen, CheckCircle2, BarChart3, Users, Settings as Cog } from "lucide-react";
import { Protected } from "@/components/protected";
import { cn } from "@/lib/utils";
import { DailyLog } from "@/components/qtracker/daily-log";
import { Planner } from "@/components/qtracker/planner";
import { Insights } from "@/components/qtracker/insights";
import { GroupStudy } from "@/components/qtracker/group-study";
import { SettingsTab } from "@/components/qtracker/settings-tab";
import { useLoggedDays, useQSettings } from "@/components/qtracker/use-qtracker";

const TABS = [
  { id: "log", label: "Daily Log", icon: NotebookPen },
  { id: "planner", label: "Planner", icon: CheckCircle2 },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "group", label: "Group Study", icon: Users },
  { id: "settings", label: "Settings", icon: Cog },
] as const;
type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/qtracker")({
  validateSearch: (s: Record<string, unknown>): { tab: TabId } => ({
    tab: TABS.some((t) => t.id === s.tab) ? (s.tab as TabId) : "log",
  }),
  head: () => ({ meta: [{ title: "Qtracker | Guiding Mentor" }] }),
  component: () => <Protected><Qtracker /></Protected>,
});

function Qtracker() {
  const { tab } = Route.useSearch();
  const { data: days } = useLoggedDays();
  const { data: settings } = useQSettings();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Student performance tracker</p>
          <h1 className="text-2xl font-semibold">My Qtracker</h1>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2">
            <Flame className="size-5 text-orange-500" />
            <div className="leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Log streak</p>
              <p className="text-sm font-semibold">{days?.streak ?? 0} {days?.streak === 1 ? "day" : "days"}</p>
            </div>
          </div>
          <Link to="/qtracker" search={{ tab: "settings" }} className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2">
            <Target className="size-5 text-sky-600" />
            <div className="leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Goal</p>
              <p className="text-sm font-semibold">{settings?.goal || "Set a goal"}</p>
            </div>
          </Link>
        </div>
      </header>

      <nav aria-label="Qtracker sections" className="grid grid-cols-5 gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Link
            key={id} to="/qtracker" search={{ tab: id }} replace
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2.5 text-[11px] font-medium transition-colors sm:flex-row sm:gap-2 sm:text-sm",
              tab === id ? "border-orange-500 bg-orange-500 text-white shadow" : "border-border bg-card text-foreground hover:bg-secondary",
            )}
          >
            <Icon className="size-4" /><span className="truncate">{label}</span>
          </Link>
        ))}
      </nav>

      {tab === "log" && <DailyLog />}
      {tab === "planner" && <Planner />}
      {tab === "insights" && <Insights />}
      {tab === "group" && <GroupStudy />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
