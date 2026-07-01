# Deploying superhuman-va to Vercel + Supabase

This is a one-time setup. After it runs once, future deploys are
just `git push` (Vercel auto-deploys from the default branch) or
`vercel --prod` for explicit production deploys.

## Prerequisites

- Node 22+ and pnpm 9+ locally
- A Supabase project (free tier is enough)
- A Vercel account
- The Supabase CLI: `brew install supabase/tap/supabase` (or see https://supabase.com/docs/guides/cli)
- The Vercel CLI: `pnpm add -g vercel` (or `npm i -g vercel`)

## 1. Create the Supabase project (one time)

```bash
# Login
supabase login

# Create a project from the dashboard (https://app.supabase.com)
# then grab the project ref from the URL bar
# (it's the string between /project/ and the first /)
supabase link --project-ref <your-project-ref>
```

In the Supabase dashboard:
- Settings → API → copy the Project URL and the `anon` + `service_role` keys.
- Authentication → Providers → ensure Email is enabled (default).

## 2. Apply the migrations (one time)

```bash
cd superhuman-va
supabase db push
```

This applies the 2 migration files in `supabase/migrations/`:
- `20260701000000_init.sql` (7 tables, indexes, RLS)
- `20260701000001_match_functions.sql` (3 match_* functions)

## 3. Set local env vars (one time)

```bash
cd next-app
cp .env.local.example .env.local
# Fill in:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
#   DEEPSEEK_API_KEY
#   TAVILY_API_KEY
#   CRON_SECRET=    (run: openssl rand -hex 32)
```

## 4. Install dependencies

```bash
cd superhuman-va
pnpm install
```

## 5. Link Vercel and set prod env vars (one time)

```bash
cd superhuman-va
vercel login
vercel link
# Set each env var:
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# paste the value
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add DEEPSEEK_API_KEY production
vercel env add DEEPSEEK_BASE_URL production
vercel env add DEEPSEEK_MODEL production
vercel env add TAVILY_API_KEY production
vercel env add CRON_SECRET production
vercel env add USER_ID production
```

Optionally, to use the local `.env.local` for the Vercel project:
```bash
vercel env pull .env.local
```

## 6. Deploy

```bash
cd superhuman-va
vercel --prod
```

This builds, deploys, and prints the production URL (e.g. `https://superhuman-va.vercel.app`).

## 7. Configure Supabase Auth redirect

In the Supabase dashboard:
- Authentication → URL Configuration
- Add the Vercel URL to "Site URL" and "Additional Redirect URLs"
- The middleware on Vercel will use `/auth/callback` for OAuth/magic-link
  redirects.

## 8. First user

Either:
- Visit `/login` and click "Create account" with your email + password (sign-up is enabled in the SQL by default), OR
- From the Supabase dashboard: Authentication → Users → Add user → Auto Confirm User.

## Subsequent deploys

```bash
git push  # if Vercel is auto-deploying from a git branch
# or
vercel --prod  # explicit production deploy
```

## Cron

Vercel runs `/api/cron/cleanup` daily at 03:00 UTC. It trims
`cost_traces` rows older than 30 days. Verify it's wired up by visiting
the Vercel dashboard → Project → Settings → Cron Jobs.
