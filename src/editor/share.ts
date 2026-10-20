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

  async copyUrl(): Promise<void> {
    await this.hashWrite;
    try {
      await navigator.clipboard.writeText(location.href);
      toast('URLをコピーしました');
    } catch {
      prompt('このURLをコピーしてください', location.href);
    }
  }
}

export function exportJson(course: Course): void {
  const blob = new Blob([JSON.stringify(course, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${course.name || 'course'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
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
