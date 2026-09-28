#!/usr/bin/env node

// Rebuilds the fonts a document can use from Fontsource's copy of Google
// Fonts: public/fonts/catalog.json lists them for the font menu, and
// public/fonts/faces.json tells the /fonts route and the PDF which files each
// one has. Run it to pick up new fonts or newer versions, then commit both.

import { writeFileSync } from "node:fs"

const API = "https://api.fontsource.org/v1/fonts"

async function load(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`)
  }

  return response.json()
}

// Icon fonts draw pictures for words, which is no use in a document.
const listing = (await load(`${API}?type=google`)).filter((font) => font.category !== "icons")
const ranges = []
const rangeIndexes = new Map()
const fonts = {}
const catalog = []

function rangeIndex(range) {
  if (!rangeIndexes.has(range)) {
    rangeIndexes.set(range, ranges.length)
    ranges.push(range)
  }

  return rangeIndexes.get(range)
}

function describe(font) {
  const faces = Object.entries(font.variants).flatMap(([weight, styles]) =>
    Object.entries(styles).map(([style, files]) => ({ files, style, weight: Number(weight) }))
  )
  const weights = [...new Set(faces.map((face) => face.weight))].sort((a, b) => a - b)
  const styles = [...new Set(faces.map((face) => face.style))]

  if (faces.length !== weights.length * styles.length) {
    return `${font.id}: not every weight comes in every style`
  }

  // Numbered slices of a large script are "[12]" in the ranges and "12" in the
  // file names. A subset every face has, at the address the route will ask
  // for, is one the CSS and the PDF can both rely on.
  const subsets = {}

  for (const [name, range] of Object.entries(font.unicodeRange)) {
    const subset = name.replace(/^\[(\d+)\]$/, "$1")
    const everywhere = faces.every(
      ({ files, style, weight }) =>
        files[subset]?.url?.woff2 ===
        `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}@latest/${subset}-${weight}-${style}.woff2`
    )

    if (everywhere) {
      subsets[subset] = rangeIndex(range)
    }
  }

  if (Object.keys(subsets).length === 0 || !/^\d+\.\d+\.\d+$/.test(font.npmVersion ?? "")) {
    return `${font.id}: no files to serve`
  }

  fonts[font.id] = { license: font.license, styles, subsets, version: font.npmVersion, weights }
  catalog.push({ category: font.category, family: font.family, id: font.id })
  return null
}

// A dozen at a time, so the API is not flooded.
for (let start = 0; start < listing.length; start += 12) {
  const details = await Promise.all(listing.slice(start, start + 12).map(({ id }) => load(`${API}/${id}`)))

  for (const skipped of details.map(describe).filter(Boolean)) {
    console.warn(`Skipped ${skipped}`)
  }
}

catalog.sort((a, b) => a.family.localeCompare(b.family, "en"))
writeFileSync("public/fonts/catalog.json", JSON.stringify(catalog))
writeFileSync(
  "public/fonts/faces.json",
  JSON.stringify({ fonts: Object.fromEntries(Object.entries(fonts).sort(([a], [b]) => a.localeCompare(b))), ranges })
)
console.log(`${catalog.length} fonts, ${ranges.length} distinct ranges`)
