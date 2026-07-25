---
name: writing-tests
description: >-
  BizFlow service test conventions (Vitest). Use when writing or updating tests (*.test.ts /
  *.test.tsx), especially for src/services code — building the in-memory FakeSupabaseClient,
  createDeps dependency injection, row fixtures, and deterministic ids/timestamps. Covers why
  this repo fakes Supabase instead of mocking method chains, and how to run vitest.
---

# Writing BizFlow tests

Tests are **co-located** (`foo.ts` → `foo.test.ts`) and run on Vitest. The `@` alias maps to
`src`. No jest, no `@testing-library` for services. Import from `vitest`:

```ts
import { describe, expect, it, vi } from "vitest"
```

## Run

```bash
pnpm vitest run src/services/template-service.test.ts   # one file — the inner loop
pnpm vitest run -t "rejects staff"                       # by test name
pnpm test                                                # whole suite (what CI runs)
```

## The core idea: fake Supabase, inject deps — don't mock

Services accept a `deps` object and reach the DB through `Pick<AdminSupabaseClient, "from">`.
Tests pass an **in-memory fake** that stores rows in plain arrays and supports the exact query
methods the service uses. This is faithful (real filtering, real optimistic-concurrency
behavior) and readable — never hand-mock `.from().select().eq()` chains with `vi.fn()`.

Two established shapes:
- **Shared harness** in `src/services/<domain>-service.test-support.ts`, reused across a
  domain's test files (e.g. `document-service.test-support.ts`). Prefer this when >1 test file
  or >1 table is involved.
- **Inline `FakeQuery`** at the top of a single `.test.ts` when the surface is tiny.

## The fake client (from `document-service.test-support.ts`)

A chainable builder that is **thenable** (so `await client.from(t).select()...` resolves to
`{ data, error }`) and also exposes `.single()` / `.maybeSingle()`.

```ts
export class FakeSupabaseClient {
  readonly tables: Record<FakeTableName, FakeRow[]>
  constructor(seed: Partial<Record<FakeTableName, FakeRow[]>> = {}) { /* default each table to seed[t] ?? [] */ }
  from(tableName: FakeTableName): FakeQueryBuilder { return new FakeQueryBuilder(this, tableName) }
  async rpc(fn: "…", args: Record<string, unknown>) { /* emulate the specific RPCs the service calls */ }
}

class FakeQueryBuilder {
  select() { return this }
  insert(v) { this.insertRows = Array.isArray(v) ? v : [v]; return this }
  update(v) { this.updateValues = v; return this }
  eq(col, val) { this.filters.push(r => r[col] === val); return this }   // is() = same
  order(col, { ascending = true } = {}) { /* record */ return this }
  limit(n) { /* record */ return this }
  async single()      { const r = this.execute(); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: new Error("Expected one row.") } }
  async maybeSingle() { const r = this.execute(); return r.length > 1 ? { data: null, error: new Error("Expected zero or one row.") } : { data: r[0] ?? null, error: null } }
  then(onf, onr) { return Promise.resolve({ data: this.execute(), error: null }).then(onf, onr) }  // makes it awaitable
  private execute() { /* insert → push & return; update → Object.assign matched rows; else filtered+ordered+limited */ }
}
```
Only implement the methods your service actually calls. `maybeSingle()` returning `null` is how
you exercise the service's **409 optimistic-conflict** path — a key case to cover.

## Fixtures + deps

Factories with `overrides`, deterministic ids, and **frozen timestamps** (literal ISO strings —
never `new Date()`), so assertions are stable and the duplication budget stays happy:

```ts
export function createMembershipRow(role: OrganizationRole): FakeRow { return { org_id: "org-1", user_id: "user-1", role, status: "active", /* … */ } }
export function createDocumentRow(overrides: FakeRow = {}): FakeRow { return { id: "document-1", org_id: "org-1", /* … */, ...overrides } }

export function createDeps(client: FakeSupabaseClient, ids: string[] = []): DocumentServiceDeps {
  const queue = [...ids]
  return {
    client: client as never,                        // fake ⇒ `as never` to satisfy the narrow client type
    createId: () => queue.shift() ?? "generated-id", // deterministic id sequence
    recordAuditLog: vi.fn().mockResolvedValue(undefined),        // side effects → vi.fn()
    createSignedDocumentUploadUrl: vi.fn(async () => ({ uploadUrl: "https://r2.example/upload", storageKey: "…", expiresInSeconds: 900 })),
    // …one entry per Deps field the operation touches…
  }
}
```

## A test

```ts
const ORG_ID = "10000000-0000-4000-8000-000000000001"  // UUID-shaped constants at top of file
const MANAGER_ID = "20000000-0000-4000-8000-000000000001"

describe("updateDocumentTemplate", () => {
  it("increments revision once and rejects a stale expectedRevision", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
      document_templates: [createTemplateRow({ revision: 3 })],
    })
    const deps = createDeps(client, ["new-id"])

    await expect(
      updateDocumentTemplate({ actorUserId: MANAGER_ID, organizationId: ORG_ID, templateId: TEMPLATE_ID, expectedRevision: 2, title: "x" }, deps),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
```

## What to cover (services)

- [ ] **Happy path** returns a mapped (camelCase) domain object, not a raw row.
- [ ] **Permission**: wrong role / no membership → `403` (`.rejects.toMatchObject({ statusCode: 403 })`).
- [ ] **Tenant isolation**: an actor from another `org_id` cannot read/mutate the row.
- [ ] **Not found** → `404`; **validation** (bad title/checksum/etc.) → `400`.
- [ ] **Optimistic conflict**: stale `expectedRevision` / concurrent status change → `409`.
- [ ] **Side effects**: assert `deps.recordAuditLog` / signer mocks were called with expected args.
- [ ] Assert on `statusCode`, not message strings, so copy tweaks don't break tests.

Keep helpers in `*-service.test-support.ts` and reuse them — duplicated fake-builder or fixture
blocks will trip `pnpm check:duplication` (see `passing-checks`).
