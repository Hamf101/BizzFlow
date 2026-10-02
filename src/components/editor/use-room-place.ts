"use client"

import { useEffect } from "react"

import type { RoomPlace } from "@/components/editor/use-live-room"
import type { EditorController } from "@/components/editor/use-editor-controller"

/**
 * Tells the others in the room where this person is: the block in use, and
 * while they write, the line their caret is in and where.
 *
 * @param controller - The editor's controller, which knows the block and line in use.
 * @param setPlace - How the room hears it.
 */
export function useRoomPlace(controller: EditorController, setPlace: (place: RoomPlace) => void): void {
  const blockId = controller.selectedBlockId ?? controller.activeBlockId
  const { line } = controller

  useEffect(() => {
    const send = (): void => {
      const key = line && !line.isDestroyed && line.isFocused ? line.view.dom.dataset.caretKey : undefined
      setPlace({ blockId, caret: key && line ? { key, offset: line.state.selection.head } : null })
    }

    send()

    if (!line || line.isDestroyed) {
      return
    }

    line.on("selectionUpdate", send)
    line.on("focus", send)
    line.on("blur", send)

    return () => {
      line.off("selectionUpdate", send)
      line.off("focus", send)
      line.off("blur", send)
    }
  }, [blockId, line, setPlace])
}
