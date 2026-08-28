import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CapabilityError } from '@genoffice/capabilities'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_PIXELS = 24_000_000

export interface StagedMcpImage {
  handle: string
  fileName: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif'
  bytes: Buffer
}

interface StoredImage extends StagedMcpImage {
  clientId: string
}

function isSafeImportName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 180 &&
    value === basename(value) &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  )
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot !== '' &&
    !fromRoot.startsWith(`..${sep}`) &&
    fromRoot !== '..' &&
    !isAbsolute(fromRoot)
  )
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function gifDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.length < 10 ||
    (bytes.toString('ascii', 0, 6) !== 'GIF87a' && bytes.toString('ascii', 0, 6) !== 'GIF89a')
  )
    return null
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  for (let index = 2; index + 9 < bytes.length;) {
    if (bytes[index] !== 0xff) return null
    while (bytes[index] === 0xff) index += 1
    const marker = bytes[index++]
    if (marker === 0xd9 || marker === 0xda) return null
    const length = bytes.readUInt16BE(index)
    if (length < 2 || index + length > bytes.length) return null
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: bytes.readUInt16BE(index + 3), width: bytes.readUInt16BE(index + 5) }
    }
    index += length
  }
  return null
}

function inspectImage(bytes: Buffer): {
  mimeType: StagedMcpImage['mimeType']
  width: number
  height: number
} {
  const match = [
    ['image/png', pngDimensions(bytes)],
    ['image/jpeg', jpegDimensions(bytes)],
    ['image/gif', gifDimensions(bytes)],
  ] as const
  const found = match.find((entry) => entry[1] !== null)
  if (!found)
    throw new CapabilityError(
      'validation_error',
      'Only PNG, JPEG, and GIF image files are accepted',
    )
  const dimensions = found[1]!
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new CapabilityError('validation_error', 'Image dimensions exceed the allowed limit')
  }
  return { mimeType: found[0], ...dimensions }
}

/** Session-private staging directory for external MCP image generation. */
export class McpMediaImportStore {
  readonly directory: string
  private readonly entries = new Map<string, StoredImage>()

  constructor() {
    this.directory = mkdtempSync(join(tmpdir(), 'genoffice-mcp-media-'))
    // Do not rely on the process umask: discovery publishes this path to the
    // authenticated client, so it must never be readable by another local user.
    chmodSync(this.directory, 0o700)
  }

  stage(clientId: string, fileName: unknown): Omit<StagedMcpImage, 'bytes'> {
    if (!isSafeImportName(fileName))
      throw new CapabilityError(
        'validation_error',
        'fileName must be one safe file name in mediaImportDirectory',
      )
    const root = realpathSync(this.directory)
    const candidate = resolve(root, fileName)
    if (!isInside(root, candidate))
      throw new CapabilityError('validation_error', 'Image must be inside mediaImportDirectory')
    let info: ReturnType<typeof lstatSync>
    try {
      info = lstatSync(candidate)
    } catch {
      throw new CapabilityError('not_found', 'Staged image file was not found')
    }
    if (!info.isFile() || info.isSymbolicLink())
      throw new CapabilityError(
        'validation_error',
        'Staged image must be a regular non-symlink file',
      )
    const resolved = realpathSync(candidate)
    if (!isInside(root, resolved))
      throw new CapabilityError('validation_error', 'Staged image escapes mediaImportDirectory')
    if (info.size <= 0 || info.size > MAX_IMAGE_BYTES)
      throw new CapabilityError('validation_error', 'Image file size exceeds the allowed limit')
    const bytes = readFileSync(resolved)
    if (bytes.length !== info.size || bytes.length > MAX_IMAGE_BYTES)
      throw new CapabilityError('validation_error', 'Staged image changed while being read')
    const image = inspectImage(bytes)
    const handle = `media-${randomUUID()}`
    const entry: StoredImage = { handle, clientId, fileName, bytes, mimeType: image.mimeType }
    this.entries.set(handle, entry)
    rmSync(resolved, { force: true })
    return { handle, fileName, mimeType: image.mimeType }
  }

  consume(clientId: string, handle: unknown): StagedMcpImage {
    if (typeof handle !== 'string' || !handle.startsWith('media-'))
      throw new CapabilityError('validation_error', 'mediaHandle is required')
    const entry = this.entries.get(handle)
    if (!entry || entry.clientId !== clientId)
      throw new CapabilityError('not_found', 'Media handle is unavailable for this MCP client')
    this.entries.delete(handle)
    return entry
  }

  stop(): void {
    this.entries.clear()
    rmSync(this.directory, { recursive: true, force: true })
  }
}
