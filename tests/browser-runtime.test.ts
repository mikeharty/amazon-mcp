import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserRuntimeError, PersistentBrowserRuntime } from '../packages/browser-runtime/index.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('persistent browser runtime', () => {
  it('serializes operations and fences a profile to one live owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'amazon-mcp-runtime-'));
    temporary.push(root);
    const profileDir = join(root, 'profile');
    const first = new PersistentBrowserRuntime({ profileDir, headless: true });
    const second = new PersistentBrowserRuntime({ profileDir, headless: true });
    await first.start();
    await expect(second.start()).rejects.toMatchObject({ code: 'recovery_required' });
    const seen: number[] = [];
    await Promise.all([
      first.run(async () => { seen.push(1); await new Promise(resolve => setTimeout(resolve, 20)); seen.push(2); }),
      first.run(async () => { seen.push(3); }),
    ]);
    expect(seen).toEqual([1, 2, 3]);
    await first.close();
  });

  it('pauses for handoff and increments the persisted generation only after revalidation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'amazon-mcp-runtime-'));
    temporary.push(root);
    const generations: number[] = [];
    const runtime = new PersistentBrowserRuntime({ profileDir: join(root, 'profile'), headless: true, onSessionGeneration: generation => { generations.push(generation); } });
    await runtime.start();
    await runtime.run(async page => {
      await page.route('https://www.amazon.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Account</title><span id="nav-link-accountList-nav-line-1">Hello, Fixture</span>' }));
      await page.goto('https://www.amazon.com/gp/css/homepage.html');
    });
    const handoff = await runtime.beginHandoff();
    await expect(runtime.run(async () => true)).rejects.toMatchObject({ code: 'handoff_in_progress' });
    const result = await runtime.completeHandoff(handoff.generation);
    expect(result.kind).toBe('ready');
    expect(runtime.status()).toMatchObject({ sessionGeneration: 1, paused: false, running: true });
    expect(generations).toEqual([1]);
    await runtime.close();
  });

  it('rejects navigation outside the explicit host allowlist before any request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'amazon-mcp-runtime-'));
    temporary.push(root);
    const runtime = new PersistentBrowserRuntime({ profileDir: join(root, 'profile'), headless: true });
    await runtime.start();
    await expect(runtime.navigate('https://example.com/')).rejects.toEqual(expect.objectContaining<Partial<BrowserRuntimeError>>({ code: 'host_not_allowed' }));
    await runtime.close();
  });
});
