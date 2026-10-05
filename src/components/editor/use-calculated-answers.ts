"use client"

import { useEffect, useMemo, useState } from "react"

import type { TemplateContent } from "@/types/template"
import type { calculateTemplateAnswers } from "@/types/template-calculation"
import { hasFormulas } from "@/types/template-formula"

/**
 * The answers with what each formula works out, as they are typed. The
 * arithmetic loads only for a document with a formula; the server works every
 * answer out again as it saves, so a page's figures are only ever shown.
 *
 * @param content - The document's content.
 * @param answers - Its answers so far.
 * @returns The answers with the worked-out ones in place.
 */
export function useCalculatedAnswers(content: TemplateContent, answers: Record<string, unknown>): Record<string, unknown> {
  const needed = useMemo(() => hasFormulas(content.blocks), [content])
  const [calculate, setCalculate] = useState<typeof calculateTemplateAnswers | null>(null)

  useEffect(() => {
    if (needed && calculate === null) {
      void import("@/types/template-calculation").then((loaded) => setCalculate(() => loaded.calculateTemplateAnswers))
    }
  }, [calculate, needed])

  return useMemo(() => (needed && calculate ? calculate(content, answers) : answers), [answers, calculate, content, needed])
}
