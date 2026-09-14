"use client"

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

/**
 * Opens a menu where the pointer right-clicks, on a long press, or from the
 * keyboard's menu key. Its popup, items, and separators are the dropdown
 * menu's own parts, so both kinds of menu look the same.
 */
function ContextMenu(props: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger(props: ContextMenuPrimitive.Trigger.Props) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  )
}

export { ContextMenu, ContextMenuTrigger }
