"use client"

import { Send } from "lucide-react"
import { type ReactElement, useMemo, useState } from "react"

import { completePublicSigningAction } from "@/app/sign/[token]/actions"
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
  CardTitle
} from "@/components/ui/card"
import { withBoxMarks } from "@/types/box-signers"
import type { PublicDocumentSigningView } from "@/types/signing"
import {
  pruneHiddenTemplateFieldValues,
  templateRequiresVisibleInitials
} from "@/types/template-visibility"

import { DrawnSignatureField } from "./drawn-signature-field"
import { GeneratedDocumentContent } from "./generated-document-content"
import { getGeneratedDocumentAnswerBaselineFields } from "./generated-document-form-data"

type PublicDocumentSigningFormProps = {
  editable: boolean
  token: string
  view: PublicDocumentSigningView
}

/**
 * Renders the interactive public signing form and keeps acknowledgement
 * requirements synchronized with conditional document answers.
 *
 * @param props - Private token, immutable signing view, and editability state.
 * @returns The public document form with live initials requirements.
 */
export function PublicDocumentSigningForm({
  editable,
  token,
  view
}: PublicDocumentSigningFormProps): ReactElement {
  const [currentAnswers, setCurrentAnswers] = useState<
    Record<string, unknown>
  >(() =>
    pruneHiddenTemplateFieldValues(
      view.document.templateSnapshot,
      view.answers
    )
  )
  // Each drawn box shows only its signer's mark: the sender's, or the reader's
  // own once they have signed. A co-signer's drawing is not theirs to see.
  const signerNumber =
    view.signers.findIndex((signer): boolean => signer.id === view.recipient.id) + 1
  const requiresInitials = useMemo(
    (): boolean =>
      templateRequiresVisibleInitials(
        view.document.templateSnapshot,
        currentAnswers,
        signerNumber
      ),
    [currentAnswers, signerNumber, view.document.templateSnapshot]
  )
  const shownAnswers = useMemo(
    (): Record<string, unknown> =>
      withBoxMarks(
        view.document.templateSnapshot.blocks,
        view.answers,
        view.signers.map((signer) =>
          signer.id === view.recipient.id ? view.recipient : { id: signer.id }
        )
      ),
    [view]
  )
  const answerBaselineFields = getGeneratedDocumentAnswerBaselineFields(
    view.document.templateSnapshot,
    view.answers
  )

  return (
    <form
      action={completePublicSigningAction}
      className="flex min-w-0 flex-col gap-6"
    >
      <input name="token" type="hidden" value={token} />
      {answerBaselineFields.map(
        (field: { name: string; value: string }): ReactElement => (
          <input
            key={field.name}
            name={field.name}
            type="hidden"
            value={field.value}
          />
        )
      )}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Document</CardTitle>
          {editable ? (
            <CardDescription>
              Fill anything missing, then sign below.
            </CardDescription>
          ) : null}
          <CardAction>
            <Badge variant="outline">{editable ? "Editable" : "Read only"}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-auto bg-muted/30 p-4 sm:p-6">
          <GeneratedDocumentContent
            answers={shownAnswers}
            content={view.document.templateSnapshot}
            editable={editable}
            onAnswersChange={setCurrentAnswers}
            recipientSigned={view.recipient.status === "signed"}
            recipientSigning
            signerNumber={signerNumber}
            signers={view.signers}
            title={view.document.title}
          />
        </CardContent>
      </Card>

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Sign</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <DrawnSignatureField
              label="Signature"
              name="signatureDataUrl"
              required
            />
            <DrawnSignatureField
              description={
                requiresInitials ? "Required for this document." : "Optional."
              }
              label="Initials"
              name="initialsDataUrl"
              required={requiresInitials}
            />
            <Alert>
              <AlertTitle>Basic electronic acknowledgement</AlertTitle>
              <AlertDescription>
                A drawing here is a basic acknowledgement, not a qualified or
                regulated electronic signature.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              By submitting, you confirm the answers and drawing shown here.
            </span>
            <Button type="submit">
              <Send />
              Submit signature
            </Button>
          </CardFooter>
        </Card>
      )}
    </form>
  )
}
