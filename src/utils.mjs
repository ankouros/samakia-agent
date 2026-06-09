/**
 * Lightweight glob matching (no dependencies).
 */
export function minimatch(filePath, pattern) {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '†')
    .replace(/\*/g, '[^/]*')
    .replace(/†/g, '.*');
  return new RegExp(`^${regex}$`).test(filePath);
}
