#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { clientFromEnvironment, createMcpServer } from './mcp-server.js'

try {
  await createMcpServer(clientFromEnvironment(process.env)).connect(new StdioServerTransport())
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
