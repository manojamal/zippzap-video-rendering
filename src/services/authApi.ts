import { supabase } from './supabaseClient';
import type { UserProfile } from '../types';

/**
 * Real organizer authentication, backed by Supabase Auth.
 * Replaces the previous fake login (App.tsx's handleLoginSubmit/handleSignupSubmit),
 * which only ever set local React state with no real account behind it — meaning
 * "organizer_id = auth.uid()" in the RLS policies had nothing real to check against,
 * and campaigns could never actually be scoped to a real, cross-device account.
 */

/** Sign up a brand-new organizer. The matching public.organizers row is created
 * automatically by a database trigger (see schema.sql: handle_new_organizer),
 * NOT by this function — a client-side insert here would fail with an RLS
 * error whenever email confirmation is required, since no session exists yet
 * at that point (auth.uid() is null until the user confirms and logs in). */
export async function signUpOrganizer(email: string, password: string, name: string, tier: string): Promise<UserProfile> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, tier } }, // read by the handle_new_organizer trigger
  });
  if (error) throw new Error(error.message);

  const authUser = data.user;
  if (!authUser) {
    throw new Error('Sign up failed — no user was returned.');
  }
  if (!data.session) {
    // Email confirmation is required by your Supabase project's Auth settings.
    // The organizer row will already exist (created by the trigger) by the
    // time they confirm and log in — nothing further to do here but tell them.
    throw new Error('Account created! Check your email to confirm it, then log in.');
  }

  return {
    id: authUser.id,
    name,
    em: email,
    pw: '',
    tier,
    phone: '',
    city: '',
    points: tier === 'elite' ? 300 : tier === 'gold' ? 100 : 20,
    monthlyMsgCount: 0,
  };
}

/** Log in an existing organizer and load their real profile row. */
export async function signInOrganizer(email: string, password: string): Promise<UserProfile> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const authUser = data.user;
  if (!authUser) throw new Error('Login failed — no user returned.');

  const { data: profile, error: profileError } = await supabase
    .from('organizers')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (profileError || !profile) {
    throw new Error('Logged in, but no organizer profile was found for this account.');
  }

  return {
    id: authUser.id,
    name: profile.name,
    em: email,
    pw: '',
    tier: profile.tier,
    phone: '',
    city: '',
    points: profile.points,
    monthlyMsgCount: profile.monthly_msg_count,
    brandLogoDataUrl: profile.brand_logo_url ?? undefined,
    brandColor: profile.brand_color ?? undefined,
  };
}

export async function signOutOrganizer(): Promise<void> {
  await supabase.auth.signOut();
}

/** Restores a session on page load (e.g. after refresh) without requiring re-login. */
export async function restoreOrganizerSession(): Promise<UserProfile | null> {
  const { data } = await supabase.auth.getSession();
  const authUser = data.session?.user;
  if (!authUser) return null;

  const { data: profile } = await supabase.from('organizers').select('*').eq('id', authUser.id).single();
  if (!profile) return null;

  return {
    id: authUser.id,
    name: profile.name,
    em: authUser.email || '',
    pw: '',
    tier: profile.tier,
    phone: '',
    city: '',
    points: profile.points,
    monthlyMsgCount: profile.monthly_msg_count,
    brandLogoDataUrl: profile.brand_logo_url ?? undefined,
    brandColor: profile.brand_color ?? undefined,
  };
}
