import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { UserManager } from "@/components/admin/user-manager";

export const Route = createFileRoute("/admin/people")({
  component: () => <><People /></>,
});

type Tab = "approvals" | "users" | "mentors" | "coaches" | "assign";

function People() {
  const [tab, setTab] = useState<Tab>("approvals");
  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><AppIcon name="mentor" size={14} /> Admin · People</div>
        <h1 className="font-display text-3xl">People & access</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-lg">Add or remove accounts, verify staff credentials, and decide who can see which student.</p>
      </header>

      <div className="inline-flex flex-wrap gap-1 rounded-full bg-secondary p-1 text-sm">
        {(["approvals","users","mentors","coaches","assign"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 capitalize ${tab === t ? "bg-card shadow-sm" : ""}`}>
            {t === "assign" ? "Assign role by email" : t}
          </button>
        ))}
      </div>

      {tab === "approvals" && <Approvals />}
      {tab === "users" && <UserManager />}
      {tab === "assign" && <AssignRole />}
      {tab === "mentors" && <MentorsPanel />}
      {tab === "coaches" && <CoachesPanel />}
    </div>
  );
}

/* ---------------- Pending mentor & coach approvals ---------------- */
type RoleRequest = {
  id: string;
  requested_role: "mentor" | "coach";
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

function Approvals() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["role-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_requests")
        .select("id,requested_role,first_name,last_name,email,phone,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RoleRequest[];
    },
  });

  /** Approval is the only path to a mentor or coach role — enforced in the DB. */
  const review = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await (supabase.rpc as any)("approve_role_request", {
        _request_id: id,
        _approve: approve,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.approve ? "Approved. Their portal is open." : "Request rejected.");
      qc.invalidateQueries({ queryKey: ["role-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-mentors"] });
      qc.invalidateQueries({ queryKey: ["admin-coaches"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that."),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading requests…</div>;

  if (rows.length === 0) {
    return (
      <div className="soft-card p-6 text-sm text-muted-foreground">
        Nothing waiting. Mentors and coaches who sign in with Google appear here until you approve them.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="soft-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">
              {[r.first_name, r.last_name].filter(Boolean).join(" ") || "Unnamed"}
              <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] capitalize">
                {r.requested_role}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {r.email ?? "—"}{r.phone ? ` · ${r.phone}` : ""} · {new Date(r.created_at).toLocaleDateString()}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={() => review.mutate({ id: r.id, approve: true })}
              disabled={review.isPending}
              className="rounded-full"
              size="sm"
            >
              Approve
            </Button>
            <Button
              onClick={() => review.mutate({ id: r.id, approve: false })}
              disabled={review.isPending}
              variant="outline"
              className="rounded-full"
              size="sm"
            >
              Reject
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AssignRole() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"mentor"|"coach"|"counsellor"|"admin">("mentor");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const { data: uid, error } = await (supabase.rpc as any)("find_user_id_by_email", { _email: email.trim().toLowerCase() });
      if (error) throw error;
      if (!uid) { toast.error("No user with that email. Ask them to sign up first."); return; }
      const userId = uid as unknown as string;
      const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (insErr && !/duplicate/i.test(insErr.message)) throw insErr;
      // Also create staff row if needed
      if (role === "mentor") {
        await supabase.from("mentors").insert({ profile_id: userId, active: true, verification_status: "pending" });
      } else if (role === "coach" || role === "counsellor") {
        await supabase.from("coaches").insert({ profile_id: userId, active: true, verification_status: "pending" });
      }
      toast.success(`Assigned ${role} to ${email}`);
      setEmail("");
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to assign");
    } finally { setBusy(false); }
  };

  return (
    <div className="soft-card p-5 max-w-lg space-y-3">
      <div>
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mentor@example.com" />
        <p className="mt-1 text-[11px] text-muted-foreground">User must have signed up already.</p>
      </div>
      <div>
        <Label>Role</Label>
        <select value={role} onChange={(e) => setRole(e.target.value as any)} className="w-full rounded-lg border border-border bg-paper/60 px-3 py-2 text-sm">
          <option value="mentor">Mentor</option>
          <option value="coach">Coach</option>
          <option value="counsellor">Counsellor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <Button onClick={submit} disabled={busy} className="rounded-full">{busy ? "…" : "Assign"}</Button>
    </div>
  );
}

function MentorsPanel() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-mentors"],
    queryFn: async () => {
      const { data } = await supabase.from("mentors").select("id, profile_id, verification_status, college_name, active, specialties, bio").order("created_at", { ascending: false });
      const ids = (data ?? []).map((r: any) => r.profile_id);
      const { data: profs } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
      const nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      return (data ?? []).map((r: any) => ({ ...r, full_name: nameMap.get(r.profile_id) ?? "—" }));
    },
  });

  const verify = useMutation({
    mutationFn: async ({ id, status, college }: { id: string; status: string; college?: string }) => {
      const patch: any = { verification_status: status };
      if (college !== undefined) patch.college_name = college;
      if (status === "verified") { patch.verified_at = new Date().toISOString(); }
      await supabase.from("mentors").update(patch).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-mentors"] }),
  });

  return (
    <ul className="space-y-2">
      {rows.map((r: any) => (
        <li key={r.id} className="soft-card p-4 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <div className="font-medium">{r.full_name}</div>
            <div className="text-xs text-muted-foreground">{r.college_name ?? "No college on file"} · {r.verification_status}</div>
          </div>
          <div className="flex items-center gap-2">
            <input placeholder="College" defaultValue={r.college_name ?? ""} onBlur={(e) => verify.mutate({ id: r.id, status: r.verification_status, college: e.target.value })}
              className="rounded-lg border border-border bg-paper/60 px-2 py-1 text-sm w-48" />
            <Button size="sm" variant="outline" onClick={() => verify.mutate({ id: r.id, status: "verified" })}>Verify</Button>
            <Button size="sm" variant="ghost" onClick={() => verify.mutate({ id: r.id, status: "pending" })}>Unverify</Button>
          </div>
        </li>
      ))}
      {rows.length === 0 && <div className="soft-card p-6 text-sm text-muted-foreground">No mentors yet.</div>}
    </ul>
  );
}

function CoachesPanel() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-coaches"],
    queryFn: async () => {
      const { data } = await supabase.from("coaches").select("id, profile_id, verification_status, certification_name, active").order("created_at", { ascending: false });
      const ids = (data ?? []).map((r: any) => r.profile_id);
      const { data: profs } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
      const nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      return (data ?? []).map((r: any) => ({ ...r, full_name: nameMap.get(r.profile_id) ?? "—" }));
    },
  });

  const { data: students = [] } = useQuery({
    queryKey: ["admin-all-students"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").order("full_name");
      return data ?? [];
    },
  });

  const verify = useMutation({
    mutationFn: async ({ id, status, cert }: { id: string; status: string; cert?: string }) => {
      const patch: any = { verification_status: status };
      if (cert !== undefined) patch.certification_name = cert;
      if (status === "verified") patch.verified_at = new Date().toISOString();
      await supabase.from("coaches").update(patch).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-coaches"] }),
  });

  return (
    <ul className="space-y-3">
      {rows.map((r: any) => (
        <li key={r.id} className="soft-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="font-medium">{r.full_name}</div>
              <div className="text-xs text-muted-foreground">{r.certification_name ?? "No certification on file"} · {r.verification_status}</div>
            </div>
            <div className="flex items-center gap-2">
              <input placeholder="Certification" defaultValue={r.certification_name ?? ""} onBlur={(e) => verify.mutate({ id: r.id, status: r.verification_status, cert: e.target.value })}
                className="rounded-lg border border-border bg-paper/60 px-2 py-1 text-sm w-48" />
              <Button size="sm" variant="outline" onClick={() => verify.mutate({ id: r.id, status: "verified" })}>Verify</Button>
            </div>
          </div>
          <CaseloadEditor coachId={r.profile_id} students={students as any[]} />
        </li>
      ))}
      {rows.length === 0 && <div className="soft-card p-6 text-sm text-muted-foreground">No coaches yet.</div>}
    </ul>
  );
}

function CaseloadEditor({ coachId, students }: { coachId: string; students: { id: string; full_name: string }[] }) {
  const qc = useQueryClient();
  const { data: assigned = [] } = useQuery({
    queryKey: ["caseload", coachId],
    queryFn: async () => {
      const { data } = await supabase.from("coach_assignments").select("id, student_id").eq("coach_id", coachId);
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async (studentId: string) => {
      await supabase.from("coach_assignments").insert({ coach_id: coachId, student_id: studentId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["caseload", coachId] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("coach_assignments").delete().eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["caseload", coachId] }),
  });

  const assignedIds = new Set(assigned.map((a: any) => a.student_id));
  const available = students.filter((s) => !assignedIds.has(s.id) && s.id !== coachId);

  return (
    <div className="rounded-lg bg-paper/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Caseload</div>
      <div className="flex flex-wrap gap-1 mb-2">
        {assigned.map((a: any) => {
          const s = students.find((x) => x.id === a.student_id);
          return (
            <button key={a.id} onClick={() => remove.mutate(a.id)}
              className="rounded-full bg-secondary px-3 py-1 text-xs hover:bg-secondary/70">
              {s?.full_name ?? "Student"} ×
            </button>
          );
        })}
        {assigned.length === 0 && <span className="text-xs text-muted-foreground">No students assigned.</span>}
      </div>
      <select onChange={(e) => { if (e.target.value) { add.mutate(e.target.value); e.target.value = ""; } }}
        className="rounded-lg border border-border bg-paper/60 px-2 py-1 text-xs">
        <option value="">+ Add student…</option>
        {available.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
    </div>
  );
}
