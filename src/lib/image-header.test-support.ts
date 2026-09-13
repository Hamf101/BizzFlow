import { crc32, deflateSync } from "node:zlib"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

type JpegFixtureOptions = {
  /** Omit the trailing end-of-image marker. */
  endMarker?: boolean
  /** Start-of-frame marker; 0xc2 is a progressive JPEG. */
  frameMarker?: number
  /** Put a Huffman table segment before the frame header. */
  huffmanTableFirst?: boolean
  /** Bytes after the end marker, as motion photos append video. */
  trailer?: Uint8Array
}

/**
 * Builds a PNG whose header declares a size no pixel data backs.
 *
 * @param width - Declared width.
 * @param height - Declared height.
 * @param salt - Trailing byte that keeps otherwise identical fixtures distinct.
 * @returns Bytes that pass header checks but cannot be decoded.
 */
export function createPngHeaderBytes(
  width: number,
  height: number,
  salt = 0
): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    createPngChunk("IHDR", createPngHeaderChunkData(width, height)),
    Buffer.from([salt]),
  ])
}

/**
 * Builds a decodable, all-black 8-bit grayscale PNG.
 *
 * @param width - Image width.
 * @param height - Image height.
 * @returns Complete PNG bytes.
 */
export function createPngBytes(width: number, height: number): Buffer {
  // Every scanline is a zero filter byte followed by zero-valued pixels.
  const scanlines = Buffer.alloc((width + 1) * height)

  return Buffer.concat([
    PNG_SIGNATURE,
    createPngChunk("IHDR", createPngHeaderChunkData(width, height)),
    createPngChunk("IDAT", deflateSync(scanlines)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ])
}

/**
 * Builds a three-channel JPEG header declaring a size, without scan data.
 *
 * @param width - Declared width.
 * @param height - Declared height.
 * @param options - Structural variations for header parsing tests.
 * @returns JPEG bytes that pdf-lib can embed without decoding.
 */
export function createJpegBytes(
  width: number,
  height: number,
  options: JpegFixtureOptions = {}
): Buffer {
  const applicationSegment = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]
  const huffmanTableSegment = options.huffmanTableFirst
    ? [0xff, 0xc4, 0x00, 0x03, 0x00]
    : []
  const frameSegment = [
    0xff,
    options.frameMarker ?? 0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]

  return Buffer.concat([
    Buffer.from([
      0xff,
      0xd8,
      ...applicationSegment,
      ...huffmanTableSegment,
      ...frameSegment,
      ...(options.endMarker === false ? [] : [0xff, 0xd9]),
    ]),
    options.trailer ?? Buffer.alloc(0),
  ])
}

/**
 * Encodes image bytes as the data URL templates and drawings store.
 *
 * @param format - Image format named in the data URL.
 * @param bytes - Image bytes.
 * @returns Base64 data URL.
 */
export function toImageDataUrl(
  format: "jpeg" | "png",
  bytes: Uint8Array
): string {
  return `data:image/${format};base64,${Buffer.from(bytes).toString("base64")}`
}

function createPngHeaderChunkData(width: number, height: number): Buffer {
  const data = Buffer.alloc(13)

  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  // 8-bit grayscale; compression, filter, and interlace methods stay zero.
  data[8] = 8
  return data
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)

  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}
