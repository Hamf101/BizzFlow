import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import type { AiRuntime, AiTokenUsage } from "@/services/ai/contracts"
import { createAiRuntime } from "@/services/ai/provider-factory"
import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import { createPdfPagePlans } from "@/services/document-pdf/planner"
import { normalizePdfInput } from "@/services/document-pdf/shared"
import { executeTemplateFlow } from "@/services/template-flow-service"
import { evaluateTemplateQuality } from "@/services/templates/template-quality-service"
import { STARTER_TEMPLATES } from "@/services/templates/starter-templates"
import { createEmptyDocumentContent } from "@/types/template"
import type { TemplateFlowDraft, TemplateFlowMessage } from "@/types/template-flow"

/**
 * Flow benchmark: runs real requests through the real Flow service against a
 * live model, renders each result to PDF, and writes a summary to compare
 * models, prompts and references by eye. It costs money, so it only runs when
 * asked:
 *
 *   FLOW_BENCH=1 [AI_PROVIDER=… AI_MODEL=…] [FLOW_BENCH_JOBS=id,id] [FLOW_BENCH_REPEAT=n] \
 *     pnpm vitest run scripts/flow-bench
 *
 * Output lands in artifacts/flow-bench/<date>/<provider>__<model>/, which is
 * never committed. Nothing touches a database: authorization, history and
 * persistence are stood in for here.
 */

type Job = {
  id: string
  family: string
  start: string
  turns: string[]
}

type CallRecord = { ms: number; usage?: AiTokenUsage; error?: string }

type JobResult = {
  id: string
  ok: boolean
  error: string | null
  operations: number
  critical: string[]
  warnings: string[]
  pages: number | string
  calls: CallRecord[]
  ms: number
}

const METADATA_TIMESTAMP = "2026-01-01T00:00:00.000Z"

describe.runIf(process.env.FLOW_BENCH === "1")("Flow bench", () => {
  it("runs every job and writes a summary", async () => {
    if (existsSync(".env.local")) {
      process.loadEnvFile(".env.local")
    }

    const runtime = createAiRuntime({ requireApproved: false })
    const only = process.env.FLOW_BENCH_JOBS?.split(",").map((id) => id.trim())
    const repeat = Math.max(1, Number(process.env.FLOW_BENCH_REPEAT ?? 1))
    const jobs = (JSON.parse(readFileSync("scripts/flow-bench/jobs.json", "utf8")) as Job[])
      .filter((job) => !only || only.includes(job.id))
    const outDir = join(
      "artifacts/flow-bench",
      new Date().toISOString().slice(0, 10),
      `${runtime.model.provider}__${runtime.model.model.replaceAll("/", "_")}`
    )

    mkdirSync(outDir, { recursive: true })

    const results: JobResult[] = []

    for (const job of jobs) {
      for (let run = 1; run <= repeat; run += 1) {
        const name = repeat > 1 ? `${job.id}-r${run}` : job.id
        const result = await runJob(job, runtime, outDir, name)

        results.push(result)
        console.info(`flow-bench ${name}: ${result.ok ? "ok" : `error: ${result.error}`}`)
      }
    }

    const summaryPath = join(outDir, "summary.md")

    writeFileSync(join(outDir, "summary.json"), JSON.stringify(results, null, 2))
    writeFileSync(summaryPath, renderSummary(runtime, results))
    expect(existsSync(summaryPath)).toBe(true)
  }, 60 * 60_000)
})

async function runJob(job: Job, runtime: AiRuntime, outDir: string, name: string): Promise<JobResult> {
  const calls: CallRecord[] = []
  const recording: AiRuntime = {
    model: runtime.model,
    provider: {
      id: runtime.provider.id,
      async generateStructured(request) {
        const started = performance.now()

        try {
          const result = await runtime.provider.generateStructured(request)

          calls.push({ ms: Math.round(performance.now() - started), usage: result.usage })

          return result
        } catch (error: unknown) {
          calls.push({ ms: Math.round(performance.now() - started), error: String(error) })
          throw error
        }
      }
    }
  }
  const started = performance.now()
  const templateId = randomUUID()
  const history: TemplateFlowMessage[] = []
  let draft = startingDraft(job.start)
  let operations = 0
  let error: string | null = null

  for (const instruction of job.turns) {
    try {
      const result = await executeTemplateFlow(
        { actorUserId: "bench", draft, instruction, organizationId: "bench", templateId },
        {
          authorizeTemplateManagement: async () => {},
          getAiRuntime: () => recording,
          loadHistory: async () => [...history],
          persistMessages: async () => {},
          resolveAuthorName: async () => "Bench"
        }
      )

      history.push(...result.messages)

      if (result.proposal) {
        operations += result.proposal.operations.length
        draft = result.proposal.candidateDraft
      }
    } catch (caught: unknown) {
      error = caught instanceof Error ? caught.message : String(caught)
      break
    }
  }

  const quality = evaluateTemplateQuality(draft)
  const pdfInput = {
    answers: {},
    content: draft.content,
    documentId: templateId,
    metadataTimestamp: METADATA_TIMESTAMP,
    title: draft.title,
    workflowStatus: "draft" as const
  }
  let pages: number | string

  try {
    pages = createPdfPagePlans(normalizePdfInput(pdfInput)).length
    writeFileSync(join(outDir, `${name}.pdf`), await renderGeneratedDocumentPdf(pdfInput))
  } catch (caught: unknown) {
    pages = `unrenderable: ${caught instanceof Error ? caught.message : String(caught)}`
  }

  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ draft, history, job }, null, 2))

  return {
    calls,
    critical: quality.issues.filter((issue) => issue.severity === "critical").map((issue) => issue.code),
    error,
    id: name,
    ms: Math.round(performance.now() - started),
    ok: error === null,
    operations,
    pages,
    warnings: quality.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code)
  }
}

function startingDraft(start: string): TemplateFlowDraft {
  const starter = start.startsWith("starter:") ? STARTER_TEMPLATES[Number(start.slice(8))] : undefined

  if (starter) {
    return { content: structuredClone(starter.content), description: starter.description, title: starter.title }
  }

  return { content: createEmptyDocumentContent(), description: "", title: "Untitled document" }
}

function renderSummary(runtime: AiRuntime, results: JobResult[]): string {
  const sum = (pick: (usage: AiTokenUsage) => number | null | undefined): number =>
    results.flatMap((result) => result.calls).reduce((total, call) => total + (call.usage ? pick(call.usage) ?? 0 : 0), 0)
  const rows = results.map((result) =>
    [
      result.id,
      result.ok ? "ok" : `**${result.error}**`,
      result.operations,
      result.critical.join(" ") || "–",
      result.warnings.join(" ") || "–",
      result.pages,
      result.calls.length,
      result.calls.reduce((total, call) => total + (call.usage?.outputTokens ?? 0), 0),
      `${(result.ms / 1000).toFixed(1)}s`
    ].join(" | ")
  )

  return [
    `# Flow bench — ${runtime.model.provider}/${runtime.model.model}`,
    "",
    `${results.filter((result) => result.ok).length}/${results.length} ok · input ${sum((usage) => usage.inputTokens)} · cached ${sum((usage) => usage.cachedTokens)} · output ${sum((usage) => usage.outputTokens)} tokens`,
    "",
    "job | result | ops | critical | warnings | pages | calls | out tokens | time",
    "--- | --- | --- | --- | --- | --- | --- | --- | ---",
    ...rows.map((row) => `${row}`),
    ""
  ].join("\n")
}
