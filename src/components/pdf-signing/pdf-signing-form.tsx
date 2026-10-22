"use client"

import { Check, Paperclip } from "lucide-react"
import dynamic from "next/dynamic"
import { type ReactElement, useActionState, useState } from "react"

import { completePublicPdfSigningAction } from "@/app/sign/[token]/actions"
import { DrawnSignatureField } from "@/components/documents/drawn-signature-field"
import { signerTone } from "@/components/pdf-signing/pdf-tones"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/ui/submit-button"
import { cn } from "@/lib/utils"
import type { PublicPdfSigningView } from "@/services/pdf-signing-service"
import type { PdfField } from "@/types/pdf-fields"

// pdf.js needs the browser's document, so the pages draw there only.
const PdfPages = dynamic(() => import("@/components/pdf-signing/pdf-pages").then((module) => module.PdfPages), { ssr: false })

type Value = string | boolean

// Drawn once at the end of the page, not in each box: one signature and one set of initials per signer.
const DRAWN = new Set(["signature", "initials"])

/**
 * A signer's view of an uploaded PDF: their own fields are live and in their
 * colour, everyone else's are greyed, and "Next field" walks them through what
 * is left before they draw, agree, and finish.
 *
 * @param props - The private link's token and the signer's view.
 * @returns The signing form, or the PDF as signed.
 */
export function PdfSigningForm({ token, view }: { token: string; view: PublicPdfSigningView }): ReactElement {
  const signed = view.recipient.status === "signed" || view.workflowStatus !== "awaiting_signatures"
  const mine = signed ? [] : view.fields.filter((field) => field.signerId === view.recipient.signerId)
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(mine.filter((field) => view.values[field.id] !== undefined).map((field) => [field.id, view.values[field.id] as Value]))
  )
  const [uploading, setUploading] = useState<string | null>(null)
  // The name of each file attached, and the field whose upload last failed.
  const [names, setNames] = useState<Record<string, string>>({})
  const [attachError, setAttachError] = useState<string | null>(null)
  const [state, submit] = useActionState(completePublicPdfSigningAction, null)
  const toFill = mine.filter((field) => field.required && !DRAWN.has(field.kind))
  const done = toFill.filter((field) => filled(values[field.id])).length
  const signerIndex = new Map(view.signers.map((signer, index) => [signer.id, index]))
  const set = (id: string, value: Value): void => setValues((current) => ({ ...current, [id]: value }))

  function next(): void {
    const target = toFill.find((field) => !filled(values[field.id]))
    const element = target ? document.querySelector<HTMLElement>(`[data-fill="${target.id}"]`) : document.getElementById("finish")
    element?.scrollIntoView({ behavior: "smooth", block: "center" })
    element?.focus({ preventScroll: true })
  }

  async function attach(field: PdfField, file: File): Promise<void> {
    setUploading(field.id)

    try {
      const base = `/api/sign/${encodeURIComponent(token)}/attachments`
      const json = { "Content-Type": "application/json" }
      const started = await fetch(base, {
        body: JSON.stringify({ byteSize: file.size, contentType: file.type, fieldId: field.id, filename: file.name }),
        headers: json,
        method: "POST",
      })
      if (!started.ok) throw new Error()
      const { attachmentId, uploadUrl } = (await started.json()) as { attachmentId: string; uploadUrl: string }
      const put = await fetch(uploadUrl, { body: file, headers: { "Content-Type": file.type }, method: "PUT" })
      if (!put.ok) throw new Error()
      const confirmed = await fetch(`${base}/${encodeURIComponent(attachmentId)}`, { headers: json, method: "POST" })
      if (!confirmed.ok) throw new Error()
      set(field.id, attachmentId)
      setNames((current) => ({ ...current, [field.id]: file.name }))
    } catch {
      setNames((current) => ({ ...current, [field.id]: "" }))
      setAttachError(field.id)
    } finally {
      setUploading(null)
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-6 pb-28">
      <input name="token" type="hidden" value={token} />
      <input name="values" type="hidden" value={JSON.stringify(values)} />

      <PdfPages
        file={`/api/sign/${encodeURIComponent(token)}/pdf`}
        overlay={(pageNumber) =>
          view.fields
            .filter((field) => field.page === pageNumber)
            .map((field) => {
              const own = mine.includes(field)
              const box = { height: `${field.height * 100}%`, left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%` }

              if (!own) {
                const owner = view.signers.find((signer) => signer.id === field.signerId)
                const shown = view.values[field.id]

                return (
                  <div
                    className="absolute flex items-center overflow-hidden rounded-sm border border-dashed border-border bg-muted/30 px-1 text-[11px] leading-[1.2] text-muted-foreground"
                    data-slot="pdf-field-other"
                    key={field.id}
                    style={box}
                  >
                    <span className="truncate">{typeof shown === "string" && !DRAWN.has(field.kind) ? shown : (owner?.name ?? "Another signer")}</span>
                  </div>
                )
              }

              const tone = signerTone(signerIndex.get(field.signerId) ?? 0)
              // See-through, so the line under a field still shows; small type fits a field drawn to a line's height.
              const live = "absolute min-w-0 rounded-sm border-[1.5px] border-(--tone) bg-(--tone-soft)/65 text-[11px] leading-[1.2] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-[12px]"
              const label = `${field.label ?? field.kind}${field.required ? "" : " (optional)"}`

              if (DRAWN.has(field.kind)) {
                return (
                  <button
                    className={cn(live, "flex items-center gap-1 overflow-hidden px-1.5 text-left")}
                    key={field.id}
                    onClick={() => document.getElementById("finish")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                    style={{ ...box, ...tone, borderStyle: "dashed" }}
                    type="button"
                  >
                    <span className="truncate">{field.kind === "signature" ? "Sign at the end" : "Initials at the end"}</span>
                  </button>
                )
              }

              if (field.kind === "checkbox") {
                return (
                  <input
                    aria-label={label}
                    checked={values[field.id] === true}
                    className={cn(live, "m-0 size-auto cursor-pointer accent-primary")}
                    data-fill={field.id}
                    key={field.id}
                    onChange={(event) => set(field.id, event.target.checked)}
                    style={{ ...box, ...tone }}
                    type="checkbox"
                  />
                )
              }

              if (field.kind === "attachment") {
                return (
                  <label
                    className={cn(live, "flex cursor-pointer items-center gap-1 overflow-hidden px-1.5", attachError === field.id && "border-destructive")}
                    data-fill={field.id}
                    key={field.id}
                    style={{ ...box, ...tone }}
                    tabIndex={-1}
                  >
                    {filled(values[field.id]) ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : <Paperclip aria-hidden="true" className="size-3.5 shrink-0" />}
                    <span className="truncate">
                      {uploading === field.id ? "Uploading…" : attachError === field.id ? "Didn't upload. Try again" : names[field.id] || "Attach a file"}
                    </span>
                    <input
                      aria-label={label}
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        setAttachError(null)
                        if (file) void attach(field, file)
                      }}
                      type="file"
                    />
                  </label>
                )
              }

              return (
                <input
                  aria-label={label}
                  className={cn(live, "px-1 [&::-webkit-calendar-picker-indicator]:ml-0 [&::-webkit-calendar-picker-indicator]:w-3")}
                  data-fill={field.id}
                  key={field.id}
                  maxLength={500}
                  onChange={(event) => set(field.id, event.target.value)}
                  placeholder={field.kind === "date" ? undefined : (field.label ?? "Type here")}
                  // A date control needs its own width to show the whole date; it grows past a short line rather than cut it off.
                  style={{
                    ...box,
                    ...tone,
                    // On the page's right half it grows leftwards, so it stays on the page.
                    ...(field.kind === "date"
                      ? { minWidth: box.width, width: "auto", ...(field.x > 0.5 ? { left: "auto", right: `${(1 - field.x - field.width) * 100}%` } : null) }
                      : null),
                  }}
                  type={field.kind === "date" ? "date" : "text"}
                  value={typeof values[field.id] === "string" ? (values[field.id] as string) : ""}
                />
              )
            })
        }
        pages={view.pages}
      />

      {signed ? null : (
        <section className="mx-auto flex w-full max-w-[820px] scroll-mt-24 flex-col gap-4 rounded-lg border border-border bg-card p-4 outline-none sm:p-5" id="finish" tabIndex={-1}>
          {view.recipient.requiresSignature ? <DrawnSignatureField label="Signature" name="signatureDataUrl" required /> : null}
          {view.recipient.requiresInitials ? <DrawnSignatureField label="Initials" name="initialsDataUrl" required /> : null}
          <label className="flex items-start gap-2 text-sm">
            <input className="mt-0.5 size-4 shrink-0 accent-primary" name="consent" required type="checkbox" />
            I agree to sign this document electronically, and that my electronic signature counts as my handwritten one.
          </label>
          {state?.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <SubmitButton className="self-start" disabled={uploading !== null} pendingText="Signing…">
            Finish signing
          </SubmitButton>
        </section>
      )}

      {signed ? null : (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-[820px] items-center gap-3">
            <span aria-live="polite" className="text-sm text-muted-foreground">
              {toFill.length > 0 ? `${done} of ${toFill.length} done` : "Draw, agree, and finish below"}
            </span>
            <Button className="ml-auto" onClick={next} type="button">
              {done < toFill.length ? "Next field" : "Finish"}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

function filled(value: Value | undefined): boolean {
  return value === true || (typeof value === "string" && value.trim().length > 0)
}
