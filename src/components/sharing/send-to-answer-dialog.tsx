"use client"

import { Check, Copy, Send } from "lucide-react"
import { type FormEvent, type ReactElement, useEffect, useMemo, useState } from "react"

import {
  type AnswerRequestsResult,
  loadAnswerRequestsAction,
  resendAnswerRequestAction,
  revokeAnswerRequestAction,
  sendToAnswerAction,
} from "@/app/(dashboard)/documents/send-to-answer-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatMediumDate } from "@/lib/date-format"
import type { AnswerRequestState, AnswerRequestSummary, AnswerSource, SentAnswerRequest } from "@/services/send-to-answer-service"

const STATE: Record<AnswerRequestState, { label: string; variant: "default" | "outline" | "secondary" }> = {
  answered: { label: "Answered", variant: "default" },
  expired: { label: "Expired", variant: "outline" },
  revoked: { label: "Revoked", variant: "outline" },
  sent: { label: "Sent", variant: "secondary" },
}

/**
 * Sends a document or template to people to answer, each by their own emailed
 * link, and lists whom it went to with Resend and Revoke.
 *
 * @param props - What is sent, its name for the title, and the open state.
 * @returns The Send to answer dialog.
 */
export function SendToAnswerDialog({
  name,
  onOpenChange,
  open,
  source,
}: {
  name: string
  onOpenChange: (open: boolean) => void
  open: boolean
  source: AnswerSource
}): ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* Mounted only while open, so each opening starts fresh. */}
      <DialogContent className="max-h-[85dvh] max-w-md grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto">
        <SendBody name={name} onDone={() => onOpenChange(false)} source={source} />
      </DialogContent>
    </Dialog>
  )
}

function SendBody({ name, onDone, source }: { name: string; onDone: () => void; source: AnswerSource }): ReactElement {
  const [requests, setRequests] = useState<AnswerRequestSummary[] | null>(null)
  const [undelivered, setUndelivered] = useState<SentAnswerRequest[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [emails, setEmails] = useState("")
  const [busy, setBusy] = useState(false)
  const key = JSON.stringify(source)
  const what = useMemo(() => JSON.parse(key) as AnswerSource, [key])

  function receive(result: AnswerRequestsResult): boolean {
    if (!result.ok) {
      setMessage(result.message)
      return false
    }

    setRequests(result.requests)
    setMessage(null)
    // A link whose email could not go is shown this once, beside any shown before.
    setUndelivered((shown) => [...result.sent.filter((sent) => !sent.delivered), ...shown.filter((old) => !result.sent.some((sent) => sent.linkId === old.linkId))])
    return true
  }

  useEffect(() => {
    let current = true
    void loadAnswerRequestsAction(what)
      .then((result) => current && receive(result))
      .catch(() => current && setMessage("What was sent could not be shown. Try again."))

    return () => {
      current = false
    }
  }, [what])

  async function act(request: Promise<AnswerRequestsResult>): Promise<boolean> {
    setBusy(true)
    try {
      return receive(await request)
    } catch {
      setMessage("That could not be done. Try again.")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const list = emails.split(/[\s,;]+/).filter(Boolean)

    if (list.length === 0) {
      setMessage("Add at least one email address.")
      return
    }

    if (await act(sendToAnswerAction({ emails: list, source: what }))) {
      setEmails("")
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Send “{name}” to answer</DialogTitle>
        <DialogDescription>
          Each person gets their own link by email and needs no account. Their answers go to Submissions; the {what.kind} itself never changes.
        </DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-3" onSubmit={(event) => void send(event)}>
        <Field>
          <FieldLabel htmlFor="send-to-answer-emails">Email addresses</FieldLabel>
          <Input
            autoComplete="off"
            disabled={busy}
            id="send-to-answer-emails"
            inputMode="email"
            onChange={(event) => setEmails(event.target.value)}
            placeholder="ana@example.com, ben@example.com"
            value={emails}
          />
          <FieldDescription>Up to 10 at once. Each link takes one set of answers within 7 days.</FieldDescription>
        </Field>
        <Button className="self-end" disabled={busy} type="submit">
          <Send data-icon="inline-start" />
          {busy ? "Sending…" : "Send"}
        </Button>
      </form>
      {message ? (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      {undelivered.map((sent) => (
        <Undelivered key={sent.linkId} sent={sent} />
      ))}
      {requests === null ? (
        message ? null : <p className="text-sm text-muted-foreground">Opening…</p>
      ) : requests.length > 0 ? (
        <section aria-label="Sent" className="flex flex-col">
          <h3 className="text-sm font-medium">Sent</h3>
          <ul className="flex flex-col divide-y divide-border">
            {requests.map((request) => (
              <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" key={request.id}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{request.email}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">Sent {formatMediumDate(request.sentAt)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={STATE[request.state].variant}>{STATE[request.state].label}</Badge>
                  {request.state === "sent" || request.state === "expired" ? (
                    <Button
                      aria-label={`Resend to ${request.email}`}
                      disabled={busy}
                      onClick={() => void act(resendAnswerRequestAction({ linkId: request.id, source: what }))}
                      size="sm"
                      variant="ghost"
                    >
                      Resend
                    </Button>
                  ) : null}
                  {request.state === "sent" ? (
                    <Button
                      aria-label={`Revoke ${request.email}'s link`}
                      disabled={busy}
                      onClick={() => void act(revokeAnswerRequestAction({ linkId: request.id, source: what }))}
                      size="sm"
                      variant="ghost"
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={onDone} variant="outline">
          Done
        </Button>
      </div>
    </>
  )
}

// The email did not go, so the link is shown here, once, to pass on another way.
function Undelivered({ sent }: { sent: SentAnswerRequest }): ReactElement {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/forms/${sent.token}`

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-muted/50 p-3" role="status">
      <p className="text-sm">
        The email to <span className="font-medium">{sent.email}</span> couldn&apos;t be sent. Send them this link yourself; it won&apos;t be shown again.
      </p>
      <div className="flex gap-2">
        <Input aria-label={`Link for ${sent.email}`} className="font-mono text-xs" readOnly value={url} />
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => setCopied(true))
          }}
          variant="outline"
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  )
}
