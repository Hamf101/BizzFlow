"use client"

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  ImageUp,
  Trash2,
} from "lucide-react"
import Image from "next/image"
import {
  type ChangeEvent,
  type ReactElement,
  useState,
} from "react"

import { BlockFields } from "@/components/editor/block-fields"
import { IMAGE_ACCEPT, storeTemplateImage } from "@/components/templates/template-image"
import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { TemplateBlock } from "@/types/template"
import { imageSource, type PictureSource } from "@/types/template-images"
import { downloadImageOriginalAction, requestImageUploadAction } from "@/app/(editor)/image-actions"

const BLOCK_LABELS: Record<TemplateBlock["type"], string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  bullet_list: "Bullet list",
  numbered_list: "Numbered list",
  image: "Image or logo",
  table: "Table",
  divider: "Divider",
  text_field: "Text field",
  date_field: "Date field",
  checkbox_field: "Checkbox",
  dropdown_field: "Dropdown",
  choice_grid_field: "Question grid",
  table_field: "Fill-in table",
  initials_field: "Initials field",
  signature_field: "Signature field",
  file_field: "File upload",
}

type TemplateBlockEditorProps = {
  block: TemplateBlock
  blocks?: readonly TemplateBlock[]
  canMoveDown: boolean
  canMoveUp: boolean
  onChange: (block: TemplateBlock) => void
  onDelete: () => void
  onDuplicate?: () => void
  onMoveDown: () => void
  onMoveUp: () => void
  // The template or document being edited, so a picture's original can be downloaded from it.
  pictureSource?: PictureSource
}

/**
 * Renders accessible controls for one canonical template block.
 *
 * @param props - Block value and explicit update, delete, and ordering callbacks.
 * @returns A bordered editor panel for the selected block type.
 */
export function TemplateBlockEditor({
  block,
  blocks = [],
  canMoveDown,
  canMoveUp,
  onChange,
  onDelete,
  onDuplicate,
  onMoveDown,
  onMoveUp,
  pictureSource,
}: TemplateBlockEditorProps): ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">{BLOCK_LABELS[block.type]}</span>
        <div className="flex items-center gap-1">
          {onDuplicate && (
            <Button
              aria-label={`Duplicate ${BLOCK_LABELS[block.type]}`}
              onClick={onDuplicate}
              size="icon-sm"
              title="Duplicate block"
              type="button"
              variant="ghost"
            >
              <Copy />
            </Button>
          )}
          <Button
            aria-label={`Move ${BLOCK_LABELS[block.type]} up`}
            disabled={!canMoveUp}
            onClick={onMoveUp}
            size="icon-sm"
            title="Move up"
            type="button"
            variant="ghost"
          >
            <ArrowUp />
          </Button>
          <Button
            aria-label={`Move ${BLOCK_LABELS[block.type]} down`}
            disabled={!canMoveDown}
            onClick={onMoveDown}
            size="icon-sm"
            title="Move down"
            type="button"
            variant="ghost"
          >
            <ArrowDown />
          </Button>
          <Button
            aria-label={`Delete ${BLOCK_LABELS[block.type]}`}
            onClick={onDelete}
            size="icon-sm"
            title="Delete block"
            type="button"
            variant="destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {/* Keyed, so options still being written never carry over to another block. */}
      {block.type === "image" ? (
        <ImageFields block={block} key={block.id} onChange={onChange} pictureSource={pictureSource} />
      ) : (
        <BlockFields block={block} blocks={blocks} key={block.id} onChange={onChange} />
      )}
    </div>
  )
}

function ImageFields({
  block,
  onChange,
  pictureSource,
}: {
  block: Extract<TemplateBlock, { type: "image" }>
  onChange: (block: TemplateBlock) => void
  pictureSource?: PictureSource
}): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const altTextMissing = block.altText.trim().length === 0
  const source = imageSource(block.asset, block.dataUrl)

  // Asked for when pressed, so it checks the person can still see the picture.
  async function downloadOriginal(assetId: string, source: PictureSource): Promise<void> {
    const result = await downloadImageOriginalAction({ assetId, source })

    if ("url" in result) {
      window.location.assign(result.url)
    } else {
      setErrorMessage(result.error)
    }
  }

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setErrorMessage(null)
    setUploading(true)

    try {
      const asset = await storeTemplateImage(file, requestImageUploadAction)
      onChange({ ...block, asset, dataUrl: undefined })
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Unable to read image."

      console.warn("template_block_image_read_failed", {
        blockId: block.id,
        fileName: file.name,
        reason,
      })
      setErrorMessage(reason)
    } finally {
      setUploading(false)
      event.target.value = ""
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid justify-items-center gap-2 rounded-lg border bg-muted/30 p-3">
        {source ? (
          <Image
            alt={block.altText}
            className="h-auto max-h-44 w-auto max-w-full rounded object-contain"
            height={block.asset?.height ?? 320}
            src={source}
            unoptimized
            width={block.asset?.width ?? 480}
          />
        ) : null}
        <div className="flex flex-wrap justify-center gap-1">
          <label
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/35",
              uploading && "pointer-events-none opacity-60"
            )}
          >
            <ImageUp />
            {uploading ? "Uploading…" : "Replace"}
            <input
              accept={IMAGE_ACCEPT}
              disabled={uploading}
              aria-describedby={errorMessage ? `${block.id}-image-error` : undefined}
              className="sr-only"
              onChange={handleFileChange}
              type="file"
            />
          </label>
          {block.asset && pictureSource ? (
            <Button
              onClick={(): void => void downloadOriginal((block.asset as NonNullable<typeof block.asset>).id, pictureSource)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Download />
              Download original
            </Button>
          ) : null}
        </div>
        {errorMessage && (
          <p className="text-sm text-destructive" id={`${block.id}-image-error`} role="alert">
            {errorMessage}
          </p>
        )}
      </div>
      <Field>
        <FieldLabel htmlFor={`${block.id}-alt-text`}>Alternative text</FieldLabel>
        <Input
          aria-describedby={altTextMissing ? `${block.id}-alt-text-error` : undefined}
          aria-invalid={altTextMissing}
          id={`${block.id}-alt-text`}
          maxLength={500}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, altText: event.target.value })
          }
          required
          value={block.altText}
        />
        {altTextMissing ? (
          <p className="text-xs text-destructive" id={`${block.id}-alt-text-error`}>
            Describe the picture for people who cannot see it.
          </p>
        ) : null}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${block.id}-caption`}>Caption</FieldLabel>
        <Input
          id={`${block.id}-caption`}
          maxLength={500}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, caption: event.target.value || null })
          }
          value={block.caption ?? ""}
        />
      </Field>
      <AlignmentField
        id={`${block.id}-image-alignment`}
        onChange={(alignment: "left" | "center" | "right"): void =>
          onChange({ ...block, alignment })
        }
        value={block.alignment}
      />
      <Field>
        <FieldLabel htmlFor={`${block.id}-image-width`}>
          Width ({block.widthPercent}%)
        </FieldLabel>
        <input
          className="accent-primary"
          id={`${block.id}-image-width`}
          max={100}
          min={10}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, widthPercent: Number(event.target.value) })
          }
          step={5}
          type="range"
          value={block.widthPercent}
        />
      </Field>
    </div>
  )
}

function AlignmentField({
  id,
  onChange,
  value,
}: {
  id: string
  onChange: (alignment: "left" | "center" | "right") => void
  value: "left" | "center" | "right"
}): ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Alignment</FieldLabel>
      <Select
        id={id}
        onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
          onChange(event.target.value as "left" | "center" | "right")
        }
        value={value}
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </Select>
    </Field>
  )
}
