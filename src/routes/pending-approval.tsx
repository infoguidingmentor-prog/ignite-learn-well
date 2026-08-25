import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { fetchRoles, landingForRoles } from "@/lib/role-routing";

export const Route = createFileRoute("/pending-approval")({
  component: PendingApproval,
});

type Req = { requested_role: string; status: string } | null;

function PendingApproval() {
  const router = useRouter();
  const [req, setReq] = useState<Req>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      router.navigate({ to: "/portals" });
      return;
    }
    const roles = await fetchRoles(user.id);
    if (roles.length > 0) {
      router.navigate({ to: landingForRoles(roles) });
      return;
    }
    const { data: r } = await supabase
      .from("role_requests")
      .select("requested_role, status")
      .eq("user_id", user.id)
      .maybeSingle();
    setReq((r as Req) ?? null);
    setChecking(false);
  }, [router]);

  useEffect(() => {
    check();
    const t = setInterval(check, 20000);
    return () => clearInterval(t);
  }, [check]);

  const rejected = req?.status === "rejected";

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex justify-center">
          <BrandLogo height={34} />
        </Link>
        <div className="soft-card p-7 text-center">
          <h1 className="font-display text-2xl">
            {rejected ? "Not approved" : "Waiting for approval"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {rejected
              ? "Reach out to the Guiding Mentor team if you think this is a mistake."
              : `Your ${req?.requested_role ?? "access"} request is with the admin team. Once they approve it, your portal opens here.`}
          </p>
          <Button
            onClick={check}
            disabled={checking}
            className="mt-6 w-full rounded-full"
          >
            {checking ? "Checking…" : "Check again"}
          </Button>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.navigate({ to: "/portals" });
            }}
            className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
