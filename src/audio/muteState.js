import { useSyncExternalStore } from 'react';

// Site-wide mute for the welcome-page music and the space-bar click, remembered per browser.
const STORAGE_KEY = 'dj-muted';
const listeners = new Set();

let muted = false;
try { muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage unavailable */ }

export const isMuted = () => muted;

export function setMuted(next) {
  muted = next;
  try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
  listeners.forEach((fn) => fn(muted));
}

export function subscribeMuted(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useMuted = () => useSyncExternalStore(subscribeMuted, isMuted);
