"use client"

import { LayoutTemplate, Plus, Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react"

import { createGeneratedDocumentAction } from "@/app/(dashboard)/documents/actions"
import { UPLOAD_ACCEPT, uploadDocumentFile } from "@/components/documents/document-upload-client"
import { OneClickForm } from "@/components/ui/one-click-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { bizflowToast } from "@/components/ui/toaster"
import { trackEvent } from "@/lib/analytics"

/** A published template a new document can copy. */
export type DocumentTemplateChoice = { id: string; title: string }

const TITLE_MAX_LENGTH = 180
const TILE =
  "group grid cursor-pointer justify-items-center gap-2.5 rounded-lg px-2.5 py-3 outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/35 focus-visible:ring-2 focus-visible:ring-ring/35"

/**
 * The ways to add a document, each one page tile: upload a file, which asks
 * for its title once the file is chosen, or start one in a single click, blank
 * or from a published template.
 *
 * @param props - Where the document goes and the templates on offer.
 * @returns The page tiles and the upload dialog.
 */
export function AddDocument({
  folderId,
  organizationId,
  templates,
}: {
  folderId: string | null
  organizationId: string
  templates: DocumentTemplateChoice[]
}): ReactElement {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

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
      const uploadMetadata = await uploadDocumentFile({ file, folderId, organizationId, title })
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
      <div className="flex flex-wrap justify-center gap-4 sm:gap-8">
        <label className={TILE}>
          <input
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            onChange={chooseFile}
            type="file"
          />
          <PageTile icon={<Upload />} label="Upload" />
        </label>
        <OneClickForm action={createGeneratedDocumentAction} className={TILE} fields={{ folderId }}>
          <PageTile icon={<Plus />} label="Blank document" />
        </OneClickForm>
        {templates.map((template: DocumentTemplateChoice) => (
          <OneClickForm
            action={createGeneratedDocumentAction}
            className={TILE}
            fields={{ folderId, templateId: template.id }}
            key={template.id}
          >
            <PageTile icon={<LayoutTemplate />} label={template.title} />
          </OneClickForm>
        ))}
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

    </>
  )
}

function PageTile({ icon, label }: { icon: ReactNode; label: string }): ReactElement {
  return (
    <>
      <span
        aria-hidden="true"
        className="grid w-[120px] place-items-center rounded-md border border-dashed border-muted-foreground/40 text-primary transition-colors group-hover:border-primary/60 sm:w-[150px] [&_svg]:size-6"
        style={{ aspectRatio: "595 / 842" }}
      >
        {icon}
      </span>
      <span className="text-sm text-foreground">{label}</span>
    </>
  )
}
