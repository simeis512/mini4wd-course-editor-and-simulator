import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { buildStraightMesh } from './course/mesh';
import { PARTS } from './course/parts';
import { createPhysicsWorld } from './physics/world';

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const background = new THREE.Color(0x1b1d22);
scene.background = background;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(1.2, 1.0, -0.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.45);
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(2, 4, 1);
scene.add(sun);

const grid = new THREE.GridHelper(4, 40, 0x555555, 0x333333);
scene.add(grid);

const course = new THREE.Group();
course.add(buildStraightMesh(PARTS[0]));
scene.add(course);

// AR: drop the opaque background and grid so the course sits in the camera feed.
document.body.appendChild(ARButton.createButton(renderer));
renderer.xr.addEventListener('sessionstart', () => {
  scene.background = null;
  grid.visible = false;
  course.position.set(0, -0.8, -1.2);
});
renderer.xr.addEventListener('sessionend', () => {
  scene.background = background;
  grid.visible = true;
  course.position.set(0, 0, 0);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const world = await createPhysicsWorld();
hud.textContent = `Three.js r${THREE.REVISION} / Rapier ready`;

renderer.setAnimationLoop(() => {
  world.step();
  renderer.render(scene, camera);
});
