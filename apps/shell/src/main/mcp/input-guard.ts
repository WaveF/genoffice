import { CapabilityError } from '@nexoffice/capabilities'

const MAX_INPUT_BYTES = 256 * 1024
const MAX_DEPTH = 12
const MAX_ARRAY_ITEMS = 50
const MAX_OBJECT_KEYS = 100
const MAX_STRING_BYTES = 64 * 1024

function inspect(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH)
    throw new CapabilityError('validation_error', 'MCP input nesting is too deep')
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) {
      throw new CapabilityError('validation_error', 'MCP input string is too large')
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new CapabilityError('validation_error', 'MCP input array has too many items')
    }
    for (const item of value) inspect(item, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') return
  const entries = Object.entries(value)
  if (entries.length > MAX_OBJECT_KEYS) {
    throw new CapabilityError('validation_error', 'MCP input object has too many fields')
  }
  for (const [, nested] of entries) inspect(nested, depth + 1)
}

/** Shared boundary guard before any tool-specific schema or adapter validation. */
export function assertSafeMcpInput(value: Record<string, unknown>): void {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new CapabilityError('validation_error', 'MCP input must be JSON-serializable')
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_INPUT_BYTES) {
    throw new CapabilityError('validation_error', 'MCP input exceeds the maximum size')
  }
  inspect(value, 0)
}
