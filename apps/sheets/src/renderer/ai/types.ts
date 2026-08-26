import type { AttachmentMeta } from '../../shared/desktop-api'

export interface AiToolChip {
  readonly summary: string
  readonly isError: boolean
  readonly running?: boolean
  readonly name?: string
  readonly output?: string
}

export interface AiChatMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly tools: readonly AiToolChip[]
  readonly streaming?: boolean | undefined
  readonly isError?: boolean | undefined
  readonly undelivered?: boolean | undefined
  readonly loginRequired?: boolean | undefined
  readonly autoApplied?: { readonly opCount: number; readonly undoSteps: number } | undefined
  readonly attachments?: readonly AttachmentMeta[] | undefined
}
