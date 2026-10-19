import type { DocumentServiceDeps } from "@/services/documents/contracts"
import type { DocumentAccessLevel, DocumentLifecycleState } from "@/types/document"
import type { SheetContent } from "@/types/sheet"

/** Injected client, ids, audit and the clock TODAY() reads. */
export type SheetServiceDeps = DocumentServiceDeps & { now?: () => Date }

export type CreateSheetInput = {
  actorUserId: string
  organizationId: string
  folderId?: string | null
  title: string
}

export type SheetInput = { actorUserId: string; organizationId: string; documentId: string }

export type UpdateSheetContentInput = SheetInput & {
  /** Untrusted: what the browser sent. */
  content: unknown
  /** The updatedAt the writer opened; a save over anyone else's is refused. */
  expectedUpdatedAt: string
}

export type RenameSheetInput = SheetInput & { title: string; expectedUpdatedAt: string }

/** A sheet as its reader opens it. */
export type Sheet = {
  id: string
  title: string
  content: SheetContent
  updatedAt: string
  accessLevel: DocumentAccessLevel
  /** Null at the top of Files, and for a guest, who never sees where it is filed. */
  folderId: string | null
  /** Archived sheets open read-only. */
  lifecycleState: DocumentLifecycleState
}
