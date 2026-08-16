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
  const requiresInitials = useMemo(
    (): boolean =>
      templateRequiresVisibleInitials(
        view.document.templateSnapshot,
        currentAnswers
      ),
    [currentAnswers, view.document.templateSnapshot]
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
          <CardDescription>
            {editable
              ? "Complete any outstanding fields, then sign below."
              : "This submitted document is read only."}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{editable ? "Editable" : "Read only"}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-auto bg-muted/30 p-4 sm:p-6">
          <GeneratedDocumentContent
            answers={view.answers}
            content={view.document.templateSnapshot}
            editable={editable}
            onAnswersChange={setCurrentAnswers}
            recipientSigned={view.recipient.status === "signed"}
            recipientSigning
            title={view.document.title}
          />
        </CardContent>
        <CardFooter>
          <span className="text-xs text-muted-foreground">
            The document uses the immutable template snapshot selected by the
            sender.
          </span>
        </CardFooter>
      </Card>

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Signing acknowledgement</CardTitle>
            <CardDescription>
              A drawn signature is a basic acknowledgement for this workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <DrawnSignatureField
              label="Signature"
              name="signatureDataUrl"
              required
            />
            <DrawnSignatureField
              description={
                requiresInitials
                  ? "Required because this document contains a required initials field."
                  : "Optional. Add initials if this document calls for them."
              }
              label="Initials"
              name="initialsDataUrl"
              required={requiresInitials}
            />
            <Alert>
              <AlertTitle>Basic electronic acknowledgement</AlertTitle>
              <AlertDescription>
                This MVP drawing is not a qualified or regulated electronic
                signature product.
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
