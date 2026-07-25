---
name: writing-services
description: >-
  BizFlow service-layer conventions. Use when creating or editing any file under src/services/
  — adding a domain operation, a new service module, permission checks, status transitions,
  audit/activity events, or Supabase data access. Covers the contracts/errors/shared module
  split, the runXOperation logging wrapper, requirePermission, dependency injection,
  optimistic-concurrency updates, and Postgres error mapping.
---

# Writing BizFlow services

Services are the **only** place business logic, permission checks, status transitions, and
audit/activity events live. Route handlers and server actions stay thin: parse → call service →
translate error by `statusCode`.

## Module layout

A domain lives in `src/services/<domain>/` and is re-exported by a sibling barrel
`src/services/<domain>-service.ts`. Reference implementation: `src/services/templates/`.

```
services/
  templates/
    contracts.ts   # input types + <Domain>ServiceClient + <Domain>ServiceDeps
    errors.ts      # <Domain>ServiceError extends Error { statusCode }
    shared.ts      # column list, requirePermission, getById, mapRow, normalizers, wrapper, deps helpers
    template-lifecycle-service.ts   # the actual operations
  template-service.ts               # BARREL: re-export types + fns, nothing else
```

Small domains can collapse `contracts`/`errors`/`shared` into fewer files, but keep the barrel.

## The 5 pieces

### 1. Error (`errors.ts`) — HTTP-translatable

```ts
export class TemplateServiceError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "TemplateServiceError"
    this.statusCode = statusCode
  }
}
```
Messages are **user-safe** (surfaced at the route). Status codes: `400` validation, `403`
permission, `404` not-found/not-visible, `409` conflict/state, `500` unexpected.

### 2. Contracts (`contracts.ts`) — inputs + injected deps

Compose inputs by intersection; every tenant op carries `actorUserId` + `organizationId`.

```ts
export type TemplateServiceClient = Pick<AdminSupabaseClient, "from">  // add "rpc" if used
export type ListDocumentTemplatesInput = { actorUserId: string; organizationId: string }
export type GetDocumentTemplateInput   = ListDocumentTemplatesInput & { templateId: string }
export type TemplateServiceDeps = { client?: TemplateServiceClient; createId?: () => string; now?: () => Date }
```
`Deps` names every non-deterministic or side-effecting dependency (`client`, `createId`, `now`,
signers, `recordAuditLog`, validators…) so tests inject fakes. See `writing-tests`.

### 3. Shared helpers (`shared.ts`)

- **Column constant:** `export const TEMPLATE_COLUMNS = "id,org_id,title,status,revision,…"` —
  one source of truth for `.select(...)`.
- **`requirePermission(client, orgId, actorUserId, action, rejectionMessage)`** → reads the
  active `organization_memberships` row, validates the role, calls
  `canPerformOrganizationAction`, returns the `OrganizationRole`. Throws `403` with
  `rejectionMessage` when absent/denied. **Call it first in every operation.**
- **`getById(client, orgId, id)`** → tenant-scoped `.eq("id").eq("org_id").maybeSingle()`,
  throws `404` when missing.
- **`mapRow(row): Domain`** → snake_case DB row → camelCase domain object, parsing enums/JSON.
- **Normalizers** (`normalizeTitle`, `normalizeDescription`, `assertRevision`…) trim/validate
  and throw `400` on bad input.
- **Deps resolvers:** `getClient(deps) = deps.client ?? createAdminClient()`,
  `createId(deps) = deps.createId?.() ?? randomUUID()`,
  `nowIso(deps) = (deps.now?.() ?? new Date()).toISOString()`.
- **`createDatabaseError(error, fallback)`** maps Postgres codes: `23505 → 409`,
  `23514`/`22P02 → 400`, else `500`. Use it for every `{ error }` from Supabase.
- **`runXOperation(name, identifiers, op)`** wraps every operation for structured logging.

### 4. The operation wrapper (structured logging)

```ts
export async function runTemplateOperation<T>(
  operationName: string,
  identifiers: Record<string, string | number | boolean | null | undefined>,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await operation()
    console.info("template_service_success", { operationName, durationMs: Date.now() - startedAt, ...identifiers })
    return result
  } catch (error) {
    if (error instanceof TemplateServiceError) {
      console.warn("template_service_rejected", { operationName, statusCode: error.statusCode, reason: error.message, ...identifiers })
      throw error
    }
    if (error instanceof ZodError) { /* → TemplateServiceError("… is invalid.", 400), warn, throw */ }
    console.error("template_service_failed", { operationName, reason: /* Error.message */, ...identifiers })
    throw new TemplateServiceError("Template service failed.", 500)  // never leak raw errors
  }
}
```
Log event names are `<domain>_service_{success|rejected|failed}`. `identifiers` are safe ids
(orgId, actorUserId, entityId, revision) — **never** file bytes, tokens, or PII.

### 5. An operation

```ts
export async function updateDocumentTemplate(
  input: UpdateDocumentTemplateInput,
  deps: TemplateServiceDeps = {},
): Promise<DocumentTemplate> {
  return runTemplateOperation("update_document_template",
    { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: input.templateId },
    async () => {
      const client = getClient(deps)
      await requirePermission(client, input.organizationId, input.actorUserId, "templates:manage", "You cannot manage document templates.")
      const existing = await getTemplateById(client, input.organizationId, input.templateId)
      // …validate transition / compute next values…
      const { data, error } = await client.from("document_templates").update({ /* … */ })
        .eq("id", input.templateId).eq("org_id", input.organizationId)
        .eq("revision", input.expectedRevision).eq("status", existing.status)  // optimistic guard
        .select(TEMPLATE_COLUMNS).maybeSingle()
      if (error) throw createDatabaseError(error, "Unable to update document template.")
      if (!data) throw new TemplateServiceError("Document template changed since it was opened.", 409)
      return mapDocumentTemplate(data as DocumentTemplateRow)
    })
}
```

## Non-negotiables (checklist)

- [ ] `runXOperation` wraps the whole body; safe identifiers only.
- [ ] `requirePermission(...)` is the first thing inside, before any read/write.
- [ ] Every query filters `.eq("org_id", input.organizationId)` — **tenant scoping is mandatory.**
- [ ] Non-determinism comes from `deps` (`getClient`/`createId`/`nowIso`), never called directly.
- [ ] Mutations that can race use optimistic guards (`expectedRevision` + status) and treat a
      `null` result from `maybeSingle()` as a `409`.
- [ ] Supabase `{ error }` goes through `createDatabaseError`; raw errors never reach the caller.
- [ ] Rows are mapped to camelCase domain types via `mapRow`; callers never see DB shape.
- [ ] New public functions/types are added to the barrel `<domain>-service.ts`.
- [ ] Status transitions follow the state machine in `CLAUDE.md` and are enforced here.
- [ ] Ship the co-located test (`writing-tests`) and keep it DRY (`passing-checks` — 3% budget).

For DB permission mechanics see `supabase-rls`; for signed-URL file work see `r2-storage`.
