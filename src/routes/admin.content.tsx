import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/content")({
  component: () => (
    <>
      <Content />
    </>
  ),
});


type Tab = "meditations" | "ambient" | "music" | "affirmations" | "sessions";

function Content() {
  const [tab, setTab] = useState<Tab>("meditations");
  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Admin · Content</div>
        <h1 className="font-display text-3xl">Content library</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-lg">
          Upload calm, ambient focus audio. Nothing is played from an external hotlink.
        </p>
      </header>

      <div className="inline-flex flex-wrap gap-1 rounded-full bg-secondary p-1 text-sm">
        {(["meditations", "ambient", "music", "affirmations", "sessions"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-full px-4 py-1.5 capitalize", tab === t && "bg-card shadow-sm")}>
            {t}
          </button>
        ))}
      </div>

      {tab === "meditations" && <MeditationsAdmin />}
      {tab === "ambient" && <AmbientAdmin />}
      {tab === "music" && <MusicAdmin />}
      {tab === "affirmations" && <AffirmationsAdmin />}
      {tab === "sessions" && <SessionsAdmin />}
    </div>
  );
}

/* ---------------- Meditations ---------------- */
const SLOTS = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
  { value: "any", label: "Any time" },
] as const;

type Slot = (typeof SLOTS)[number]["value"];

type Med = {
  id: string; title: string; description: string | null;
  coach_name: string | null; audio_url: string; duration_seconds: number;
  time_of_day: Slot; is_published: boolean;
};

const AUDIO_EXT = [".mp3", ".m4a", ".wav", ".aac", ".ogg"];
const isAudio = (f: File) =>
  f.type.startsWith("audio/") || AUDIO_EXT.some((x) => f.name.toLowerCase().endsWith(x));

/** Read length from the file itself so nobody types it in by hand. */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v: number) => { URL.revokeObjectURL(url); resolve(v); };
    a.addEventListener("loadedmetadata", () =>
      done(Number.isFinite(a.duration) ? Math.round(a.duration) : 0));
    a.addEventListener("error", () => done(0));
    a.src = url;
  });
}

const titleFromFile = (n: string) =>
  n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

function MeditationsAdmin() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-meditations"],
    queryFn: async () => {
      const { data } = await supabase.from("meditation_tracks")
        .select("id,title,description,coach_name,audio_url,duration_seconds,time_of_day,is_published")
        .order("time_of_day");
      return (data ?? []) as Med[];
    },
  });

  const [slot, setSlot] = useState<Slot>("morning");
  const [coach, setCoach] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Slot | "all">("all");

  const uploadFiles = async (files: File[]) => {
    const audio = files.filter(isAudio);
    if (files.length && !audio.length) {
      toast.error("Meditations are audio — try .mp3, .m4a or .wav.");
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const file of audio) {
      try {
        const seconds = await readDuration(file);
        const path = `meditations/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("meditation-audio")
          .upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("meditation_tracks").insert({
          title: titleFromFile(file.name), coach_name: coach || null,
          audio_url: path, duration_seconds: seconds,
          time_of_day: slot, is_published: true,
        });
        if (insErr) throw insErr;
        ok++;
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "upload failed"}`);
      }
    }
    setBusy(false);
    if (ok) toast.success(`Added ${ok} to ${SLOTS.find((s) => s.value === slot)?.label}.`);
    qc.invalidateQueries({ queryKey: ["admin-meditations"] });
    qc.invalidateQueries({ queryKey: ["meditation-tracks"] });
  };

  /** Mis-slotted a track? This moves it, and students see it move. */
  const changeSlot = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: Slot }) => {
      const { error } = await supabase.from("meditation_tracks")
        .update({ time_of_day: next }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(`Moved to ${SLOTS.find((s) => s.value === v.next)?.label}.`);
      qc.invalidateQueries({ queryKey: ["admin-meditations"] });
      qc.invalidateQueries({ queryKey: ["meditation-tracks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't move that track."),
  });

  const rename = async (id: string, title: string) => {
    if (!title.trim()) return;
    await supabase.from("meditation_tracks").update({ title: title.trim() }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["meditation-tracks"] });
  };

  const togglePublish = useMutation({
    mutationFn: async (r: Med) => {
      await supabase.from("meditation_tracks").update({ is_published: !r.is_published }).eq("id", r.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-meditations"] }),
  });

  const remove = useMutation({
    mutationFn: async (r: Med) => {
      if (r.audio_url && !/^https?:\/\//i.test(r.audio_url)) {
        await supabase.storage.from("meditation-audio").remove([r.audio_url]);
      }
      await supabase.from("meditation_tracks").delete().eq("id", r.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-meditations"] });
      qc.invalidateQueries({ queryKey: ["meditation-tracks"] });
    },
  });

  const count = (s: Slot) => rows.filter((r) => r.time_of_day === s).length;
  const visible = filter === "all" ? rows : rows.filter((r) => r.time_of_day === filter);

  return (
    <div className="space-y-6">
      <section className="soft-card p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Add meditations
        </div>

        <div className="flex flex-wrap gap-2">
          {SLOTS.map((s) => (
            <button key={s.value} onClick={() => setSlot(s.value)}
              className={cn("rounded-full border border-border px-4 py-1.5 text-sm",
                slot === s.value && "bg-primary text-primary-foreground border-primary")}>
              {s.label} <span className="opacity-70">{count(s.value)}</span>
            </button>
          ))}
        </div>

        <input className="mt-3 w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
          placeholder="Coach name for this upload (optional)"
          value={coach} onChange={(e) => setCoach(e.target.value)} />

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
            uploadFiles(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "mt-3 flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border bg-paper/40 px-6 py-9 text-center",
            dragging && "border-primary bg-primary/5",
          )}>
          <span className="pointer-events-none inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
            <Upload className="size-4" />
            {busy ? "Uploading…" : "Choose MP3 files"}
          </span>
          <span className="mt-2 text-sm">
            or drop them here for <span className="font-medium">{SLOTS.find((s) => s.value === slot)?.label}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            .mp3, .m4a or .wav — several at once is fine. Length is read automatically.
          </span>
          <input type="file" multiple accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg" className="hidden"
            onChange={(e) => { uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </label>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Meditations available ({rows.length})
          </h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Slot | "all")}
            className="rounded-lg border border-border bg-paper/60 px-2 py-1.5 text-sm">
            <option value="all">All slots</option>
            {SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <ul className="space-y-2">
          {visible.map((r) => (
            <li key={r.id} className="soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <input defaultValue={r.title} onBlur={(e) => rename(r.id, e.target.value)}
                  className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-medium hover:border-border focus:border-border" />
                <div className="px-2 text-xs text-muted-foreground">
                  {r.coach_name ?? "—"} · {Math.round(r.duration_seconds / 60)} min
                </div>
              </div>

              <select value={r.time_of_day}
                onChange={(e) => changeSlot.mutate({ id: r.id, next: e.target.value as Slot })}
                className="rounded-lg border border-border bg-paper/60 px-2 py-1.5 text-sm">
                {SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => togglePublish.mutate(r)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs">
                  {r.is_published ? <CheckCircle2 className="size-3.5 text-primary" /> : <Circle className="size-3.5" />}
                  {r.is_published ? "Published" : "Draft"}
                </button>
                <button onClick={() => remove.mutate(r)} className="text-muted-foreground hover:text-foreground">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
          {visible.length === 0 && (
            <div className="soft-card p-6 text-sm text-muted-foreground">
              Nothing here yet. Drop audio above and it appears for students right away.
            </div>
          )}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- Ambient ---------------- */
type Amb = { id: string; title: string; audio_url: string; category: string | null; is_published: boolean };

function AmbientAdmin() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-ambient"],
    queryFn: async () => {
      const { data } = await supabase.from("ambient_tracks")
        .select("id,title,audio_url,category,is_published").order("title");
      return (data ?? []) as Amb[];
    },
  });
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("focus");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file || !title.trim()) { toast.error("Title and file required."); return; }
    setBusy(true);
    try {
      const path = `ambient/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("meditation-audio")
        .upload(path, file, { contentType: file.type || "audio/mpeg" });
      if (upErr) throw upErr;
      const { error } = await supabase.from("ambient_tracks").insert({
        title, category, audio_url: path, is_published: true,
      });
      if (error) throw error;
      toast.success("Uploaded.");
      setTitle(""); setFile(null);
      qc.invalidateQueries({ queryKey: ["admin-ambient"] });
      qc.invalidateQueries({ queryKey: ["ambient-tracks"] });
    } catch (e: any) { toast.error(e?.message ?? "Upload failed."); }
    finally { setBusy(false); }
  };

  const remove = useMutation({
    mutationFn: async (r: Amb) => {
      if (r.audio_url && !/^https?:\/\//i.test(r.audio_url))
        await supabase.storage.from("meditation-audio").remove([r.audio_url]);
      await supabase.from("ambient_tracks").delete().eq("id", r.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-ambient"] }),
  });

  return (
    <div className="space-y-6">
      <section className="soft-card p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Upload ambient focus audio</div>
        <div className="grid gap-3 md:grid-cols-3">
          <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm md:col-span-2"
            placeholder="Title (e.g. Rain on cedar)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <label className="md:col-span-3 flex items-center gap-2 rounded-lg border border-dashed border-border bg-paper/40 px-3 py-3 text-sm cursor-pointer">
            <Upload className="size-4" />
            <span className="text-muted-foreground">{file ? file.name : "Choose .mp3 file"}</span>
            <input type="file" accept="audio/*" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="mt-3">
          <Button onClick={upload} disabled={busy} className="rounded-full">
            <Upload className="mr-2 size-4" /> {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </section>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="soft-card p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground">{r.category ?? "—"} · {r.is_published ? "Published" : "Draft"}</div>
            </div>
            <button onClick={() => remove.mutate(r)} className="text-muted-foreground hover:text-foreground">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {rows.length === 0 && <div className="soft-card p-6 text-sm text-muted-foreground">No ambient tracks yet.</div>}
      </ul>
    </div>
  );
}

/* ---------------- Affirmations ---------------- */
type Aff = { id: string; body: string; category: string | null; is_published: boolean; audio_url: string | null };

function AffirmationsAdmin() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-affirmations"],
    queryFn: async () => {
      const { data } = await supabase.from("affirmations").select("id,body,category,is_published,audio_url").order("category");
      return (data ?? []) as Aff[];
    },
  });
  const [text, setText] = useState("");
  const [category, setCategory] = useState("calm");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  /** Text is required; a recording is optional and uploaded with it. */
  const add = useMutation({
    mutationFn: async () => {
      if (!text.trim()) return;
      let path: string | null = null;
      if (file) {
        setBusy(true);
        const key = `affirmations/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("meditation-audio")
          .upload(key, file, { contentType: file.type || "audio/mpeg", upsert: false });
        if (upErr) { setBusy(false); throw upErr; }
        path = key;
      }
      const { error } = await supabase.from("affirmations").insert({
        body: text.trim(), category, is_published: true, audio_url: path,
      });
      setBusy(false);
      if (error) throw error;
    },
    onSuccess: () => {
      setText(""); setFile(null);
      qc.invalidateQueries({ queryKey: ["admin-affirmations"] });
      qc.invalidateQueries({ queryKey: ["affirmations"] });
    },
    onError: (e: any) => { setBusy(false); toast.error(e?.message ?? "Couldn't save that."); },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { await supabase.from("affirmations").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-affirmations"] }),
  });

  return (
    <div className="space-y-4">
      <section className="soft-card p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">New affirmation</div>
        <div className="grid gap-2 md:grid-cols-4">
          <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm md:col-span-3"
            placeholder="I am steady in the effort I chose." value={text} onChange={(e) => setText(e.target.value)} />
          <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-paper/40 px-3 py-3 text-sm">
          <Upload className="size-4" />
          <span className="text-muted-foreground">
            {file ? file.name : "Add an MP3 recording for this line (optional)"}
          </span>
          <input type="file" accept="audio/*,.mp3,.m4a,.wav" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="mt-3">
          <Button onClick={() => add.mutate()} disabled={busy || add.isPending} className="rounded-full">
            {busy ? "Uploading…" : "Add"}
          </Button>
        </div>
      </section>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="soft-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm">{r.body}</div>
              <div className="text-[11px] text-muted-foreground">{r.category ?? "—"}</div>
            </div>
            <AffirmationVoice row={r} />
            <button onClick={() => remove.mutate(r.id)} className="text-muted-foreground hover:text-foreground">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {rows.length === 0 && <div className="soft-card p-6 text-sm text-muted-foreground">No affirmations yet.</div>}
      </ul>
    </div>
  );
}

/* ---------------- Live sessions ---------------- */
type Sess = { id: string; title: string; scheduled_at: string; zoom_url: string | null; recording_url: string | null; cohort_id: string | null };

function SessionsAdmin() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-sessions"],
    queryFn: async () => {
      const { data } = await supabase.from("live_sessions")
        .select("id,title,scheduled_at,zoom_url,recording_url,cohort_id")
        .order("scheduled_at", { ascending: false });
      return (data ?? []) as Sess[];
    },
  });
  const [form, setForm] = useState({ title: "", scheduled_at: "", join_url: "", recording_url: "" });

  const add = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.scheduled_at) return;
      const { error } = await supabase.from("live_sessions").insert({
        title: form.title, scheduled_at: form.scheduled_at,
        zoom_url: form.join_url || null, recording_url: form.recording_url || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setForm({ title: "", scheduled_at: "", join_url: "", recording_url: "" });
      qc.invalidateQueries({ queryKey: ["admin-sessions"] }); },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { await supabase.from("live_sessions").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-sessions"] }),
  });

  return (
    <div className="space-y-4">
      <section className="soft-card p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Schedule a live session</div>
        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input type="datetime-local" className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm"
            value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm md:col-span-2"
            placeholder="Zoom / meet URL" value={form.join_url} onChange={(e) => setForm({ ...form, join_url: e.target.value })} />
          <input className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm md:col-span-2"
            placeholder="Recording URL (optional)" value={form.recording_url} onChange={(e) => setForm({ ...form, recording_url: e.target.value })} />
        </div>
        <div className="mt-3"><Button onClick={() => add.mutate()} className="rounded-full">Schedule</Button></div>
      </section>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="soft-card p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground">{new Date(r.scheduled_at).toLocaleString()}</div>
            </div>
            <div className="flex items-center gap-3">
              {r.zoom_url && <a href={r.zoom_url} target="_blank" className="text-xs underline text-muted-foreground" rel="noreferrer">Join</a>}
              <button onClick={() => remove.mutate(r.id)} className="text-muted-foreground hover:text-foreground">
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
        {rows.length === 0 && <div className="soft-card p-6 text-sm text-muted-foreground">No sessions scheduled.</div>}
      </ul>
    </div>
  );
}


/** Attach (or replace) a spoken recording for one affirmation. */
function AffirmationVoice({ row }: { row: Aff }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|wav|aac|ogg)$/i.test(file.name)) {
      toast.error("Affirmation recordings are audio files.");
      return;
    }
    setBusy(true);
    try {
      const path = `affirmations/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("meditation-audio")
        .upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from("affirmations").update({ audio_url: path }).eq("id", row.id);
      if (error) throw error;
      toast.success("Recording attached.");
      qc.invalidateQueries({ queryKey: ["admin-affirmations"] });
      qc.invalidateQueries({ queryKey: ["affirmations"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed.");
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (row.audio_url && !/^https?:\/\//i.test(row.audio_url)) {
      await supabase.storage.from("meditation-audio").remove([row.audio_url]);
    }
    await supabase.from("affirmations").update({ audio_url: null }).eq("id", row.id);
    qc.invalidateQueries({ queryKey: ["admin-affirmations"] });
    qc.invalidateQueries({ queryKey: ["affirmations"] });
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <label className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs hover:bg-secondary">
        {busy ? "Uploading…" : row.audio_url ? "Replace voice" : "Add voice"}
        <input type="file" accept="audio/*,.mp3,.m4a,.wav" className="hidden"
          onChange={(e) => { upload(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      </label>
      {row.audio_url && (
        <button onClick={clear} className="text-[11px] text-muted-foreground hover:text-foreground underline">
          remove
        </button>
      )}
    </div>
  );
}

/* ---------------- Background music ---------------- */
type BgTrack = {
  id: string; title: string; audio_url: string;
  use_for: "meditate" | "breathe" | "affirm" | "both";
  is_default: boolean; is_published: boolean;
};

const USE_FOR = [
  { value: "meditate", label: "Meditations" },
  { value: "breathe", label: "Breathing" },
  { value: "affirm", label: "Affirmations" },
  { value: "both", label: "Everywhere" },
] as const;

function MusicAdmin() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-background"],
    queryFn: async () => {
      const { data } = await supabase.from("background_tracks")
        .select("id,title,audio_url,use_for,is_default,is_published")
        .order("is_default", { ascending: false });
      return (data ?? []) as BgTrack[];
    },
  });

  const [useFor, setUseFor] = useState<BgTrack["use_for"]>("both");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-background"] });
    qc.invalidateQueries({ queryKey: ["background-tracks"] });
  };

  const uploadFiles = async (files: File[]) => {
    const audio = files.filter((f) =>
      f.type.startsWith("audio/") || /\.(mp3|m4a|wav|aac|ogg)$/i.test(f.name));
    if (files.length && !audio.length) {
      toast.error("Background music must be an audio file.");
      return;
    }
    setBusy(true);
    for (const file of audio) {
      try {
        const path = `background/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("meditation-audio")
          .upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
        if (upErr) throw upErr;
        const { error } = await supabase.from("background_tracks").insert({
          title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(),
          audio_url: path, use_for: useFor,
          is_default: false, is_published: true,
        });
        if (error) throw error;
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "upload failed"}`);
      }
    }
    setBusy(false);
    refresh();
  };

  /** Exactly one default per scope — the DB trigger clears the previous one. */
  const setDefault = useMutation({
    mutationFn: async (r: BgTrack) => {
      const { error } = await supabase.from("background_tracks")
        .update({ is_default: true }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("This plays by default now."); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't set default."),
  });

  const changeUse = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: BgTrack["use_for"] }) => {
      const { error } = await supabase.from("background_tracks")
        .update({ use_for: next }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (r: BgTrack) => {
      if (r.audio_url && !/^https?:\/\//i.test(r.audio_url)) {
        await supabase.storage.from("meditation-audio").remove([r.audio_url]);
      }
      await supabase.from("background_tracks").delete().eq("id", r.id);
    },
    onSuccess: refresh,
  });

  return (
    <div className="space-y-6">
      <section className="soft-card p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Background music</div>
        <p className="mb-3 text-sm text-muted-foreground">
          Plays quietly under meditations and breathing. Whatever you mark as default starts on its own —
          students can switch it or mute it.
        </p>

        <div className="flex flex-wrap gap-2">
          {USE_FOR.map((u) => (
            <button key={u.value} onClick={() => setUseFor(u.value)}
              className={cn("rounded-full border border-border px-4 py-1.5 text-sm",
                useFor === u.value && "bg-primary text-primary-foreground border-primary")}>
              {u.label}
            </button>
          ))}
        </div>

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); uploadFiles(Array.from(e.dataTransfer.files)); }}
          className={cn(
            "mt-3 flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border bg-paper/40 px-6 py-8 text-center",
            dragging && "border-primary bg-primary/5")}>
          <span className="pointer-events-none inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
            <Upload className="size-4" />
            {busy ? "Uploading…" : "Choose MP3 files"}
          </span>
          <span className="mt-2 text-sm">
            or drop them here for <span className="font-medium">{USE_FOR.find((u) => u.value === useFor)?.label}</span>
          </span>
          <span className="text-xs text-muted-foreground">Long, loopable tracks work best.</span>
          <input type="file" multiple accept="audio/*,.mp3,.m4a,.wav" className="hidden"
            onChange={(e) => { uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </label>
      </section>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="soft-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{r.title}</div>
              {r.is_default && <div className="text-[11px] text-primary">Plays by default</div>}
            </div>
            <select value={r.use_for}
              onChange={(e) => changeUse.mutate({ id: r.id, next: e.target.value as BgTrack["use_for"] })}
              className="rounded-lg border border-border bg-paper/60 px-2 py-1.5 text-sm">
              {USE_FOR.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setDefault.mutate(r)} disabled={r.is_default}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs disabled:opacity-40">
                {r.is_default ? <CheckCircle2 className="size-3.5 text-primary" /> : <Circle className="size-3.5" />}
                Default
              </button>
              <button onClick={() => remove.mutate(r)} className="text-muted-foreground hover:text-foreground">
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <div className="soft-card p-6 text-sm text-muted-foreground">
            No background music yet. Without one, meditations play with voice only.
          </div>
        )}
      </ul>
    </div>
  );
}
