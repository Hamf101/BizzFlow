# BizFlow Docs Development Plan Artifact

Last updated: 2026-07-18

This artifact exists because local superpowers rules require planning output to be persisted under `artifacts/superpowers/`.

Canonical guide:

- `.agent/AGENT.md`

Summary:

- Product: BizFlow Docs, a mobile-first, multi-tenant workflow portal for forms, document collection, submissions, tasks, reminders, public links, and offline drafts.
- Current state: Sprint 5 is implemented and schema-verified against the live Supabase project. Before further feature sprints, the project is entering a security-gated Offline Foundation planning and verification phase.
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
- [x] Supabase migrations applied and live schema verified against the real project.
- [ ] Authenticated browser-to-R2 upload/download UAT completed with test-user credentials and deployment R2 settings.
- [x] Local-first desktop direction and offline scope confirmed with the user.
- [x] Repository-grounded offline threat model documented.
- [x] Offline Foundation phase plan documented.
- [x] Offline security and durability spike specified.
- [ ] Threat model, candidate controls, and spike exit criteria reviewed before implementation.

Offline direction:

- Dedicated user devices.
- Offline support for drafts, attachments, complete documents, recipient data, generated PDFs, and drawn signatures.
- Indefinite offline read/edit access, with the documented limitation that a fully disconnected device cannot be remotely revoked or wiped.
- PWA plus IndexedDB/Dexie first; Tauri plus SQLite only after field evidence justifies it.
- Cloud authorization remains authoritative for every synchronized mutation.

Planning artifacts:

- `artifacts/audits/BizzFlow-threat-model.md`
- `artifacts/superpowers/offline-foundation-plan.md`
- `artifacts/superpowers/offline-foundation-security-spike.md`

Mandatory next-work routing:

The user's 2026-07-18 instruction approves starting this sequence. The next agent should execute it rather than ask which sprint comes next.

1. Run the Offline Foundation security and durability spike.
2. Resolve or explicitly accept every failed security gate.
3. Implement the Offline Foundation plan in its defined order.
4. Verify the complete local-save, recovery, authorization, synchronization, and file-upload path.
5. Resume Sprint 6 only after the Offline Foundation is accepted.

Do not substitute a VPN project for the Offline Foundation. A VPN can protect or route traffic only when a network path already exists; it cannot preserve work or synchronize devices during a total connectivity outage. HTTPS/TLS remains mandatory for normal cloud traffic, while any later private-access requirement must be justified and planned independently.

Execution model:

- Plan before non-trivial changes.
- Use subagent-driven development for independent sprint tasks after an implementation plan is approved.
- Run spec compliance review before code quality review for each task.
- Verify with fresh commands before claiming completion.
