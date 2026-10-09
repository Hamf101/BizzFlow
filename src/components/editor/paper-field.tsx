"use client"

import { Check } from "lucide-react"
import { createContext, type CSSProperties, type ReactElement, type ReactNode, useContext } from "react"

import { typedInput } from "@/components/ui/typed-input"
import { DrawnSignatureField } from "@/components/documents/drawn-signature-field"
import { getGeneratedDocumentAnswerName } from "@/components/documents/generated-document-form-data"
// Imported with the page, not after it, so the canvas measures their real height.
import { EDGE, PaperGrid, PaperTable, RULE } from "@/components/editor/paper-answer-kinds"
import { DatePicker } from "@/components/ui/date-picker"
import { RequiredStandIn } from "@/components/ui/required-stand-in"
import { Select } from "@/components/ui/select"
import { describeDateFormat, formatDateAnswer } from "@/lib/date-format"
import { cn } from "@/lib/utils"
import { boxNote, boxSigner } from "@/types/box-signers"
import type { TemplateBlock, TemplateLayout, TextFieldBlock } from "@/types/template"
import { isTemplateAnswerComplete } from "@/types/template-answer"
import { readChoiceList } from "@/types/template-answer-kinds"


type FieldBlock = Extract<TemplateBlock, { fieldKey: string }>
type FieldStyle = NonNullable<TemplateLayout["fieldStyle"]>

/**
 * Space the PDF leaves around a block, as CSS: its own points, plus what the
 * layout's spacing adds under every block, never below nothing.
 *
 * @param points - The block's own space, in points.
 * @param adjusted - Whether the layout's spacing applies; it does below a block, not above.
 * @returns A CSS length.
 */
export function printedSpace(points: number, adjusted = true): string {
  return adjusted ? `max(0px, calc(${points} * var(--doc-pt) + var(--doc-adjust, 0px)))` : `calc(${points} * var(--doc-pt))`
}

/** A heading prints in the page's face, not the app's, and without the app's tightened letters. */
export const PRINTED_HEADING: CSSProperties = { fontFamily: "inherit", letterSpacing: "normal" }

/** A section's title as it prints: 15 points bold on 22, with 10 points under it. */
export const SECTION_TITLE: CSSProperties = {
  ...PRINTED_HEADING,
  color: "var(--doc-primary)",
  fontSize: "1.5em",
  lineHeight: 22 / 15,
  marginBottom: printedSpace(10),
}

// The PDF's field, in ems of its 10-point text, so the page shows each field
// at the size and place it prints (see drawPdfLibField): a 9-point bold
// label, a box two lines tall (four when multi-line, 56 points for a
// signature) padded by 6 points, and 7-point help beneath.
const BOX_HEIGHT = { line: 3, lines: 6, drawing: 5.6 } as const
// A comb box prints 16 points wide and 22 tall.
const COMB = { height: 2.2, width: 1.6 } as const
// A long answer in the line style is written on rules 20 points apart, the
// page's faint edge colour, as it prints.
const RULED: CSSProperties = {
  backgroundImage: "linear-gradient(to bottom, transparent calc(2em - 0.07em), var(--color-border) calc(2em - 0.07em))",
  backgroundSize: "100% 2em",
  lineHeight: 2,
}
// A control inside a box is bare: the box is the field.
/**
 * Set by a page whose form is submitted, such as a link someone answers: each
 * required field is then required in the browser, and the message for a field
 * it refused, by block id, shows under that field.
 */
export const PaperAnswering = createContext<Readonly<Record<string, string>> | null>(null)

/**
 * Set by a document that is sent for signing: each drawn box is then its
 * signer's, and only the sender's own box is drawn here, until it is sent.
 * Its signers, in the order they were added, say whose boxes are signed.
 */
export const PaperSigning = createContext<Readonly<{ sent: boolean; signers: ReadonlyArray<{ status: string }> }> | null>(null)

const BARE =
  "h-auto min-h-0 rounded-none border-0 bg-transparent p-0 text-[1em] leading-[1.5] shadow-none focus-visible:border-0 focus-visible:ring-0 data-popup-open:border-0 md:h-auto md:text-[1em]"

/**
 * A field as it prints: its label, and the box its answer is written in. The
 * author sees what each box will hold; someone filling it in types into the
 * box itself, and a finished document shows the answers.
 *
 * @param props - The field, how it is shown, the answers, and where a changed one goes.
 * @returns The field.
 */
export function PaperField({
  answers,
  block,
  edge,
  fieldStyle = "box",
  mode,
  onAnswerChange,
  renderFile,
}: {
  answers: Readonly<Record<string, unknown>>
  block: FieldBlock
  /** What changes the box's height, along its foot. */
  edge?: ReactNode
  /** How the document draws its answers: in a box, on a line, or in a cell. */
  fieldStyle?: FieldStyle
  mode: "design" | "fill" | "read"
  onAnswerChange: (fieldKey: string, value: unknown) => void
  /** What a page that takes uploads puts in a file field while it is filled in. */
  renderFile?: (block: Extract<FieldBlock, { type: "file_field" }>) => ReactNode
}): ReactElement {
  const fill = mode === "fill"
  const errors = useContext(PaperAnswering)
  const signing = useContext(PaperSigning)
  const required = fill && errors !== null && block.required
  const value = answers[block.fieldKey]
  const text = typeof value === "string" ? value : ""
  const set = (next: unknown): void => onAnswerChange(block.fieldKey, next)
  const textName = getGeneratedDocumentAnswerName("text", block.fieldKey)
  const star = block.required ? <span className="text-destructive"> *</span> : null
  // Not a <label>: a press on it takes the field to arrange it, and the box takes answers.
  const title = (
    <span className="font-bold" style={{ fontSize: "0.9em", lineHeight: 13 / 9, marginBottom: "0.3em" }}>
      {block.label}
      {star}
    </span>
  )

  // A grid and a table print with their own rules, under the field's title.
  if (block.type === "choice_grid_field" || block.type === "table_field") {
    return (
      <div className="flex flex-col">
        {title}
        {block.type === "choice_grid_field" ? (
          <PaperGrid block={block} mode={mode} onChange={set} value={value} />
        ) : (
          <PaperTable block={block} mode={mode} onChange={set} value={value} />
        )}
        {required ? <RequiredStandIn filled={isTemplateAnswerComplete(block, value)} label={block.label} /> : null}
        <Help block={block} />
      </div>
    )
  }

  if (block.type === "checkbox_field") {
    const checked = value === undefined ? block.checkedByDefault : value === true
    const booleanName = getGeneratedDocumentAnswerName("boolean", block.fieldKey)

    return (
      <div className="relative" style={{ lineHeight: 1.5, paddingLeft: "1.6em" }}>
        {fill ? (
          <>
            <input name={booleanName} type="hidden" value="false" />
            <input
              aria-label={block.label}
              checked={checked}
              className="peer absolute top-[0.2em] left-0 size-[1em] cursor-pointer opacity-0"
              id={block.id}
              name={booleanName}
              required={required}
              onChange={(event) => set(event.target.checked)}
              type="checkbox"
              value="true"
            />
          </>
        ) : null}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[0.2em] left-0 flex size-[1em] items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40"
          style={{ border: RULE }}
        >
          {checked && mode !== "design" ? <Check className="size-[0.85em]" strokeWidth={3} /> : null}
        </span>
        {/* The box is drawn; read, it says whether it is ticked. */}
        {mode === "read" ? <span className="sr-only">{checked ? "Checked: " : "Not checked: "}</span> : null}
        {block.label}
        {star}
        <Help block={block} inset="-1.6em" />
      </div>
    )
  }

  let answer: ReactNode
  let height: number = BOX_HEIGHT.line
  // A box its author made taller or shorter, in ems of the 10-point text.
  const sized = "boxHeight" in block && block.boxHeight !== undefined ? block.boxHeight / 10 : undefined
  const placeholder = (words: string): ReactElement => <span className="text-muted-foreground">{words}</span>
  // A long answer's rules, as many as its box is tall to the nearest 20 points.
  const rules = Math.max(1, Math.round((sized ?? BOX_HEIGHT.lines) / 2))
  const ruled = fieldStyle === "line" && block.type === "text_field" && block.multiline

  switch (block.type) {
    case "text_field":
      height = block.multiline ? BOX_HEIGHT.lines : BOX_HEIGHT.line
      answer = fill ? (
        block.multiline ? (
          <textarea
            aria-label={block.label}
            className="w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground"
            id={block.id}
            maxLength={20_000}
            name={textName}
            onChange={(event) => set(event.target.value)}
            placeholder={block.placeholder ?? undefined}
            required={required}
            // It grows with its answer, as the printed box does.
            style={ruled ? { ...RULED, fieldSizing: "content", minHeight: `${rules * 2}em` } : { fieldSizing: "content", minHeight: `${(sized ?? BOX_HEIGHT.lines) - 1.2}em` }}
            value={text}
          />
        ) : (
          <input
            aria-label={block.label}
            className={cn(
              "w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground",
              // One character a box: a fixed face spaced to the boxes' width.
              block.comb && "absolute inset-0 font-mono tracking-[calc(var(--comb)-1ch)] [padding-inline:calc((var(--comb)-1ch)/2)] leading-none"
            )}
            id={block.id}
            maxLength={block.comb ?? 20_000}
            name={textName}
            onChange={(event) => set(event.target.value)}
            placeholder={block.comb ? undefined : (block.placeholder ?? undefined)}
            required={required}
            value={text}
            {...typedInput(block.format)}
          />
        )
      ) : mode === "read" ? (
        <span className="whitespace-pre-wrap">{text}</span>
      ) : (
        placeholder(block.placeholder || (block.comb ? "" : "Text"))
      )
      if (block.comb) {
        answer = <PaperComb block={{ ...block, comb: block.comb }} input={fill ? (answer as ReactElement) : undefined} text={text} />
      }

      answer = <Affixed block={block}>{answer}</Affixed>
      break
    case "date_field":
      answer = fill ? (
        <DatePicker aria-label={block.label} className={BARE} format={block.dateFormat} id={block.id} name={textName} onChange={set} required={required} value={text} />
      ) : mode === "read" ? (
        formatDateAnswer(text, block.dateFormat)
      ) : (
        placeholder(describeDateFormat(block.dateFormat))
      )
      break
    case "dropdown_field":
      answer = fill ? (
        <Select aria-label={block.label} className={BARE} id={block.id} name={textName} onChange={(event) => set(event.target.value)} required={required} value={text}>
          <option value="">{block.placeholder || "Select an option"}</option>
          {block.options.map((option: string) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : mode === "read" ? (
        text
      ) : (
        placeholder(block.placeholder || "Choose an option")
      )
      break
    case "signature_field":
    case "initials_field": {
      height = BOX_HEIGHT.drawing
      // On a document, a box is its signer's; only the sender draws here, until it is sent.
      const signer = boxSigner(block)
      answer = fill && (!signing || (signer === "sender" && !signing.sent)) ? (
        <DrawnSignatureField
          bare
          label={block.label}
          name={getGeneratedDocumentAnswerName("drawing", block.fieldKey)}
          required={required}
          saved={text}
        />
      ) : text ? (
        // eslint-disable-next-line @next/next/no-img-element -- a drawn data URL, already sized
        <img alt={`Saved ${block.label}`} className="doc-drawing max-h-[4.5em] max-w-[15em] object-contain object-left" src={text} />
      ) : mode === "design" || (signing && signer !== "sender") ? (
        placeholder(boxNote(block, signing?.signers ?? []))
      ) : null
      break
    }
    case "file_field":
      answer = fill && renderFile ? renderFile(block) : placeholder(mode === "design" ? "Choose a file" : "Uploads are only in submissions.")
      break
  }

  // Radio buttons and checkboxes print with no box: each option beside a
  // circle, or a square when any number may be ticked, one a line or side by side.
  if (block.type === "dropdown_field" && (block.display === "radios" || block.multiple)) {
    const Option = fill ? "label" : "div"
    const several = block.multiple === true
    const ticked = readChoiceList(value)

    return (
      <div className="flex flex-col">
        {title}
        <div
          aria-label={fill ? block.label : undefined}
          className={cn(block.across && "flex flex-wrap gap-x-[1.8em]")}
          role={fill ? (several ? "group" : "radiogroup") : undefined}
          style={{ lineHeight: 1.5 }}
        >
          {/* Nothing chosen still answers, as an empty dropdown does. */}
          {required && several ? <RequiredStandIn filled={isTemplateAnswerComplete(block, ticked)} label={block.label} /> : null}
          {fill ? (
            several ? (
              <input name={getGeneratedDocumentAnswerName("json", block.fieldKey)} type="hidden" value={JSON.stringify(ticked)} />
            ) : (
              <input name={textName} type="hidden" value="" />
            )
          ) : null}
          {block.options.map((option: string) => {
            const chosen = mode !== "design" && (several ? ticked.includes(option) : text === option)

            return (
              <Option className={cn("relative block", fill && "cursor-pointer")} key={option} style={{ paddingLeft: "1.6em" }}>
                {fill ? (
                  <input
                    checked={chosen}
                    className="peer absolute top-[0.2em] left-0 size-[1em] cursor-pointer opacity-0"
                    name={several ? undefined : textName}
                    onChange={() =>
                      // Ticks keep the options' order, whatever order they were ticked in.
                      set(several ? block.options.filter((other) => (other === option ? !chosen : ticked.includes(other))) : option)
                    }
                    required={required && !several}
                    type={several ? "checkbox" : "radio"}
                    value={option}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute top-[0.2em] left-0 flex size-[1em] items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40",
                    !several && "rounded-full"
                  )}
                  style={{ border: RULE }}
                >
                  {chosen ? several ? <Check className="size-[0.85em]" strokeWidth={3} /> : <span className="size-[0.5em] rounded-full bg-current" /> : null}
                </span>
                {chosen && !fill ? <span className="sr-only">Chosen: </span> : null}
                {option}
              </Option>
            )
          })}
        </div>
        <Help block={block} />
      </div>
    )
  }

  if (fieldStyle !== "box" && block.type !== "file_field") {
    const drawing = height === BOX_HEIGHT.drawing

    return fieldStyle === "cell" ? (
      // A bordered cell, its label small in the corner and its help inside, so
      // cells beside and below it share their edges (see the canvas's rules).
      <div
        // A row's cells are as tall as its tallest, so the next row sits on all of them.
        className={cn("relative flex h-full flex-col transition-colors focus-within:ring-2 focus-within:ring-ring/40", fill && "cursor-text")}
        data-paper-cell=""
        style={{ border: RULE, lineHeight: 1.5, marginBottom: "calc(3 * var(--doc-pt))", padding: "0.4em" }}
      >
        <span className="text-muted-foreground" style={{ fontSize: "0.7em", lineHeight: 10 / 7, marginBottom: "calc(0.2em / 0.7)" }}>
          {block.label}
          {star}
        </span>
        <div className="relative flex flex-col" style={{ minHeight: `${drawing ? (sized ?? height) : block.type === "text_field" && block.multiline ? (sized ?? BOX_HEIGHT.lines) - 1.2 : 1.5}em` }}>
          {answer}
          {edge}
        </div>
        {block.helpText ? (
          <span className="text-muted-foreground" style={{ fontSize: "0.7em", lineHeight: 10 / 7 }}>
            {block.helpText}
          </span>
        ) : null}
        <Refused blockId={block.id} />
      </div>
    ) : drawing ? (
      // Signed on a line, named by a caption under it.
      <div className="flex flex-col" data-paper-line="">
        <div className="relative flex flex-col" style={{ borderBottom: RULE, lineHeight: 1.5, minHeight: `${sized ?? height}em` }}>
          {answer}
          {edge}
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground" style={{ fontSize: "0.8em", lineHeight: 11 / 8, marginTop: "calc(0.2em / 0.8)" }}>
            {block.label}
            {star}
          </span>
          <Help block={block} />
        </div>
      </div>
    ) : ruled ? (
      // A long answer: its label, then lines to write on.
      <div className="flex flex-col" data-paper-line="">
        <div className="flex flex-col">
          <span style={{ lineHeight: 1.5, marginBottom: "calc(3 * var(--doc-pt))" }}>
            {block.label}
            {star}
          </span>
          <div className="relative flex flex-col transition-colors focus-within:ring-2 focus-within:ring-ring/40" style={fill ? undefined : { ...RULED, minHeight: `${rules * 2}em` }}>
            {fill ? answer : <span className="whitespace-pre-wrap">{answer}</span>}
            {edge}
          </div>
        </div>
        <Help block={block} />
      </div>
    ) : (
      // The label, and beside it the line its answer is written on.
      <div className="flex flex-col" data-paper-line="">
        {/* A wrapped label's last line and the answer sit together on the line. */}
        <div className="flex items-end" style={{ gap: "0.6em", lineHeight: 1.5 }}>
          <span className="max-w-[45%] shrink-0" style={{ paddingBottom: "0.27em" }}>
            {block.label}
            {star}
          </span>
          <div
            className={cn("min-w-0 flex-1 transition-colors focus-within:border-ring focus-within:shadow-[0_0.07em_0_0_var(--color-ring)]", fill && "cursor-text")}
            style={{ borderBottom: RULE, paddingBottom: "0.2em" }}
          >
            {answer}
          </div>
        </div>
        <Help block={block} />
      </div>
    )
  }

  // Comb boxes are the answer's box.
  if (block.type === "text_field" && block.comb) {
    return (
      <div className="flex flex-col">
        {title}
        {answer}
        <Help block={block} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {title}
      <div
        className={cn(
          "relative flex flex-col border-border transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
          fill && block.type !== "file_field" && "cursor-text",
          // Faint until a pointer comes over it, drawn in full while it takes an answer.
          mode !== "read" && "hover:border-muted-foreground/60"
        )}
        data-slot="paper-box"
        style={{
          borderBottomColor: height === BOX_HEIGHT.drawing ? EDGE : undefined,
          borderStyle: "solid",
          borderWidth: "0.07em",
          lineHeight: 1.5,
          minHeight: `${sized ?? height}em`,
          padding: "0.6em",
        }}
      >
        {answer}
        {edge}
      </div>
      {block.type === "file_field" && fill && renderFile ? (
        <span className="block text-muted-foreground" style={{ fontSize: "0.7em", lineHeight: 10 / 7, marginTop: "calc(3 * var(--doc-pt))" }}>
          PDF, PNG, JPG, DOCX, XLSX or CSV, up to 20 MB.
        </span>
      ) : null}
      <Help block={block} />
    </div>
  )
}

// Help prints 3 points under its field, flush with the field's left edge;
// the gap is kept with no help too, as the PDF keeps it.
function Help({ block, inset }: { block: FieldBlock; inset?: string }): ReactElement {
  return (
    <>
      <span className="block text-muted-foreground" style={{ fontSize: "0.7em", lineHeight: 10 / 7, marginLeft: inset && `calc(${inset} / 0.7)`, marginTop: "calc(3 * var(--doc-pt))" }}>
        {block.helpText}
      </span>
      <Refused blockId={block.id} inset={inset} />
    </>
  )
}

// Why the browser refused this field, under it, until it is answered.
function Refused({ blockId, inset }: { blockId: string; inset?: string }): ReactElement | null {
  const message = useContext(PaperAnswering)?.[blockId]

  return message ? (
    <span className="block text-destructive" id={`${blockId}-error`} role="alert" style={{ fontSize: "0.8em", marginLeft: inset && `calc(${inset} / 0.8)`, marginTop: "0.2em" }}>
      {message}
    </span>
  ) : null
}

/**
 * An answer written one character a box, as a reference or account number
 * prints: boxes of 16 by 22 points, narrowed to fit a narrow column.
 *
 * @param props - The field, its answer, and its input when it is being filled in.
 * @returns The row of boxes.
 */
export function PaperComb({ block, input, text }: { block: TextFieldBlock & { comb: number }; input?: ReactElement; text: string }): ReactElement {
  // Measured against the column, not the font, so the typed letters and the boxes agree.
  const width = `min(${COMB.width}em, max(1em, 100cqw / ${block.comb}))`

  return (
    <div className="@container w-full">
      <div
        className="relative flex"
        style={{
          ["--comb" as string]: width,
          height: `${COMB.height}em`,
          width: `calc(${width} * ${block.comb})`,
        }}
      >
        {Array.from({ length: block.comb }, (_, at) => (
          <span
            className="flex flex-1 items-center justify-center"
            key={at}
            style={{ borderBottom: RULE, borderLeft: RULE, borderRight: at === block.comb - 1 ? RULE : undefined, borderTop: RULE }}
          >
            {input ? null : text[at]}
          </span>
        ))}
        {input}
      </div>
    </div>
  )
}

/**
 * An answer between the words printed before and after it, such as "£" and
 * "per month", in the label's colour.
 *
 * @param props - The field and its answer.
 * @returns The answer with its words around it.
 */
export function Affixed({ block, children }: { block: TextFieldBlock; children: ReactNode }): ReactElement {
  if (!block.prefix && !block.suffix) {
    return <>{children}</>
  }

  return (
    <span className="flex min-w-0 items-baseline gap-[0.3em]">
      {block.prefix ? <span className="shrink-0 text-muted-foreground">{block.prefix}</span> : null}
      <span className={cn("min-w-0 flex-1")}>{children}</span>
      {block.suffix ? <span className="shrink-0 text-muted-foreground">{block.suffix}</span> : null}
    </span>
  )
}
