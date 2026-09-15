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

import { bizflowToast } from "./toaster"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("bizflowToast", () => {
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
    expect(sonner.success.mock.calls[0]?.[0]).toMatchObject({
      props: { children: "Saved", role: "status" },
      type: "span",
    })
    expect(sonner.success).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining(options)
    )
    expect(sonner.error).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining(options)
    )
    expect(sonner.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining(options)
    )
    expect(sonner.loading).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining(options)
    )
    expect(sonner.error.mock.calls[0]?.[0]).toMatchObject({
      props: { children: "Could not save", role: "status" },
      type: "span",
    })
    expect(sonner.info.mock.calls[0]?.[0]).toMatchObject({
      props: { children: "Review needed", role: "status" },
      type: "span",
    })
    expect(sonner.loading.mock.calls[0]?.[0]).toMatchObject({
      props: { children: "Saving", role: "status" },
      type: "span",
    })
  })
})
