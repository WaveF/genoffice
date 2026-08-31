#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { LocalBridgeClient, readBridgeDiscovery } from './bridge-client'
import { StdioMcpServer } from './server'

function discoveryPath(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  const at = argv.indexOf('--discovery')
  if (at >= 0 && argv[at + 1]) return argv[at + 1]!
  if (env.NEXOFFICE_MCP_DISCOVERY_PATH) return env.NEXOFFICE_MCP_DISCOVERY_PATH
  throw new Error('Set NEXOFFICE_MCP_DISCOVERY_PATH or pass --discovery <path>')
}

export async function runMcpCli(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const discovery = await readBridgeDiscovery(discoveryPath(argv, env))
  const bridge = new LocalBridgeClient(discovery)
  await bridge.connect()
  const server = new StdioMcpServer({
    input: process.stdin,
    output: process.stdout,
    backend: bridge,
  })
  process.stdin.once('end', () => bridge.close())
  process.once('SIGTERM', () => {
    server.close()
    bridge.close()
  })
  server.start()
}

const invokedPath = process.argv[1]
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runMcpCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`nexoffice-mcp: ${message}\n`)
    process.exitCode = 1
  })
}
