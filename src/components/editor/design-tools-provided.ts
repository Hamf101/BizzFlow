"use client"

// What the editors provide around their canvas, so it can design.
import dynamic from "next/dynamic"

import type { DesignTools } from "./design-tools"
import { BlockContextMenu } from "./editor-block-tools"
import { FrameEdges, nudgeFrame, useCanvasEditing } from "./editor-canvas-editing"
import { EditorSection } from "./editor-section"
import { EditorTable } from "./editor-table"
import { RichLine } from "./rich-line"
import { SectionPieces } from "./section-pieces"

export const DESIGN_TOOLS: DesignTools = {
  BlockContextMenu,
  // These show only after a choice, a selection or a typed /, so they may
  // arrive a moment later; what is typed into, or wraps the page, may not.
  BlockToolbar: dynamic(() => import("./editor-block-toolbar").then((module) => module.BlockToolbar)),
  EditorSection,
  EditorTable,
  FrameEdges,
  nudgeFrame,
  MarginGuides: dynamic(() => import("./margin-guides").then((module) => module.MarginGuides)),
  RichLine,
  SectionPieces,
  SlashMenu: dynamic(() => import("./slash-menu").then((module) => module.SlashMenu)),
  useCanvasEditing,
}
