-- Qtracker: daily log, planner board status, settings, expenses, study groups.
-- Every table is private to its owner via RLS.

-- ---------- Planner board: add a status to the existing todos ----------
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo'
  CHECK (status IN ('todo','in_progress','done'));

UPDATE public.todos SET status = 'done' WHERE done = true AND status = 'todo';

-- ---------- Settings ----------
CREATE TABLE IF NOT EXISTS public.qtracker_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wake_time time NOT NULL DEFAULT '06:30',
  water_target int NOT NULL DEFAULT 8 CHECK (water_target BETWEEN 4 AND 15),
  default_duration_hours numeric NOT NULL DEFAULT 2 CHECK (default_duration_hours BETWEEN 0.5 AND 8),
  goal text,
  remind_daily_log boolean NOT NULL DEFAULT true,
  remind_streaks boolean NOT NULL DEFAULT true,
  remind_tasks boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Daily log (one row per student per day) ----------
CREATE TABLE IF NOT EXISTS public.qtracker_daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  notes text NOT NULL DEFAULT '',
  water_glasses int NOT NULL DEFAULT 0 CHECK (water_glasses >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

-- ---------- Items on a day: priorities, schedule blocks, calls/emails, appointments ----------
CREATE TABLE IF NOT EXISTS public.qtracker_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('priority','schedule','call','appointment')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  start_time time,
  end_time time,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qtracker_items_user_day ON public.qtracker_items (user_id, day);

-- ---------- Expenses ----------
CREATE TABLE IF NOT EXISTS public.qtracker_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qtracker_expenses_user_day ON public.qtracker_expenses (user_id, day);

-- ---------- Group study ----------
CREATE TABLE IF NOT EXISTS public.study_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  invite_code text NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_group_members (
  group_id uuid NOT NULL REFERENCES public.study_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Membership check as SECURITY DEFINER so policies don't recurse.
CREATE OR REPLACE FUNCTION public.is_study_group_member(_group uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.study_group_members WHERE group_id = _group AND user_id = _user);
$$;
REVOKE ALL ON FUNCTION public.is_study_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_study_group_member(uuid, uuid) TO authenticated;

-- Join by invite code without exposing every group to every student.
CREATE OR REPLACE FUNCTION public.join_study_group(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid;
BEGIN
  SELECT id INTO gid FROM public.study_groups WHERE invite_code = lower(trim(_code));
  IF gid IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;
  INSERT INTO public.study_group_members (group_id, user_id) VALUES (gid, auth.uid())
    ON CONFLICT DO NOTHING;
  RETURN gid;
END $$;
REVOKE ALL ON FUNCTION public.join_study_group(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_study_group(text) TO authenticated;

-- What a group can see of its members: first name + hours studied today. Nothing else.
CREATE OR REPLACE FUNCTION public.study_group_board(_group uuid)
RETURNS TABLE (user_id uuid, display_name text, focus_minutes_today int, streak_days int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id,
         split_part(coalesce(p.full_name, 'Student'), ' ', 1),
         coalesce((SELECT sum(f.actual_minutes)::int
                   FROM public.focus_sessions f
                   WHERE f.user_id = m.user_id AND f.completed
                     AND f.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'), 0),
         0
  FROM public.study_group_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE public.is_study_group_member(_group, auth.uid()) AND m.group_id = _group;
$$;
REVOKE ALL ON FUNCTION public.study_group_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.study_group_board(uuid) TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.qtracker_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qtracker_daily_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qtracker_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qtracker_expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_group_members  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qt settings own" ON public.qtracker_settings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "qt logs own" ON public.qtracker_daily_logs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "qt items own" ON public.qtracker_items FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "qt expenses own" ON public.qtracker_expenses FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "groups member read" ON public.study_groups FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_study_group_member(id, auth.uid()));
CREATE POLICY "groups create" ON public.study_groups FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "groups owner delete" ON public.study_groups FOR DELETE TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "members read same group" ON public.study_group_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_study_group_member(group_id, auth.uid()));
CREATE POLICY "members leave" ON public.study_group_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "creator joins own group" ON public.study_group_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.study_groups g WHERE g.id = group_id AND g.created_by = auth.uid()));

-- ---------- My Mentors ----------
-- Students can't read other profiles or flip slot.booked under existing RLS,
-- so expose exactly what the mentor directory and booking flow need.

CREATE OR REPLACE FUNCTION public.list_bookable_mentors()
RETURNS TABLE (
  id uuid, display_name text, college_name text, bio text,
  specialties text[], completed_sessions int, open_slots int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id,
         coalesce(p.full_name, 'Mentor'),
         m.college_name, m.bio, m.specialties,
         (SELECT count(*)::int FROM public.bookings b WHERE b.mentor_id = m.id AND b.status = 'completed'),
         (SELECT count(*)::int FROM public.mentor_availability a
            WHERE a.mentor_id = m.id AND NOT a.booked AND a.slot_start > now())
  FROM public.mentors m
  JOIN public.profiles p ON p.id = m.profile_id
  WHERE m.active AND m.verification_status = 'verified'
    AND auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.list_bookable_mentors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bookable_mentors() TO authenticated;

-- Atomic booking: claims the slot and creates the booking in one step,
-- so two students can't take the same slot.
CREATE OR REPLACE FUNCTION public.book_mentor_slot(_availability uuid, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE slot public.mentor_availability; bid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO slot FROM public.mentor_availability WHERE id = _availability FOR UPDATE;
  IF slot.id IS NULL OR slot.booked OR slot.slot_start <= now() THEN
    RAISE EXCEPTION 'That slot is no longer available';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mentors m
                 WHERE m.id = slot.mentor_id AND m.active AND m.verification_status = 'verified') THEN
    RAISE EXCEPTION 'Mentor is not available';
  END IF;
  UPDATE public.mentor_availability SET booked = true WHERE id = slot.id;
  INSERT INTO public.bookings (mentor_id, student_id, availability_id, notes, status)
  VALUES (slot.mentor_id, auth.uid(), slot.id, left(_notes, 500), 'requested')
  RETURNING id INTO bid;
  RETURN bid;
END $$;
REVOKE ALL ON FUNCTION public.book_mentor_slot(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_mentor_slot(uuid, text) TO authenticated;
