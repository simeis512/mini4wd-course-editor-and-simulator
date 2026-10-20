import { Matrix4, Vector3 } from 'three';
import { variantOf, type PartDef } from '../course/catalog';
import { attach, partGeometry, pointOnFrame } from '../course/geometry';
import { crossSection } from '../course/mesh';

/** Width of floor every icon shows, mm, so the parts keep their sizes relative to each other. */
const ICON_SPAN = 960;
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Top view of a part as it lies when joined by `port`: that port at the
 * bottom, the part heading up the icon, as in the 2D view (spec 8). Drawn
 * from the part's own geometry, so a measured model will show the same way.
 */
export function partIcon(part: PartDef, port: number, variant?: number): SVGSVGElement {
  const geo = partGeometry(part);
  const matrix = attach(new Matrix4(), geo.ports[port]);
  const p = new Vector3();
  // Screen right is world −X and screen up is +Z, as in the top view.
  const shapes = geo.tracks
    .map((track) => {
      const samples = track.samples.map((s) => matrix.clone().multiply(s));
      const edge = (x: number) => samples.map((f) => (pointOnFrame(f, x, 0, p), [-p.x, -p.z] as [number, number]));
      const section = crossSection(track.lanes);
      return {
        polygon: [...edge(section.left), ...edge(section.right).reverse()],
        fences: section.fences.map(edge),
        height: samples.reduce((sum, f) => sum + f.elements[13], 0) / samples.length,
      };
    })
    .sort((a, b) => a.height - b.height);

  const pts = shapes.flatMap((s) => s.polygon);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `${cx - ICON_SPAN / 2} ${cy - ICON_SPAN / 2} ${ICON_SPAN} ${ICON_SPAN}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('part-icon');
  const color = variantOf(part, variant).color;
  const points = (q: [number, number][]) => q.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  for (const s of shapes) {
    const road = document.createElementNS(SVG, 'polygon');
    road.setAttribute('points', points(s.polygon));
    road.setAttribute('fill', color);
    road.setAttribute('stroke', 'rgba(0,0,0,0.55)');
    road.setAttribute('stroke-width', '8');
    svg.appendChild(road);
    for (const f of s.fences) {
      const line = document.createElementNS(SVG, 'polyline');
      line.setAttribute('points', points(f));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'rgba(0,0,0,0.45)');
      line.setAttribute('stroke-width', '6');
      svg.appendChild(line);
    }
  }
  return svg;
}
