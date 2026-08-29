/**
 * A source-mode-only template for an image that cannot yet be imported because
 * the document has no on-disk location. It must never be treated as an asset
 * reference by the save/asset lifecycle.
 */
export const UNSAVED_IMAGE_PLACEHOLDER_SOURCE = '图片路径'
export const UNSAVED_IMAGE_PLACEHOLDER_MARKDOWN = `![图片描述](${UNSAVED_IMAGE_PLACEHOLDER_SOURCE})`

export function isUnsavedImagePlaceholderSource(source: string): boolean {
  return source === UNSAVED_IMAGE_PLACEHOLDER_SOURCE
}
