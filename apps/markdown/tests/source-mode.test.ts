import { describe, expect, it } from 'vitest'
import {
  imageSourcesFromMarkdown,
  rewriteMarkdownImageSources,
  sourceMayNormalizeInWysiwyg,
} from '../src/renderer/markdown/sourceMode'

describe('Markdown source mode boundaries', () => {
  it('keeps supported GFM warning-free but identifies unsupported conversion boundaries', () => {
    expect(
      sourceMayNormalizeInWysiwyg(
        '# Title\n\n- [ ] task\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![image](assets/a.png)',
      ),
    ).toBe(false)
    expect(sourceMayNormalizeInWysiwyg('<details><summary>More</summary></details>')).toBe(true)
    expect(sourceMayNormalizeInWysiwyg('[^note]: An unsupported footnote')).toBe(true)
    expect(sourceMayNormalizeInWysiwyg(':::callout {type="info"}')).toBe(true)
  })

  it('finds and rewrites only Markdown image destinations', () => {
    const source = '![one](assets/one.png)\n\n`assets/one.png`\n\n![two](assets/two.jpg "Two")'
    expect(imageSourcesFromMarkdown(source)).toEqual(['assets/one.png', 'assets/two.jpg'])
    expect(
      rewriteMarkdownImageSources(source, [
        { from: 'assets/one.png', to: 'assets/relocated-one.png' },
      ]),
    ).toBe('![one](assets/relocated-one.png)\n\n`assets/one.png`\n\n![two](assets/two.jpg "Two")')
  })
})
