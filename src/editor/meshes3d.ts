import { Group, type Mesh } from 'three';
import type { Layout } from '../course/course';
import { supports, type Support } from '../course/height';
import { sameRoad } from '../course/layout-diff';
import { buildPieceMesh, buildSupportMesh, worldTracks } from '../course/mesh';
import { buildPropMeshes } from '../course/props-mesh';
import { disposeGeometries } from './resources';

/** Retain unchanged piece/support meshes, releasing only replaced geometry (#92). */
export class CourseMeshes {
  private layout: Layout | null = null;
  private pieces: Group[] = [];
  private stands = new Map<number, { list: Support[]; mesh: Mesh }>();
  props: Group[] = [];

  constructor(private root: Group) {}

  update(layout: Layout): Group[] {
    const before = this.layout;
    const tracks = worldTracks(layout, before);
    const list = supports(layout, tracks, before);
    const pieces = layout.pieces.map((pc, i) => {
      const old = before?.pieces[i];
      if (sameRoad(old, pc) && old!.rec.variant === pc.rec.variant &&
        JSON.stringify(before!.attachments.filter((a) => a.piece === i)) === JSON.stringify(layout.attachments.filter((a) => a.piece === i))) return this.pieces[i];
      const mesh = buildPieceMesh(layout, i);
      this.root.add(mesh);
      return mesh;
    });
    this.pieces.forEach((mesh, i) => {
      if (pieces[i] === mesh) return;
      this.root.remove(mesh);
      disposeGeometries(mesh, true);
    });
    const byPiece = new Map<number, Support[]>();
    for (const s of list) {
      const group = byPiece.get(s.piece) ?? [];
      group.push(s);
      byPiece.set(s.piece, group);
    }
    for (const [piece, old] of this.stands) {
      const next = byPiece.get(piece);
      if (next?.length === old.list.length && next.every((s, i) => s === old.list[i])) continue;
      this.root.remove(old.mesh);
      old.mesh.geometry.dispose();
      this.stands.delete(piece);
    }
    for (const [piece, list] of byPiece) {
      if (this.stands.has(piece)) continue;
      const mesh = buildSupportMesh(list);
      mesh.userData.supportPiece = piece;
      this.root.add(mesh);
      this.stands.set(piece, { list, mesh });
    }
    const sameProps = before && JSON.stringify([before.start, before.timer, before.stoppers]) === JSON.stringify([layout.start, layout.timer, layout.stoppers]) &&
      [layout.start, layout.timer].every((at) => !at || sameRoad(before.pieces[at.piece], layout.pieces[at.piece]));
    if (!sameProps) {
      for (const mesh of this.props) {
        this.root.remove(mesh);
        disposeGeometries(mesh);
      }
      this.props = buildPropMeshes(layout);
      for (const mesh of this.props) this.root.add(mesh);
    }
    this.layout = layout;
    this.pieces = pieces;
    return pieces;
  }
}
