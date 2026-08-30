import { beforeEach, describe, expect, it, vi } from "vitest"

const sonner = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  success: vi.fn(),
}))

vi.mock("sonner", () => ({
  Toaster: function MockToaster(): null {
    return null
  },
  toast: sonner,
}))

import { BizFlowToaster, bizflowToast } from "./toaster"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("BizFlowToaster", () => {
  it("configures one closable semantic top-center toast surface", () => {
    const element = BizFlowToaster()

    expect(element.props).toMatchObject({
      closeButton: true,
      duration: 5_000,
      position: "top-center",
      richColors: false,
    })
    expect(element.props.toastOptions?.classNames).toMatchObject({
      closeButton: expect.stringContaining("text-foreground"),
      description: expect.stringContaining("text-muted-foreground"),
      error: expect.stringContaining("text-destructive"),
      info: expect.stringContaining("text-foreground"),
      loading: expect.stringContaining("text-foreground"),
      success: expect.stringContaining("text-foreground"),
      toast: expect.stringContaining("bg-card"),
    })
  })

  it("loads Sonner on demand and routes feedback through its semantic channel", async () => {
    const options = { description: "The authoritative result is available." }

    const toastIds = [
      bizflowToast.success("Saved", options),
      bizflowToast.error("Could not save", options),
      bizflowToast.info("Review needed", options),
      bizflowToast.loading("Saving", options),
    ]

    expect(sonner.success).not.toHaveBeenCalled()

    await vi.dynamicImportSettled()

    expect(toastIds.every((id) => typeof id === "string")).toBe(true)
    expect(sonner.success).toHaveBeenCalledWith(
      "Saved",
      expect.objectContaining(options)
    )
    expect(sonner.error).toHaveBeenCalledWith(
      "Could not save",
      expect.objectContaining(options)
    )
    expect(sonner.info).toHaveBeenCalledWith(
      "Review needed",
      expect.objectContaining(options)
    )
    expect(sonner.loading).toHaveBeenCalledWith(
      "Saving",
      expect.objectContaining(options)
    )
  })
})
