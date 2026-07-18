import type { DocumentFolder } from "@/types/document"

/**
 * Builds the root-to-leaf path for an active document folder.
 *
 * Cyclic parent data is truncated at the first repeated folder so page
 * rendering remains bounded.
 *
 * @param activeFolder - Folder whose ancestors should be listed.
 * @param folders - Available active folders in the current workspace.
 * @returns Ordered folder path beginning with the highest reachable ancestor.
 */
export function buildDocumentFolderPath(
  activeFolder: DocumentFolder | null,
  folders: readonly DocumentFolder[]
): DocumentFolder[] {
  if (!activeFolder) {
    return []
  }

  const folderById = new Map(
    folders.map(
      (folder: DocumentFolder): [string, DocumentFolder] => [folder.id, folder]
    )
  )
  const path: DocumentFolder[] = []
  const visitedIds = new Set<string>()
  let current: DocumentFolder | undefined = activeFolder

  while (current && !visitedIds.has(current.id)) {
    path.unshift(current)
    visitedIds.add(current.id)
    current = current.parentFolderId
      ? folderById.get(current.parentFolderId)
      : undefined
  }

  return path
}
