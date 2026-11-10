import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Copy, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/qtracker";

type Group = { id: string; name: string; invite_code: string; created_by: string };
type Row = { user_id: string; display_name: string; focus_minutes_today: number };

export function GroupStudy() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const key = ["qt-groups", user?.id];

  const { data: groups = [] } = useQuery({
    enabled: !!user,
    queryKey: key,
    queryFn: async (): Promise<Group[]> => {
      const { data, error } = await db.from("study_groups").select("id,name,invite_code,created_by").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.from("study_groups").insert({ name: name.trim(), created_by: user!.id }).select("id").single();
      if (error) throw error;
      const { error: e2 } = await db.from("study_group_members").insert({ group_id: data.id, user_id: user!.id });
      if (e2) throw e2;
    },
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: key }); toast.success("Group created. Share the invite code with friends."); },
    onError: () => toast.error("Couldn't create the group."),
  });

  const join = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("join_study_group", { _code: code });
      if (error) throw error;
    },
    onSuccess: () => { setCode(""); qc.invalidateQueries({ queryKey: key }); toast.success("You're in!"); },
    onError: () => toast.error("That invite code didn't work."),
  });

  const leave = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("study_group_members").delete().eq("group_id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="soft-card p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">Start a group</h3>
          <div className="flex gap-2">
            <Input value={name} maxLength={80} placeholder="e.g. NEET Night Owls" onChange={(e) => setName(e.target.value)} />
            <Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>Create</Button>
          </div>
        </section>
        <section className="soft-card p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">Join with a code</h3>
          <div className="flex gap-2">
            <Input value={code} maxLength={16} placeholder="Invite code" onChange={(e) => setCode(e.target.value)} />
            <Button disabled={code.trim().length < 4 || join.isPending} onClick={() => join.mutate()}>Join</Button>
          </div>
        </section>
      </div>

      {groups.length === 0 ? (
        <div className="soft-card flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
          <Users className="size-6" />
          You're not in a study group yet. Start one or join with a friend's code.
        </div>
      ) : (
        groups.map((g) => <GroupCard key={g.id} group={g} onLeave={() => leave.mutate(g.id)} />)
      )}
      <p className="text-[11px] text-muted-foreground">Group members only see each other's first name and focus minutes for today. Nothing else is shared.</p>
    </div>
  );
}

function GroupCard({ group, onLeave }: { group: Group; onLeave: () => void }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["qt-group-board", group.id],
    refetchInterval: 60000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await db.rpc("study_group_board", { _group: group.id });
      if (error) throw error;
      return (data ?? []).sort((a: Row, b: Row) => b.focus_minutes_today - a.focus_minutes_today);
    },
  });

  return (
    <section className="soft-card p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{group.name}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { navigator.clipboard?.writeText(group.invite_code); toast.success("Invite code copied"); }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs"
          >
            {group.invite_code}<Copy className="size-3" />
          </button>
          <Button variant="ghost" size="sm" onClick={onLeave}><LogOut className="mr-1 size-3.5" />Leave</Button>
        </div>
      </header>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.user_id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
            <span className="flex-1 truncate">{r.display_name}</span>
            <span className="tabular-nums text-muted-foreground">{r.focus_minutes_today} min today</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
