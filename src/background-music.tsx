import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Music, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

type BgTrack = {
  id: string;
  title: string;
  audio_url: string;
  use_for: "meditate" | "breathe" | "both";
  is_default: boolean;
};

/**
 * Quiet looping background music.
 *
 * The admin-marked default starts on its own — a student who touches nothing
 * still gets sound. They can switch track or mute; the choice sticks for the
 * session. If no track has been uploaded, this renders nothing at all.
 */
export function BackgroundMusic({
  scope,
  className,
}: {
  scope: "meditate" | "breathe";
  className?: string;
}) {
  const [chosen, setChosen] = useState<string>("");
  const [muted, setMuted] = useState(false);
  const [src, setSrc] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: tracks = [] } = useQuery({
    queryKey: ["background-tracks", scope],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("background_tracks")
        .select("id,title,audio_url,use_for,is_default")
        .eq("is_published", true)
        .in("use_for", [scope, "both"])
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BgTrack[];
    },
  });

  const active = useMemo(
    () => tracks.find((t) => t.id === chosen) ?? tracks[0] ?? null,
    [tracks, chosen],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!active) { setSrc(""); return; }
      let url = active.audio_url;
      if (!/^https?:\/\//i.test(url)) {
        const { data } = await supabase.storage
          .from("meditation-audio")
          .createSignedUrl(url, 60 * 60);
        url = data?.signedUrl ?? "";
      }
      if (!cancelled) setSrc(url);
    })();
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = 0.25;                 // sits under the voice, never over it
    if (muted || !src) { el.pause(); return; }
    el.play().catch(() => {});        // browsers may block until first tap
  }, [src, muted]);

  if (tracks.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <audio ref={audioRef} src={src} loop preload="none" />
      <Music className="size-3.5 shrink-0" />
      <select
        value={active?.id ?? ""}
        onChange={(e) => { setChosen(e.target.value); setMuted(false); }}
        className="rounded-lg border border-border bg-paper/60 px-2 py-1 text-xs max-w-[10rem]"
      >
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>{t.title}</option>
        ))}
      </select>
      <button
        onClick={() => setMuted((m) => !m)}
        className={cn("rounded-full border border-border px-2 py-1", muted && "bg-secondary")}
        aria-label={muted ? "Unmute background music" : "Mute background music"}
      >
        {muted ? <VolumeX className="size-3.5" /> : "Mute"}
      </button>
    </div>
  );
}
