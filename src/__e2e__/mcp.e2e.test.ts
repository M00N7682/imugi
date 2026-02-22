import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { readFileSync } from 'fs';

const { version: PKG_VERSION } = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'),
);

const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function createMcpSession() {
  const child = spawn('node', [CLI_PATH, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });

  let buffer = '';
  const pendingResolvers = new Map<number, (response: JsonRpcResponse) => void>();

  child.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (msg.id !== undefined) {
          const resolver = pendingResolvers.get(msg.id);
          if (resolver) {
            pendingResolvers.delete(msg.id);
            resolver(msg);
          }
        }
      } catch {
        // not json, skip
      }
    }
  });

  return {
    send(method: string, params: Record<string, unknown>, id: number): Promise<JsonRpcResponse> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingResolvers.delete(id);
          reject(new Error(`MCP response timeout for id=${id}, method=${method}`));
        }, 10000);

        pendingResolvers.set(id, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });

        const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
        child.stdin!.write(msg + '\n');
      });
    },
    notify(method: string, params: Record<string, unknown>): void {
      const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
      child.stdin!.write(msg + '\n');
    },
    kill() {
      child.kill('SIGTERM');
    },
  };
}

describe('MCP Server E2E', () => {
  it('responds to initialize request', async () => {
    const session = createMcpSession();
    try {
      const response = await session.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }, 1);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();

      const result = response.result as { serverInfo?: { name: string; version: string }; capabilities?: Record<string, unknown> };
      expect(result.serverInfo?.name).toBe('imugi');
      expect(result.serverInfo?.version).toBe(PKG_VERSION);
      expect(result.capabilities).toBeDefined();
    } finally {
      session.kill();
    }
  }, 15000);

  it('lists all 5 tools after initialization', async () => {
    const session = createMcpSession();
    try {
      await session.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }, 1);

      session.notify('notifications/initialized', {});

      const response = await session.send('tools/list', {}, 2);
      expect(response.id).toBe(2);

      const result = response.result as { tools: Array<{ name: string; description: string }> };
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('imugi_capture');
      expect(toolNames).toContain('imugi_compare');
      expect(toolNames).toContain('imugi_analyze');
      expect(toolNames).toContain('imugi_detect');
      expect(toolNames).toContain('imugi_serve');
      expect(result.tools).toHaveLength(5);

      for (const tool of result.tools) {
        expect(tool.description.length).toBeGreaterThan(10);
      }
    } finally {
      session.kill();
    }
  }, 15000);

  it('executes imugi_detect tool on current directory', async () => {
    const session = createMcpSession();
    try {
      await session.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }, 1);

      session.notify('notifications/initialized', {});

      const response = await session.send('tools/call', {
        name: 'imugi_detect',
        arguments: { projectDir: process.cwd() },
      }, 3);

      expect(response.id).toBe(3);
      expect(response.error).toBeUndefined();

      const result = response.result as { content: Array<{ type: string; text: string }> };
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      const textContent = result.content.find((c) => c.type === 'text');
      expect(textContent).toBeDefined();

      const detected = JSON.parse(textContent!.text);
      expect(detected).toHaveProperty('framework');
      expect(detected).toHaveProperty('language');
      expect(detected).toHaveProperty('css');
      expect(detected).toHaveProperty('devServer');
    } finally {
      session.kill();
    }
  }, 15000);
});
