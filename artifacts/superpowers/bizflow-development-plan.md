# BizFlow Docs Development Plan Artifact

Last updated: 2026-07-08

This artifact exists because local superpowers rules require planning output to be persisted under `artifacts/superpowers/`.

Canonical guide:

- `.agent/AGENT.md`

Summary:

- Product: BizFlow Docs, a mobile-first, multi-tenant workflow portal for forms, document collection, submissions, tasks, reminders, public links, and offline drafts.
- Current state: Sprint 3 implementation. The Next.js App Router foundation exists.
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
- [ ] Supabase configured.
- [x] First sprint implemented and verified.
- [x] Sprint 2 organizations and roles implemented and locally verified.
- [x] Sprint 3 RLS and permissions implemented and locally verified.
- [ ] Supabase migrations applied and live workflows verified against the real project.

Execution model:

- Plan before non-trivial changes.
- Use subagent-driven development for independent sprint tasks after an implementation plan is approved.
- Run spec compliance review before code quality review for each task.
- Verify with fresh commands before claiming completion.
