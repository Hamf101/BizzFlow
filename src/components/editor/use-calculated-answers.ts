"use client"

import { useEffect, useMemo, useState } from "react"

import type { TemplateContent } from "@/types/template"
import { hasFormulas } from "@/types/template-formula"
import { pruneHiddenTemplateFieldValues, type AnswerSettler } from "@/types/template-visibility"

/**
 * The answers with what each formula works out, as they are typed, and how a
 * change is brought to that same state: hidden answers let go and, for a
 * document with a formula, each worked out, so a rule testing a worked-out
 * answer reads the new figure. The arithmetic loads only for a document with
 * a formula; the server works every answer out again as it saves, so a page's
 * figures are only ever shown.
 *
 * @param content - The document's content.
 * @param answers - Its answers so far.
 * @returns The answers with the worked-out ones in place, and the settler for a change.
 */
export function useCalculatedAnswers(
  content: TemplateContent,
  answers: Record<string, unknown>
): { answers: Record<string, unknown>; settle: AnswerSettler } {
  const needed = useMemo(() => hasFormulas(content.blocks), [content])
  const [calculate, setCalculate] = useState<AnswerSettler | null>(null)

  useEffect(() => {
    if (needed && calculate === null) {
      void import("@/types/template-calculation").then((loaded) => setCalculate(() => loaded.calculateTemplateAnswers))
    }
  }, [calculate, needed])

  // Until the arithmetic arrives nothing is let go: a rule may test a figure
  // not yet worked out, and the first working out settles what was typed.
  const settle = needed ? (calculate ?? keepAnswers) : pruneHiddenTemplateFieldValues
  const shown = useMemo(() => (needed && calculate ? calculate(content, answers) : answers), [answers, calculate, content, needed])

  return { answers: shown, settle }
}

function keepAnswers(_content: TemplateContent, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...values }
}
