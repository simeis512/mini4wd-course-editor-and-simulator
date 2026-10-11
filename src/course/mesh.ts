import * as THREE from 'three';
import { LANE_COUNT, LANE_WIDTH_MM, TRACK_WIDTH_MM, WALL_HEIGHT_MM, WALL_THICKNESS_MM, type StraightPart } from './parts';

/** Scene units are metres; part data is in millimetres. */
const MM = 0.001;

const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2d6cdf });
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2f2 });

/** Build a straight section running along +Z, with its start at the origin. */
export function buildStraightMesh(part: StraightPart): THREE.Group {
  const group = new THREE.Group();
  group.name = part.id;
  const length = part.lengthMm * MM;

  const floor = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH_MM * MM, 0.002, length), floorMaterial);
  floor.position.set(0, -0.001, length / 2);
  group.add(floor);

  const wallGeometry = new THREE.BoxGeometry(WALL_THICKNESS_MM * MM, WALL_HEIGHT_MM * MM, length);
  const pitch = (LANE_WIDTH_MM + WALL_THICKNESS_MM) * MM;
  const firstWallX = -(LANE_COUNT * pitch) / 2;
  for (let i = 0; i <= LANE_COUNT; i++) {
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(firstWallX + i * pitch, (WALL_HEIGHT_MM * MM) / 2, length / 2);
    group.add(wall);
  }
  return group;
}
