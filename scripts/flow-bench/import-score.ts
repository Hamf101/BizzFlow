import type { TemplateBlock, TemplateContentV3 } from "@/types/template"

/**
 * Scores a form Flow recreated from an attached file against the reference it
 * was printed from: which fields it found (by label), whether each is the
 * right kind, the sections, the page, and for a filled source the answers it
 * read. Deterministic, so two runs compare.
 */

type Field = { key: string; label: string; kind: string; tokens: string[] }

export type ImportScore = {
  refFields: number
  resultFields: number
  matched: number
  recall: number
  precision: number
  kindAccuracy: number
  kindMisses: string[]
  sections: { ref: number; result: number; matched: number; inOrder: boolean }
  page: { ref: string; result: string; match: boolean }
  answers: { truth: number; correct: number; accuracy: number; hallucinated: number; unmatched: number; wrong: string[] } | null
}

const normalise = (text: string): string =>
  text.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()

const tokensOf = (text: string): string[] => normalise(text).split(" ").filter(Boolean)

// Shared tokens over the longer label's count, so "Name" never matches "Business name".
function overlap(a: string[], b: string[]): number {
  const set = new Set(b)

  return a.filter((token) => set.has(token)).length / Math.max(a.length, b.length, 1)
}

function kindOf(block: TemplateBlock): string {
  const kind = block.type.replace(/_field$/, "")

  return block.type === "dropdown_field" && block.multiple ? "dropdown_multiple" : kind
}

function fieldsOf(blocks: readonly TemplateBlock[]): Field[] {
  return blocks.flatMap((block) =>
    "fieldKey" in block ? [{ key: block.fieldKey, label: block.label, kind: kindOf(block), tokens: tokensOf(block.label) }] : []
  )
}

/** Pairs each reference label with the first unmatched result label equal to it, else with overlap ≥ 0.8. */
export function matchLabels<T extends { tokens: string[] }>(ref: readonly T[], result: readonly T[]): Array<[T, T]> {
  const used = new Set<number>()
  const pairs: Array<[T, T]> = []

  for (const wanted of ref) {
    const label = wanted.tokens.join(" ")
    let index = result.findIndex((candidate, at) => !used.has(at) && candidate.tokens.join(" ") === label)

    if (index < 0) {
      let best = 0.8 - Number.EPSILON

      result.forEach((candidate, at) => {
        const score = used.has(at) ? 0 : overlap(wanted.tokens, candidate.tokens)

        if (score > best) {
          best = score
          index = at
        }
      })
    }

    if (index >= 0) {
      used.add(index)
      pairs.push([wanted, result[index]!])
    }
  }

  return pairs
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.every(isBlank)) ||
  (typeof value === "object" && !Array.isArray(value) && Object.values(value as object).every(isBlank))

/** One answer as a comparable string: case, spacing, currency signs, thousands commas and empty table rows don't count. */
export function normaliseAnswer(value: unknown): string {
  if (typeof value === "boolean") return String(value)
  if (typeof value === "number") return String(value)
  if (typeof value === "string") {
    const text = normalise(value.replace(/[£$€]/g, "").replace(/(\d),(\d{3})/g, "$1$2"))
    const number = /^-?\d+(\.\d+)?$/.test(value.replace(/[£$€,\s]/g, "")) ? Number(value.replace(/[£$€,\s]/g, "")) : null

    return number === null ? text : String(number)
  }
  if (Array.isArray(value)) {
    const items = value.filter((item) => !isBlank(item)).map(normaliseAnswer)

    // A table keeps its row order; a list of choices doesn't have one.
    return JSON.stringify(Array.isArray(value[0]) ? items : items.sort())
  }
  if (value && typeof value === "object") {
    return JSON.stringify(
      Object.entries(value).filter(([, cell]) => !isBlank(cell)).map(([row, cell]) => [normalise(row), normaliseAnswer(cell)]).sort()
    )
  }

  return ""
}

export function scoreImport(input: {
  reference: TemplateContentV3
  // The reference fields a reader could see on the source: all, or what a filled copy printed.
  visibleRefKeys?: ReadonlySet<string>
  result: TemplateContentV3
  truth: Record<string, unknown> | null
  answers: Record<string, unknown>
}): ImportScore {
  const ref = fieldsOf(input.reference.blocks).filter((field) => !input.visibleRefKeys || input.visibleRefKeys.has(field.key))
  const result = fieldsOf(input.result.blocks)
  const pairs = matchLabels(ref, result)
  const kindMisses = pairs.filter(([a, b]) => a.kind !== b.kind).map(([a, b]) => `${a.label}: ${a.kind}→${b.kind}`)
  const refSections = input.reference.sections.map((section) => ({ tokens: tokensOf(section.label) }))
  const resultSections = input.result.sections.map((section) => ({ tokens: tokensOf(section.label) }))
  const sectionPairs = matchLabels(refSections, resultSections)
  const order = sectionPairs.map(([, b]) => resultSections.indexOf(b))
  const page = (content: TemplateContentV3): string => `${content.layout.pageSize} ${content.layout.orientation}`
  let answers: ImportScore["answers"] = null

  if (input.truth || Object.keys(input.answers).length > 0) {
    const truth = input.truth ?? {}
    const resultKeyFor = new Map(pairs.map(([a, b]) => [a.key, b.key]))
    const truthFor = new Map(pairs.map(([a, b]) => [b.key, a.key]))
    const wrong: string[] = []
    let correct = 0

    for (const [key, expected] of Object.entries(truth)) {
      const resultKey = resultKeyFor.get(key)
      const got = resultKey === undefined ? undefined : input.answers[resultKey]

      if (got !== undefined && normaliseAnswer(got) === normaliseAnswer(expected)) {
        correct += 1
      } else {
        wrong.push(`${key}: ${JSON.stringify(expected)} → ${got === undefined ? "–" : JSON.stringify(got)}`)
      }
    }

    const given = Object.entries(input.answers).filter(([, value]) => !isBlank(value))
    // An answer to a field the source left blank; and one to a field no reference label matched, which may be either.
    const hallucinated = given.filter(([key]) => truthFor.has(key) && !(truthFor.get(key)! in truth)).length
    const unmatched = given.filter(([key]) => !truthFor.has(key)).length
    const count = Object.keys(truth).length

    answers = { truth: count, correct, accuracy: count ? correct / count : 1, hallucinated, unmatched, wrong }
  }

  return {
    refFields: ref.length,
    resultFields: result.length,
    matched: pairs.length,
    recall: ref.length ? pairs.length / ref.length : 1,
    precision: result.length ? pairs.length / result.length : 0,
    kindAccuracy: pairs.length ? (pairs.length - kindMisses.length) / pairs.length : 0,
    kindMisses,
    sections: {
      ref: refSections.length,
      result: resultSections.length,
      matched: sectionPairs.length,
      inOrder: order.every((at, i) => i === 0 || at > order[i - 1]!),
    },
    page: { ref: page(input.reference), result: page(input.result), match: page(input.reference) === page(input.result) },
    answers,
  }
}
