import type { Layout } from '../course/course';
import type { Selection } from './selection';

/** What the editor needs from the 2D and 3D views alike. */
export interface EditorView {
  /** Show this layout with this selection. */
  setData(layout: Layout, selection: Selection): void;
  /** Frame the whole course. */
  fit(): void;
  /** Floor point (mm, X/Z) in the middle of the view. */
  readonly centre: [number, number];
  /** Floor point (mm, X/Z) under a point on the page, or null when there is none. */
  floorAt(clientX: number, clientY: number): [number, number] | null;
  /** Point on the page over the world point (mm), or null when it cannot be seen. */
  clientOf(x: number, y: number, z: number): [number, number] | null;
}
