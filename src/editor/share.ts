import { courseFromHash, courseFromJson, courseToHash } from '../course/codec';
import type { Course } from '../course/course';
import { toast } from './dom';

// Handing courses over: the page URL, and course files.

/** Keeps the page URL holding the course. */
export class HashSync {
  /** The hash we last wrote, so our own updates are not reloaded. */
  private writtenHash = '';
  private hashWrite = Promise.resolve();

  /** Whether `hash` is the one we last wrote. */
  isOwn(hash: string): boolean {
    return hash === this.writtenHash;
  }

  write(course: Course): void {
    // Chain the writes so a slow encode never overwrites a newer one.
    this.hashWrite = this.hashWrite.then(async () => {
      const hash = await courseToHash(course);
      this.writtenHash = hash;
      history.replaceState(null, '', hash || location.pathname + location.search);
    });
  }

  /** The page URL once the latest course is written into it. */
  async url(): Promise<string> {
    await this.hashWrite;
    return location.href;
  }

  async copyUrl(): Promise<void> {
    const url = await this.url();
    try {
      await navigator.clipboard.writeText(url);
      toast('URLをコピーしました');
    } catch {
      prompt('このURLをコピーしてください', url);
    }
  }
}

/** Characters file systems refuse in a name (Windows is the strictest). */
const UNSAFE_IN_FILE_NAMES = /[\\/:*?"<>|\u0000-\u001f]/g;

/** A file name, before the extension, for a course called `name`: `course` when it has none. */
export const fileName = (name = '') => name.replace(UNSAFE_IN_FILE_NAMES, '_').trim() || 'course';

/** Save `blob` as a file called `name`. */
export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Save the course as a JSON file named after `name` (its own name or the save it is). */
export function exportJson(course: Course, name: string): void {
  download(new Blob([JSON.stringify(course, null, 2)], { type: 'application/json' }), `${fileName(name)}.json`);
}

/** The course in a file saved by `exportJson`; throws when it is not one. */
export async function readCourseFile(file: File): Promise<Course> {
  return courseFromJson(await file.text());
}

/** The course in the page URL: null when there is none, undefined (after saying so) when it cannot be read. */
export async function readHash(): Promise<Course | null | undefined> {
  try {
    return await courseFromHash(location.hash);
  } catch (e) {
    toast(`URLのコースを読み込めませんでした: ${(e as Error).message}`);
    return undefined;
  }
}
