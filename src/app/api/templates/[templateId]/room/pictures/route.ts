import { signRoomPictures } from "@/app/api/_working-copy-room"

type Context = { params: Promise<{ templateId: string }> }

/** Addresses for pictures in the template's working copy this editor can't show yet. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return signRoomPictures(request, { templateId: (await context.params).templateId })
}
