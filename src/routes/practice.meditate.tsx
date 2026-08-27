import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { TouchSlider } from "@/components/touch-slider";
import { Play, Pause, RotateCcw, Volume2, Sunrise, Sun, Sunset, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Scene } from "@/components/scene";
import { Celebrate } from "@/components/celebrate";

type Slot = "morning" | "afternoon" | "evening" | "night" | "any";

type Track = {
  id: string; title: string; description: string | null;
  audio_url: string; duration_seconds: number;
  time_of_day: Slot; coach_name: string | null;
};

/** The four times of day a student can be in. "Any" plays in all of them. */
const TABS = [
  { value: "morning", label: "Morning", Icon: Sunrise, heading: "Begin the day" },
  { value: "afternoon", label: "Relax", Icon: Sun, heading: "Relax between study blocks" },
  { value: "evening", label: "Evening", Icon: Sunset, heading: "Wind down" },
  { value: "night", label: "Night", Icon: Moon, heading: "Settle before sleep" },
] as const;

type Tab = (typeof TABS)[number]["value"];

export const Route = createFileRoute("/practice/meditate")({ component: Meditate });

function timeBucket(): Tab {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 20) return "evening";
  return "night";
}
function fmt(s: number) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function Meditate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(timeBucket());
  const [active, setActive] = useState<Track | null>(null);
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(70);
  const [celebrate, setCelebrate] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ["meditation-tracks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meditation_tracks")
        .select("id,title,description,audio_url,duration_seconds,time_of_day,coach_name")
        .eq("is_published", true)
        .order("time_of_day", { ascending: true });
      if (error) throw error;
      return data as Track[];
    },
  });

  const list = useMemo(
    () => tracks.filter((t) => t.time_of_day === tab || t.time_of_day === "any"),
    [tracks, tab]
  );

  const heading = TABS.find((t) => t.value === tab)?.heading ?? "";

  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol / 100; }, [vol]);

  const logSession = useMutation({
    mutationFn: async (payload: { track_id: string; seconds: number; completed: boolean }) => {
      if (!user) return;
      const { error } = await supabase.from("meditation_sessions").insert({
        user_id: user.id, track_id: payload.track_id,
        duration_seconds: payload.seconds, completed: payload.completed,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["today-progress"] }),
  });

  const pick = async (t: Track) => {
    setActive(t); setPos(0); setPlaying(false); setSignedUrl("");
    // audio_url is a storage path within the meditation-audio bucket
    // (legacy full URLs are also handled)
    let src = t.audio_url;
    if (!/^https?:\/\//i.test(src)) {
      const { data } = await supabase.storage.from("meditation-audio").createSignedUrl(src, 60 * 60);
      src = data?.signedUrl ?? "";
    }
    setSignedUrl(src);
    setTimeout(() => { audioRef.current?.play().then(() => setPlaying(true)).catch(() => {}); }, 60);
  };
  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
  };
  const reset = () => { if (audioRef.current) { audioRef.current.currentTime = 0; setPos(0); } };
  const onEnded = () => {
    setPlaying(false);
    if (active) logSession.mutate({ track_id: active.id, seconds: Math.round(dur), completed: true });
    setCelebrate(true);
  };

  return (
    <div className="space-y-6">
      <Celebrate scene="meditate" open={celebrate} onClose={() => setCelebrate(false)} next={{ label: "" }} />

      <div className="inline-flex flex-wrap gap-1 rounded-full bg-secondary p-1 text-sm">
        {TABS.map(({ value, label, Icon }) => (
          <button key={value} onClick={() => setTab(value)}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-4 py-1.5", tab === value && "bg-card shadow-sm")}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      <BackgroundMusic scope="meditate" />

      {!active && (
        <div className="soft-card grid place-items-center p-6">
          <Scene kind="meditate" size={200} />
          <p className="mt-2 text-center text-sm text-muted-foreground max-w-xs">
            Pick a track. Five minutes is enough.
          </p>
        </div>
      )}

      {active && (
        <div className="soft-card overflow-hidden">
          <div className="relative bg-gradient-to-br from-sage-soft to-paper p-6 md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">{active.coach_name ?? "Guided"}</div>
                <h2 className="mt-1 font-display text-2xl md:text-3xl">{active.title}</h2>
                {active.description && <p className="mt-2 max-w-md text-sm text-muted-foreground">{active.description}</p>}
              </div>
              <Scene kind="meditate" size={96} />
            </div>

            <audio
              ref={audioRef}
              src={signedUrl}
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || active.duration_seconds)}
              onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
              onEnded={onEnded}
              preload="metadata"
            />

            <div className="mt-6">
              <TouchSlider
                min={0} max={Math.max(dur, 1)} step={1}
                value={Math.min(pos, Math.max(dur, 1))}
                onChange={(v) => { if (audioRef.current) audioRef.current.currentTime = v; setPos(v); }}
                ariaLabel="Seek"
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{fmt(pos)}</span><span>{fmt(dur || active.duration_seconds)}</span>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button onClick={toggle} size="lg" className="rounded-full">
                {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
                <span className="ml-2">{playing ? "Pause" : "Play"}</span>
              </Button>
              <Button variant="outline" size="icon" onClick={reset} className="rounded-full">
                <RotateCcw className="size-4" />
              </Button>
              <div className="ml-auto flex items-center gap-2 text-muted-foreground w-40">
                <Volume2 className="size-4 shrink-0" />
                <TouchSlider min={0} max={100} step={1} value={vol} onChange={setVol} ariaLabel="Volume" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && list.length === 0 && (
          <div className="soft-card p-6 text-sm text-muted-foreground">
            No tracks for this time yet. Ask your coach to publish one.
          </div>
        )}
        <ul className="space-y-2">
          {list.map((t) => (
            <li key={t.id}>
              <button onClick={() => pick(t)} className={cn(
                "w-full soft-card p-4 text-left transition-colors hover:bg-secondary/50",
                active?.id === t.id && "ring-2 ring-primary/30"
              )}>
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t.coach_name} · {Math.round(t.duration_seconds / 60)} min</div>
                  </div>
                  <Play className="size-4 text-muted-foreground" />
                </div>
              </button>
            </li>
          ))}
        </ul>
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
