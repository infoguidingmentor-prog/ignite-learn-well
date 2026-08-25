import { useCallback, useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fetchRoles, ROLE_HOME, type AppRole } from "@/lib/role-routing";
import { BrandLogo } from "@/components/brand-logo";

/**
 * A single-role sign-in portal. Only accounts holding `role` may enter.
 *
 * When `requestRole` is set (mentor / coach), the portal also offers Google
 * sign-in. A new person signing in that way gets a pending row in
 * `role_requests` and waits — an admin approval is the only way to the panel.
 * Admin has no Google button: it stays a fixed email + password account.
 */
export function StaffLogin({
  role,
  title,
  kicker,
  blurb,
  requestRole,
  portalPath,
}: {
  role: AppRole | AppRole[];
  title: string;
  kicker: string;
  blurb: string;
  requestRole?: "mentor" | "coach";
  portalPath?: string;
}) {
  const router = useRouter();
  const allowed = Array.isArray(role) ? role : [role];
  const home = ROLE_HOME[allowed[0]];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  /** Signed in already? Send them on, or park them on the waiting screen. */
  const settle = useCallback(
    async (userId: string) => {
      const roles = await fetchRoles(userId);
      if (roles.some((r) => allowed.includes(r))) {
        router.navigate({ to: home });
        return true;
      }
      if (requestRole) {
        router.navigate({ to: "/pending-approval" });
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, requestRole, router],
  );

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user;
      if (!u) return;

      // Coming back from Google: file the request before deciding where to go.
      if (requestRole) {
        const roles = await fetchRoles(u.id);
        if (!roles.some((r) => allowed.includes(r))) {
          const full = (u.user_metadata?.full_name ?? "").trim();
          const parts = full.split(/\s+/).filter(Boolean);
          const { error } = await supabase.from("role_requests").insert({
            user_id: u.id,
            requested_role: requestRole,
            status: "pending",
            first_name: parts[0] ?? null,
            last_name: parts.slice(1).join(" ") || null,
            email: u.email ?? null,
          });
          // 23505 = request already on file. Nothing to do.
          if (error && error.code !== "23505") {
            toast.error(error.message);
          }
        }
      }

      await settle(u.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const google = async () => {
    setBusy(true);
    const back = portalPath ?? window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${back}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setBusy(false);
      toast.error(error.message || "Google sign-in failed");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });
    if (error || !data.user) {
      setBusy(false);
      return toast.error(error?.message ?? "Sign-in failed");
    }
    const handled = await settle(data.user.id);
    setBusy(false);
    if (!handled) {
      await supabase.auth.signOut();
      toast.error(`This account doesn't have ${kicker.toLowerCase()}.`);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex justify-center">
          <BrandLogo height={34} />
        </Link>
        <div className="soft-card p-7">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {kicker}
          </div>
          <h1 className="mt-1 font-display text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>

          {requestRole && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={google}
                disabled={busy}
                className="mt-6 w-full rounded-full"
              >
                Continue with Google
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                New here? An admin approves you before your portal opens.
              </p>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or use email</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={submit} className={requestRole ? "space-y-4" : "mt-6 space-y-4"}>
            <div>
              <Label htmlFor="e">Email</Label>
              <Input
                id="e"
                type="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="p">Password</Label>
              <Input
                id="p"
                type="password"
                required
                value={password}
