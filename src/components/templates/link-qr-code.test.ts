import { describe, expect, it } from "vitest"
import { encode } from "uqr"

import { qrSvg } from "./link-qr-code"

describe("qrSvg", () => {
  it("draws every dark module, on white, and never the address itself", () => {
    const url = 'https://app.example/forms/abc"><script>alert(1)</script>'
    const svg = qrSvg(url)
    const { data, size } = encode(url, { border: 2, ecc: "M" })
    const dark = data.flat().filter(Boolean).length
    // Each run covers its modules: the widths add up to the dark count.
    const drawn = [...svg.matchAll(/h(\d+)v1/g)].reduce((sum, [, width]) => sum + Number(width), 0)

    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`)
    expect(svg).toContain('fill="#fff"')
    expect(drawn).toBe(dark)
    expect(svg).not.toContain("script")
    expect(svg).not.toContain("example")
  })
})
