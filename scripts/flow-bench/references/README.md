# Flow references

Six gold documents: the intake form, quote and service agreement a careful professional would be glad to send, built in BizFlow's own content format.

- `tuning/` may be shown to Flow as examples of good work.
- `heldout/` is never used as prompt material. The benchmark's drafts for the same requests are judged against it, so it stays unseen.

Each file holds the request a user would type, the title, the description and the content. `references.test.ts` checks that every one is valid, raises no quality issue and prints on five pages or fewer. To render them to PDF:

```bash
FLOW_BENCH=1 pnpm vitest run scripts/flow-bench/references.test.ts
```

The structure follows Flow's playbooks. Their sources and licences are credited in `src/services/template-ai/flow-playbooks.ts`.
