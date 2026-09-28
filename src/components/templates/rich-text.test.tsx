import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { TemplateStaticBlock } from "@/components/templates/template-static-block"

const ID = "60000000-0000-4000-8000-000000000001"

function draw(block: Parameters<typeof TemplateStaticBlock>[0]["block"]): string {
  return renderToStaticMarkup(<TemplateStaticBlock accentColorVariable="var(--a)" block={block} primaryColorVariable="var(--p)" />)
}

it("shows formatted words as formatted, and opens links in a new tab without handing it this page", () => {
  const html = draw({
    alignment: "left",
    id: ID,
    runs: [
      { text: "Pay " },
      { bold: true, text: "within 30 days" },
      { text: " through " },
      { link: "https://pay.example.com", text: "the portal" },
      { color: "#a24949", italic: true, text: " or late fees apply." },
    ],
    text: "Pay within 30 days through the portal or late fees apply.",
    type: "paragraph",
  })

  expect(html).toContain('<span style="font-weight:700">within 30 days</span>')
  expect(html).toContain('<span class="doc-ink" style="--doc-ink:#a24949;color:#a24949;font-style:italic"> or late fees apply.</span>')
  expect(html).toMatch(/<a [^>]*href="https:\/\/pay\.example\.com"[^>]*rel="noopener noreferrer"[^>]*target="_blank"[^>]*>the portal<\/a>/)
})

it("formats each list item on its own, and leaves plain text as plain as before", () => {
  const list = draw({
    id: ID,
    itemRuns: [[{ text: "Weekly " }, { highlight: "#f2cd5c", text: "visit" }], null],
    items: ["Weekly visit", "Deep clean"],
    type: "bullet_list",
  })

  expect(list).toContain('<li>Weekly <span class="doc-highlight" style="--doc-highlight:#f2cd5c;background-color:#f2cd5c">visit</span></li>')
  expect(list).toContain("<li>Deep clean</li>")
  expect(draw({ alignment: "left", id: ID, text: "Pay now.", type: "paragraph" })).not.toContain("<span")
})
