# BizFlow Docs Development Plan Artifact

Last updated: 2026-07-18

This artifact exists because local superpowers rules require planning output to be persisted under `artifacts/superpowers/`.

Canonical guide:

- `.agent/AGENT.md`

Summary:

- Product: BizFlow Docs, a mobile-first, multi-tenant cloud workflow portal for forms, document collection, submissions, tasks, reminders, and public links. Offline drafts remain a deferred option.
- Current state: Sprint 6 is implemented and schema-verified against the live Supabase project. Cloud hardening now precedes Sprint 7; the Offline Foundation is not an active release gate.
- Source of truth: `.agent/AGENT.md` and the attached BizFlow MVP notes.
- Stale context: `.agent/Project_inf.md` described an unrelated product and should not guide BizFlow implementation.

Current checklist:

- [x] BizFlow MVP requirements captured.
- [x] Development guide initialized in `.agent/AGENT.md`.
- [x] Stale project info rewritten or removed.
- [x] README created.
- [x] Package manager chosen.
- [x] Next.js app scaffolded.
- [x] Tailwind and shadcn/ui initialized.
- [x] Supabase configured for the implemented schema and live Data API checks.
- [x] First sprint implemented and verified.
- [x] Sprint 2 organizations and roles implemented and locally verified.
- [x] Sprint 3 RLS and permissions implemented and locally verified.
- [x] Sprint 4 documents implemented and locally verified.
- [x] Sprint 5 document versioning and comments implemented and locally verified.
- [x] Sprint 6 guided templates, signing, recent documents, and generated PDFs implemented and migrated.
- [x] Supabase migrations applied and live schema verified against the real project.
- [x] Fail-closed two-tenant authenticated RLS verification harness added.
- [ ] Two-tenant authenticated RLS checks completed without service-role query access.
- [ ] Authenticated browser-to-R2 upload/download UAT completed with test-user credentials and deployment R2 settings.
- [x] Cloud-first direction confirmed; PWA/offline dependencies explicitly deferred.
- [x] Repository-grounded offline threat model documented.
- [x] Offline Foundation phase plan documented.
- [x] Offline security and durability spike specified.
- [ ] Immutable generated-document finalization and signing evidence designed before representing a document as finalized.

Deferred offline research:

- Spike 001 established useful native IndexedDB development evidence without adding a production PWA dependency.
- Windows installed-PWA, storage-pressure, and hard-power gates remain open by design while this work is deferred.
- Do not install PWA, service-worker, IndexedDB/Dexie, Tauri, or other offline-runtime packages unless the user explicitly reactivates the phase.
- If reactivated, cloud authorization must remain authoritative for every synchronized mutation.

Planning artifacts:

- `artifacts/audits/BizzFlow-threat-model.md`
- `artifacts/superpowers/offline-foundation-plan.md`
- `artifacts/superpowers/offline-foundation-security-spike.md`

Current next-work routing:

The user's later 2026-07-18 instruction supersedes the Offline Foundation execution lock and makes the cloud application the current target.

1. Harden the real cloud upload and template-publishing paths.
2. Add and run an authenticated two-tenant RLS verification path.
3. Complete browser-to-R2 UAT when test-user and R2 deployment credentials are available.
4. Design immutable generated-document finalization and signing evidence.
5. Continue to Sprint 7 internal submissions once the locally actionable cloud gates pass.

Keep HTTPS/TLS and server-side authorization mandatory for cloud traffic. Do not substitute unrelated PWA, VPN, desktop-runtime, or speculative infrastructure work for the current cloud path.

Execution model:

- Plan before non-trivial changes.
- Use subagent-driven development for independent sprint tasks after an implementation plan is approved.
- Run spec compliance review before code quality review for each task.
- Verify with fresh commands before claiming completion.
