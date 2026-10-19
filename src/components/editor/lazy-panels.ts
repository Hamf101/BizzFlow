"use client"

import dynamic from "next/dynamic"

const loadBlockSettings = () => import("@/components/editor/template-block-editor")
const loadFlowPanel = () => import("@/components/editor/template-flow-panel")
const loadRoom = () => import("@/components/editor/room-ui")
const loadPageSetup = () => import("@/components/editor/page-setup-panel")
const loadBranding = () => import("@/components/templates/template-branding-panel")
const loadShare = () => import("@/components/sharing/share-dialog")
const loadChecks = () => import("@/components/templates/template-checks-panel")

// Each has its own Suspense boundary (`loading`), so one still loading never
// hides the editor behind the route's loading screen.
// Panels no page needs to draw at first; they arrive while the page is idle.
export const TemplateBlockEditor = dynamic(() => loadBlockSettings().then((panel) => panel.TemplateBlockEditor), { loading: () => null })
export const TemplateFlowPanel = dynamic(() => loadFlowPanel().then((panel) => panel.TemplateFlowPanel), { loading: () => null })
export const PageSetupPanel = dynamic(() => loadPageSetup().then((panel) => panel.PageSetupPanel), { loading: () => null })
export const TemplateBrandingPanel = dynamic(() => loadBranding().then((panel) => panel.TemplateBrandingPanel), { loading: () => null })
export const TemplateChecksPanel = dynamic(() => loadChecks().then((panel) => panel.TemplateChecksPanel), { loading: () => null })
// Opened from a menu, so it loads when asked for.
export const ShareDialog = dynamic(() => loadShare().then((panel) => panel.ShareDialog), { loading: () => null })
export const DocumentRecipientCollection = dynamic(() => import("@/components/documents/document-recipient-collection").then((form) => form.DocumentRecipientCollection), { loading: () => null })
export const SendToAnswerDialog = dynamic(() => import("@/components/sharing/send-to-answer-dialog").then((panel) => panel.SendToAnswerDialog), { loading: () => null })
// What editing together shows, once a room is open.
export const RoomCheckpoints = dynamic(() => loadRoom().then((room) => room.RoomCheckpoints), { loading: () => null })
export const RoomComments = dynamic(() => loadRoom().then((room) => room.RoomComments), { loading: () => null })
export const RoomLayer = dynamic(() => loadRoom().then((room) => room.RoomLayer), { loading: () => null })
export const RoomPeople = dynamic(() => loadRoom().then((room) => room.RoomPeople), { loading: () => null })

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
