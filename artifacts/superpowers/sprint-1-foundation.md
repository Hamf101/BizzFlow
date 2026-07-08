# Sprint 1 Foundation

Last updated: 2026-07-08

Goal: create the initial Next.js foundation for BizFlow Docs.

Scope:

- Next.js App Router with TypeScript and `src/`.
- Tailwind CSS and shadcn/ui.
- Supabase browser/server/admin helpers.
- Supabase Auth pages and callback route.
- Protected dashboard layout.
- Environment variable validation.
- Vercel-compatible project defaults.

Initial task order:

- [x] Activate `pnpm`.
- [x] Scaffold Next.js application.
- [x] Initialize shadcn/ui.
- [x] Add foundation dependencies.
- [x] Add environment validation.
- [x] Add Supabase helpers.
- [x] Add auth routes/pages.
- [x] Add protected dashboard shell.
- [x] Run fresh verification commands.
- [ ] Add real Supabase project values to `.env.local`.
- [ ] Verify real signup, login, and authenticated dashboard access against Supabase.

Acceptance criterion:

- A user can reach signup/login pages and the protected dashboard route redirects unauthenticated users to login.
- Real account creation and login require valid Supabase environment values.

Verification performed:

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm build`
- Playwright CLI snapshot for `/login`
- Playwright CLI snapshot for `/signup`
- Playwright CLI snapshot for `/dashboard` redirecting to `/login?error=Supabase+environment+is+not+configured.`

Verification commands:

```txt
pnpm lint
pnpm typecheck
pnpm build
```
