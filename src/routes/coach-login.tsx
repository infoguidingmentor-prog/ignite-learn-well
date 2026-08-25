import { createFileRoute } from "@tanstack/react-router";
import { StaffLogin } from "@/components/staff-login";

export const Route = createFileRoute("/coach-login")({
  head: () => ({
    meta: [
      { title: "Coach Portal — Guiding Mentor" },
      { name: "description", content: "Sign in to the Guiding Mentor coach portal to review your assigned caseload and wellness flags." },
      { property: "og:title", content: "Coach Portal — Guiding Mentor" },
      { property: "og:description", content: "Sign in to review your assigned caseload and wellness flags." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <StaffLogin
      role={["coach", "counsellor"]}
      requestRole="coach"
      portalPath="/coach-login"
      kicker="Coach access"
      title="Coach portal"
      blurb="Your assigned students, risk-ranked."
    />
  ),
});
