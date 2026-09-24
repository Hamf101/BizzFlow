"use client"

import { Plus, Send, X } from "lucide-react"
import {
  type ChangeEvent,
  type ReactElement,
  useRef,
  useState,
} from "react"
import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const MAX_RECIPIENTS = 20

type RecipientDraft = {
  clientId: string
  name: string
  email: string
}

type DocumentRecipientCollectionProps = {
  action: (formData: FormData) => Promise<void>
  documentId: string
}

/**
 * Collects one or more unordered recipients before starting a signing batch.
 *
 * @param props - Authenticated send action and generated document id.
 * @returns The recipients' names and emails, and Send.
 */
export function DocumentRecipientCollection({
  action,
  documentId,
}: DocumentRecipientCollectionProps): ReactElement {
  const [recipients, setRecipients] = useState<RecipientDraft[]>([
    createRecipientDraft("recipient-1"),
  ])
  const nextRecipientNumber = useRef<number>(2)

  function addRecipient(): void {
    if (recipients.length >= MAX_RECIPIENTS) {
      return
    }

    const clientId = `recipient-${nextRecipientNumber.current}`
    nextRecipientNumber.current += 1
    setRecipients((current: RecipientDraft[]) => [
      ...current,
      createRecipientDraft(clientId),
    ])
  }

  function removeRecipient(clientId: string): void {
    setRecipients((current: RecipientDraft[]) =>
      current.length > 1
        ? current.filter((recipient: RecipientDraft) => recipient.clientId !== clientId)
        : current
    )
  }

  function updateRecipient(
    clientId: string,
    update: Partial<Pick<RecipientDraft, "name" | "email">>
  ): void {
    setRecipients((current: RecipientDraft[]) =>
      current.map((recipient: RecipientDraft) =>
        recipient.clientId === clientId ? { ...recipient, ...update } : recipient
      )
    )
  }

  const serializedRecipients = JSON.stringify(
    recipients.map((recipient: RecipientDraft) => ({
      name: recipient.name,
      email: recipient.email,
      requiresSignature: true,
    }))
  )

  return (
    <form action={action} className="grid gap-4">
      <input name="documentId" type="hidden" value={documentId} />
      <input name="recipients" type="hidden" value={serializedRecipients} />
      <div className="grid gap-3">
        {recipients.map((recipient: RecipientDraft, index: number) => (
          <div
            className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]"
            key={recipient.clientId}
          >
            <Field>
              <FieldLabel htmlFor={`${recipient.clientId}-name`}>Name</FieldLabel>
              <Input
                autoComplete="name"
                id={`${recipient.clientId}-name`}
                maxLength={160}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  updateRecipient(recipient.clientId, { name: event.target.value })
                }
                required
                value={recipient.name}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${recipient.clientId}-email`}>Email</FieldLabel>
              <Input
                autoComplete="email"
                id={`${recipient.clientId}-email`}
                maxLength={320}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  updateRecipient(recipient.clientId, { email: event.target.value })
                }
                required
                type="email"
                value={recipient.email}
              />
            </Field>
            <Button
              aria-label={`Remove recipient ${index + 1}`}
              className="max-sm:justify-self-end"
              disabled={recipients.length === 1}
              onClick={(): void => removeRecipient(recipient.clientId)}
              size="icon"
              title="Remove"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button
          disabled={recipients.length >= MAX_RECIPIENTS}
          onClick={addRecipient}
          type="button"
          variant="ghost"
        >
          <Plus />
          Add recipient
        </Button>
        <SendRecipientsButton />
      </div>
    </form>
  )
}

function SendRecipientsButton(): ReactElement {
  const { pending } = useFormStatus()

  return (
    <Button disabled={pending} type="submit">
      <Send />
      {pending ? "Sending…" : "Send"}
    </Button>
  )
}

function createRecipientDraft(clientId: string): RecipientDraft {
  return {
    clientId,
    name: "",
    email: "",
  }
}
