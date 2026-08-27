import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className="space-y-5">
      {/* One quiet row of chrome. Nothing competes with the orb. */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PATTERNS) as Pattern[]).map((p) => (
          <button
            key={p}
            onClick={() => !running && setPattern(p)}
            disabled={running}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm transition-colors disabled:opacity-40",
              pattern === p
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {PATTERNS[p].label}
          </button>
        ))}
        <BackgroundMusic scope="breathe" />
      </div>

      <div className="soft-card flex flex-col items-center px-6 py-10">
        {/* Instruction lives outside the orb, in a fixed slot, so nothing reflows. */}
        <p className="h-6 text-sm text-muted-foreground">
          {running ? `${cycles} ${cycles === 1 ? "cycle" : "cycles"}` : cfg.blurb}
        </p>

        <div className="relative mt-6 grid size-[260px] place-items-center">
          {/* Hairline target ring — the orb grows to meet it on the inhale. */}
          <div
            className="absolute rounded-full border border-primary/20"
            style={{ width: 240, height: 240 }}
          />
          <div
            className="absolute rounded-full bg-gradient-to-br from-sage/35 to-dusk/25"
            style={{
              width: 240,
              height: 240,
              transform: `scale(${scale})`,
              transition: prefersReduced ? "none" : `transform ${phase.sec}s ease-in-out`,
            }}
          />
          <div className="relative text-center">
            <div className="font-display text-2xl font-normal text-foreground/80">
              {running ? phase.name : ""}
            </div>
            {running && (
              <div className="mt-1 text-sm tabular-nums text-muted-foreground">
                {Math.ceil(phase.sec - phaseSec)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8">
          {!running ? (
            <Button onClick={start} size="lg" className="rounded-full px-8">
              <Play className="mr-2 size-4" /> Begin
            </Button>
          ) : (
            <Button onClick={stop} size="lg" variant="ghost" className="rounded-full px-8 text-muted-foreground">
              <Square className="mr-2 size-4" /> Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Background music (inline) ---------------- */
type BgTrack = { id: string; title: string; audio_url: string; is_default: boolean };

function BackgroundMusic({ scope }: { scope: "meditate" | "breathe" }) {
  // Off until asked for. Autoplay fights whatever the student already has on.
  const [chosen, setChosen] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [bgSrc, setBgSrc] = useState("");
  const bgRef = useRef<HTMLAudioElement | null>(null);

  const { data: bgTracks = [] } = useQuery({
    queryKey: ["background-tracks", scope],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("background_tracks")
        .select("id,title,audio_url,is_default")
        .eq("is_published", true)
        .in("use_for", [scope, "both"])
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BgTrack[];
    },
  });

  const activeBg = bgTracks.find((t) => t.id === chosen) ?? bgTracks[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeBg) { setBgSrc(""); return; }
      let url = activeBg.audio_url;
      if (!/^https?:\/\//i.test(url)) {
        const { data } = await supabase.storage
          .from("meditation-audio")
          .createSignedUrl(url, 60 * 60);
        url = data?.signedUrl ?? "";
      }
      if (!cancelled) setBgSrc(url);
    })();
    return () => { cancelled = true; };
  }, [activeBg?.id]);

  useEffect(() => {
    const el = bgRef.current;
    if (!el) return;
    el.volume = 0.25;                 // sits under the voice, never over it
    if (!playing || !bgSrc) { el.pause(); return; }
    el.play().catch(() => setPlaying(false));
  }, [bgSrc, playing]);

  // Leaving the page stops the sound. Nothing keeps looping in a stray tab.
  useEffect(() => () => { bgRef.current?.pause(); }, []);

  if (bgTracks.length === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <audio ref={bgRef} src={bgSrc} loop preload="none" />
      <button
        onClick={() => setPlaying((p) => !p)}
        className={cn("rounded-full border border-border px-3 py-1",
          playing && "bg-primary text-primary-foreground border-primary")}
      >
        {playing ? "Stop music" : "Play music"}
      </button>
      {playing && (
        <select
          value={activeBg?.id ?? ""}
          onChange={(e) => setChosen(e.target.value)}
          className="rounded-lg border border-border bg-paper/60 px-2 py-1 text-xs max-w-[10rem]"
        >
          {bgTracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}
    </div>
  );
}
