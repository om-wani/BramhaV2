/**
 * McpClient — HTTP client for calling MCP connector endpoints.
 *
 * Security invariants:
 * - Sends capability token as Bearer header (never raw credentials)
 * - Checks Content-Length header first (fast-fail before buffering)
 * - Buffers response and enforces byte limit before returning
 * - On non-2xx → throws McpCallError with HTTP status text
 * - On oversized response → throws McpCallError('result_too_large')
 */

import { McpCallError } from './errors.js'
import type { McpResult } from '../types.js'

export class McpClient {
  /**
   * Call a tool on an MCP connector.
   *
   * @param connectorUrl    Base URL of the connector (e.g. https://connector.example.com)
   * @param toolName        Tool name as declared in the connector manifest
   * @param args            Arguments to pass to the tool
   * @param capabilityToken Signed JWT minted by PolicyEngine
   * @param maxResultBytes  Per-tool byte limit from ConnectorTool.limits.maxResultBytes
   */
  async call(
    connectorUrl: string,
    toolName: string,
    args: unknown,
    capabilityToken: string,
    maxResultBytes: number,
  ): Promise<McpResult> {
    const response = await fetch(`${connectorUrl}/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${capabilityToken}`,
      },
      body: JSON.stringify({ tool: toolName, args }),
    })

    if (!response.ok) {
      throw new McpCallError(response.statusText, response.status)
    }

    // Fast-fail: check Content-Length before buffering the full body
    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader !== null) {
      const declared = parseInt(contentLengthHeader, 10)
      if (!isNaN(declared) && declared > maxResultBytes) {
        throw new McpCallError('result_too_large')
      }
    }

    // Buffer and enforce byte limit
    const buffer = await response.arrayBuffer()
    const bytes = buffer.byteLength
    if (bytes > maxResultBytes) {
      throw new McpCallError('result_too_large')
    }

    const content = new TextDecoder('utf-8').decode(buffer)
    return { content, bytes }
  }
}
