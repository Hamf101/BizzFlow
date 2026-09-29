import { openRoom } from "@/app/api/_working-copy-room"

type Context = { params: Promise<{ documentId: string }> }

/** Opens the room where a draft document is written together. */
export async function POST(_request: Request, context: Context): Promise<Response> {
  return openRoom({ documentId: (await context.params).documentId })
}
