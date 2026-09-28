import { expect, it } from "vitest"

import { placeImage } from "@/components/editor/image-placement"
import { imageBlockSchema } from "@/types/template"

it("keeps a dragged or resized picture wholly on its page", () => {
  expect(placeImage({ height: 20, page: 1, width: 30, x: 90, y: -4 })).toEqual({ height: 20, page: 1, width: 30, x: 70, y: 0 })
  expect(placeImage({ height: 0, page: 2.4, width: 200, x: 10, y: 10 })).toEqual({ height: 1, page: 2, width: 100, x: 0, y: 10 })
  // A saved document refuses a box that hangs off its page.
  expect(
    imageBlockSchema.safeParse({
      altText: "Logo",
      id: "60000000-0000-4000-8000-000000000001",
      placement: { height: 10, page: 1, width: 30, x: 90, y: 0 },
      type: "image",
    }).success
  ).toBe(false)
})
