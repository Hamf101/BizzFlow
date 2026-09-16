"use client"

import { Plus, Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react"
import { useFormStatus } from "react-dom"

import {
  completeDocumentUploadRequest,
  readApiErrorMessage,
  uploadFileToSignedUrl,
} from "@/components/documents/document-upload-client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { bizflowToast } from "@/components/ui/toaster"
import { trackEvent } from "@/lib/analytics"
import type { CreateDocumentUploadUrlResponse } from "@/types/document"

/** A published template a new document can copy. */
export type DocumentTemplateChoice = { id: string; title: string }

const TITLE_MAX_LENGTH = 180
const TILE =
  "group grid cursor-pointer justify-items-center gap-2.5 rounded-[12px] px-2.5 py-3 outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/35 focus-visible:ring-2 focus-visible:ring-ring/35"

/**
 * The two ways to add a document: upload a file, which asks for its title once
 * the file is chosen, or create one, blank or from a template.
 *
 * @param props - Where the document goes, the templates on offer, and the
 *   server action that creates a document.
 * @returns Two page tiles and the dialog each one opens.
 */
export function AddDocument({
  createAction,
  folderId,
  organizationId,
  templates,
}: {
  createAction: (formData: FormData) => Promise<void>
  folderId: string | null
  organizationId: string
  templates: DocumentTemplateChoice[]
}): ReactElement {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [creating, setCreating] = useState(false)

  function chooseFile(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null)
    // Choosing the same file again after a cancel still opens the dialog.
    event.target.value = ""
  }

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!file) {
      return
    }

    setUploading(true)

    try {
      const title = String(new FormData(event.currentTarget).get("title") ?? "").trim()
      const response = await fetch("/api/documents/upload-url", {
        body: JSON.stringify({
          byteSize: file.size,
          contentType: file.type,
          description: null,
          folderId,
          organizationId,
          originalFilename: file.name,
          title,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Unable to prepare upload."))
      }

      const uploadMetadata = (await response.json()) as CreateDocumentUploadUrlResponse

      await uploadFileToSignedUrl(
        uploadMetadata.uploadUrl,
        file,
        "Unable to upload file to storage."
      )
      await completeDocumentUploadRequest(
        uploadMetadata,
        organizationId,
        "Unable to complete upload."
      )
      trackEvent("document_uploaded")
      router.push(`/documents/${uploadMetadata.documentId}`)
      router.refresh()
    } catch (error: unknown) {
      bizflowToast.error(
        error instanceof Error ? error.message : "Unable to upload document."
      )
      setUploading(false)
    }
  }

  return (
    <>
      <div className="flex justify-center gap-4 sm:gap-8">
        <label className={TILE}>
          <input
            accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"
            className="sr-only"
            onChange={chooseFile}
            type="file"
          />
          <PageTile icon={<Upload />} label="Upload" />
        </label>
        <button className={TILE} onClick={() => setCreating(true)} type="button">
          <PageTile icon={<Plus />} label="Create" />
        </button>
      </div>

      <Dialog
        onOpenChange={(open: boolean) => {
          if (!open && !uploading) {
            setFile(null)
          }
        }}
        open={file !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
            <DialogDescription className="truncate">{file?.name}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-5" onSubmit={upload}>
            <Field>
              <FieldLabel htmlFor="upload-title">Title</FieldLabel>
              <Input
                autoFocus
                // The file's own name, without its extension, is the first guess.
                defaultValue={file?.name.replace(/\.[^.]+$/, "").slice(0, TITLE_MAX_LENGTH)}
                id="upload-title"
                maxLength={TITLE_MAX_LENGTH}
                name="title"
                required
              />
            </Field>
            <DialogFooter>
              <Button disabled={uploading} type="submit">
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setCreating} open={creating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create document</DialogTitle>
          </DialogHeader>
          <form action={createAction} className="grid gap-5">
            <input name="folderId" type="hidden" value={folderId ?? ""} />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="create-title">Title</FieldLabel>
                <Input
                  autoFocus
                  id="create-title"
                  maxLength={TITLE_MAX_LENGTH}
                  name="title"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="create-template">Template</FieldLabel>
                <Select defaultValue="" id="create-template" name="templateId">
                  <option value="">Blank</option>
                  {templates.map((template: DocumentTemplateChoice) => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <CreateButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PageTile({ icon, label }: { icon: ReactNode; label: string }): ReactElement {
  return (
    <>
      <span
        aria-hidden="true"
        className="grid w-[120px] place-items-center rounded-[8px] border border-dashed border-muted-foreground/40 text-primary transition-colors group-hover:border-primary/60 sm:w-[150px] [&_svg]:size-6"
        style={{ aspectRatio: "595 / 842" }}
      >
        {icon}
      </span>
      <span className="text-sm text-foreground">{label}</span>
    </>
  )
}

function CreateButton(): ReactElement {
  const { pending } = useFormStatus()

  return (
    <Button disabled={pending} type="submit">
      {pending ? "Creating…" : "Create"}
    </Button>
  )
}
