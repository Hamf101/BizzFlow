import {
  CalendarDays,
  ChevronDown,
  FileUp,
  FilePlus2,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  PenLine,
  Pilcrow,
  Signature,
  SquareCheck,
  Table,
  TextCursorInput,
} from "lucide-react"

import type { TextBlockKind } from "@/components/editor/editor-content"
import type { TemplateBlock } from "@/types/template"

/** What choosing an item adds: a kind of line, a block, or a new page. */
export type InsertAction =
  | Readonly<{ kind: "text"; value: TextBlockKind }>
  | Readonly<{ kind: "block"; type: TemplateBlock["type"] }>
  | Readonly<{ kind: "page" }>

/** One thing a person can add to the page, from the dock or by typing /. */
export type InsertChoice = Readonly<{
  action: InsertAction
  group: "fields" | "page"
  icon: LucideIcon
  id: string
  /** Extra words the / menu matches, beyond the label. */
  keywords: readonly string[]
  label: string
}>

/** Everything that can be added, in the order the menus show it. */
export const INSERT_CHOICES: readonly InsertChoice[] = [
  { action: { kind: "text", value: { type: "paragraph" } }, group: "page", icon: Pilcrow, id: "paragraph", keywords: ["paragraph", "body"], label: "Text" },
  { action: { kind: "text", value: { level: 1, type: "heading" } }, group: "page", icon: Heading1, id: "heading-1", keywords: ["title", "h1"], label: "Heading 1" },
  { action: { kind: "text", value: { level: 2, type: "heading" } }, group: "page", icon: Heading2, id: "heading-2", keywords: ["subtitle", "h2"], label: "Heading 2" },
  { action: { kind: "text", value: { level: 3, type: "heading" } }, group: "page", icon: Heading3, id: "heading-3", keywords: ["h3"], label: "Heading 3" },
  { action: { kind: "text", value: { type: "bullet_list" } }, group: "page", icon: List, id: "bullet-list", keywords: ["bullets", "unordered"], label: "Bulleted list" },
  { action: { kind: "text", value: { type: "numbered_list" } }, group: "page", icon: ListOrdered, id: "numbered-list", keywords: ["ordered", "steps"], label: "Numbered list" },
  { action: { kind: "block", type: "table" }, group: "page", icon: Table, id: "table", keywords: ["grid", "rows"], label: "Table" },
  { action: { kind: "block", type: "image" }, group: "page", icon: Image, id: "image", keywords: ["picture", "photo", "logo"], label: "Image" },
  { action: { kind: "block", type: "divider" }, group: "page", icon: Minus, id: "divider", keywords: ["line", "rule", "separator"], label: "Divider" },
  { action: { kind: "page" }, group: "page", icon: FilePlus2, id: "page", keywords: ["page break", "new page"], label: "New page" },
  { action: { kind: "block", type: "text_field" }, group: "fields", icon: TextCursorInput, id: "text-field", keywords: ["input", "answer", "name"], label: "Text field" },
  { action: { kind: "block", type: "date_field" }, group: "fields", icon: CalendarDays, id: "date-field", keywords: ["day", "when"], label: "Date" },
  { action: { kind: "block", type: "checkbox_field" }, group: "fields", icon: SquareCheck, id: "checkbox-field", keywords: ["tick", "agree", "consent"], label: "Checkbox" },
  { action: { kind: "block", type: "dropdown_field" }, group: "fields", icon: ChevronDown, id: "dropdown-field", keywords: ["choice", "select", "options"], label: "Dropdown" },
  { action: { kind: "block", type: "initials_field" }, group: "fields", icon: PenLine, id: "initials-field", keywords: ["initial"], label: "Initials" },
  { action: { kind: "block", type: "signature_field" }, group: "fields", icon: Signature, id: "signature-field", keywords: ["sign", "signer"], label: "Signature" },
  { action: { kind: "block", type: "file_field" }, group: "fields", icon: FileUp, id: "file-field", keywords: ["upload", "attachment"], label: "File upload" },
]

/**
 * Lists what can be added where, matching a / query by label or keyword.
 *
 * @param options - Whether file uploads are offered, and an optional query.
 * @returns The matching choices in menu order.
 */
export function findInsertChoices({
  allowFiles,
  query = "",
}: {
  allowFiles: boolean
  query?: string
}): InsertChoice[] {
  const needle = query.trim().toLowerCase()

  return INSERT_CHOICES.filter(
    (choice: InsertChoice): boolean =>
      (allowFiles || choice.id !== "file-field") &&
      (needle.length === 0 ||
        [choice.label, ...choice.keywords].some((word) => word.toLowerCase().includes(needle)))
  )
}
