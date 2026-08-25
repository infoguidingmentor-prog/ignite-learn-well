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
  { value: "afternoon", label: "Afternoon", Icon: Sun, heading: "Reset between blocks" },
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
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5",
              tab === value && "bg-card shadow-sm",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

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
