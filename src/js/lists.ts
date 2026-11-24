/** Keep first-occurrence order in authored/server lists used as Svelte keys. */
export function uniqueBy<T>(items: readonly T[], key: (item: T) => unknown): T[] {
  const seen = new Set<unknown>();
  return items.filter(item => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value) ? uniqueBy(value.filter((item): item is string => typeof item === 'string'), item => item) : [];
}
