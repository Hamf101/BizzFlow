"use client"

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Link2,
  Rows2,
  Trash2,
  Undo2,
} from "lucide-react"
import { type ReactElement, type ReactNode, useRef, useState } from "react"

import { type CanvasActions, isField } from "@/components/editor/editor-block"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { rowOf, setBlockRule } from "@/types/template-structure"
import type { TemplateBlock } from "@/types/template"

/**
 * The right-click menu over blocks while they can be selected: what the
 * toolbar does, from a right-click or the menu key. Loaded only for designing.
 *
 * @param props - What the canvas lends each block, and the page's blocks.
 * @returns The blocks, with their menu.
 */
export function BlockContextMenu({ actions, children }: { actions: CanvasActions; children: ReactNode }): ReactElement {
  const [blockId, setBlockId] = useState<string | null>(null)
  const target = useRef<string | null>(null)
  const pointer = useRef("")
  const block = actions.controller.content.blocks.find((candidate) => candidate.id === blockId)

  return (
    <ContextMenu
      onOpenChange={(open, details) => {
        const chosen = actions.controller.content.blocks.find((candidate) => candidate.id === target.current)
        const canSelect = chosen && (actions.textEditable || (actions.designable && isField(chosen)))

        // A press and hold on a touch screen picks the block up; its toolbar has the same actions.
        if (open && (!canSelect || pointer.current === "touch")) {
          details.cancel()
        }
      }}
    >
      <ContextMenuTrigger
        className="contents"
        onContextMenuCapture={(event) => {
          target.current = (event.target as Element).closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? null
          setBlockId(target.current)
        }}
        onKeyDownCapture={() => {
          pointer.current = "keyboard"
        }}
        onPointerDownCapture={(event) => {
          pointer.current = event.pointerType
        }}
      >
        {children}
      </ContextMenuTrigger>
      {block ? <BlockMenu actions={actions} block={block} /> : null}
    </ContextMenu>
  )
}

// What the block's toolbar does, from a right-click or the menu key.
function BlockMenu({ actions, block }: { actions: CanvasActions; block: TemplateBlock }): ReactElement {
  const { controller } = actions
  const content = controller.content
  const rule = content.blockRules.find((candidate) => candidate.blockId === block.id)
  const inRow = (rowOf(content, block.id)?.columns ?? 1) > 1
  // A picture placed on a page has no place in the order.
  const pinned = block.type === "image" && block.placement !== undefined

  return (
    <DropdownMenuContent className="w-52">
      {inRow ? (
        <DropdownMenuItem onClick={() => controller.standAlone(block.id)}>
          <Rows2 aria-hidden="true" />
          Stand alone
        </DropdownMenuItem>
      ) : null}
      {pinned ? null : (
        <>
          <DropdownMenuCheckboxItem
            checked={rule?.keepWithNext ?? false}
            disabled={content.blocks.at(-1)?.id === block.id}
            onCheckedChange={(on) => controller.setKeepWithNext(block.id, on)}
          >
            <Link2 aria-hidden="true" />
            Keep with next
          </DropdownMenuCheckboxItem>
          {rule?.frame || rule?.spaceAbove ? (
            <DropdownMenuItem onClick={() => controller.change((current) => setBlockRule(current, block.id, { frame: undefined, spaceAbove: 0 }))}>
              <Undo2 aria-hidden="true" />
              Reset position
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={() => controller.duplicate(block.id)}>
        <Copy aria-hidden="true" />
        Duplicate
      </DropdownMenuItem>
      {pinned ? null : (
        <>
          <DropdownMenuItem disabled={!controller.canMove(block.id, "up")} onClick={() => controller.move(block.id, "up")}>
            <ArrowUp aria-hidden="true" />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!controller.canMove(block.id, "down")} onClick={() => controller.move(block.id, "down")}>
            <ArrowDown aria-hidden="true" />
            Move down
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => controller.remove(block.id)} variant="destructive">
        <Trash2 aria-hidden="true" />
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
