import { opNames, type Op } from './ops'

const MAX_MCP_OPS = 50
const MAX_MCP_OP_BYTES = 200 * 1024
const MAX_DEPTH = 12
const FORBIDDEN_KEYS = new Set([
  'archive',
  'archivebytes',
  'bytes',
  'data',
  'mediapath',
  'path',
  'script',
  'source',
  'slidexml',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateValue(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error(`MCP operation nesting exceeds ${MAX_DEPTH} levels.`)
  if (Array.isArray(value)) {
    if (value.length > MAX_MCP_OPS)
      throw new Error(`MCP operation arrays may contain at most ${MAX_MCP_OPS} items.`)
    for (const item of value) validateValue(item, depth + 1)
    return
  }
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`MCP operations may not include the restricted field "${key}".`)
    }
    validateValue(nested, depth + 1)
  }
}

/**
 * Convert untrusted MCP input into the existing canonical operation surface.
 * The resulting values remain fully validated by the registry/executor before
 * they can mutate a live deck.
 */
export function validateMcpOps(value: unknown): Op[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MCP_OPS) {
    throw new Error(`ops must be a non-empty array with at most ${MAX_MCP_OPS} operations.`)
  }
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new Error('ops must be JSON-serializable.')
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_MCP_OP_BYTES) {
    throw new Error(`ops exceed the ${MAX_MCP_OP_BYTES}-byte MCP limit.`)
  }
  const allowed = new Set(opNames())
  return value.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.op !== 'string' || !allowed.has(candidate.op)) {
      throw new Error(`ops[${index}] must name a registered canonical slide operation.`)
    }
    validateValue(candidate, 0)
    return candidate as Op
  })
}
