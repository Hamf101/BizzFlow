// Rules every stored file follows, whichever path it arrives by: ids in its key
// are UUIDs, links to it are short-lived, and its bytes are the type it was
// uploaded as, so a renamed program or a macro workbook is refused everywhere.

/** Canonical UUID shape for every id segment of an object key. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A stored file's record as a browser may see it: its object key stays server-side. */
export type ClientFile<T> = T extends unknown ? Omit<T, "storageKey"> : never

/**
 * Drops the internal object key before a file record is returned to a client.
 *
 * @param file - A stored file record.
 * @returns The same record without its storage key.
 */
export function toClientFile<T extends { storageKey: string }>(
  file: T
): ClientFile<T> {
  const clientFile: Partial<T> = { ...file }
  delete clientFile.storageKey
  return clientFile as ClientFile<T>
}

/** Longest life of any signed upload or download link. */
export const SIGNED_URL_MAX_TTL_SECONDS = 15 * 60

const MAX_OOXML_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

class InvalidFileSignature extends Error {}

/**
 * Checks stored bytes against the signature their content type requires: a
 * PDF header, PNG or JPEG magic, UTF-8 CSV, or a macro-free OOXML container
 * holding its main part.
 *
 * @param bytes - The whole stored object.
 * @param contentType - The type it was allowed to upload as.
 * @returns Whether the bytes are that type.
 */
export function hasAllowedFileSignature(
  bytes: Uint8Array,
  contentType: string
): boolean {
  try {
    assertFileSignature(bytes, contentType)
    return true
  } catch (error: unknown) {
    if (error instanceof InvalidFileSignature) {
      return false
    }

    throw error
  }
}

function assertFileSignature(bytes: Uint8Array, contentType: string): void {
  if (contentType === "application/pdf") {
    const header = new TextDecoder("latin1").decode(bytes.slice(0, 1_024))

    if (!header.includes("%PDF-")) {
      throw invalidStoredFileType()
    }

    return
  }

  if (contentType === "image/png") {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]

    if (!pngSignature.every((value: number, index: number) => bytes[index] === value)) {
      throw invalidStoredFileType()
    }

    return
  }

  if (contentType === "image/jpeg") {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw invalidStoredFileType()
    }

    return
  }

  if (contentType === "text/csv") {
    assertUtf8Csv(bytes)
    return
  }

  if (
    contentType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    assertOoxmlContainer(bytes, "word/document.xml")
    return
  }

  if (
    contentType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    assertOoxmlContainer(bytes, "xl/workbook.xml")
    return
  }

  throw invalidStoredFileType()
}

function assertUtf8Csv(bytes: Uint8Array): void {
  let value: string

  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw invalidStoredFileType()
  }

  for (const character of value) {
    const code = character.charCodeAt(0)

    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw invalidStoredFileType()
    }
  }
}

function assertOoxmlContainer(
  bytes: Uint8Array,
  requiredDocumentEntry: string
): void {
  const entries = readZipCentralDirectoryEntries(bytes)

  if (
    !entries.has("[Content_Types].xml") ||
    !entries.has(requiredDocumentEntry) ||
    entries.has("word/vbaProject.bin") ||
    entries.has("xl/vbaProject.bin")
  ) {
    throw invalidStoredFileType()
  }
}

function readZipCentralDirectoryEntries(bytes: Uint8Array): ReadonlySet<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumEocdSize = 22
  const searchStart = Math.max(0, bytes.byteLength - 65_557)
  let eocdOffset = -1

  for (
    let offset = bytes.byteLength - minimumEocdSize;
    offset >= searchStart;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }

  if (eocdOffset < 0) {
    throw invalidStoredFileType()
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true)
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectoryOffset + centralDirectorySize > eocdOffset
  ) {
    throw invalidStoredFileType()
  }

  const entries = new Set<string>()
  let offset = centralDirectoryOffset
  let totalUncompressedBytes = 0

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw invalidStoredFileType()
    }

    const flags = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const filenameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const entryEnd = offset + 46 + filenameLength + extraLength + commentLength

    totalUncompressedBytes += uncompressedSize

    if (
      (flags & 0x1) !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      totalUncompressedBytes > MAX_OOXML_UNCOMPRESSED_BYTES ||
      entryEnd > eocdOffset
    ) {
      throw invalidStoredFileType()
    }

    let filename: string

    try {
      filename = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.slice(offset + 46, offset + 46 + filenameLength)
      )
    } catch {
      throw invalidStoredFileType()
    }

    const normalizedFilename = filename.replace(/\\/g, "/")

    if (
      normalizedFilename.startsWith("/") ||
      normalizedFilename.split("/").includes("..")
    ) {
      throw invalidStoredFileType()
    }

    assertZipLocalEntry({
      bytes,
      centralDirectoryOffset,
      compressedSize,
      expectedFilename: filename,
      localHeaderOffset,
      view,
    })

    entries.add(normalizedFilename)
    offset = entryEnd
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw invalidStoredFileType()
  }

  return entries
}

function assertZipLocalEntry(input: {
  bytes: Uint8Array
  centralDirectoryOffset: number
  compressedSize: number
  expectedFilename: string
  localHeaderOffset: number
  view: DataView
}): void {
  if (
    input.localHeaderOffset + 30 > input.centralDirectoryOffset ||
    input.view.getUint32(input.localHeaderOffset, true) !== 0x04034b50
  ) {
    throw invalidStoredFileType()
  }

  const filenameLength = input.view.getUint16(input.localHeaderOffset + 26, true)
  const extraLength = input.view.getUint16(input.localHeaderOffset + 28, true)
  const dataOffset = input.localHeaderOffset + 30 + filenameLength + extraLength
  const dataEnd = dataOffset + input.compressedSize

  if (dataEnd > input.centralDirectoryOffset) {
    throw invalidStoredFileType()
  }

  let localFilename: string

  try {
    localFilename = new TextDecoder("utf-8", { fatal: true }).decode(
      input.bytes.slice(
        input.localHeaderOffset + 30,
        input.localHeaderOffset + 30 + filenameLength
      )
    )
  } catch {
    throw invalidStoredFileType()
  }

  if (localFilename !== input.expectedFilename) {
    throw invalidStoredFileType()
  }
}

function invalidStoredFileType(): Error {
  return new InvalidFileSignature()
}
