# Document Workspace And Guided Template Editor Plan

Last updated: 2026-07-17

## Goal

Turn the Documents area into a navigable workspace where organization owners and
managers publish reusable, branded document templates; staff create immutable
document instances from those templates; internal and external recipients fill
and sign them; and the completed result is available as a print-ready PDF.

## Locked Product Decisions

- The editor is a guided vertical page with header, body, and footer sections.
- Each section accepts supported content blocks, including full-width blocks.
- Repeating the header and footer across PDF pages is optional and disabled by
  default.
- Supported blocks are headings, paragraphs, bullet lists, numbered lists,
  images/logos, tables, dividers, text fields, date fields, checkboxes,
  dropdowns, initials, and drawn signatures.
- Owners and managers create, edit, publish, and archive templates. Staff can
  use published templates but cannot change them.
- A template edit is organization-wide. Existing document instances retain the
  exact template snapshot from which they were created.
- Documents may have internal and external recipients and multiple signers.
- Signers may complete in any order. A document is complete only after every
  required signer has signed.
- External recipients receive an email containing a time-limited secure link.
- Drawn signatures are an MVP acknowledgement field, not a qualified or
  regulated e-signature product.
- AI may propose new blocks only. It cannot silently insert, rewrite, delete, or
  rearrange existing template content.
- AI proposals must be schema-valid and previewed before a user accepts them.

## Delivery Slices

### 1. Domain And Persistence

- Add tenant-scoped template, document-instance, recipient/signature, and
  per-user recent-document persistence.
- Add explicit indexes for tenant lists, recent-document ordering, recipient
  token lookup, and foreign keys.
- Enable and force RLS for every new public table, with least-privilege grants.
- Store only hashes of public recipient tokens.
- Add typed models and server-side permission checks.

### 2. Template Library And Editor

- Add template list, create, edit, publish, duplicate, and archive flows.
- Build one client editor around a single validated block schema.
- Provide accessible add, edit, remove, and move controls for every block.
- Allow PNG/JPEG logo and image blocks with explicit size validation.
- Provide a print-oriented preview using the same document schema.

### 3. AI Block Proposals

- Call OpenRouter only from the server with `OPENROUTER_API_KEY`.
- Require a model/provider route that supports strict structured outputs.
- Send the selected section, compact document outline, and organization prompt.
- Validate every response against the canonical block schema.
- Show proposed blocks in a preview and insert them only after confirmation.
- Apply a bounded input size, output block count, timeout, and per-user rate
  limit to control cost and abuse.

### 4. Document Creation, Filling, And Signing

- Let users choose Upload or Create from the Documents plus tile.
- Create from a published template or a blank three-section document.
- Snapshot template content and repeat settings at document creation.
- Add internal/external recipients and send secure Resend invitations.
- Allow recipients to fill supported fields and draw their assigned signature.
- Mark the document complete only when every required signer has signed.
- Generate a final immutable PDF and store it through the existing private
  document-version storage flow.

### 5. Documents Workspace Redesign

- Replace Active documents with the current user's last-opened documents.
- Make nested folders openable.
- Show clickable breadcrumbs for the current folder path.
- Filter visible folders and documents to the current location.
- Add a permission-aware plus tile in the current location.
- Preserve the selected folder through upload and document creation.

## Explicit Boundaries

In scope:

- Guided block editing, organization-wide template publishing, immutable
  document snapshots, basic filling and drawn signatures, secure invitations,
  final PDF generation, proposal-only AI, and the requested Documents UI.

Out of scope:

- Legally qualified e-signatures, identity verification, certificates of
  completion, sequential signing, arbitrary free-position canvas elements,
  collaborative real-time editing, custom fonts, OCR, document import/parsing,
  and AI changes applied without human approval.

## Acceptance Criteria

- [ ] A manager can publish a template containing every supported block type.
- [ ] A staff member can use a published template but cannot modify it.
- [ ] A template edit is visible to all organization members while a previously
      created document retains its original snapshot.
- [ ] Repeat-header and repeat-footer settings are off by default and produce
      repeated PDF content only when enabled.
- [ ] An AI request returns schema-valid proposed blocks and never changes the
      template before explicit acceptance.
- [ ] A user can create a blank document or create one from a published
      template in the selected folder.
- [ ] Internal and external recipients can fill their document through an
      authorized route.
- [ ] Multiple required signers can sign in any order, and completion occurs
      only after all required signatures exist.
- [ ] External recipients receive time-limited links and raw tokens are not
      stored in the database.
- [ ] A completed document has a downloadable print-ready PDF.
- [ ] The Documents root shows user-specific last-opened documents.
- [ ] Nested folders open correctly and every breadcrumb segment is clickable.
- [ ] Tests, type checking, linting, and the production build pass.

## Verification Commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm supabase:check
```
