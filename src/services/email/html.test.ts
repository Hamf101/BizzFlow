import { describe, expect, it } from "vitest"

import { escapeHtml } from "@/services/email/html"

describe("email HTML escaping", () => {
  it("escapes all characters that can change HTML text or attributes", () => {
    expect(escapeHtml(`North & <Co> 'Docs' "Team"`)).toBe(
      "North &amp; &lt;Co&gt; &#39;Docs&#39; &quot;Team&quot;"
    )
  })
})
