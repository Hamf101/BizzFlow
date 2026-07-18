"use client"

import { Archive, Plus, Save, Send } from "lucide-react"
import Image from "next/image"
import {
  type ChangeEvent,
  type ReactElement,
  useReducer,
  useState,
} from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TemplateStatusBadge } from "@/lib/page-status-badges"
import { cn } from "@/lib/utils"
import type {
  DocumentTemplate,
  TemplateBlock,
  TemplateBranding,
} from "@/types/template"

import { TemplateAiSuggestions } from "./template-ai-suggestions"
import { TemplateBlockEditor } from "./template-block-editor"
import {
  createTemplateBlock,
  templateEditorReducer,
  type TemplateEditorState,
  type TemplateSectionKey,
} from "./template-editor-state"
import { readTemplateImage } from "./template-image"
import { TemplatePreview } from "./template-preview"

const BLOCK_OPTIONS: ReadonlyArray<{
  type: TemplateBlock["type"]
  label: string
}> = [
  { type: "heading", label: "Heading" },
  { type: "paragraph", label: "Paragraph" },
  { type: "bullet_list", label: "Bullet list" },
  { type: "numbered_list", label: "Numbered list" },
  { type: "image", label: "Image or logo" },
  { type: "table", label: "Table" },
  { type: "divider", label: "Divider" },
  { type: "text_field", label: "Text field" },
  { type: "date_field", label: "Date field" },
  { type: "checkbox_field", label: "Checkbox" },
  { type: "dropdown_field", label: "Dropdown" },
  { type: "initials_field", label: "Initials field" },
  { type: "signature_field", label: "Signature field" },
  { type: "file_field", label: "File upload" },
]

const SELECT_CLASS_NAME =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

type TemplateEditorProps = {
  archiveAction: (formData: FormData) => Promise<void>
  publishAction: (formData: FormData) => Promise<void>
  saveAction: (formData: FormData) => Promise<void>
  template: DocumentTemplate
}

/**
 * Provides the guided three-region template editor and live print preview.
 *
 * @param props - Persisted template and authenticated server actions.
 * @returns A reducer-driven editor form with explicit publish and archive controls.
 */
export function TemplateEditor({
  archiveAction,
  publishAction,
  saveAction,
  template,
}: TemplateEditorProps): ReactElement {
  const [state, dispatch] = useReducer(templateEditorReducer, {
    title: template.title,
    description: template.description ?? "",
    content: template.content,
  })

  return (
    <form action={saveAction} className="flex flex-col gap-6">
      <input name="templateId" type="hidden" value={template.id} />
      <input name="expectedRevision" type="hidden" value={template.revision} />
      <input name="content" type="hidden" value={JSON.stringify(state.content)} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              Edit template
            </h1>
            <TemplateStatusBadge status={template.status} />
            <Badge variant="outline">Revision {template.revision}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Build a vertical document with reusable content and fillable fields.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {template.status !== "archived" && (
            <Button type="submit" variant="outline">
              <Save />
              {template.status === "draft" ? "Save draft" : "Save changes"}
            </Button>
          )}
          {template.status === "draft" && (
            <Button formAction={publishAction} type="submit">
              <Send />
              Save &amp; publish
            </Button>
          )}
          {template.status !== "archived" && (
            <Button
              formAction={archiveAction}
              type="submit"
              variant="destructive"
            >
              <Archive />
              Archive
            </Button>
          )}
        </div>
      </div>

      {template.status === "archived" && (
        <Alert>
          <AlertTitle>This template is archived</AlertTitle>
          <AlertDescription>
            Archived templates remain available for reference but cannot be edited.
          </AlertDescription>
        </Alert>
      )}

      {template.status === "published" && (
        <Alert>
          <AlertTitle>Changes are organization-wide</AlertTitle>
          <AlertDescription>
            Saving updates the published template for everyone in this
            organization. Documents already created from an earlier revision keep
            their original snapshot.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <TemplateDetailsCard
            description={state.description}
            disabled={template.status === "archived"}
            onDescriptionChange={(value: string): void =>
              dispatch({ type: "set_description", value })
            }
            onTitleChange={(value: string): void =>
              dispatch({ type: "set_title", value })
            }
            title={state.title}
          />

          <BrandingCard
            branding={state.content.branding}
            disabled={template.status === "archived"}
            onChange={(value: TemplateBranding): void =>
              dispatch({ type: "set_branding", value })
            }
          />

          {(["header", "body", "footer"] as const).map(
            (section: TemplateSectionKey) => (
              <RegionEditor
                blocks={state.content.sections[section].blocks}
                disabled={template.status === "archived"}
                draft={state}
                key={section}
                onAdd={(block: TemplateBlock): void =>
                  dispatch({ type: "add_block", section, block })
                }
                onDelete={(blockId: string): void =>
                  dispatch({ type: "delete_block", section, blockId })
                }
                onMove={(
                  blockId: string,
                  direction: "up" | "down"
                ): void =>
                  dispatch({ type: "move_block", section, blockId, direction })
                }
                onRepeatChange={
                  section === "body"
                    ? undefined
                    : (value: boolean): void =>
                        dispatch({ type: "set_repeat", section, value })
                }
                onUpdate={(block: TemplateBlock): void =>
                  dispatch({ type: "update_block", section, block })
                }
                repeat={
                  section === "body" ? undefined : state.content.repeat[section]
                }
                section={section}
              />
            )
          )}
        </div>

        <Card className="min-w-0 xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>
              A print-oriented view of the current unsaved draft.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-auto bg-muted/30 p-4 sm:p-6">
            <TemplatePreview content={state.content} />
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Preview only; fields become interactive in their supported workflow.
            </span>
            {template.status !== "archived" && (
              <Button type="submit">
                <Save />
                Save
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </form>
  )
}

function TemplateDetailsCard({
  description,
  disabled,
  onDescriptionChange,
  onTitleChange,
  title,
}: {
  description: string
  disabled: boolean
  onDescriptionChange: (value: string) => void
  onTitleChange: (value: string) => void
  title: string
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Template details</CardTitle>
        <CardDescription>
          Name this template so organization members can find it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field>
          <FieldLabel htmlFor="template-title">Title</FieldLabel>
          <Input
            disabled={disabled}
            id="template-title"
            maxLength={180}
            name="title"
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onTitleChange(event.target.value)
            }
            required
            value={title}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="template-description">Description</FieldLabel>
          <textarea
            className={cn(
              "min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
            )}
            disabled={disabled}
            id="template-description"
            maxLength={2_000}
            name="description"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              onDescriptionChange(event.target.value)
            }
            value={description}
          />
        </Field>
      </CardContent>
      <CardFooter>
        <span className="text-xs text-muted-foreground">
          Title and description appear in the template library.
        </span>
      </CardFooter>
    </Card>
  )
}

function BrandingCard({
  branding,
  disabled,
  onChange,
}: {
  branding: TemplateBranding
  disabled: boolean
  onChange: (branding: TemplateBranding) => void
}): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleLogoChange(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setErrorMessage(null)

    try {
      const logoDataUrl = await readTemplateImage(file)
      onChange({ ...branding, logoDataUrl })
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Unable to read logo."

      console.warn("template_branding_logo_read_failed", {
        fileName: file.name,
        reason,
      })
      setErrorMessage(reason)
    } finally {
      event.target.value = ""
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Apply organization identity to this template snapshot.
        </CardDescription>
        {branding.logoDataUrl && (
          <CardAction>
            <Image
              alt="Current organization logo"
              className="max-h-10 w-auto max-w-28 object-contain"
              height={40}
              src={branding.logoDataUrl}
              unoptimized
              width={112}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="branding-organization-name">
            Organization name
          </FieldLabel>
          <Input
            disabled={disabled}
            id="branding-organization-name"
            maxLength={160}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange({ ...branding, organizationName: event.target.value })
            }
            value={branding.organizationName}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="branding-primary-color">Primary color</FieldLabel>
          <Input
            disabled={disabled}
            id="branding-primary-color"
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange({ ...branding, primaryColor: event.target.value })
            }
            type="color"
            value={branding.primaryColor}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="branding-accent-color">Accent color</FieldLabel>
          <Input
            disabled={disabled}
            id="branding-accent-color"
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange({ ...branding, accentColor: event.target.value })
            }
            type="color"
            value={branding.accentColor}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="branding-logo">PNG or JPEG logo</FieldLabel>
          <Input
            accept="image/png,image/jpeg"
            aria-describedby={errorMessage ? "branding-logo-error" : undefined}
            disabled={disabled}
            id="branding-logo"
            onChange={handleLogoChange}
            type="file"
          />
          {errorMessage && (
            <p className="text-sm text-destructive" id="branding-logo-error">
              {errorMessage}
            </p>
          )}
        </Field>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          PNG and JPEG only. Images are validated before insertion.
        </span>
        {branding.logoDataUrl && !disabled && (
          <Button
            onClick={(): void => onChange({ ...branding, logoDataUrl: null })}
            size="sm"
            type="button"
            variant="ghost"
          >
            Remove logo
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function RegionEditor({
  blocks,
  disabled,
  draft,
  onAdd,
  onDelete,
  onMove,
  onRepeatChange,
  onUpdate,
  repeat,
  section,
}: {
  blocks: TemplateBlock[]
  disabled: boolean
  draft: TemplateEditorState
  onAdd: (block: TemplateBlock) => void
  onDelete: (blockId: string) => void
  onMove: (blockId: string, direction: "up" | "down") => void
  onRepeatChange?: (value: boolean) => void
  onUpdate: (block: TemplateBlock) => void
  repeat?: boolean
  section: TemplateSectionKey
}): ReactElement {
  const label = `${section.charAt(0).toUpperCase()}${section.slice(1)}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          {getSectionDescription(section)}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {onRepeatChange && (
          <label
            className="flex w-fit items-center gap-2 text-sm"
            htmlFor={`repeat-${section}`}
          >
            <input
              checked={repeat ?? false}
              className="size-4 accent-primary"
              disabled={disabled}
              id={`repeat-${section}`}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                onRepeatChange(event.target.checked)
              }
              type="checkbox"
            />
            Repeat {section} on every printed page
          </label>
        )}

        {blocks.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="text-sm font-medium">No {section} blocks</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add the first block using the controls below.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {blocks.map((block: TemplateBlock, index: number) => (
              <TemplateBlockEditor
                block={block}
                canMoveDown={!disabled && index < blocks.length - 1}
                canMoveUp={!disabled && index > 0}
                key={block.id}
                onChange={onUpdate}
                onDelete={(): void => onDelete(block.id)}
                onMoveDown={(): void => onMove(block.id, "down")}
                onMoveUp={(): void => onMove(block.id, "up")}
              />
            ))}
          </div>
        )}

        {!disabled && (
          <AddBlockControl onAdd={onAdd} section={section} />
        )}

        {!disabled && (
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Ask AI to propose {section} blocks
            </summary>
            <div className="pt-3">
              <TemplateAiSuggestions
                draft={draft}
                onInsert={onAdd}
                section={section}
              />
            </div>
          </details>
        )}
      </CardContent>
      <CardFooter>
        <span className="text-xs text-muted-foreground">
          Blocks render from top to bottom in this order.
        </span>
      </CardFooter>
    </Card>
  )
}

function AddBlockControl({
  onAdd,
  section,
}: {
  onAdd: (block: TemplateBlock) => void
  section: TemplateSectionKey
}): ReactElement {
  const [blockType, setBlockType] = useState<TemplateBlock["type"]>("paragraph")

  return (
    <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <Field>
        <FieldLabel htmlFor={`add-${section}-block`}>Add block</FieldLabel>
        <select
          className={SELECT_CLASS_NAME}
          id={`add-${section}-block`}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            setBlockType(event.target.value as TemplateBlock["type"])
          }
          value={blockType}
        >
          {BLOCK_OPTIONS.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Button
        onClick={(): void => onAdd(createTemplateBlock(blockType))}
        type="button"
        variant="outline"
      >
        <Plus />
        Add to {section}
      </Button>
    </div>
  )
}

function getSectionDescription(section: TemplateSectionKey): string {
  if (section === "header") {
    return "Branding and context shown before the main document content."
  }

  if (section === "footer") {
    return "Closing details, notices, and page-level information."
  }

  return "Primary document content, tables, and recipient fields."
}
