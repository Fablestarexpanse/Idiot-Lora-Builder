/**
 * Groups of images that share one caption file because only their extension
 * differs (a.jpg and a.png both use a.txt): editing either caption overwrites
 * the other's. Case-insensitive, since Windows paths are.
 */
export function findSharedCaptions(relativePaths: string[]): string[][] {
  const byCaption = new Map<string, string[]>();
  for (const rel of relativePaths) {
    const key = rel.replace(/\\/g, "/").replace(/\.[^./]+$/, "").toLowerCase();
    const group = byCaption.get(key);
    if (group) group.push(rel);
    else byCaption.set(key, [rel]);
  }
  return [...byCaption.values()].filter((g) => g.length > 1);
}
