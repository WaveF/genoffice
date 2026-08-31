#!/usr/bin/env node
// Launch a packaged NexOffice build and verify its bundled MCP adapter can
// reach the live local bridge. Linux callers must provide an X display.
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const target = process.env.PACKAGE_SMOKE_TARGET

function reportFatal(error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  // Keep CI failure diagnostics visible in the run summary even when raw
  // GitHub Actions logs require authenticated access.
  process.stdout.write(
    `::error title=Packaged MCP smoke::${message.replaceAll('%', '%25').replaceAll('\r', '').replaceAll('\n', '%0A')}\n`,
  )
  process.exitCode = 1
}

process.on('uncaughtException', reportFatal)
process.on('unhandledRejection', reportFatal)

const layouts = {
  mac: {
    app: join(
      'apps',
      'shell',
      'release',
      'mac-arm64',
      'NexOffice.app',
      'Contents',
      'MacOS',
      'NexOffice',
    ),
    adapter: join(
      'apps',
      'shell',
      'release',
      'mac-arm64',
      'NexOffice.app',
      'Contents',
      'Resources',
      'mcp',
      'nexoffice-mcp.mjs',
    ),
  },
  win: {
    app: join('apps', 'shell', 'release', 'win-unpacked', 'NexOffice.exe'),
    adapter: join(
      'apps',
      'shell',
      'release',
      'win-unpacked',
      'resources',
      'mcp',
      'nexoffice-mcp.mjs',
    ),
  },
  linux: {
    app: join('apps', 'shell', 'release', 'linux-unpacked', 'nexoffice'),
    adapter: join(
      'apps',
      'shell',
      'release',
      'linux-unpacked',
      'resources',
      'mcp',
      'nexoffice-mcp.mjs',
    ),
  },
}[target]

if (!layouts)
  throw new Error(`PACKAGE_SMOKE_TARGET must be mac, win, or linux (received ${target ?? 'unset'})`)

const appPath = join(root, layouts.app)
const adapterPath = join(root, layouts.adapter)
for (const path of [appPath, adapterPath]) {
  if (!existsSync(path)) throw new Error(`Packaged smoke target missing: ${path}`)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function waitForFile(path, timeoutMs = 30_000, describeFailure = () => '') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await stat(path)).isFile()) return
    } catch {
      // The bridge creates the parent directory asynchronously.
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for packaged bridge discovery: ${path}${describeFailure()}`)
}

function createMcpClient(discoveryPath) {
  const child = spawn(process.execPath, [adapterPath, '--discovery', discoveryPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let nextId = 1
  let buffer = ''
  const pending = new Map()
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let boundary
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 1)
      if (!line.trim()) continue
      const response = JSON.parse(line)
      const resolveResponse = pending.get(response.id)
      if (resolveResponse) {
        pending.delete(response.id)
        resolveResponse(response)
      }
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.once('error', (error) => {
    for (const rejectResponse of pending.values()) rejectResponse(error)
    pending.clear()
  })
  return {
    async request(method, params) {
      const id = nextId++
      const response = new Promise((resolveResponse, rejectResponse) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectResponse(
            new Error(`Timed out waiting for MCP ${method}: ${stderr || 'no adapter stderr'}`),
          )
        }, 20_000)
        pending.set(id, (value) => {
          clearTimeout(timer)
          resolveResponse(value)
        })
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      return response
    },
    async close() {
      child.stdin.end()
      child.kill()
      await new Promise((resolvePromise) => {
        child.once('close', resolvePromise)
        setTimeout(resolvePromise, 1_000).unref()
      })
    },
  }
}

async function stopApp(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      killer.once('exit', resolvePromise)
      killer.once('error', resolvePromise)
    })
  } else {
    child.kill('SIGTERM')
  }
  await new Promise((resolvePromise) => {
    child.once('close', resolvePromise)
    setTimeout(resolvePromise, 5_000).unref()
  })
}

const userDataDir = await mkdtemp(join(tmpdir(), 'nexoffice-package-mcp-'))
let appOutput = ''
// CI hosts can export this for Electron tooling. A packaged desktop app must
// remove it or Electron starts as plain Node and never creates the MCP bridge.
const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...hostEnv } = process.env
const app = spawn(appPath, target === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [], {
  detached: process.platform !== 'win32',
  env: {
    ...hostEnv,
    NEXOFFICE_USER_DATA: userDataDir,
    ...(target === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
  },
  // Linux GitHub runners need the same trusted-local switches as the Electron
  // E2E suite; Windows keeps its default process invocation.
  stdio: ['ignore', 'pipe', 'pipe'],
})
for (const stream of [app.stdout, app.stderr]) {
  stream?.setEncoding('utf8')
  stream?.on('data', (chunk) => {
    appOutput = `${appOutput}${chunk}`.slice(-4_000)
  })
}
app.once('error', (error) => {
  appOutput = `${appOutput}\nlaunch error: ${error.message}`.slice(-4_000)
})
let client
try {
  const discoveryPath = join(userDataDir, 'mcp', 'bridge.json')
  await waitForFile(discoveryPath, 30_000, () =>
    appOutput ? `\nPackaged app output:\n${appOutput}` : '',
  )
  client = createMcpClient(discoveryPath)
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'nexoffice-package-smoke' },
  })
  if (initialized.result?.serverInfo?.name !== 'NexOffice') {
    throw new Error('Packaged MCP adapter did not return NexOffice server info')
  }
  const tools = await client.request('tools/list', {})
  if (!tools.result?.tools?.some((tool) => tool.name === 'create_document')) {
    throw new Error('Packaged MCP adapter did not expose create_document')
  }
  const created = await client.request('tools/call', {
    name: 'create_document',
    arguments: { kind: 'slides' },
  })
  if (created.result?.isError)
    throw new Error('Packaged MCP adapter could not create a Slides document')
  process.stdout.write(`package-mcp-smoke: ${target} OK\n`)
} finally {
  await client?.close()
  await stopApp(app)
  // Chromium can retain SQLite/WAL handles briefly after its parent exits,
  // particularly on Windows runners. Cleanup is non-functional: retry it,
  // then report a warning rather than hiding a successful MCP smoke result.
  try {
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`::warning title=Packaged MCP smoke cleanup::${message}\n`)
  }
}
