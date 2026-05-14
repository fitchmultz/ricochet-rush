export function appendAssistantTextChunk(current: string, next: string): string {
  if (!next) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;

  const maxOverlap = Math.min(current.length, next.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (current.endsWith(next.slice(0, length))) return current + next.slice(length);
  }
  return current + next;
}
