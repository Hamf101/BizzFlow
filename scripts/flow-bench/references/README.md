# Flow references

Gold documents a careful professional would be glad to send, built in BizFlow's own content format: two each of an intake form, a quote and a service agreement (`intake`, `quote`, `agreement`), and six variations each of an official application, a health record, an employment form, an inspection or log, a questionnaire and a long notice (`application-*`, `health-*`, `employment-*`, `inspection-*`, `questionnaire-*`, `notice-*`).

- `tuning/` may be shown to Flow as examples of good work.
- `heldout/` is never used as prompt material. The benchmark's drafts for the same requests are judged against it, so it stays unseen.

Each file holds the request a user would type, the title, the description and the content. `references.test.ts` checks that every one is valid, raises no quality issue and prints within its `maxPages` (five when absent). To render them to PDF:

```bash
FLOW_BENCH=1 pnpm vitest run scripts/flow-bench/references.test.ts
```

The structure follows Flow's playbooks. Their sources and licences are credited in `src/services/template-ai/flow-playbooks.ts`.

The 36 six-way references are written in our own words. Their sources gave structure only, never wording:

- **UK public bodies:** GOV.UK and its guidance, HMRC, DfE, UKHSA, HSE, FSA, ICO, Acas, the Civil Service People Survey and the NHS. Contains public sector information licensed under the Open Government Licence v3.0.
- **US federal sources, public domain:** CDC, OSHA, DOL, FMCSA, FDA Food Code and CISA, and the Code of Federal Regulations.
- **Other public guidance:**
  - PAR-Q+, the ICAEW engagement-letter helpsheet and the PHSO complaint-handling principles;
  - BSACI allergy action plans, CSP and World Physiotherapy consent guidance;
  - National Lottery Awards for All, and Boston, Madison and Colorado Springs event applications;
  - NSW Public Service Commission and Lincolnshire County Council exit-interview guidance.

None of these bodies endorses BizFlow.
