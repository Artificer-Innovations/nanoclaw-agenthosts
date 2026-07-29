const warned = new Set<string>();

/** Shared fail-loud helper. One implementation, copied into the host tree. */
export function warnOnce(key: string, message: string, error?: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (error === undefined) console.warn(`[nanoclaw-agenthosts] ${message}`);
  else console.warn(`[nanoclaw-agenthosts] ${message}`, error);
}

export function resetWarnOnceForTests(): void {
  warned.clear();
}
