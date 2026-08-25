import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Scene } from "@/components/scene";
import { toast } from "sonner";
import { BackgroundMusic } from "@/components/background-music";

export const Route = createFileRoute("/practice/breathe")({ component: Breathe });

type Pattern = "box" | "4-7-8" | "coherent";

/**
 * Named for what they do, not for their counts — "4-7-8" means nothing to a
 * student mid-panic. The keys stay the same so existing session rows still
 * line up.
 */
const PATTERNS: Record<Pattern, { label: string; phases: { name: string; sec: number }[]; blurb: string }> = {
  "box":      { label: "Settle", blurb: "When your chest is tight.", phases: [{ name: "Inhale", sec: 4 }, { name: "Hold", sec: 4 }, { name: "Exhale", sec: 4 }, { name: "Hold", sec: 4 }] },
  "4-7-8":    { label: "Sleep",  blurb: "For winding down.",         phases: [{ name: "Inhale", sec: 4 }, { name: "Hold", sec: 7 }, { name: "Exhale", sec: 8 }] },
  "coherent": { label: "Focus",  blurb: "Before a study block.",     phases: [{ name: "Inhale", sec: 5 }, { name: "Exhale", sec: 5 }] },
};

function Breathe() {
  const { user } = useAuth();
  const [pattern, setPattern] = useState<Pattern>("box");
  const [running, setRunning] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [phaseSec, setPhaseSec] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const tick = useRef<number | null>(null);

  const cfg = PATTERNS[pattern];
  const phase = cfg.phases[phaseIdx];

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setElapsed((e) => e + 0.1);
      setPhaseSec((s) => {
        const next = s + 0.1;
        if (next >= phase.sec) {
          const nextIdx = (phaseIdx + 1) % cfg.phases.length;
          setPhaseIdx(nextIdx);
          if (nextIdx === 0) setCycles((c) => c + 1);
          return 0;
        }
        return next;
      });
    }, 100);
    return () => { if (tick.current) window.clearInterval(tick.current); };
  }, [running, phase.sec, phaseIdx, cfg.phases.length]);

  const log = useMutation({
    mutationFn: async (payload: { cycles: number; seconds: number }) => {
      if (!user) return;
      const { error } = await supabase.from("breathing_sessions").insert({
        user_id: user.id, pattern, cycles: payload.cycles, duration_seconds: payload.seconds,
      });
      if (error) throw error;
    },
  });

  const start = () => { setRunning(true); setPhaseIdx(0); setPhaseSec(0); setCycles(0); setElapsed(0); };
  const stop = () => {
    setRunning(false);
    if (elapsed > 5) {
      log.mutate({ cycles, seconds: Math.round(elapsed) });
      toast.success(`${cycles} cycles. Nice.`);
    }
  };

  // orb scale by phase name
  const scale = phase.name === "Inhale" ? 1 : phase.name === "Exhale" ? 0.55 : phase.name === "Hold" ? (phaseIdx > 1 ? 0.55 : 1) : 0.8;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PATTERNS) as Pattern[]).map((p) => (
            <button key={p} onClick={() => !running && setPattern(p)} className={cn(
              "rounded-full px-4 py-1.5 text-sm border border-border",
              pattern === p ? "bg-primary text-primary-foreground border-primary ring-2 ring-primary/40 shadow-[0_0_0_5px_rgba(0,60,148,0.10)] motion-safe:scale-[1.05]" : "hover:bg-secondary opacity-70"
            )}>{PATTERNS[p].label}</button>
          ))}
        </div>
        <Scene kind="breathe" size={64} className="shrink-0" />
      </div>

      <BackgroundMusic scope="breathe" />

      <div className="soft-card grid place-items-center p-8 md:p-12" style={{ minHeight: 360 }}>
        <div className="relative grid size-64 place-items-center">
          <div
            className="absolute rounded-full bg-gradient-to-br from-sage/40 to-dusk/30"
            style={{
              width: 220, height: 220,
              transform: `scale(${scale})`,
              transition: `transform ${phase.sec}s ease-in-out`,
            }}
          />
          <div className="relative text-center">
            <div className="font-display text-3xl">{running ? phase.name : cfg.blurb}</div>
            {running && <div className="mt-1 text-sm text-muted-foreground">{Math.ceil(phase.sec - phaseSec)}s</div>}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {!running ? (
            <Button onClick={start} size="lg" className="rounded-full">
              <Play className="mr-2 size-4" /> Begin
            </Button>
          ) : (
            <Button onClick={stop} size="lg" variant="outline" className="rounded-full">
              <Square className="mr-2 size-4" /> Finish
            </Button>
          )}
        </div>

        {running && (
          <div className="mt-4 text-xs text-muted-foreground">
            {cycles} cycles · {Math.round(elapsed)}s
          </div>
        )}
      </div>
    </div>
  );
}
