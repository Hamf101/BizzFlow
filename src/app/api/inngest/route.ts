import { serve } from "inngest/next"

import { inngest } from "@/inngest/client"
import { inngestFunctions } from "@/inngest/functions"
import { getInngestEnv } from "@/lib/env"

// Background work runs to completion inside the request, so the route needs the
// platform's full function budget rather than the shorter page default.
export const maxDuration = 300

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
  servePath: getInngestEnv().INNGEST_SERVE_PATH,
})
