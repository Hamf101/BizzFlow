"use client"

import { Plus, Sparkles } from "lucide-react"
import {
  type ChangeEvent,
  type ReactElement,
  useMemo,
  useState,
} from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import {
  templateBlockSchema,
  type TemplateBlock,
  type TemplateContent,
} from "@/types/template"

import type {
  TemplateEditorState,
  TemplateSectionKey,
} from "./template-editor-state"
import { TemplatePreview } from "./template-preview"

const REQUEST_TIMEOUT_MS = 30_000
const OMITTED_IMAGE_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

type TemplateAiSuggestionsProps = {
  draft: TemplateEditorState
  onInsert: (block: TemplateBlock) => void
  section: TemplateSectionKey
}

/**
 * Requests schema-valid AI block proposals and requires an explicit insert click.
 *
 * @param props - Current draft, target section, and confirmed insertion callback.
 * @returns A proposal panel that never mutates the draft automatically.
 */
export function TemplateAiSuggestions({
  draft,
  onInsert,
  section,
}: TemplateAiSuggestionsProps): ReactElement {
  const [instruction, setInstruction] = useState<string>("")
  const [proposals, setProposals] = useState<TemplateBlock[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const previewContent = useMemo(
    (): TemplateContent => createProposalPreview(draft.content, section, proposals),
    [draft.content, proposals, section]
  )

  async function requestSuggestions(): Promise<void> {
    const trimmedInstruction = instruction.trim()

    if (!trimmedInstruction) {
      setErrorMessage("Describe the blocks you want the assistant to propose.")
      return
    }

    setErrorMessage(null)
    setProposals([])
    setIsLoading(true)

    const controller = new AbortController()
    const timeoutId = window.setTimeout((): void => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    const startedAt = performance.now()

    try {
      const response = await fetch("/api/templates/suggest-blocks", {
        body: JSON.stringify({
          draft: {
            title: draft.title,
            description: draft.description.trim() || null,
            content: createAiRequestContent(draft.content),
          },
          section,
          instruction: trimmedInstruction,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      })
      const payload = await readJsonResponse(response)

      if (!response.ok) {
        throw new Error(readApiError(payload))
      }

      const nextProposals = parseProposals(payload)
      setProposals(nextProposals)
      console.info("template_ai_suggestions_loaded", {
        durationMs: Math.round(performance.now() - startedAt),
        proposalCount: nextProposals.length,
        section,
      })
    } catch (error: unknown) {
      const reason =
        error instanceof DOMException && error.name === "AbortError"
          ? "The suggestion request timed out. Try a shorter instruction."
          : error instanceof Error
            ? error.message
            : "Unable to load suggestions."

      console.warn("template_ai_suggestions_failed", {
        durationMs: Math.round(performance.now() - startedAt),
        reason,
        section,
      })
      setErrorMessage(reason)
    } finally {
      window.clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  function insertProposal(proposal: TemplateBlock): void {
    // Generate a fresh block id so repeated proposals cannot collide in the draft.
    onInsert({ ...proposal, id: crypto.randomUUID() } as TemplateBlock)
    setProposals((currentProposals: TemplateBlock[]) =>
      currentProposals.filter((block: TemplateBlock) => block.id !== proposal.id)
    )
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          AI block proposals
        </CardTitle>
        <CardDescription>
          Ask for new {section} blocks. Nothing is inserted until you choose it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor={`ai-instruction-${section}`}>Instruction</FieldLabel>
          <textarea
            className={cn(
              "min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            )}
            id={`ai-instruction-${section}`}
            maxLength={1_200}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setInstruction(event.target.value)
            }
            placeholder="For example: Add a concise customer contact section with name, email, and preferred date."
            value={instruction}
          />
        </Field>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Suggestions unavailable</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {proposals.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-muted/30 p-3">
              <TemplatePreview className="min-h-[24rem] shadow-none" content={previewContent} />
            </div>
            <ul className="flex flex-col gap-2" aria-label="Proposed blocks">
              {proposals.map((proposal: TemplateBlock) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
                  key={proposal.id}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium">
                      {formatBlockType(proposal.type)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {summarizeBlock(proposal)}
                    </span>
                  </div>
                  <Button
                    onClick={(): void => insertProposal(proposal)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus />
                    Insert this block
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          Proposals are validated before display.
        </span>
        <Button
          disabled={isLoading}
          onClick={requestSuggestions}
          type="button"
          variant="secondary"
        >
          <Sparkles />
          {isLoading ? "Proposing…" : "Propose blocks"}
        </Button>
      </CardFooter>
    </Card>
  )
}

function createAiRequestContent(content: TemplateContent): TemplateContent {
  return {
    ...content,
    branding: {
      ...content.branding,
      logoDataUrl: content.branding.logoDataUrl
        ? OMITTED_IMAGE_PLACEHOLDER
        : null,
    },
    sections: {
      header: { blocks: omitEmbeddedImageBytes(content.sections.header.blocks) },
      body: { blocks: omitEmbeddedImageBytes(content.sections.body.blocks) },
      footer: { blocks: omitEmbeddedImageBytes(content.sections.footer.blocks) },
    },
  }
}

function omitEmbeddedImageBytes(blocks: TemplateBlock[]): TemplateBlock[] {
  return blocks.map((block: TemplateBlock): TemplateBlock =>
    block.type === "image"
      ? { ...block, dataUrl: OMITTED_IMAGE_PLACEHOLDER }
      : block
  )
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error("The suggestion service returned an unreadable response.")
  }
}

function readApiError(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error
  }

  return "Unable to load block proposals."
}

function parseProposals(payload: unknown): TemplateBlock[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("proposals" in payload) ||
    !Array.isArray(payload.proposals)
  ) {
    throw new Error("The suggestion service returned an invalid response.")
  }

  const proposals = payload.proposals.map((proposal: unknown) =>
    templateBlockSchema.safeParse(proposal)
  )
  const invalidProposal = proposals.find((proposal) => !proposal.success)

  if (invalidProposal) {
    throw new Error("A proposed block did not match the template schema.")
  }

  return proposals.map((proposal) => {
    if (!proposal.success) {
      throw new Error("A proposed block did not match the template schema.")
    }

    return proposal.data
  })
}

function createProposalPreview(
  currentContent: TemplateContent,
  section: TemplateSectionKey,
  proposals: TemplateBlock[]
): TemplateContent {
  return {
    ...currentContent,
    repeat: { header: false, footer: false },
    sections: {
      header: { blocks: section === "header" ? proposals : [] },
      body: { blocks: section === "body" ? proposals : [] },
      footer: { blocks: section === "footer" ? proposals : [] },
    },
  }
}

function formatBlockType(type: TemplateBlock["type"]): string {
  return type
    .split("_")
    .map((part: string) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function summarizeBlock(block: TemplateBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.text || "Empty text"
    case "bullet_list":
    case "numbered_list":
      return block.items.join(" · ")
    case "image":
      return block.altText
    case "table":
      return block.headers.join(" · ")
    case "divider":
      return "Full-width rule"
    case "text_field":
    case "date_field":
    case "checkbox_field":
    case "dropdown_field":
    case "initials_field":
    case "signature_field":
      return block.label
  }
}
