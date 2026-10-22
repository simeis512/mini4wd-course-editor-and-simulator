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

/** The name files of `course` are saved under, before the extension. */
export const fileName = (course: Course) => course.name || 'course';

/** Save `blob` as a file called `name`. */
export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportJson(course: Course): void {
  download(new Blob([JSON.stringify(course, null, 2)], { type: 'application/json' }), `${fileName(course)}.json`);
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
