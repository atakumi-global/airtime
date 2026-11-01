import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, loadConfigFromFile, mergeConfig } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

// AIRTIME-83: `npm run tauri dev` crashed on Windows with EBUSY because Vite's file
// watcher tried to watch Rust build output under src-tauri/target.
describe('vite dev server watcher', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.()
  })

  async function watchedPaths(overrideIgnored?: string[]): Promise<string[]> {
    const root = mkdtempSync(join(tmpdir(), 'airtime-vite-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const buildDir = join(root, 'src-tauri', 'target', 'debug', 'build', 'tauri-x')
    const exe = join(buildDir, 'build_script_build-x.exe')
    mkdirSync(buildDir, { recursive: true })
    writeFileSync(exe, 'x')
    writeFileSync(join(root, 'index.html'), '<!doctype html>')

    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      resolve(process.cwd(), 'vite.config.ts'),
    )
    if (!loaded) throw new Error('vite.config.ts not found')
    let config = mergeConfig({ ...loaded.config, plugins: [] }, {
      root,
      configFile: false,
      appType: 'custom',
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
    })
    if (overrideIgnored) config = { ...config, server: { ...config.server, watch: { ignored: overrideIgnored } } }
    const server = await createServer(config)
    cleanups.push(() => server.close())
    server.watcher.add(exe)
    await new Promise((done) => setTimeout(done, 300))
    return Object.keys(server.watcher.getWatched()).map((p) => p.replaceAll('\\', '/'))
  }

  it('does not watch anything under src-tauri', async () => {
    const watched = await watchedPaths()
    expect(watched.filter((p) => p.includes('/src-tauri'))).toEqual([])
  })

  it('control: without the ignore rule the Rust build output is watched', async () => {
    const watched = await watchedPaths([])
    expect(watched.some((p) => p.includes('/src-tauri/target/'))).toBe(true)
  })
})
