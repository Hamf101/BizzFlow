import { ImageResponse } from "next/og"

import { CORNERS, FACETS, FLAP, type Tone } from "@/components/brand/folded-page"

// The light theme's fold tones and ground (globals.css), fixed: an icon has no theme.
const TONES: Record<Tone, string> = {
  lavender: "#c9b6e4",
  lilac: "#b9a3da",
  orchid: "#d3b2d9",
  periwinkle: "#b6bde9",
  rose: "#ebbfcd",
  sage: "#bdd7c6",
  wisteria: "#a992cc",
}
const GROUND = "#f3f1ed"

// Pixels per size; a maskable icon keeps the page inside the middle 80%,
// which every launcher's mask leaves whole.
const SIZES: Record<string, { pixels: number; scale: number }> = {
  "180": { pixels: 180, scale: 0.78 },
  "192": { pixels: 192, scale: 0.78 },
  "512": { pixels: 512, scale: 0.78 },
  maskable: { pixels: 512, scale: 0.6 },
}

/**
 * Draws the folded-page mark as an app icon, a PNG at the size asked for.
 *
 * @param _request - Unused.
 * @param context - The size: 180, 192, 512, or maskable.
 * @returns The icon, cached for a year; 404 for any other size.
 */
export async function GET(_request: Request, context: { params: Promise<{ size: string }> }): Promise<Response> {
  const size = SIZES[(await context.params).size]

  if (!size) {
    return new Response("Not found", { status: 404 })
  }

  const point = ([x, y]: readonly [number, number]): string => `${x},${y}`

  return new ImageResponse(
    (
      <div style={{ alignItems: "center", background: GROUND, display: "flex", height: "100%", justifyContent: "center", width: "100%" }}>
        <svg height={size.pixels * size.scale} viewBox="-200 -250 400 500" width={(size.pixels * size.scale * 400) / 500}>
          {FACETS.map((facet) => (
            <polygon fill={TONES[facet.tones[0]]} key={facet.corners.join()} opacity={0.55 + facet.strength * 0.45} points={facet.corners.map((corner) => point(CORNERS[corner])).join(" ")} />
          ))}
          <polygon fill="#635273" points={FLAP.map(point).join(" ")} />
        </svg>
      </div>
    ),
    { headers: { "Cache-Control": "public, max-age=31536000, immutable" }, height: size.pixels, width: size.pixels }
  )
}
