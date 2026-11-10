import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, CalendarCheck, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Protected } from "@/components/protected";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/qtracker";
import { useQSettings } from "@/components/qtracker/use-qtracker";

export const Route = createFileRoute("/mentors")({
  head: () => ({ meta: [{ title: "My Mentors | Guiding Mentor" }] }),
  component: () => <Protected><Mentors /></Protected>,
});

type Mentor = {
  id: string; display_name: string; college_name: string | null; bio: string | null;
  specialties: string[] | null; completed_sessions: number; open_slots: number;
};
type Booking = { id: string; mentor_id: string; status: string };

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function Mentors() {
  const { user } = useAuth();
  const { data: settings } = useQSettings();
  const [booking, setBooking] = useState<Mentor | null>(null);

  const { data: mentors = [], isLoading } = useQuery({
    enabled: !!user,
    queryKey: ["bookable-mentors"],
    queryFn: async (): Promise<Mentor[]> => {
      const { data, error } = await db.rpc("list_bookable_mentors");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: bookings = [] } = useQuery({
    enabled: !!user,
    queryKey: ["my-bookings", user?.id],
    queryFn: async (): Promise<Booking[]> => {
      const { data, error } = await db.from("bookings").select("id,mentor_id,status").eq("student_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const attendedIds = useMemo(
    () => new Set(bookings.filter((b) => b.status === "completed").map((b) => b.mentor_id)),
    [bookings],
  );
  const attended = mentors.filter((m) => attendedIds.has(m.id));
  const totalSessions = bookings.filter((b) => b.status === "completed").length;
  const upcoming = bookings.filter((b) => b.status === "requested" || b.status === "confirmed").length;

  // Suggestions: mentors whose specialties mention the student's goal come first.
  const suggested = useMemo(() => {
    const goal = (settings?.goal ?? "").trim().toLowerCase();
    const score = (m: Mentor) =>
      (goal && (m.specialties ?? []).some((s) => s.toLowerCase().includes(goal)) ? 100 : 0) +
      (m.open_slots > 0 ? 10 : 0) + Math.min(m.completed_sessions, 9);
    return mentors.filter((m) => !attendedIds.has(m.id)).sort((a, b) => score(b) - score(a));
  }, [mentors, settings?.goal, attendedIds]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">My Mentors</h1>
        <p className="text-sm text-muted-foreground">Book a session with someone who's been where you're headed.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<Users className="size-5" />} value={attended.length} label="Mentors attended" />
        <Stat icon={<CalendarCheck className="size-5" />} value={totalSessions} label="Total sessions" />
        <Stat icon={<Sparkles className="size-5" />} value={upcoming} label="Upcoming requests" />
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Attended mentors</h2>
        {attended.length === 0 ? (
          <div className="soft-card flex flex-col items-center gap-1 border-dashed p-8 text-center">
            <Users className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No mentors yet</p>
            <p className="text-xs text-muted-foreground">Once you attend a session, your mentors will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {attended.map((m) => <MentorCard key={m.id} m={m} onBook={() => setBooking(m)} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Suggested for you</h2>
          {settings?.goal && <span className="rounded border border-amber-400/60 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Matched to {settings.goal}</span>}
        </div>
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="soft-card h-40 animate-pulse" />)}</div>
        ) : suggested.length === 0 ? (
          <p className="soft-card p-6 text-sm text-muted-foreground">No mentors are open for booking right now. Please check back soon.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {suggested.map((m) => <MentorCard key={m.id} m={m} suggested onBook={() => setBooking(m)} />)}
          </div>
        )}
      </section>

      <BookDialog mentor={booking} onClose={() => setBooking(null)} />
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="soft-card flex items-center gap-3 p-4">
      <span className="grid size-10 place-items-center rounded-xl bg-secondary">{icon}</span>
      <div><p className="text-xl font-semibold leading-tight">{value}</p><p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p></div>
    </div>
  );
}

function MentorCard({ m, suggested, onBook }: { m: Mentor; suggested?: boolean; onBook: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      {suggested && <div className="flex items-center gap-1.5 bg-amber-400 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-950"><Sparkles className="size-3.5" />Suggested match</div>}
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initials(m.display_name)}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{m.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">{m.college_name ?? "Verified mentor"}</p>
          </div>
        </div>
        {m.bio && <p className="line-clamp-2 text-xs text-muted-foreground">{m.bio}</p>}
        {!!m.specialties?.length && (
          <div className="flex flex-wrap gap-1.5">
            {m.specialties.slice(0, 3).map((s) => <span key={s} className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">{s}</span>)}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">{m.completed_sessions} {m.completed_sessions === 1 ? "session" : "sessions"} · {m.open_slots} open {m.open_slots === 1 ? "slot" : "slots"}</span>
          <Button size="sm" onClick={onBook} disabled={m.open_slots === 0}>Book<ArrowRight className="ml-1 size-3.5" /></Button>
        </div>
      </div>
    </article>
  );
}

type Slot = { id: string; slot_start: string; slot_end: string };

function BookDialog({ mentor, onClose }: { mentor: Mentor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: slots = [], isLoading } = useQuery({
    enabled: !!mentor,
    queryKey: ["mentor-slots", mentor?.id],
    queryFn: async (): Promise<Slot[]> => {
      const { data, error } = await db.from("mentor_availability").select("id,slot_start,slot_end")
        .eq("mentor_id", mentor!.id).eq("booked", false).gt("slot_start", new Date().toISOString())
        .order("slot_start").limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const book = useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await db.rpc("book_mentor_slot", { _availability: slotId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Session requested. The mentor will confirm it.");
      qc.invalidateQueries({ queryKey: ["my-bookings", user?.id] });
      qc.invalidateQueries({ queryKey: ["bookable-mentors"] });
      onClose();
    },
    onError: (e: Error) => {
      toast.error(e.message?.includes("no longer") ? "Someone just took that slot. Pick another." : "Couldn't book that slot.");
      qc.invalidateQueries({ queryKey: ["mentor-slots", mentor?.id] });
    },
  });

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

  return (
    <Dialog open={!!mentor} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book {mentor?.display_name}</DialogTitle>
          <DialogDescription>Times are in IST. The mentor confirms your request.</DialogDescription>
        </DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading slots…</p>
          : slots.length === 0 ? <p className="text-sm text-muted-foreground">No open slots right now.</p>
          : (
            <ul className="space-y-2">
              {slots.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <span className="text-sm">{fmt(s.slot_start)}</span>
                  <Button size="sm" disabled={book.isPending} onClick={() => book.mutate(s.id)}>Request</Button>
                </li>
              ))}
            </ul>
          )}
      </DialogContent>
    </Dialog>
  );
}
