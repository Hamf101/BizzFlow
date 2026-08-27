import { describe, expect, it } from "vitest"

import { escapeHtml, wrapEmailDocument } from "@/services/email/html"

describe("email HTML escaping", () => {
  it("escapes all characters that can change HTML text or attributes", () => {
    expect(escapeHtml(`North & <Co> 'Docs' "Team"`)).toBe(
      "North &amp; &lt;Co&gt; &#39;Docs&#39; &quot;Team&quot;"
    )
  })
})

describe("email document branding", () => {
  it("wraps content in BizFlow's email-safe light palette", () => {
    const html = wrapEmailDocument({
      subject: "A subject",
      contentHtml: "<p>Message</p>",
    })

    expect(html).toContain("background-color:#f3f1ed")
    expect(html).toContain("background-color:#fffdfc")
    expect(html).toContain("color:#635273")
    expect(html).toContain("border:1px solid #c9c2bb")
    expect(html).toContain("<p>Message</p>")
  })
})
