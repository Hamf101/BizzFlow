import { openRoom } from "@/app/api/_working-copy-room"

type Context = { params: Promise<{ templateId: string }> }

/** Opens the room where a template's working copy is edited together. */
export async function POST(_request: Request, context: Context): Promise<Response> {
  return openRoom({ templateId: (await context.params).templateId })
}
