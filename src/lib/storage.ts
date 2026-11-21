const memory = new Map<string, string>();
let memoryOnly = false;

function storageBlocked(): boolean {
  if (memoryOnly) return true;
  try {
    const probe = "__pickem_storage__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return false;
  } catch {
    memoryOnly = true;
    return true;
  }
}

/** localStorage when it works, otherwise memory for this visit. */
export function safeGetItem(key: string): string | null {
  if (storageBlocked()) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    memoryOnly = true;
    return memory.get(key) ?? null;
  }
}

export function safeSetItem(key: string, value: string) {
  memory.set(key, value);
  if (storageBlocked()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryOnly = true;
  }
}

export function safeRemoveItem(key: string) {
  memory.delete(key);
  if (storageBlocked()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    memoryOnly = true;
  }
}

export const safeAuthStorage = {
  getItem: (key: string) => safeGetItem(key),
  setItem: (key: string, value: string) => { safeSetItem(key, value); },
  removeItem: (key: string) => { safeRemoveItem(key); },
};
