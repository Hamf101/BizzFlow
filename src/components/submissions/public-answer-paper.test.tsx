// @vitest-environment jsdom
import { act } from "react"
import type { Root } from "react-dom/client"
import { beforeAll, expect, it, vi } from "vitest"

import { parseGeneratedDocumentAnswers } from "@/components/documents/generated-document-form-data"
import { createEmptyDocumentContent, templateContentV3Schema } from "@/types/template"

import { PublicAnswerPaper } from "./public-answer-paper"
import { mount } from "@/test/render"

const checkpoint = vi.hoisted(() => vi.fn())
vi.mock("./public-form-file-client", () => ({ checkpointPublicFormDraft: checkpoint }))
vi.mock("./submission-file-client", () => ({ calculateSubmissionFileChecksum: async () => "0".repeat(64), resolveSubmissionFileContentType: () => "application/pdf" }))

const NAME = "70000000-0000-4000-8000-000000000041"
const ACCOUNT = "70000000-0000-4000-8000-000000000042"
const NUMBER = "70000000-0000-4000-8000-000000000043"
const COLOUR = "70000000-0000-4000-8000-000000000044"

const CONTENT = templateContentV3Schema.parse({
  ...createEmptyDocumentContent(),
  blocks: [
    { fieldKey: "name", helpText: null, id: NAME, label: "Your name", multiline: false, placeholder: null, required: true, type: "text_field" },
    { checkedByDefault: false, fieldKey: "has_account", helpText: null, id: ACCOUNT, label: "I have an account", required: false, type: "checkbox_field" },
    {
      fieldKey: "account_number", helpText: null, id: NUMBER, label: "Account number", multiline: false, placeholder: null, required: true, type: "text_field",
      visibleWhen: { operator: "equals", sourceBlockId: ACCOUNT, value: true },
    },
    { display: "radios", fieldKey: "colour", helpText: null, id: COLOUR, label: "Colour", options: ["Red", "Blue"], placeholder: null, required: false, type: "dropdown_field" },
  ],
})

let root: Root
let form: HTMLFormElement

beforeAll(() => {
  window.matchMedia = () => ({ addEventListener() {}, matches: true, removeEventListener() {} }) as unknown as MediaQueryList
  globalThis.ResizeObserver = class { disconnect() {} observe() {} unobserve() {} } as unknown as typeof ResizeObserver
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
})

async function open(): Promise<void> {
  form = document.body.appendChild(document.createElement("form"))
  root = mount(form)
  await act(async () => root.render(<PublicAnswerPaper content={CONTENT} initialAnswers={{}} initialFiles={[]} phone title="Sign-up" token="t" />))
}

const field = (label: string) => form.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!

async function type(label: string, text: string): Promise<void> {
  const input = field(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

it("posts its answers under the names the submit action reads", async () => {
  await open()
  await type("Your name", "Ana")
  await act(async () => field("I have an account").click())
  await type("Account number", "AC-7")
  await act(async () => form.querySelector<HTMLInputElement>('input[value="Blue"]')!.click())

  expect(parseGeneratedDocumentAnswers(new FormData(form))).toEqual({
    account_number: "AC-7",
    colour: "Blue",
    has_account: true,
    name: "Ana",
  })
})

it("holds back an unanswered required field with its reason under it, until it is answered", async () => {
  await open()

  expect(await act(async () => form.checkValidity())).toBe(false)
  const name = field("Your name")
  const reason = document.getElementById(name.getAttribute("aria-describedby") ?? "")
  expect(name.getAttribute("aria-invalid")).toBe("true")
  expect(reason?.getAttribute("role")).toBe("alert")
  expect(reason?.textContent).toBe("Your name is required.")
  expect(reason?.closest(`[data-block-id="${NAME}"]`)).not.toBeNull()

  await type("Your name", "Ana")
  expect(name.hasAttribute("aria-invalid")).toBe(false)
  expect(form.querySelector('[role="alert"]')).toBeNull()
  // The account number is required only once it shows.
  expect(form.checkValidity()).toBe(true)
  await act(async () => field("I have an account").click())
  expect(form.checkValidity()).toBe(false)
})

it("keeps what is typed in the moment the page takes over from the server's", async () => {
  form = document.body.appendChild(document.createElement("form"))
  // The page's form carries the link's token, which is how the paper finds its boxes.
  form.appendChild(Object.assign(document.createElement("input"), { name: "token", type: "hidden", value: "t" }))
  root = mount(form.appendChild(document.createElement("div")))
  // The page's code arrives with the boxes still blank, and someone types before its first tick is over.
  act(() => root.render(<PublicAnswerPaper content={CONTENT} initialAnswers={{}} initialFiles={[]} phone title="Sign-up" token="t" />))
  act(() => {
    const input = field("Your name")
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Ana")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))

  expect(field("Your name").value).toBe("Ana")
})

it("lets a recipient draw only in their own box, showing the sender's signature as signed", async () => {
  const drawn = "data:image/png;base64,AAAA"
  const box = (fieldKey: string, id: string, label: string, signer: "sender" | number) => ({ fieldKey, helpText: null, id, label, required: true, signer, type: "signature_field" })
  const content = templateContentV3Schema.parse({
    ...createEmptyDocumentContent(),
    blocks: [box("sender_box", NAME, "Sender", "sender"), box("first_box", ACCOUNT, "First", 1), box("second_box", NUMBER, "Second", 2)],
  })
  form = document.body.appendChild(document.createElement("form"))
  root = mount(form)
  await act(async () => root.render(<PublicAnswerPaper content={content} initialAnswers={{ sender_box: drawn }} initialFiles={[]} phone signer={2} title="Agreement" token="t" />))

  expect([...form.querySelectorAll("canvas")].map((canvas) => canvas.getAttribute("aria-label"))).toEqual(["Second drawing area"])
  expect(form.querySelector<HTMLImageElement>('img[alt="Saved Sender"]')?.getAttribute("src")).toBe(drawn)
  expect(form.textContent).toContain("Signer 1 signs here")
  // Only their own box is theirs to complete, and only it is sent.
  expect(form.checkValidity()).toBe(false)
  expect(parseGeneratedDocumentAnswers(new FormData(form))).toEqual({})
})

it("lets everyone a one-signer form went to sign it as Signer 1", async () => {
  const content = templateContentV3Schema.parse({
    ...createEmptyDocumentContent(),
    blocks: [{ fieldKey: "first_box", helpText: null, id: NAME, label: "First", required: true, signer: 1, type: "signature_field" }],
  })
  form = document.body.appendChild(document.createElement("form"))
  root = mount(form)
  await act(async () => root.render(<PublicAnswerPaper content={content} initialAnswers={{}} initialFiles={[]} phone signer={3} title="Agreement" token="t" />))

  expect(form.querySelector('canvas[aria-label="First drawing area"]')).not.toBeNull()
})

it("saves a drawing with the answers when a file is uploaded, so a reload keeps it", async () => {
  const drawn = "data:image/png;base64,BBBB"
  const content = templateContentV3Schema.parse({
    ...createEmptyDocumentContent(),
    blocks: [
      { fieldKey: "my_box", helpText: null, id: NAME, label: "Signature", required: true, signer: 1, type: "signature_field" },
      { fieldKey: "id_copy", helpText: null, id: COLOUR, label: "ID copy", required: false, type: "file_field" },
    ],
  })
  Object.assign(HTMLCanvasElement.prototype, {
    getContext: () => ({ beginPath() {}, clearRect() {}, lineTo() {}, moveTo() {}, stroke() {} }),
    setPointerCapture() {},
    toDataURL: () => drawn,
  })
  checkpoint.mockRejectedValue(new Error("stop after the checkpoint"))
  form = document.body.appendChild(document.createElement("form"))
  root = mount(form)
  await act(async () => root.render(<PublicAnswerPaper content={content} initialAnswers={{}} initialFiles={[]} phone signer={1} title="Agreement" token="t" />))

  const canvas = form.querySelector("canvas")!
  await act(async () => {
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 5, clientY: 5 }))
    }
  })
  const file = form.querySelector<HTMLInputElement>('input[type="file"]')!
  const chosen = new File(["%PDF"], "id.pdf", { type: "application/pdf" })
  Object.defineProperty(file, "files", { value: Object.assign([chosen], { item: () => chosen }) })
  await act(async () => file.dispatchEvent(new Event("change", { bubbles: true })))

  expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ answers: expect.objectContaining({ my_box: drawn }) }))
})
