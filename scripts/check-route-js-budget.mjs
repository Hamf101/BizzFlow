#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

export const ROUTE_BUDGETS = [
  {
    label: "Authentication",
    route: "/(auth)/login/page",
    ceilingKiB: 40,
  },
  {
    label: "Public form",
    route: "/forms/[token]/page",
    ceilingKiB: 55,
  },
  {
    label: "Public signing",
    route: "/sign/[token]/page",
    ceilingKiB: 125,
  },
  {
    label: "Core dashboard/list",
    route: "/(dashboard)/documents/page",
    ceilingKiB: 250,
  },
  {
    label: "Interactive dashboard detail",
    route: "/(dashboard)/documents/[documentId]/page",
    ceilingKiB: 265,
  },
  {
    label: "Template editor",
    route: "/(editor)/templates/[templateId]/edit/page",
    ceilingKiB: 290,
  },
  {
    label: "Document editor",
    route: "/(editor)/documents/[documentId]/edit/page",
    ceilingKiB: 290,
  },
]

function formatKiB(bytes) {
  return (bytes / 1024).toFixed(1)
}

function normalizeChunkPath(chunkPath) {
  if (typeof chunkPath !== "string") {
    throw new Error("Invalid client chunk path in route manifest")
  }

  const withoutNextPrefix = chunkPath.startsWith("/_next/")
    ? chunkPath.slice("/_next/".length)
    : chunkPath.replace(/^\/+/, "")
  const cleanPath = withoutNextPrefix.split(/[?#]/, 1)[0]

  if (!cleanPath.endsWith(".js")) {
    return null
  }
  if (
    !cleanPath.startsWith("static/chunks/") ||
    cleanPath.split("/").includes("..")
  ) {
    throw new Error(`Invalid client chunk path in route manifest: ${chunkPath}`)
  }

  return cleanPath
}

/**
 * Extract one route's JSON payload from Next.js' generated client manifest.
 *
 * @param {string} source Generated manifest JavaScript.
 * @param {string} route Route key stored in the manifest.
 * @returns {Record<string, unknown>} Parsed route manifest.
 * @throws {Error} When the route assignment or JSON payload is invalid.
 */
export function parseClientReferenceManifest(source, route) {
  const marker = `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = `
  const markerIndex = typeof source === "string" ? source.indexOf(marker) : -1

  if (markerIndex === -1) {
    throw new Error(`Invalid client reference manifest for ${route}`)
  }

  const serialized = source.slice(markerIndex + marker.length).trim().replace(/;$/, "")

  try {
    const manifest = JSON.parse(serialized)
    if (
      manifest === null ||
      typeof manifest !== "object" ||
      manifest.clientModules === null ||
      typeof manifest.clientModules !== "object" ||
      manifest.entryJSFiles === null ||
      typeof manifest.entryJSFiles !== "object"
    ) {
      throw new Error("missing client module records")
    }
    return manifest
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown parse failure"
    throw new Error(`Invalid client reference manifest for ${route}: ${detail}`)
  }
}

/**
 * Return the unique JavaScript chunks needed by a generated route manifest.
 *
 * @param {Record<string, any>} manifest Parsed client reference manifest.
 * @returns {string[]} Normalized build-relative chunk paths.
 * @throws {Error} When generated chunk records have an unexpected shape.
 */
export function collectClientChunks(manifest) {
  const chunks = new Set()
  const addChunks = (candidateChunks) => {
    if (!Array.isArray(candidateChunks)) {
      throw new Error("Invalid client chunk list in route manifest")
    }

    for (const candidate of candidateChunks) {
      const normalized = normalizeChunkPath(candidate)
      if (normalized) chunks.add(normalized)
    }
  }

  for (const clientModule of Object.values(manifest.clientModules)) {
    if (clientModule === null || typeof clientModule !== "object") {
      throw new Error("Invalid client module record in route manifest")
    }
    addChunks(clientModule.chunks)
  }

  for (const entryChunks of Object.values(manifest.entryJSFiles)) {
    addChunks(entryChunks)
  }

  if (chunks.size === 0) {
    throw new Error("Route manifest contains no measurable JavaScript chunks")
  }

  return [...chunks]
}

/**
 * Gzip each unique route chunk and add its transferred byte size.
 *
 * @param {string[]} chunkPaths Build-relative chunk paths.
 * @param {(chunkPath: string) => Buffer|string} readChunk Chunk reader.
 * @returns {number} Total gzip-compressed bytes.
 * @throws {Error} When a referenced chunk cannot be read.
 */
export function calculateUniqueGzipBytes(chunkPaths, readChunk) {
  let totalBytes = 0

  for (const chunkPath of new Set(chunkPaths)) {
    const contents = readChunk(chunkPath)
    if (contents === undefined || contents === null) {
      throw new Error(`Missing client chunk: ${chunkPath}`)
    }
    totalBytes += gzipSync(contents).length
  }

  return totalBytes
}

/**
 * Require one representative route to remain within its transfer budget.
 *
 * @param {{label: string, route: string, measuredBytes: number, ceilingKiB: number}} result Route measurement.
 * @returns {void}
 * @throws {Error} When the measured route exceeds its ceiling.
 */
export function assertRouteWithinBudget({
  label,
  route,
  measuredBytes,
  ceilingKiB,
}) {
  if (measuredBytes > ceilingKiB * 1024) {
    throw new Error(
      `${label} (${route}) is ${formatKiB(measuredBytes)} KiB; ` +
        `${formatKiB(measuredBytes)} KiB exceeds ${ceilingKiB} KiB`
    )
  }
}

/**
 * Resolve a representative route to its generated client-manifest entry.
 *
 * @param {Record<string, unknown>} appPaths Next.js app paths manifest.
 * @param {string} route Representative route key.
 * @returns {string} Server-relative client reference manifest path.
 * @throws {Error} When the route is absent or has an unexpected server entry.
 */
export function resolveRouteManifestEntry(appPaths, route) {
  const serverEntry = appPaths[route]
  if (typeof serverEntry !== "string") {
    throw new Error(`Missing representative route: ${route}`)
  }
  if (!serverEntry.startsWith("app/") || !serverEntry.endsWith(".js")) {
    throw new Error(`Invalid server entry for representative route: ${route}`)
  }

  return serverEntry.replace(/\.js$/, "_client-reference-manifest.js")
}

function resolveContainedPath(root, candidate, label) {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(resolvedRoot, candidate)
  const relativePath = relative(resolvedRoot, resolvedCandidate)

  if (
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`${label} escapes the Next.js build directory: ${candidate}`)
  }

  return resolvedCandidate
}

/**
 * Measure and enforce all representative route budgets against an existing build.
 *
 * @param {string} [buildDirectory=".next"] Next.js build directory.
 * @returns {Array<{label: string, route: string, measuredBytes: number, ceilingKiB: number}>} Measurements.
 * @throws {Error} When build evidence is missing, invalid, or over budget.
 */
export function runRouteBudgetCheck(buildDirectory = ".next") {
  const buildRoot = resolve(buildDirectory)
  const appPathsFile = resolveContainedPath(
    buildRoot,
    "server/app-paths-manifest.json",
    "App paths manifest"
  )

  if (!existsSync(appPathsFile)) {
    throw new Error(`Missing Next.js app paths manifest: ${appPathsFile}`)
  }

  let appPaths
  try {
    appPaths = JSON.parse(readFileSync(appPathsFile, "utf8"))
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown parse failure"
    throw new Error(`Invalid Next.js app paths manifest: ${detail}`)
  }

  return ROUTE_BUDGETS.map(({ label, route, ceilingKiB }) => {
    const manifestEntry = resolveRouteManifestEntry(appPaths, route)
    const manifestFile = resolveContainedPath(
      resolve(buildRoot, "server"),
      manifestEntry,
      "Client reference manifest"
    )

    if (!existsSync(manifestFile)) {
      throw new Error(`Missing client reference manifest for ${route}: ${manifestFile}`)
    }

    const manifest = parseClientReferenceManifest(
      readFileSync(manifestFile, "utf8"),
      route
    )
    const chunkPaths = collectClientChunks(manifest)
    const measuredBytes = calculateUniqueGzipBytes(chunkPaths, (chunkPath) => {
      const chunkFile = resolveContainedPath(buildRoot, chunkPath, "Client chunk")
      if (!existsSync(chunkFile)) {
        throw new Error(`Missing client chunk for ${route}: ${chunkFile}`)
      }
      return readFileSync(chunkFile)
    })
    const result = { label, route, measuredBytes, ceilingKiB }
    assertRouteWithinBudget(result)
    return result
  })
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : ""

if (currentFile === invokedFile) {
  try {
    const results = runRouteBudgetCheck()
    for (const result of results) {
      console.log(
        `✓ ${result.label} (${result.route}): ` +
          `${formatKiB(result.measuredBytes)} KiB / ${result.ceilingKiB} KiB`
      )
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`Route JavaScript budget check failed: ${detail}`)
    process.exitCode = 1
  }
}
