"use client"

import { Plus, Send, Trash2 } from "lucide-react"
import {
  type ChangeEvent,
  type ReactElement,
  useRef,
  useState,
} from "react"
import { useFormStatus } from "react-dom"

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
 * @returns A dynamic, accessible recipient collection form.
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
    <form action={action}>
      <input name="documentId" type="hidden" value={documentId} />
      <input name="recipients" type="hidden" value={serializedRecipients} />
      <Card>
        <CardHeader>
          <CardTitle>Send for signing</CardTitle>
          <CardDescription>
            Invite up to {MAX_RECIPIENTS} recipients. They may sign in any order.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">

          {recipients.map((recipient: RecipientDraft, index: number) => (
            <fieldset
              className="flex flex-col gap-3 rounded-lg border bg-background p-3"
              key={recipient.clientId}
            >
              <legend className="px-1 text-sm font-semibold">
                Recipient {index + 1}
              </legend>
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  Signature required
                </span>
                <Button
                  disabled={recipients.length === 1}
                  onClick={(): void => removeRecipient(recipient.clientId)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                  Remove
                </Button>
              </div>
            </fieldset>
          ))}

          <Button
            disabled={recipients.length >= MAX_RECIPIENTS}
            onClick={addRecipient}
            type="button"
            variant="outline"
          >
            <Plus />
            Add recipient
          </Button>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Each recipient receives a private link that expires in seven days.
          </span>
          <SendRecipientsButton />
        </CardFooter>
      </Card>
    </form>
  )
}

function SendRecipientsButton(): ReactElement {
  const { pending } = useFormStatus()

  return (
    <Button disabled={pending} type="submit">
      <Send />
      {pending ? "Sending…" : "Send invitations"}
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
