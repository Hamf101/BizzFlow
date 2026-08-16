---
name: passing-checks
description: >-
  BizFlow pre-commit quality gate. Use before committing, when a PR/CI check fails, or when
  `pnpm check` reports errors — covers lint, typecheck, vitest, the jscpd duplication budget
  (3% / 5-line / 50-token), the production build, and the dependency audit. Explains what each
  gate enforces and how to satisfy the duplication budget without disabling it.
---

# Passing `pnpm check`

`pnpm check` is the gate. CI (`.github/workflows/ci.yml`) runs the same steps, so green locally
= green in CI. Run it before saying a change is done.

```bash
pnpm check   # = lint → typecheck → test → check:duplication → build → audit:dependencies
```

Run steps individually while iterating (fast → slow):

```bash
pnpm lint
pnpm typecheck
pnpm vitest run <file>      # or pnpm test for all
pnpm check:duplication
pnpm build
pnpm audit:dependencies
```

## What each gate enforces

| Step | Command | Notes |
|---|---|---|
| Lint | `eslint` | `eslint-config-next` core-web-vitals + TS. `.agent/`, `artifacts/`, `.tmp/` are ignored. |
| Types | `tsc --noEmit` | **strict**. No `any` escapes; model DB rows as typed `*Row` and map them. |
| Tests | `vitest run` | See `writing-tests`. A new/changed service needs a co-located test. |
| Duplication | `jscpd` | The unusual one — see below. |
| Build | `next build` | Catches RSC/server-client boundary and route-type errors that `tsc` misses. |
| Audit | `pnpm audit --prod --audit-level=moderate` | Prod deps only. New moderate+ CVE fails it. |

## The duplication budget (the gate people trip on)

```
jscpd src --format typescript,tsx --min-lines 5 --min-tokens 50 --mode strict --threshold 3
       --ignore '**/*.test.ts,**/*.test.tsx'
```

- Scans **`src`**, TS/TSX. **Tests are excluded** — but non-test `*.test-support.ts` helpers are
  **scanned** (only files literally ending `.test.ts[x]` are ignored).
- A clone = **≥ 5 lines AND ≥ 50 tokens** repeated. Total duplication must stay **< 3%**.
- `--mode strict` ignores nothing else; there is no inline "ignore this block" pragma in use.

**Fix duplication by refactoring, not by suppressing.** This repo's whole shape (shared
`shared.ts` helpers, `*-service.test-support.ts`, fixture factories, the `TEMPLATE_COLUMNS`
constant, `runXOperation`) exists to keep code DRY. When jscpd flags a clone:

1. Read the two locations it points at.
2. Extract the shared part to the right home:
   - service logic → a helper in the domain's `shared.ts`
   - a row/column shape → a constant or `mapRow`
   - test setup → a factory in `*-service.test-support.ts`
   - cross-cutting util → `src/lib/`
3. Re-run `pnpm check:duplication`.

Prefer a named helper with a clear responsibility over a clever abstraction that fuses two
things that merely *look* alike. If two blocks are genuinely independent and coincidentally
similar, making one *clearer* (different structure) is legitimate — but extraction is the
default answer here.

## Before you commit

- [ ] `pnpm check` is fully green (not just the step you touched).
- [ ] New behavior has a test; changed behavior updated its test.
- [ ] No stray `console.log` (structured `console.info/warn/error` inside `runXOperation` is the
      logging convention — see `writing-services`).
- [ ] Conventional commit message (`feat(...)`, `fix(...)`, `test(...)`, matching git history).
- [ ] Report failures honestly with the command output — never claim "passing" without a fresh run.
