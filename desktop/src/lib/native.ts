import { invoke } from '@tauri-apps/api/core';

export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const SESSION_KEY = 'airtime.session-token';

function browserStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function saveSecret(key: string, value: string): Promise<void> {
  if (isTauri) {
    await invoke('save_secret', { key, value });
    return;
  }
  browserStore()?.setItem(key, value);
}

export async function loadSecret(key: string): Promise<string | null> {
  if (isTauri) {
    return invoke<string | null>('load_secret', { key });
  }
  return browserStore()?.getItem(key) ?? null;
}

export async function deleteSecret(key: string): Promise<void> {
  if (isTauri) {
    await invoke('delete_secret', { key });
    return;
  }
  browserStore()?.removeItem(key);
}

export async function readCacheFile(): Promise<string | null> {
  if (isTauri) {
    return invoke<string | null>('cache_read');
  }
  return browserStore()?.getItem('airtime.cache') ?? null;
}

export async function writeCacheFile(contents: string): Promise<void> {
  if (isTauri) {
    await invoke('cache_write', { contents });
    return;
  }
  browserStore()?.setItem('airtime.cache', contents);
}
