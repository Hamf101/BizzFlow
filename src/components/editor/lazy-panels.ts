"use client"

import dynamic from "next/dynamic"

const loadBlockSettings = () => import("@/components/templates/template-block-editor")
const loadFlowPanel = () => import("@/components/templates/template-flow-panel")
const loadRoom = () => import("@/components/editor/room-ui")
const loadPageSetup = () => import("@/components/editor/page-setup-panel")
const loadBranding = () => import("@/components/templates/template-branding-panel")
const loadShare = () => import("@/components/sharing/share-dialog")
const loadChecks = () => import("@/components/templates/template-checks-panel")

// Panels no page needs to draw at first; they arrive while the page is idle.
export const TemplateBlockEditor = dynamic(() => loadBlockSettings().then((panel) => panel.TemplateBlockEditor))
export const TemplateFlowPanel = dynamic(() => loadFlowPanel().then((panel) => panel.TemplateFlowPanel))
export const PageSetupPanel = dynamic(() => loadPageSetup().then((panel) => panel.PageSetupPanel))
export const TemplateBrandingPanel = dynamic(() => loadBranding().then((panel) => panel.TemplateBrandingPanel))
export const TemplateChecksPanel = dynamic(() => loadChecks().then((panel) => panel.TemplateChecksPanel))
// Opened from a menu, so it loads when asked for.
export const ShareDialog = dynamic(() => loadShare().then((panel) => panel.ShareDialog))
// What editing together shows, once a room is open.
export const RoomCheckpoints = dynamic(() => loadRoom().then((room) => room.RoomCheckpoints))
export const RoomComments = dynamic(() => loadRoom().then((room) => room.RoomComments))
export const RoomLayer = dynamic(() => loadRoom().then((room) => room.RoomLayer))
export const RoomPeople = dynamic(() => loadRoom().then((room) => room.RoomPeople))

/**
 * Fetches the panels once the page has settled, so opening one never waits.
 *
 * @returns A way to stop, when the page goes before it settles.
 */
export function preloadPanels(): () => void {
  const load = (): void => {
    void loadBlockSettings()
    void loadFlowPanel()
    void loadRoom()
    void loadPageSetup()
    void loadBranding()
    void loadChecks()
  }

  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(load)
    return () => window.cancelIdleCallback(id)
  }

  const timer = window.setTimeout(load, 1_500)
  return () => window.clearTimeout(timer)
}
