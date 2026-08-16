"use client"

import { Check, Copy, ExternalLink, Link2, Plus, PowerOff } from "lucide-react"
import Link from "next/link"
import { useState, type ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatMediumDate } from "@/lib/date-format"
import { cn } from "@/lib/utils"
import type { PublicFormLink } from "@/types/public-link"

export function PublicFormLinksPanel({
  createAction,
  disableAction,
  links,
  templateId,
}: {
  createAction: (formData: FormData) => Promise<void>
  disableAction: (formData: FormData) => Promise<void>
  links: PublicFormLink[]
  templateId: string
}): ReactElement {
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const handleCopy = (token: string) => {
    const url = `${window.location.origin}/forms/${token}`
    navigator.clipboard.writeText(url)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" />
            <CardTitle>Public Form Links</CardTitle>
          </div>
          <CardDescription>
            Shareable links that allow external users to submit responses without an account.
          </CardDescription>
        </div>
        <Button
          onClick={() => setShowCreateForm(!showCreateForm)}
          size="sm"
          variant="outline"
        >
          <Plus className="mr-1 size-4" />
          New link
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {showCreateForm && (
          <form action={createAction} className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4">
            <input name="templateId" type="hidden" value={templateId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="link-expires-at">Expiration Date (Optional)</FieldLabel>
                <Input id="link-expires-at" name="expiresAt" type="datetime-local" />
                <FieldDescription>Leave empty for no expiration.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="link-max-submissions">Max Submissions (Optional)</FieldLabel>
                <Input
                  id="link-max-submissions"
                  min={1}
                  name="maxSubmissions"
                  placeholder="e.g. 100"
                  type="number"
                />
                <FieldDescription>Limit total responses accepted.</FieldDescription>
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setShowCreateForm(false)} type="button" variant="ghost">
                Cancel
              </Button>
              <Button type="submit">Generate link</Button>
            </div>
          </form>
        )}

        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No public links generated yet for this template.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {links.map((link: PublicFormLink) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                key={link.id}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-foreground">
                      /forms/{link.token}
                    </span>
                    <Badge variant={link.status === "active" ? "default" : "secondary"}>
                      {link.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Submissions: {link.submissionCount}{link.maxSubmissions !== null && ` / ${link.maxSubmissions}`}</span>
                    {link.expiresAt && (
                      <span>Expires: {formatMediumDate(link.expiresAt)}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => handleCopy(link.token)}
                    size="sm"
                    variant="outline"
                  >
                    {copiedToken === link.token ? (
                      <>
                        <Check className="mr-1 size-3.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 size-3.5" />
                        Copy
                      </>
                    )}
                  </Button>
                  <Link
                    className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
                    href={`/forms/${link.token}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                  {link.status === "active" && (
                    <form action={disableAction}>
                      <input name="templateId" type="hidden" value={templateId} />
                      <input name="linkId" type="hidden" value={link.id} />
                      <Button size="sm" type="submit" variant="ghost">
                        <PowerOff className="mr-1 size-3.5 text-destructive" />
                        Disable
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
