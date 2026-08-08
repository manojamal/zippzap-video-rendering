import { createClient } from '@supabase/supabase-js';

// Requires two env vars (safe to expose client-side — the anon key is
// designed to be public; real protection comes from the RLS policies
// in supabase/schema.sql, not from hiding this key).
//
// .env.local:
//   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// IMPORTANT: createClient() throws synchronously (e.g. "supabaseUrl is required.")
// if either value is missing or malformed. Because this file is imported at the
// very top of the module graph (App.tsx -> campaignApi/authApi -> here), that throw
// happens during module evaluation, before React ever mounts and before the
// ErrorBoundary exists to catch it — the result is a totally blank white screen
// with nothing but a console error, and no on-screen indication of why.
//
// Fresh clones/zips never ship a real .env.local (it's gitignored on purpose,
// since the anon key is project-specific), so this is the default state for
// anyone who just ran `npm install && npm run dev` without configuring Supabase
// yet. We fail loudly in the console (so it's still easy to diagnose) but we
// no longer let it crash the whole app.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — contributor submissions ' +
    'will not reach the organizer, and cloud features (login, campaigns, media sync) ' +
    'are disabled until you add them to .env.local. See .env.example.'
  );
}

// Chainable no-op stand-in for the real client. Real call sites look like
// `supabase.from('x').select().eq('id', y)` or `supabase.auth.signIn(...)` -
// arbitrarily deep property access followed by a call, sometimes repeated
// (`.update().eq()`), and finally `await`-ed. This proxy supports all of
// that: every property access returns a callable, every call returns another
// instance of itself, and it resolves (via `.then`) to a clear, safe
// "not configured" error instead of undefined/throwing.
function createUnconfiguredStub(): any {
  const result = Promise.resolve({
    // `{}` rather than `null`: real call sites destructure this as
    // `data.session?.user` / `data.user?.id` etc. - `null.session` throws
    // (optional chaining doesn't help when it's the outer object that's
    // null), while `{}.session` safely evaluates to `undefined`.
    data: {},
    error: new Error(
      'Supabase is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
      'Add them to .env.local — see .env.example.'
    ),
  });
  const target = () => createUnconfiguredStub();
  return new Proxy(target, {
    apply: () => createUnconfiguredStub(),
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return (result as any)[prop].bind(result);
      }
      // Must return another chainable+callable stub (not a plain function) -
      // real chains go multiple property accesses deep before the final call,
      // e.g. `supabase.auth.getSession()` or `supabase.from('x').select().eq(...)`.
      // A plain function here would make the *second* property access
      // (`.getSession`) undefined, throwing "X.getSession is not a function".
      return createUnconfiguredStub();
    },
  });
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (createUnconfiguredStub() as ReturnType<typeof createClient>);
