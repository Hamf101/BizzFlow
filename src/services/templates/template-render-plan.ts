import type {
  TemplateBlock,
  TemplateBranding,
  TemplateContent,
  TemplateFieldGroup,
  TemplateLayout,
  TemplateSection
} from "@/types/template"
import { getVisibleTemplateBlocks } from "@/types/template-visibility"

/** Rendering contexts supported by the shared template projection. */
export type TemplateRenderMode = "build" | "preview" | "test" | "final"

/** Physical page geometry resolved from version-three layout controls. */
export type TemplatePageGeometry = Readonly<{
  widthPoints: number
  heightPoints: number
  marginPoints: number
  contentWidthPoints: number
  contentHeightPoints: number
}>

/** One canonical block decorated with its structural rendering metadata. */
export type TemplateRenderBlock = Readonly<{
  block: TemplateBlock
  canonicalIndex: number
  sectionId: string | null
  sectionLabel: string | null
  fieldGroupId: string | null
  fieldGroupLabel: string | null
  fieldGroupColumns: 1 | 2
  pageBreakBefore: boolean
  keepTogether: boolean
  keepWithNext: boolean
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
  const blocks = visibleBlocks.map(
    (block: TemplateBlock): TemplateRenderBlock =>
      decorateRenderBlock(block, canonicalIndexById, structure)
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
  rulesByBlockId: ReadonlyMap<
    string,
    Readonly<{ pageBreakBefore: boolean; keepWithNext: boolean }>
  >
}>

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
  return layout.printedTitle.mode === "custom"
    ? layout.printedTitle.text
    : title.trim()
}

function resolvePageGeometry(layout: TemplateLayout): TemplatePageGeometry {
  const [portraitWidth, portraitHeight] = PAGE_SIZE_POINTS[layout.pageSize]
  const widthPoints =
    layout.orientation === "landscape" ? portraitHeight : portraitWidth
  const heightPoints =
    layout.orientation === "landscape" ? portraitWidth : portraitHeight
  const marginPoints = MARGIN_POINTS[layout.marginPreset]

  return {
    widthPoints,
    heightPoints,
    marginPoints,
    contentWidthPoints: widthPoints - marginPoints * 2,
    contentHeightPoints: heightPoints - marginPoints * 2
  }
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
    sections = content.sections.map(
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
    )
  }
  const groups = content.fieldGroups.map(
    (group: TemplateFieldGroup): IndexedFieldGroup => ({
      group,
      startIndex: canonicalIndexById.get(group.startBlockId) ?? -1,
      endIndex: canonicalIndexById.get(group.endBlockId) ?? -1
    })
  )
  const rulesByBlockId = new Map(
    content.blockRules.map(
      (rule): readonly [
        string,
        Readonly<{ pageBreakBefore: boolean; keepWithNext: boolean }>
      ] => [
        rule.blockId,
        {
          pageBreakBefore: rule.pageBreakBefore,
          keepWithNext: rule.keepWithNext
        }
      ]
    )
  )

  return { sections, groups, rulesByBlockId }
}

function decorateRenderBlock(
  block: TemplateBlock,
  canonicalIndexById: ReadonlyMap<string, number>,
  structure: StructureIndex
): TemplateRenderBlock {
  const canonicalIndex = canonicalIndexById.get(block.id) ?? -1
  const indexedSection = structure.sections.find(
    (candidate: IndexedSection): boolean =>
      canonicalIndex >= candidate.startIndex &&
      canonicalIndex <= candidate.endIndex
  )
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
    pageBreakBefore:
      (indexedSection?.startIndex === canonicalIndex &&
        indexedSection.section?.pageBreakBefore === true) ||
      rule?.pageBreakBefore === true,
    keepTogether:
      indexedSection?.section?.keepTogether === true ||
      indexedGroup?.group.keepTogether === true,
    keepWithNext: rule?.keepWithNext === true
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
