import { signRoomPictures } from "@/app/api/_working-copy-room"

type Context = { params: Promise<{ documentId: string }> }

/** Addresses for pictures in a draft document this editor can't show yet. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return signRoomPictures(request, { documentId: (await context.params).documentId })
}
