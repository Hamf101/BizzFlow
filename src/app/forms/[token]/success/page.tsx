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
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <CheckCircle2 className="size-7" />
          </div>
          <CardTitle className="text-xl">Submission Received</CardTitle>
          <CardDescription>
            Thank you! Your response has been securely submitted and recorded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            You may close this browser window.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
