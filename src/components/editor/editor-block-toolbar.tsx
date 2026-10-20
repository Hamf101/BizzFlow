"use client"

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Asterisk,
  BringToFront,
  ChevronDown,
  Copy,
  Eye,
  Link2,
  Rows2,
  Section,
  Settings2,
  Trash2,
  WrapText,
} from "lucide-react"
import { type ReactElement, type ReactNode } from "react"

import { INSERT_CHOICES } from "@/components/editor/block-catalog"
import { type CanvasActions, type ImageBlock, isField } from "@/components/editor/editor-block"
import { canStartSection, convertTextBlock, isLine, isList, type LineBlock, type ListBlock, type TextBlockKind } from "@/components/editor/editor-content"
import { FieldGroupSettings } from "@/components/editor/field-group-settings"
import { placeImage, placementOf } from "@/components/editor/image-placement"
import { BlockFields } from "@/components/editor/block-fields"
import { VisibilityRuleFields } from "@/components/editor/visibility-rule-fields"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { rowOf } from "@/types/template-structure"
import type { TemplateBlock } from "@/types/template"

/**
 * The tools over the block selected while designing: what it is, how it sits,
 * its settings, and moving, copying or deleting it. Loaded only when a block
 * is first selected.
 *
 * @param props - The selected block, and what the canvas lends it.
 * @returns The toolbar.
 */
export function BlockToolbar({ actions, block }: { actions: CanvasActions; block: TemplateBlock }): ReactElement {
  const { controller } = actions
  const blocks = controller.content.blocks
  const index = blocks.findIndex((candidate) => candidate.id === block.id)

  const group = rowOf(controller.content, block.id)
  const inRow = group !== undefined && group.columns > 1
  const keepWithNext = controller.content.blockRules.some((rule) => rule.blockId === block.id && rule.keepWithNext)

  // A picture let out of the text stays exactly where it was on its page.
  function placeFreely(image: ImageBlock): void {
    const picture = document.querySelector(`[data-block-id="${CSS.escape(image.id)}"] [data-image-box]`)
    const placement = (picture ? placementOf(picture) : null) ?? placeImage({ height: 25, page: 1, width: 40, x: 10, y: 10 })

    controller.updateBlock({ ...image, placement })
  }

  function turnInto(kind: TextBlockKind): void {
    const isList = kind.type === "bullet_list" || kind.type === "numbered_list"

    controller.change((current) => convertTextBlock(current, block.id, kind).content)
    controller.requestFocus({ blockId: block.id, item: isList ? 0 : undefined, offset: 0 })
  }

  return (
    <div
      className={cn(
        "absolute bottom-full z-30 mb-[0.8em] flex w-max max-w-[calc(100vw-3rem)] flex-wrap items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg",
        // Rows stack on a phone, so every block there is the column's full width.
        "right-0 justify-end"
      )}
      data-slot="block-toolbar"
      role="toolbar"
      aria-label="Block"
    >
      {isLine(block) || isList(block) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button className="h-10 gap-1 px-2 font-normal md:pointer-fine:h-8" size="sm" type="button" variant="ghost">
                {describeLine(block)}
                <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
            {isLine(block) ? <DropdownMenuItem disabled={!canStartSection(controller.content, block)} onClick={() => controller.turnIntoSection(block.id)}><Section />Section</DropdownMenuItem> : null}
            {INSERT_CHOICES.filter((choice) => choice.action.kind === "text").map((choice) => {
              const Icon = choice.icon

              return (
                <DropdownMenuItem
                  key={choice.id}
                  onClick={() => choice.action.kind === "text" && turnInto(choice.action.value)}
                >
                  <Icon aria-hidden="true" />
                  {choice.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {isLine(block) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button aria-label="Align" className="size-10 md:pointer-fine:size-8" size="icon-sm" title="Align" type="button" variant="ghost">
                {block.alignment === "center" ? <AlignCenter /> : block.alignment === "right" ? <AlignRight /> : <AlignLeft />}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-36">
            {(["left", "center", "right"] as const).map((alignment) => (
              <DropdownMenuItem
                key={alignment}
                onClick={() => controller.updateBlock({ ...block, alignment })}
              >
                {alignment === "center" ? <AlignCenter /> : alignment === "right" ? <AlignRight /> : <AlignLeft />}
                {alignment[0]?.toUpperCase() + alignment.slice(1)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {inRow ? (
        <ToolButton label="Stand alone" onClick={() => controller.standAlone(block.id)}><Rows2 /></ToolButton>
      ) : null}
      {!(block.type === "image" && block.placement) ? (
        <ToolButton disabled={index === blocks.length - 1} label="Keep with next" onClick={() => controller.setKeepWithNext(block.id, !keepWithNext)} pressed={keepWithNext}><Link2 /></ToolButton>
      ) : null}
      {isField(block) ? (
        <ToolButton
          label={block.required ? "Make optional" : "Make required"}
          onClick={() => controller.updateBlock({ ...block, required: !block.required })}
          pressed={block.required}
        >
          <Asterisk />
        </ToolButton>
      ) : null}
      {isField(block) ? (
        <Popover
          onOpenChange={(open) => (open ? controller.openSettings(block.id) : controller.closeSettings())}
          open={controller.settingsBlockId === block.id}
        >
          <PopoverTrigger
            render={
              <Button aria-label="Field settings" className="size-10 md:pointer-fine:size-8" size="icon-sm" title="Field settings" type="button" variant="ghost">
                <Settings2 />
              </Button>
            }
          />
          <PopoverContent className="w-80">
            <PopoverTitle className="mb-3 font-semibold">Field settings</PopoverTitle>
            <BlockFields block={block} blocks={blocks} onChange={(next) => controller.updateBlock(next, `settings:${block.id}`)} />
            {group ? <FieldGroupSettings controller={controller} group={group} /> : null}
          </PopoverContent>
        </Popover>
      ) : null}
      {/* Words, a list, a table or a picture in the text can show by an answer, as a field can. */}
      {!isField(block) && block.type !== "divider" && !(block.type === "image" && block.placement) ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                aria-label="Show when"
                className={cn("size-10 md:pointer-fine:size-8", "visibleWhen" in block && block.visibleWhen && "text-primary")}
                size="icon-sm"
                title="Show when"
                type="button"
                variant="ghost"
              >
                <Eye />
              </Button>
            }
          />
          <PopoverContent className="w-80">
            <PopoverTitle className="sr-only">Show when</PopoverTitle>
            <VisibilityRuleFields
              block={block}
              blocks={blocks}
              className="border-t-0 pt-0"
              onChange={(next) => controller.updateBlock(next, `rule:${block.id}`)}
            />
          </PopoverContent>
        </Popover>
      ) : null}
      {block.type === "image" ? (
        <>
          {/* A phone's column has no pages to place a picture on, only a way back into the text. */}
          {block.placement || !actions.narrow ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button className="h-10 gap-1 px-2 font-normal md:pointer-fine:h-8" size="sm" type="button" variant="ghost">
                    {block.placement ? "In front of text" : "In line"}
                    <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => controller.updateBlock({ ...block, placement: undefined })}>
                  <WrapText aria-hidden="true" />
                  In line
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => !block.placement && placeFreely(block)}>
                  <BringToFront aria-hidden="true" />
                  In front of text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <ToolButton label="Settings" onClick={() => controller.openSettings(block.id)}>
            <Settings2 />
          </ToolButton>
        </>
      ) : null}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
      <ToolButton label="Duplicate" onClick={() => controller.duplicate(block.id)}>
        <Copy />
      </ToolButton>
      {/* A picture placed on a page has no place in the order to move to. */}
      {block.type === "image" && block.placement ? null : (
        <>
          <ToolButton
            disabled={!controller.canMove(block.id, "up")}
            keys="Control+Shift+ArrowUp Meta+Shift+ArrowUp"
            label="Move up"
            onClick={() => controller.move(block.id, "up")}
          >
            <ArrowUp />
          </ToolButton>
          <ToolButton
            disabled={!controller.canMove(block.id, "down")}
            keys="Control+Shift+ArrowDown Meta+Shift+ArrowDown"
            label="Move down"
            onClick={() => controller.move(block.id, "down")}
          >
            <ArrowDown />
          </ToolButton>
        </>
      )}
      <ToolButton label="Delete" onClick={() => controller.remove(block.id)}>
        <Trash2 />
      </ToolButton>
    </div>
  )
}

function ToolButton({
  children,
  disabled,
  keys,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode
  disabled?: boolean
  /** The keys that do the same, for screen readers. */
  keys?: string
  label: string
  onClick: () => void
  pressed?: boolean
}): ReactElement {
  return (
    <Button
      aria-keyshortcuts={keys}
      aria-label={label}
      aria-pressed={pressed}
      className={cn("size-10 md:pointer-fine:size-8", pressed && "bg-secondary text-secondary-foreground")}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}

function describeLine(block: LineBlock | ListBlock): string {
  switch (block.type) {
    case "heading":
      return `Heading ${block.level}`
    case "paragraph":
      return "Text"
    case "bullet_list":
      return "Bulleted list"
    case "numbered_list":
      return "Numbered list"
  }
}
