// The app's version and the changelog in the about panel (#137, owner
// 2026-10-30). CHANGELOG.md is written by scripts/changes.mjs on merge.

export interface Release {
  version: string;
  date: string;
  lines: string[];
}

/** The versions in CHANGELOG.md, newest first. */
export function parseChangelog(text: string): Release[] {
  const out: Release[] = [];
  for (const m of text.matchAll(/^## v(\S+?)（(.+?)）\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
    const lines = m[3].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    out.push({ version: m[1], date: m[2], lines });
  }
  return out;
}

/** Whether version `a` comes after `b` (x.y.z). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** Last version the about panel was opened at in this browser. */
const SEEN_KEY = 'version.seen';

/**
 * Whether to put the small mark on the "i" button: this version is newer
 * than the one last seen (owner: only a mark, no notice). A first visit
 * just remembers the version.
 */
export function updateMark(current: string, storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  const seen = storage.getItem(SEEN_KEY);
  if (!seen) {
    storage.setItem(SEEN_KEY, current);
    return false;
  }
  return isNewer(current, seen);
}

/** The about panel was opened: the mark goes. */
export function markSeen(current: string, storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(SEEN_KEY, current);
}
