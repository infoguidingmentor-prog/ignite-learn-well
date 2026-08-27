import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Check, Shuffle, Play, Pause } from "lucide-react";

import { cn } from "@/lib/utils";
import { Scene } from "@/components/scene";
import { Celebrate } from "@/components/celebrate";

export const Route = createFileRoute("/practice/affirm")({ component: Affirm });

type Aff = { id: string; body: string; category: string | null; audio_url: string | null };

function Affirm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [idx, setIdx] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const [src, setSrc] = useState("");
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: list = [] } = useQuery({
    queryKey: ["affirmations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("affirmations")
        .select("id,body,category,audio_url")
        .eq("is_published", true);
      if (error) throw error;
      return data as Aff[];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const seedIdx = useMemo(() => {
    if (!list.length) return 0;
    let h = 0; for (const c of today) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h) % list.length;
  }, [list.length, today]);

  const cur = list[(seedIdx + idx) % Math.max(list.length, 1)];

  /** Resolve the recorded voice track, if this affirmation has one. */
  useEffect(() => {
    let cancelled = false;
    setPlaying(false);
    (async () => {
      if (!cur?.audio_url) { setSrc(""); return; }
      let url = cur.audio_url;
      if (!/^https?:\/\//i.test(url)) {
        const { data } = await supabase.storage
          .from("meditation-audio")
          .createSignedUrl(url, 60 * 60);
        url = data?.signedUrl ?? "";
      }
      if (!cancelled) setSrc(url);
    })();
    return () => { cancelled = true; };
  }, [cur?.id, cur?.audio_url]);

  const toggleAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else el.play().then(() => setPlaying(true)).catch(() => {});
  };

  const { data: doneToday } = useQuery({
    enabled: !!user,
    queryKey: ["aff-done", user?.id, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("affirmation_completions")
        .select("id")
        .eq("user_id", user!.id)
        .gte("created_at", `${today}T00:00:00Z`)
        .limit(1);
      return (data ?? []).length > 0;
    },
  });

  const mark = useMutation({
    mutationFn: async () => {
      if (!user || !cur) return;
      const { error } = await supabase.from("affirmation_completions").insert({
        user_id: user.id, affirmation_id: cur.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCelebrate(true);
      qc.invalidateQueries({ queryKey: ["aff-done"] });
    },
  });

  if (!cur) return <div className="soft-card p-8 text-sm text-muted-foreground">No affirmations published yet.</div>;

  return (
    <div className="space-y-6">
      <Celebrate scene="affirm" open={celebrate} onClose={() => setCelebrate(false)} intensity="soft" />
      <BackgroundMusic scope="affirm" />
      <div className="soft-card relative overflow-hidden bg-gradient-to-br from-paper via-card to-sage-soft/40 p-8 md:p-12">
        <div className="flex items-start justify-between gap-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Today's line</div>
          <Scene kind="affirm" size={72} />
        </div>
        <p className="mt-4 font-display text-3xl leading-snug md:text-4xl">"{cur.body}"</p>
        {cur.category && <div className="mt-6 text-xs text-muted-foreground">— {cur.category}</div>}

        {src && (
          <>
            <audio
              ref={audioRef}
              src={src}
              preload="none"
              onEnded={() => setPlaying(false)}
            />
            <button
              onClick={toggleAudio}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing ? "Pause" : "Hear it"}
            </button>
          </>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            onClick={() => mark.mutate()}
            disabled={!!doneToday || mark.isPending}
            className="rounded-full"
            size="lg"
          >
            <Check className="mr-2 size-4" />
            {doneToday ? "Held today" : "I read this out loud"}
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => setIdx((i) => i + 1)}>
            <Shuffle className="mr-2 size-4" /> Another
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Say it slowly. Even if you don't believe it yet.
      </p>
    </div>
  );
}

/* ---------------- Background music (inline) ---------------- */
type BgTrack = { id: string; title: string; audio_url: string; is_default: boolean };

function BackgroundMusic({ scope }: { scope: "meditate" | "breathe" | "affirm" }) {
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
