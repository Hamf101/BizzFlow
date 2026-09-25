import { expect, it } from "vitest"

import { createBlankTemplateContent, parseTemplateContent, type TemplateContentV3 } from "@/types/template"
import { imageSource, mapImageAssets, withoutImageUrls } from "@/types/template-images"

const PICTURE = {
  height: 900,
  id: "40000000-0000-4000-8000-000000000001",
  type: "jpeg" as const,
  url: "https://images.example.com/signed?x=1",
  width: 1200,
}

function contentWith(blocks: TemplateContentV3["blocks"]): TemplateContentV3 {
  const content = createBlankTemplateContent()

  return { ...content, blocks, branding: { ...content.branding, logoAsset: PICTURE } }
}

const image = (fields: object) => ({
  alignment: "center" as const,
  altText: "Front of the building",
  caption: null,
  id: "40000000-0000-4000-8000-0000000000b1",
  type: "image" as const,
  widthPercent: 100,
  ...fields,
})

it("saves a stored picture by reference, never the address a viewer was given", () => {
  const saved = parseTemplateContent(withoutImageUrls(contentWith([image({ asset: PICTURE })])))

  expect(saved.blocks[0]).toMatchObject({ asset: { id: PICTURE.id, type: "jpeg", width: 1200, height: 900 } })
  expect(JSON.stringify(saved)).not.toContain("signed")
})

it("needs exactly one picture in an image block", () => {
  const embedded = "data:image/png;base64,iVBORw0KGgo="

  expect(() => parseTemplateContent(contentWith([image({})]))).toThrow()
  expect(() => parseTemplateContent(contentWith([image({ asset: PICTURE, dataUrl: embedded })]))).toThrow()
})

it("shows a stored picture at its signed address and an older one from its own data", () => {
  expect(imageSource(PICTURE, null)).toBe(PICTURE.url)
  expect(imageSource(null, "data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA")
  expect(imageSource({ ...PICTURE, url: undefined }, null)).toBeNull()
})

it("reaches every stored picture, the logo included", () => {
  const seen: string[] = []

  mapImageAssets(contentWith([image({ asset: { ...PICTURE, id: "40000000-0000-4000-8000-000000000002" } })]), (asset) => {
    seen.push(asset.id)
    return asset
  })

  expect(seen.sort()).toEqual([PICTURE.id, "40000000-0000-4000-8000-000000000002"].sort())
})
