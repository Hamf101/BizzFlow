"use client"

import { AlertCircle, Send } from "lucide-react"
import {
  createContext,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useState,
} from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/** What a public form's action reports back when it could not be sent. */
export type PublicAnswerResult = Readonly<{ error: string }> | null

type Sending = Readonly<{
  error: string | null
  /** How many files are uploading; nothing is sent until they have. */
  setUploads: (change: (count: number) => number) => void
  waiting: boolean
}>

const PublicAnswerSending = createContext<Sending>({ error: null, setUploads: () => undefined, waiting: false })

/**
 * The form a public link is answered in. A refusal comes back as a message
 * on the same page, so every answer, drawing and file chosen stays where it is.
 *
 * @param props - What sends the answers, and the page.
 * @returns The form.
 */
export function PublicAnswerForm({
  action,
  children,
}: {
  action: (previous: PublicAnswerResult, formData: FormData) => Promise<PublicAnswerResult>
  children: ReactNode
}): ReactElement {
  const [result, send, pending] = useActionState(action, null)
  const [uploads, setUploads] = useState(0)
  const waiting = pending || uploads > 0

  // Sent by hand, as a form's own action would reset every box it holds once it ran.
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (!waiting) {
      const formData = new FormData(event.currentTarget)
      startTransition(() => send(formData))
    }
  }

  return (
    <PublicAnswerSending.Provider value={{ error: result?.error ?? null, setUploads, waiting }}>
      <form onSubmit={submit}>{children}</form>
    </PublicAnswerSending.Provider>
  )
}

/**
 * Sends the answers; it waits while they are being sent or a file uploads.
 *
 * @returns The Submit button.
 */
export function PublicAnswerSubmit(): ReactElement {
  const { waiting } = useContext(PublicAnswerSending)

  return (
    <Button className="h-10 px-4" disabled={waiting} type="submit">
      <Send />
      Submit
    </Button>
  )
}

/**
 * Why the answers were not sent, when they were not.
 *
 * @returns The message, or nothing.
 */
export function PublicAnswerError(): ReactElement | null {
  const { error } = useContext(PublicAnswerSending)

  return error ? (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Not sent</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null
}

/**
 * Holds the form back while a file uploads.
 *
 * @param uploading - Whether this field's file is uploading now.
 */
export function useHoldWhileUploading(uploading: boolean): void {
  const { setUploads } = useContext(PublicAnswerSending)

  useEffect(() => {
    if (!uploading) {
      return
    }

    setUploads((count) => count + 1)
    return () => setUploads((count) => count - 1)
  }, [setUploads, uploading])
}
