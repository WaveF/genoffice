import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_ERROR_CODES,
  CapabilityError,
  DOCUMENT_KINDS,
  isDocumentKind,
  toolResult,
} from '../src'

describe('capability contracts', () => {
  it('keeps the complete set of supported document kinds explicit', () => {
    expect(DOCUMENT_KINDS).toEqual(['docs', 'sheets', 'slides', 'pdf', 'markdown'])
    expect(isDocumentKind('slides')).toBe(true)
    expect(isDocumentKind('other')).toBe(false)
  })

  it('preserves machine-readable errors without serializing implementation details', () => {
    const error = new CapabilityError('conflict', 'Document changed', { currentRevision: 8 })
    expect(CAPABILITY_ERROR_CODES).toContain(error.code)
    expect(error.name).toBe('CapabilityError')
    expect(error.details).toEqual({ currentRevision: 8 })
  })

  it('builds compact successful tool results', () => {
    expect(toolResult('Read 3 slides.', false, 4)).toEqual({
      content: 'Read 3 slides.',
      mutated: false,
      revision: 4,
    })
    expect(toolResult('No changes.')).toEqual({ content: 'No changes.', mutated: false })
  })
})
