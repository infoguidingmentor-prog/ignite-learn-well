import { supabase } from "@/integrations/supabase/client";

/* ---------------------------------------------------------------------------
 * EDIT THIS BLOCK if your portal routes are named differently.
 * ------------------------------------------------------------------------ */
export const HOME_FOR_ROLE = {
  admin: "/admin",
  coach: "/coach",
  mentor: "/mentor",
  student: "/student",
} as const;

export type AppRole = keyof typeof HOME_FOR_ROLE;

/* Four slots + "Any time". Order here is the order shown everywhere. */
export const TIME_SLOTS = [
  { value: "morning", label: "Morning", hint: "Wake up and set the tone" },
  { value: "afternoon", label: "Afternoon", hint: "Reset between study blocks" },
  { value: "evening", label: "Evening", hint: "Wind down after the day" },
  { value: "night", label: "Night", hint: "Settle before sleep" },
  { value: "any", label: "Any time", hint: "Play whenever it helps" },
] as const;

export type TimeSlot = (typeof TIME_SLOTS)[number]["value"];

export const SLOT_LABEL: Record<TimeSlot, string> = TIME_SLOTS.reduce(
  (acc, s) => ({ ...acc, [s.value]: s.label }),
  {} as Record<TimeSlot, string>
);

/** Which slot a student is in right now, by the clock. */
export function currentSlot(date = new Date()): TimeSlot {
  const h = date.getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 20) return "evening";
  return "night";
}

export const BRAND_BLUE = "#003C94";

/* ---------------------------------------------------------------------------
 * Roles
 * ------------------------------------------------------------------------ */
export async function fetchMyRoles(): Promise<AppRole[]> {
  const { data: session } = await supabase.auth.getUser();
  if (!session?.user) return [];

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", session.user.id);

  if (error || !data) return [];
  return data.map((r: { role: string }) => r.role as AppRole);
}

/** Highest-privilege landing page for the roles a person actually holds. */
export function landingFor(roles: AppRole[]): string {
  if (roles.includes("admin")) return HOME_FOR_ROLE.admin;
  if (roles.includes("coach")) return HOME_FOR_ROLE.coach;
  if (roles.includes("mentor")) return HOME_FOR_ROLE.mentor;
  return HOME_FOR_ROLE.student;
}

export type RoleRequest = {
  id: string;
  user_id: string;
  requested_role: "mentor" | "coach";
  status: "pending" | "approved" | "rejected";
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export async function fetchMyRoleRequest(): Promise<RoleRequest | null> {
  const { data: session } = await supabase.auth.getUser();
  if (!session?.user) return null;

  const { data } = await supabase
    .from("role_requests")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();

  return (data as RoleRequest) ?? null;
}

/* ---------------------------------------------------------------------------
 * Signup intent — survives the round trip to Google and back
 * ------------------------------------------------------------------------ */
const INTENT_KEY = "gm.signupIntent";

export type SignupIntent = {
  role: "student" | "mentor" | "coach";
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export function saveIntent(intent: SignupIntent) {
  localStorage.setItem(INTENT_KEY, JSON.stringify(intent));
}

export function readIntent(): SignupIntent | null {
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    return raw ? (JSON.parse(raw) as SignupIntent) : null;
  } catch {
    return null;
  }
}

export function clearIntent() {
  localStorage.removeItem(INTENT_KEY);
}

export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds < 1) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
