"use client"

import { useMemo } from "react"

import type { EditorController } from "@/components/editor/use-editor-controller"
import type { TemplateContentV3 } from "@/types/template"

const ignore = (): undefined => undefined
const refuse = (): false => false

/**
 * A controller for a page that only shows or fills a document: nothing is
 * chosen, and nothing it is asked to change changes. It carries none of the
 * editing code, so such a page never loads it.
 *
 * @param content - The document.
 * @returns A controller whose every change is ignored.
 */
export function useReadOnlyController(content: TemplateContentV3): EditorController {
  return useMemo(
    (): EditorController => ({
      activeBlockId: null,
      addPage: ignore,
      announcement: "",
      canMove: refuse,
      change: ignore,
      closeSettings: ignore,
      content,
      currentSectionId: null,
      duplicate: ignore,
      focus: null,
      insert: ignore,
      line: null,
      move: ignore,
      moveSection: ignore,
      moveTo: refuse,
      openSettings: ignore,
      placeAt: refuse,
      placeBeside: refuse,
      remove: ignore,
      removeSection: ignore,
      requestFocus: ignore,
      select: ignore,
      selectedBlockId: null,
      setActiveBlockId: ignore,
      setKeepWithNext: ignore,
      setLayout: ignore,
      setLine: ignore,
      setRowWidths: ignore,
      settingsBlockId: null,
      standAlone: ignore,
      turnIntoSection: ignore,
      turnSectionInto: ignore,
      updateBlock: ignore,
      updateGroup: ignore,
      updateSection: ignore,
    }),
    [content]
  )
}
