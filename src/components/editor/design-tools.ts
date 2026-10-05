// The pieces of the canvas only designing uses: typing into lines, the block
// toolbar and menu, section titles, tables' rows and columns, the slash menu,
// margin guides, section pieces, and dragging and selecting blocks. The editors hand them over when they load;
// a page that only shows or fills a document never does, so never loads them.

import { type ComponentType, createContext, useContext } from "react"

// Any component taking what the real piece takes, loaded now or later.
type Tool<Piece> = ComponentType<Piece extends (props: infer Props) => unknown ? Props : never>

export type DesignTools = Readonly<{
  BlockContextMenu: Tool<typeof import("./editor-block-tools").BlockContextMenu>
  BlockToolbar: Tool<typeof import("./editor-block-toolbar").BlockToolbar>
  EditorSection: Tool<typeof import("./editor-section").EditorSection>
  EditorTable: Tool<typeof import("./editor-table").EditorTable>
  FrameEdges: Tool<typeof import("./editor-canvas-editing").FrameEdges>
  nudgeFrame: typeof import("./editor-canvas-editing").nudgeFrame
  MarginGuides: Tool<typeof import("./margin-guides").MarginGuides>
  RichLine: Tool<typeof import("./rich-line").RichLine>
  SectionPieces: Tool<typeof import("./section-pieces").SectionPieces>
  SlashMenu: Tool<typeof import("./slash-menu").SlashMenu>
  /** Typing, the slash menu, dragging and selecting: a hook, so the canvas calls it on every draw. */
  useCanvasEditing: typeof import("./editor-canvas-editing").useCanvasEditing
}>

/**
 * What designing needs. An editor provides it around its canvas; a page that
 * only shows or fills a document never does, so never loads it. Per tree, not
 * per module, so nothing one page provides reaches another or another request.
 */
export const DesignToolsContext = createContext<DesignTools | null>(null)

/**
 * What designing needs, where an editor provided it.
 *
 * @returns The design pieces, or null on a page that only shows or fills a document.
 */
export function useDesignTools(): DesignTools | null {
  return useContext(DesignToolsContext)
}
