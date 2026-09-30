import type {
  BlockFrame,
  TemplateBlock,
  TemplateBranding,
  TemplateContent,
  TemplateContentV3,
  TemplateFieldGroup,
  TemplateLayout,
  TemplateSection
} from "@/types/template"
import { getVisibleTemplateBlocks } from "@/types/template-visibility"

/** Rendering contexts supported by the shared template projection. */
export type TemplateRenderMode = "build" | "preview" | "test" | "final"

/**
 * Page geometry resolved from version-three layout controls, in design points:
 * the page the content is laid out on. Multiplying by `scale` gives the paper.
 */
export type TemplatePageGeometry = Readonly<{
  widthPoints: number
  heightPoints: number
  marginPoints: number
  margins: Readonly<{ top: number; right: number; bottom: number; left: number }>
  contentWidthPoints: number
  contentHeightPoints: number
  /** Physical points per design point. */
  scale: number
}>

/** One canonical block decorated with its structural rendering metadata. */
export type TemplateRenderBlock = Readonly<{
  block: TemplateBlock
  canonicalIndex: number
  sectionId: string | null
  sectionLabel: string | null
  fieldGroupId: string | null
  fieldGroupLabel: string | null
  /** How many blocks its row sets side by side (1 when it is in no row). */
  fieldGroupColumns: number
  /** The row's column widths in twelfths, or null for equal columns. */
  fieldGroupWidths: readonly number[] | null
  pageBreakBefore: boolean
  keepTogether: boolean
  keepWithNext: boolean
  /** Extra space above it, in points. */
  spaceAbove: number
  /** Where it sits across the page on a line of its own, or null for the whole width. */
  frame: BlockFrame | null
}>

/** One visible section in canonical root-block order. */
export type TemplateRenderSection = Readonly<{
  id: string | null
  label: string | null
  pageBreakBefore: boolean
  keepTogether: boolean
  blocks: readonly TemplateRenderBlock[]
}>

/** Renderer-neutral projection consumed by web and PDF adapters. */
export type TemplateRenderPlan = Readonly<{
  title: string
  branding: TemplateBranding
  layout: TemplateLayout
  geometry: TemplatePageGeometry
  sections: readonly TemplateRenderSection[]
  blocks: readonly TemplateRenderBlock[]
}>

/** Input used to create a renderer-neutral template projection. */
export type CreateTemplateRenderPlanInput = Readonly<{
  title: string
  content: TemplateContent
  answers?: Readonly<Record<string, unknown>>
  mode: TemplateRenderMode
}>

const DEFAULT_LAYOUT: TemplateLayout = {
  pageSize: "A4",
  orientation: "portrait",
  marginPreset: "standard",
  density: "balanced",
  printedTitle: { mode: "linked" },
  headerPolicy: "first_page",
  footerPolicy: "all_pages",
  pageNumbering: "page_x_of_y"
}

const PAGE_SIZE_POINTS: Readonly<
  Record<TemplateLayout["pageSize"], readonly [number, number]>
> = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008]
}

const MARGIN_POINTS: Readonly<
  Record<TemplateLayout["marginPreset"], number>
> = {
  compact: 28,
  standard: 40,
  generous: 56
}

/**
 * Projects canonical template content into one shared rendering contract.
 *
 * Build mode deliberately includes conditionally hidden fields so authors can
 * still select and edit them. Preview, Test, and final output use the shared
 * answer-aware visibility rules. The function does not mutate or persist an
 * immutable version-two snapshot.
 *
 * @param input - Template metadata, canonical content, answers, and context.
 * @returns A renderer-neutral plan in canonical root-block order.
 */
export function createTemplateRenderPlan(
  input: CreateTemplateRenderPlanInput
): TemplateRenderPlan {
  const layout = resolveTemplateLayout(input.content)
  const visibleBlocks =
    input.mode === "build"
      ? input.content.blocks
      : getVisibleTemplateBlocks(input.content, input.answers ?? {})
  const canonicalIndexById = new Map<string, number>(
    input.content.blocks.map(
      (block: TemplateBlock, index: number): readonly [string, number] => [
        block.id,
        index
      ]
    )
  )
  const structure = createStructureIndex(input.content, canonicalIndexById)
  const opened = new Set<IndexedSection>()
  const blocks = visibleBlocks.map(
    (block: TemplateBlock): TemplateRenderBlock =>
      decorateRenderBlock(block, canonicalIndexById, structure, opened)
  )

  return {
    title: resolvePrintedTitle(input.title, layout),
    branding: input.content.branding,
    layout,
    geometry: resolvePageGeometry(layout),
    sections: groupBlocksIntoSections(blocks, structure.sections),
    blocks
  }
}

/**
 * Determines whether a repeated header is shown on one one-based page.
 *
 * @param layout - Resolved template layout.
 * @param pageNumber - One-based page number.
 * @returns Whether the header belongs on that page.
 */
export function shouldRenderTemplateHeader(
  layout: TemplateLayout,
  pageNumber: number
): boolean {
  return shouldRenderRepeatedRegion(layout.headerPolicy, pageNumber)
}

/**
 * Determines whether a repeated footer is shown on one one-based page.
 *
 * @param layout - Resolved template layout.
 * @param pageNumber - One-based page number.
 * @returns Whether the footer belongs on that page.
 */
export function shouldRenderTemplateFooter(
  layout: TemplateLayout,
  pageNumber: number
): boolean {
  return shouldRenderRepeatedRegion(layout.footerPolicy, pageNumber)
}

type StructureIndex = Readonly<{
  sections: readonly IndexedSection[]
  groups: readonly IndexedFieldGroup[]
  rulesByBlockId: ReadonlyMap<string, TemplateBlockRule>
}>

type TemplateBlockRule = TemplateContentV3["blockRules"][number]

type IndexedSection = Readonly<{
  section: TemplateSection | null
  startIndex: number
  endIndex: number
}>

type IndexedFieldGroup = Readonly<{
  group: TemplateFieldGroup
  startIndex: number
  endIndex: number
}>

function resolveTemplateLayout(content: TemplateContent): TemplateLayout {
  return content.schemaVersion === 3 ? content.layout : DEFAULT_LAYOUT
}

function resolvePrintedTitle(title: string, layout: TemplateLayout): string {
  if (layout.printedTitle.mode === "none") {
    return ""
  }

  return layout.printedTitle.mode === "custom"
    ? layout.printedTitle.text
    : title.trim()
}

/**
 * Resolves the page a layout lays content on, in design points, with the
 * scale that prints it on its paper.
 *
 * @param layout - Version-three layout controls.
 * @returns The design page and its scale.
 */
export function resolvePageGeometry(layout: TemplateLayout): TemplatePageGeometry {
  const [portraitWidth, portraitHeight] = PAGE_SIZE_POINTS[layout.pageSize]
  const scale = layout.contentScale ?? 1
  const widthPoints =
    (layout.orientation === "landscape" ? portraitHeight : portraitWidth) / scale
  const heightPoints =
    (layout.orientation === "landscape" ? portraitWidth : portraitHeight) / scale
  const preset = MARGIN_POINTS[layout.marginPreset]
  const requested = layout.margins ?? { bottom: preset, left: preset, right: preset, top: preset }
  const page = { heightPoints, widthPoints }
  const margins = {
    bottom: Math.min(requested.bottom, maxMargin(page, "bottom")),
    left: Math.min(requested.left, maxMargin(page, "left")),
    right: Math.min(requested.right, maxMargin(page, "right")),
    top: Math.min(requested.top, maxMargin(page, "top")),
  }

  return {
    widthPoints,
    heightPoints,
    marginPoints: margins.left,
    margins,
    contentWidthPoints: widthPoints - margins.left - margins.right,
    contentHeightPoints: heightPoints - margins.top - margins.bottom,
    scale
  }
}

/**
 * The space between paragraphs, in points: the layout's own figure, or its
 * density's, as the PDF prints it.
 *
 * @param layout - The layout.
 * @returns The space, in points.
 */
export function paragraphGap(layout: TemplateLayout): number {
  return layout.paragraphSpacing ?? { balanced: 8, comfortable: 12, compact: 5 }[layout.density]
}

/**
 * What the layout's spacing adds under every block, in points, beyond the
 * space each kind of block leaves of its own (8 points under a paragraph).
 *
 * @param layout - The layout.
 * @returns The points added, or taken away when negative.
 */
export function blockSpacingAdjustment(layout: TemplateLayout): number {
  return paragraphGap(layout) - 8
}

/**
 * The gap between a row's columns, in points: a fortieth of the text's width,
 * kept between 10 and 16.
 *
 * @param contentWidthPoints - The width between the side margins.
 * @returns The gap, in points.
 */
export function columnGap(contentWidthPoints: number): number {
  return Math.min(16, Math.max(10, contentWidthPoints * 0.025))
}

/** A side of the page, for its margin. */
export type PageSide = keyof TemplatePageGeometry["margins"]

/**
 * The widest one margin may be: two inches, as a saved layout allows, and
 * never more than two fifths of the page.
 *
 * @param page - The page's size, in design points.
 * @param side - The margin's side.
 * @returns The widest margin, in design points.
 */
export function maxMargin(page: Readonly<{ heightPoints: number; widthPoints: number }>, side: PageSide): number {
  return Math.min(144, Math.floor((side === "left" || side === "right" ? page.widthPoints : page.heightPoints) * 0.4))
}

/**
 * Moves content to other paper or turns the page without breaking it. New
 * paper scales the content with the paper's short side, so the page looks the
 * same, only bigger or smaller. Turning the page keeps text at its size.
 *
 * @param layout - The layout the content was made on.
 * @param change - The new paper size, orientation, or both.
 * @returns The layout with the change and the scale that keeps it in proportion.
 */
export function resizeTemplateLayout(
  layout: TemplateLayout,
  change: Partial<Pick<TemplateLayout, "orientation" | "pageSize">>
): TemplateLayout {
  const pageSize = change.pageSize ?? layout.pageSize
  const shortSide = (size: TemplateLayout["pageSize"]): number =>
    Math.min(...PAGE_SIZE_POINTS[size])
  const scale =
    ((layout.contentScale ?? 1) * shortSide(pageSize)) /
    shortSide(layout.pageSize)
  // Six decimals keep a round trip back to the original paper exact, and the
  // design page within a hundredth of a point of the one it was made on.
  const contentScale = Math.min(4, Math.max(0.25, Math.round(scale * 1e6) / 1e6))
  const resized: TemplateLayout = { ...layout, ...change, contentScale }

  // A scale of 1 is the default, so content that returns to its paper is saved
  // exactly as it was made.
  if (contentScale === 1) {
    delete resized.contentScale
  }

  return resized
}

function createStructureIndex(
  content: TemplateContent,
  canonicalIndexById: ReadonlyMap<string, number>
): StructureIndex {
  if (content.schemaVersion === 2) {
    return {
      sections:
        content.blocks.length === 0
          ? []
          : [
              {
                section: null,
                startIndex: 0,
                endIndex: content.blocks.length - 1
              }
            ],
      groups: [],
      rulesByBlockId: new Map()
    }
  }

  let sections: IndexedSection[]

  if (content.sections.length === 0) {
    sections =
      content.blocks.length === 0
        ? []
        : [
            {
              section: null,
              startIndex: 0,
              endIndex: content.blocks.length - 1
            }
          ]
  } else {
    // What comes before the first section belongs to none and prints no title.
    const firstStartIndex = canonicalIndexById.get(content.sections[0]?.startBlockId ?? "") ?? 0
    const opening: IndexedSection[] =
      firstStartIndex > 0 ? [{ section: null, startIndex: 0, endIndex: firstStartIndex - 1 }] : []

    sections = [...opening, ...content.sections.map(
      (section: TemplateSection, index: number): IndexedSection => {
        const startIndex = canonicalIndexById.get(section.startBlockId) ?? 0
        const nextSection = content.sections[index + 1]
        const nextStartIndex = nextSection
          ? (canonicalIndexById.get(nextSection.startBlockId) ??
            content.blocks.length)
          : content.blocks.length

        return {
          section,
          startIndex,
          endIndex: Math.max(startIndex, nextStartIndex - 1)
        }
      }
    )]
  }
  const groups = content.fieldGroups.map(
    (group: TemplateFieldGroup): IndexedFieldGroup => ({
      group,
      startIndex: canonicalIndexById.get(group.startBlockId) ?? -1,
      endIndex: canonicalIndexById.get(group.endBlockId) ?? -1
    })
  )
  const rulesByBlockId = new Map(
    content.blockRules.map((rule): readonly [string, TemplateBlockRule] => [rule.blockId, rule])
  )

  return { sections, groups, rulesByBlockId }
}

function decorateRenderBlock(
  block: TemplateBlock,
  canonicalIndexById: ReadonlyMap<string, number>,
  structure: StructureIndex,
  opened: Set<IndexedSection>
): TemplateRenderBlock {
  const canonicalIndex = canonicalIndexById.get(block.id) ?? -1
  const indexedSection = structure.sections.find(
    (candidate: IndexedSection): boolean =>
      canonicalIndex >= candidate.startIndex &&
      canonicalIndex <= candidate.endIndex
  )
  // A section starts its page at its first block that shows, even when a
  // hidden field opens it.
  const opensSection = indexedSection !== undefined && !opened.has(indexedSection)

  if (indexedSection) {
    opened.add(indexedSection)
  }
  const indexedGroup = structure.groups.find(
    (candidate: IndexedFieldGroup): boolean =>
      canonicalIndex >= candidate.startIndex &&
      canonicalIndex <= candidate.endIndex
  )
  const rule = structure.rulesByBlockId.get(block.id)

  return {
    block,
    canonicalIndex,
    sectionId: indexedSection?.section?.id ?? null,
    sectionLabel: indexedSection?.section?.label ?? null,
    fieldGroupId: indexedGroup?.group.id ?? null,
    fieldGroupLabel: indexedGroup?.group.label ?? null,
    fieldGroupColumns: indexedGroup?.group.columns ?? 1,
    fieldGroupWidths: indexedGroup?.group.widths ?? null,
    pageBreakBefore:
      (opensSection && indexedSection.section?.pageBreakBefore === true) ||
      rule?.pageBreakBefore === true,
    keepTogether:
      indexedSection?.section?.keepTogether === true ||
      indexedGroup?.group.keepTogether === true,
    keepWithNext: rule?.keepWithNext === true,
    spaceAbove: rule?.spaceAbove ?? 0,
    // A block in a row takes its column instead.
    frame: indexedGroup && indexedGroup.group.columns > 1 ? null : (rule?.frame ?? null)
  }
}

function groupBlocksIntoSections(
  blocks: readonly TemplateRenderBlock[],
  indexedSections: readonly IndexedSection[]
): TemplateRenderSection[] {
  if (blocks.length === 0) {
    return []
  }

  const sections: TemplateRenderSection[] = []

  for (const indexedSection of indexedSections) {
    const sectionBlocks = blocks.filter(
      (block: TemplateRenderBlock): boolean =>
        block.canonicalIndex >= indexedSection.startIndex &&
        block.canonicalIndex <= indexedSection.endIndex
    )

    if (sectionBlocks.length === 0) {
      continue
    }

    sections.push({
      id: indexedSection.section?.id ?? null,
      label: indexedSection.section?.label ?? null,
      pageBreakBefore: indexedSection.section?.pageBreakBefore ?? false,
      keepTogether: indexedSection.section?.keepTogether ?? false,
      blocks: sectionBlocks
    })
  }

  return sections
}

function shouldRenderRepeatedRegion(
  policy: TemplateLayout["headerPolicy"],
  pageNumber: number
): boolean {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return false
  }

  return policy === "all_pages" || (policy === "first_page" && pageNumber === 1)
}
