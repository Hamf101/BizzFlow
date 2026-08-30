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

  it("routes each semantic entry point through the matching Sonner channel", () => {
    const options = { description: "The authoritative result is available." }

    bizflowToast.success("Saved", options)
    bizflowToast.error("Could not save", options)
    bizflowToast.info("Review needed", options)
    bizflowToast.loading("Saving", options)

    expect(sonner.success).toHaveBeenCalledWith("Saved", options)
    expect(sonner.error).toHaveBeenCalledWith("Could not save", options)
    expect(sonner.info).toHaveBeenCalledWith("Review needed", options)
    expect(sonner.loading).toHaveBeenCalledWith("Saving", options)
  })
})
