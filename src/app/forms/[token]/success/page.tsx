import { CheckCircle2 } from "lucide-react"
import type { ReactElement } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function PublicFormSuccessPage(): ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md text-center shadow-sm">
        <CardHeader className="flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
            <CheckCircle2 className="size-7" />
          </div>
          <CardTitle className="text-xl">Submission received</CardTitle>
          <CardDescription>Thanks — we have your response.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            You can close this window.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
