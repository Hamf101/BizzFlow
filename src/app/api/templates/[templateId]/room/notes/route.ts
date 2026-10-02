import { readRoomNotes, writeRoomNotes } from "@/app/api/_working-copy-room"

type Context = { params: Promise<{ templateId: string }> }

/** Checkpoints, comments or the chat beside this working copy. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return readRoomNotes(request, { templateId: (await context.params).templateId })
}

/** Leaves a checkpoint, comment or message, or brings a checkpoint back. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return writeRoomNotes(request, { templateId: (await context.params).templateId })
}
