// @vitest-environment jsdom

import { act } from "react"
import type { Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const navigation = vi.hoisted(() => ({
  pathname: "/documents",
  query: "",
  replace: vi.fn(),
}))
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}))
const trackEvent = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))
vi.mock("@/components/ui/toaster", () => ({ bizflowToast: toast }))
vi.mock("@/lib/analytics", () => ({ trackEvent }))

import { ActionFeedback } from "./action-feedback"
import { mount } from "@/test/render"

beforeEach(() => {
  navigation.pathname = "/documents"
  navigation.query = ""
  navigation.replace.mockReset()
  toast.error.mockReset()
  toast.info.mockReset()
  toast.success.mockReset()
  trackEvent.mockReset()
  window.history.replaceState(null, "", "/documents")
})

async function renderFeedback(): Promise<Root> {
  const root = mount()

  await act(async () => root.render(<ActionFeedback />))
  return root
}

describe("ActionFeedback", () => {
  it("emits one fixed toast and event, then removes only feedback without adding history", async () => {
    navigation.query =
      "view=archived&feedback=document_uploaded&folderId=folder-1"
    window.history.replaceState(
      null,
      "",
      `/documents?${navigation.query}#recent`
    )

    const root = await renderFeedback()
    await act(async () => root.render(<ActionFeedback />))

    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "Document uploaded",
      expect.objectContaining({ duration: 5_000 })
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("document_uploaded", {
      outcomeCode: "document_uploaded",
      route: "/documents",
    })
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
      "/documents?view=archived&folderId=folder-1#recent",
      { scroll: false }
    )
  })

  it("counts a quiet outcome but shows no toast over the page that already says it, and keeps that page's own marker", async () => {
    navigation.pathname = "/templates/t1/edit"
    navigation.query = "new=1&feedback=template_created"
    window.history.replaceState(null, "", `/templates/t1/edit?${navigation.query}`)

    await renderFeedback()

    expect(toast.success).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("template_created", {
      outcomeCode: "template_created",
      route: "/templates/t1/edit",
    })
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/templates/t1/edit?new=1", { scroll: false })
  })

  it("silently consumes an edited code without displaying, tracking, or reflecting it", async () => {
    navigation.query =
      "view=active&feedback=EmailJS%20provider%20stack&folderId=folder-2"
    window.history.replaceState(
      null,
      "",
      `/documents?${navigation.query}#workspace`
    )

    await renderFeedback()

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
      "/documents?view=active&folderId=folder-2#workspace",
      { scroll: false }
    )
    expect(JSON.stringify(navigation.replace.mock.calls)).not.toContain(
      "provider"
    )
  })

  it("does nothing when the URL has no feedback parameter", async () => {
    navigation.query = "view=active"

    await renderFeedback()

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
