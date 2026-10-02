// The pieces of the canvas only designing uses: typing into lines, the block
// toolbar and menu, section titles, tables' rows and columns, the slash menu,
// margin guides and section pieces. The editors hand them over when they load;
// a page that only shows or fills a document never does, so never loads them.

import type { ComponentType } from "react"

// Any component taking what the real piece takes, loaded now or later.
type Tool<Piece> = ComponentType<Piece extends (props: infer Props) => unknown ? Props : never>

export type DesignTools = Readonly<{
  BlockContextMenu: Tool<typeof import("./editor-block-tools").BlockContextMenu>
  BlockToolbar: Tool<typeof import("./editor-block-toolbar").BlockToolbar>
  EditorSection: Tool<typeof import("./editor-section").EditorSection>
  EditorTable: Tool<typeof import("./editor-table").EditorTable>
  MarginGuides: Tool<typeof import("./margin-guides").MarginGuides>
  RichLine: Tool<typeof import("./rich-line").RichLine>
  SectionPieces: Tool<typeof import("./section-pieces").SectionPieces>
  SlashMenu: Tool<typeof import("./slash-menu").SlashMenu>
}>

let tools: DesignTools | null = null

/**
 * Gives the canvas what designing needs; the editors call this as they load.
 *
 * @param next - The design pieces.
 */
export function provideDesignTools(next: DesignTools): void {
  tools = next
}

/**
 * What designing needs, where an editor provided it.
 *
 * @returns The design pieces, or null on a page that only shows or fills a document.
 */
export function designTools(): DesignTools | null {
  return tools
}
