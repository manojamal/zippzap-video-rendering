-- ============================================================================
-- Fix: "new row violates row-level security policy for table organizers"
--
-- Cause: supabase.auth.signUp() does not create an active session when email
-- confirmation is required (Supabase's default). The client-side insert into
-- public.organizers that ran immediately after signUp() was therefore running
-- as an anonymous request — auth.uid() was null, which the organizer_self
-- RLS policy correctly rejected.
--
-- Fix: create the organizer row automatically via a trigger on auth.users,
-- running as SECURITY DEFINER (so it bypasses RLS safely, same pattern
-- Supabase recommends for "profile on signup"). The client no longer inserts
-- into organizers at all — see the updated authApi.ts.
--
-- Safe to run on top of your existing schema — paste this into the SQL Editor
-- and run it once.
-- ============================================================================

create or replace function public.handle_new_organizer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organizers (id, name, tier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'tier', 'free')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_organizer();

-- Also allow the trigger's insert to succeed even though it's SECURITY DEFINER
-- (harmless to add — belt and suspenders with the function owner's privileges).
grant insert on public.organizers to authenticated, anon;
