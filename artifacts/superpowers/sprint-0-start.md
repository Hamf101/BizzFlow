# Sprint 0 Start

Last updated: 2026-07-08

Goal: clean planning context and prepare the repository for the first BizFlow Docs implementation sprint.

Work items:

- [x] Confirm canonical guide exists at `.agent/AGENT.md`.
- [x] Confirm stale `.agent/Project_inf.md` is not present.
- [x] Select `pnpm` as the initial package manager.
- [x] Select Termii as the initial SMS provider.
- [x] Add `.gitignore` for dependencies, build output, secrets, local tools, and temporary files.
- [x] Create README.
- [x] Create `.env.example`.
- [x] Verify Sprint 0 files and update the main checklist.
- [ ] Deferred: document-quality/code-quality review pass before finishing the branch.

Notes:

- The Sprint 0 spec review passed after making Termii the explicit initial SMS provider.
- The user asked to save the remaining check for later and begin Sprint 1.

Acceptance criteria:

- Planning docs describe BizFlow, not any previous unrelated product concept.
- The repo has safe defaults for ignored local files and secrets.
- The repo has a README and environment template before app scaffolding.

Verification commands:

```txt
test -f .agent/AGENT.md
test ! -f .agent/Project_inf.md
test -f README.md
test -f .env.example
test -f .gitignore
rg -n "<stale product name>" .agent README.md artifacts || true
git status --short
```
