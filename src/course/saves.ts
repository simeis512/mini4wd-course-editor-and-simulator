/**
 * Courses saved in the browser (#68): what a saved entry holds, and how
 * entries are named and listed. The storage itself is in the editor.
 */

/** A course saved under a name. */
export interface SavedCourse {
  id: string;
  name: string;
  /** The course as `encodeCourse` writes it, so older formats still open. */
  data: string;
  /** Milliseconds since the epoch. */
  savedAt: number;
  /** Shown in the list without decoding the course. */
  pieceCount: number;
}

/** The course being edited, kept apart from the named saves (#68). */
export interface Autosave {
  data: string;
  savedAt: number;
  pieceCount: number;
  /** The named save it came from, so overwriting still goes there after a resume. */
  savedId?: string;
}

/** The longest name kept, in characters. */
export const SAVE_NAME_MAX = 60;

/** A name as typed, trimmed and cut to length; empty when nothing usable was typed. */
export function cleanName(name: string): string {
  return [...name.trim().replace(/\s+/g, ' ')].slice(0, SAVE_NAME_MAX).join('');
}

/** `base`, or `base (2)`, `base (3)`, … whichever no entry in `names` has. */
export function uniqueName(base: string, names: readonly string[]): string {
  const taken = new Set(names);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} (${n})`;
    if (!taken.has(name)) return name;
  }
}

/** The name offered when saving: the course's own name, or `コース` and the date. */
export function defaultSaveName(courseName: string | undefined, now: Date, names: readonly string[]): string {
  const own = cleanName(courseName ?? '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
  return uniqueName(own || `コース ${date}`, names);
}

/** Saves newest first. */
export function sortSaves(saves: readonly SavedCourse[]): SavedCourse[] {
  return [...saves].sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Whether to ask "open where you left off?" on start (#68): only when the
 * page was opened without a course in its URL (a shared course wins), and
 * the last session left something that is not what a fresh start shows.
 */
export function offerResume(autosave: Autosave | undefined, urlHasCourse: boolean, freshData: string): boolean {
  return !urlHasCourse && !!autosave && autosave.pieceCount > 0 && autosave.data !== freshData;
}
