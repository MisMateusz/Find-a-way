import type { DirExt as Dir } from './tiles';

const KEYS_STORE = 'findaway-keys';
export const DEFAULT_KEYS: Record<Dir, string> = { N: 'w', NE: 'e', E: 'd', SE: 'c', S: 's', SW: 'z', W: 'a', NW: 'q' };

export const loadKeys = (): Record<Dir, string> => {
  try {
    return { ...DEFAULT_KEYS, ...JSON.parse(localStorage.getItem(KEYS_STORE) ?? '{}') };
  } catch {
    return { ...DEFAULT_KEYS };
  }
};

export const saveKeys = (keys: Record<Dir, string>) => {
  try {
    localStorage.setItem(KEYS_STORE, JSON.stringify(keys));
  } catch {}
};

const CONSENT_STORE = 'findaway-consent';

export const loadConsent = (): 'direct' | 'relay' | null => {
  try {
    const v = localStorage.getItem(CONSENT_STORE);
    return v === 'direct' || v === 'relay' ? v : null;
  } catch {
    return null;
  }
};

export const saveConsent = (v: 'direct' | 'relay' | null) => {
  try {
    if (v) localStorage.setItem(CONSENT_STORE, v);
    else localStorage.removeItem(CONSENT_STORE);
  } catch {}
};