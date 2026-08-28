#!/usr/bin/env node
// Source-comment English-only guard. Product plans and user-facing docs may be
// localized, so documentation prose is deliberately out of this check.
//
// Functional CJK string literals are fine (i18n resources, test fixture
// text, zh-UI matchers), as are the AI prompt guides (runtime resources that
// legitimately show CJK examples).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const HAN = /[\u3400-\u9fff]/

const git = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
if (git.status !== 0) {
  console.error(git.stderr)
  process.exit(git.status ?? 1)
}
const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()

const violations = []
for (const file of git.stdout.trim().split('\n')) {
  const isCode = /\.(ts|tsx|mjs|cjs|js)$/.test(file)
  if (!isCode) continue
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  lines.forEach((line, index) => {
    const text =
      (line.match(/(?:^|[^:'"])\/\/(.*)$/) ??
        line.match(/^\s*\*(.*)$/) ??
        line.match(/\/\*(.*)$/))?.[1]
    if (text !== undefined && HAN.test(text)) {
      violations.push(`  ${file}:${index + 1}: ${line.trim()}`)
    }
  })
}

if (violations.length > 0) {
  console.error(
    `Chinese text found in source-code comments:\n${violations.join('\n')}\n` +
      'Move CJK text into string literals or rewrite the comment in English.',
  )
  process.exit(1)
}
console.log('check-english-comments: OK')
