import { createServer, type Server } from 'node:http';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createGateway, type GatewayOptions } from '../apps/gateway/transport.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('MCP HTTP gateway', () => {
  it('supports modern SDK discovery, typed tool calls, owner context, and resources', async () => {
    const toolHandler = vi.fn(async (input: unknown, context: { owner: { id: string } }) => {
      const { query } = input as { query: string };
      const output = { query, ownerId: context.owner.id };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    });
    const gateway = createGateway({
      authenticate: authenticateTestOwner,
      tools: [
        {
          name: 'search_products',
          title: 'Search products',
          description: 'Searches fixture product data.',
          inputSchema: z.object({ query: z.string().min(1) }),
          outputSchema: z.object({ query: z.string(), ownerId: z.string() }),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          handler: toolHandler,
        },
      ],
      resources: [
        {
          name: 'capabilities',
          uri: 'amazon://capabilities',
          title: 'Capabilities',
          mimeType: 'application/json',
          handler: async (uri, { owner }) => ({
            contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ ownerId: owner.id }) }],
          }),
        },
      ],
    });
    const url = await listen(gateway);
    const client = makeClient(url, 'modern-token', 'auto');

    await client.client.connect(client.transport);

    expect(client.client.getProtocolEra()).toBe('modern');
    const { tools } = await client.client.listTools();
    expect(tools).toEqual([
      expect.objectContaining({
        name: 'search_products',
        inputSchema: expect.objectContaining({ type: 'object' }),
        outputSchema: expect.objectContaining({ type: 'object' }),
        annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
      }),
    ]);

    const result = await client.client.callTool({ name: 'search_products', arguments: { query: 'tea' } });
    expect(result.structuredContent).toEqual({ query: 'tea', ownerId: 'owner-1' });
    expect(toolHandler).toHaveBeenCalledOnce();

    const { resources } = await client.client.listResources();
    expect(resources).toEqual([expect.objectContaining({ uri: 'amazon://capabilities' })]);
    const resource = await client.client.readResource({ uri: 'amazon://capabilities' });
    const firstContent = resource.contents[0]!;
    expect('text' in firstContent ? JSON.parse(firstContent.text) : undefined).toEqual({ ownerId: 'owner-1' });

    await client.client.close();
  });

  it('supports the SDK v2 legacy 2025 Streamable HTTP path', async () => {
    const gateway = createGateway(baseOptions());
    const url = await listen(gateway);
    const client = makeClient(url, 'legacy-token', 'legacy');

    await client.client.connect(client.transport);

    expect(client.client.getProtocolEra()).toBe('legacy');
    expect(client.client.getNegotiatedProtocolVersion()).toMatch(/^2025-/);
    const result = await client.client.callTool({ name: 'get_status', arguments: {} });
    expect(result.structuredContent).toEqual({ status: 'ok', ownerId: 'owner-1' });

    await client.client.close();
  });

  it('rejects missing bearer auth, non-loopback hosts, foreign origins, and oversized bodies', async () => {
    const gateway = createGateway({
      ...baseOptions(),
      maxRequestBytes: 32,
      authenticate: (request) =>
        request.headers.get('authorization') === 'Bearer valid'
          ? { id: 'owner-1', scopes: ['shopping:read'] }
          : undefined,
    });
    const rpcBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

    const missingAuth = await gateway(
      new Request('http://localhost/mcp', { method: 'POST', headers: { host: 'localhost' }, body: rpcBody }),
    );
    expect(missingAuth.status).toBe(401);
    expect(missingAuth.headers.get('www-authenticate')).toContain('Bearer');

    const invalidAuth = await gateway(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer invalid', host: 'localhost' },
        body: rpcBody,
      }),
    );
    expect(invalidAuth.status).toBe(401);

    const foreignHost = await gateway(
      new Request('http://evil.example/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer valid', host: 'evil.example' },
        body: rpcBody,
      }),
    );
    expect(foreignHost.status).toBe(403);

    const foreignOrigin = await gateway(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer valid', host: 'localhost', origin: 'http://evil.example' },
        body: rpcBody,
      }),
    );
    expect(foreignOrigin.status).toBe(403);

    const oversized = await gateway(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer valid', host: 'localhost' },
        body: 'x'.repeat(33),
      }),
    );
    expect(oversized.status).toBe(413);
  });

  it('does not expose thrown tool errors to clients', async () => {
    const secret = 'internal-db-password';
    const gateway = createGateway({
      authenticate: authenticateTestOwner,
      tools: [
        {
          name: 'failing_tool',
          inputSchema: z.object({}),
          outputSchema: z.object({ status: z.string() }),
          annotations: { readOnlyHint: true },
          handler: async () => {
            throw new Error(`connection failed: ${secret}`);
          },
        },
      ],
    });
    const url = await listen(gateway);
    const client = makeClient(url, 'valid', 'auto');
    await client.client.connect(client.transport);

    const result = await client.client.callTool({ name: 'failing_tool', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Tool execution failed');
    expect(JSON.stringify(result)).not.toContain(secret);

    await client.client.close();
  });
});

function baseOptions(): GatewayOptions {
  return {
    authenticate: authenticateTestOwner,
    tools: [
      {
        name: 'get_status',
        inputSchema: z.object({}),
        outputSchema: z.object({ status: z.literal('ok'), ownerId: z.string() }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        handler: async (_input, { owner }) => {
          const output = { status: 'ok' as const, ownerId: owner.id };
          return {
            content: [{ type: 'text', text: JSON.stringify(output) }],
            structuredContent: output,
          };
        },
      },
    ],
  };
}

function authenticateTestOwner(request: Request) {
  return request.headers.get('authorization')?.startsWith('Bearer ')
    ? { id: 'owner-1', scopes: ['shopping:read'] }
    : undefined;
}

function makeClient(url: URL, token: string, mode: 'auto' | 'legacy') {
  const client = new Client(
    { name: `transport-test-${mode}`, version: '1.0.0' },
    { versionNegotiation: { mode } },
  );
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: { token: async () => token },
  });
  return { client, transport };
}

async function listen(handler: (request: Request) => Promise<Response>): Promise<URL> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));

      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('HTTP test server is not listening');
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const part of value) headers.append(name, part);
        else if (value !== undefined) headers.set(name, value);
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://127.0.0.1:${address.port}${incoming.url ?? '/'}`, {
        method: incoming.method,
        headers,
        body,
      });
      const response = await handler(request);

      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end('{"error":"test bridge failure"}');
    }
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server is not listening');
  return new URL(`http://127.0.0.1:${address.port}/mcp`);
}
