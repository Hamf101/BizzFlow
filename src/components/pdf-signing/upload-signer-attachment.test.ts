// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest"

import { uploadSignerAttachment } from "@/components/pdf-signing/upload-signer-attachment"

afterEach(() => {
  vi.unstubAllGlobals()
})

const FILE = new File(["%PDF-1.7"], "ID.pdf", { type: "application/pdf" })

it("tells the signer why the server refused an attachment, and stays generic when it can't say", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ error: "You can attach up to 10 files." }, { status: 409 }))
  await expect(uploadSignerAttachment("token-1", "field-1", FILE)).rejects.toThrow("You can attach up to 10 files.")

  vi.stubGlobal("fetch", async (url: string) =>
    url.startsWith("/api/") ? Response.json({ attachmentId: "a-1", uploadUrl: "https://r2.example/put" }) : new Response(null, { status: 403 })
  )
  await expect(uploadSignerAttachment("token-1", "field-1", FILE)).rejects.toThrow("That file didn't upload. Try again.")

  // A dropped connection never shows the browser's own wording.
  vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("Failed to fetch")))
  await expect(uploadSignerAttachment("token-1", "field-1", FILE)).rejects.toThrow("That file didn't upload. Try again.")
})
