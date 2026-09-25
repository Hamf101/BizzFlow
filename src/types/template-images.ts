import type { TemplateContent, TemplateImageAsset } from "@/types/template"

/** The longest edge of the copy pages show. */
export const DISPLAY_MAX_EDGE = 1_600

/** The widest print copy: 300 dots per inch across a 10-inch landscape page. */
export const PRINT_MAX_WIDTH = 3_000

/** Largest file accepted for each stored copy of a picture. */
export const IMAGE_COPY_MAX_BYTES = { display: 3_000_000, original: 20_000_000, print: 15_000_000 } as const

/** The stored copies of one picture. */
export type ImageCopy = keyof typeof IMAGE_COPY_MAX_BYTES

/**
 * Where a page can show a picture right now: a stored picture's signed
 * address, or the data of one embedded before pictures were stored.
 *
 * @param asset - The stored picture, if it is one.
 * @param dataUrl - The embedded picture, if it is one.
 * @returns An image source, or null when there is nothing to show yet.
 */
export function imageSource(
  asset: TemplateImageAsset | null | undefined,
  dataUrl: string | null | undefined
): string | null {
  return asset ? (asset.url ?? null) : (dataUrl ?? null)
}

/**
 * Applies one change to every stored picture in a document: each image
 * block's and the logo's.
 *
 * @param content - A template or document's content.
 * @param change - What to do with each stored picture.
 * @returns The content with each stored picture changed.
 */
export function mapImageAssets<Content extends TemplateContent>(
  content: Content,
  change: (asset: TemplateImageAsset) => TemplateImageAsset
): Content {
  const logoAsset = content.branding.logoAsset

  return {
    ...content,
    blocks: content.blocks.map((block) =>
      block.type === "image" && block.asset ? { ...block, asset: change(block.asset) } : block
    ),
    branding: logoAsset ? { ...content.branding, logoAsset: change(logoAsset) } : content.branding,
  }
}

/**
 * Drops the addresses a viewer was given for stored pictures: they expire,
 * and only the pictures themselves are saved.
 *
 * @param content - Content as a page held it.
 * @returns Content fit to save.
 */
export function withoutImageUrls<Content extends TemplateContent>(content: Content): Content {
  return mapImageAssets(content, ({ height, id, type, width }) => ({ height, id, type, width }))
}
