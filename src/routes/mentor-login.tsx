import { createFileRoute } from "@tanstack/react-router";
import { StaffLogin } from "@/components/staff-login";

export const Route = createFileRoute("/mentor-login")({
  head: () => ({
    meta: [
      { title: "Mentor Portal — Guiding Mentor" },
      { name: "description", content: "Sign in to the Guiding Mentor mentor portal to see your booked students and their progress trends." },
      { property: "og:title", content: "Mentor Portal — Guiding Mentor" },
      { property: "og:description", content: "See your booked students and their progress trends." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <StaffLogin
      role="mentor"
      requestRole="mentor"
      portalPath="/mentor-login"
      kicker="Mentor access"
      title="Mentor portal"
      blurb="Students who booked you, and how they're trending."
    />
  ),
});
