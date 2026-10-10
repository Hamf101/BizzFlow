// @vitest-environment jsdom
import { act } from "react"
import { expect, it, vi } from "vitest"

import { createEmptyDocumentContent, type TemplateContentV3 } from "@/types/template"

import { useMissingPictureAddresses, usePictureAddresses } from "./use-picture-addresses"
import { mount } from "@/test/render"

it("asks once for a picture the server has no address for, however often the page draws", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ urls: {} })))
  vi.stubGlobal("fetch", fetch)
  const content: TemplateContentV3 = {
    ...createEmptyDocumentContent(),
    blocks: [{ altText: "Seal", asset: { height: 20, id: "71000000-0000-4000-8000-000000000009", type: "png", width: 20 }, id: "71000000-0000-4000-8000-000000000001", type: "image" }],
  } as TemplateContentV3
  const session = { refresh: vi.fn() }

  function Editor(): null {
    const pictures = usePictureAddresses(content)
    useMissingPictureAddresses({ content, path: "/api/rooms", pictures, roomId: "room-1", session })
    return null
  }

  const root = mount()
  for (let draw = 0; draw < 3; draw += 1) {
    await act(async () => root.render(<Editor />))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
  }

  expect(fetch).toHaveBeenCalledTimes(1)
  act(() => root.unmount())
  vi.unstubAllGlobals()
})
