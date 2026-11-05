import * as THREE from 'three';
import type { Layout } from '../course/course';
import { timedLane } from '../course/lap-marks';
import type { OutReason, Run } from '../physics/run';
import { $, toast } from './dom';
import { RunCamera, seeThroughPoints, type CameraMode, type CameraView } from './run-camera';

// Running the machine in the 3D view (#27, spec simulator.md 6): a mode of
// its own, apart from editing. The physics is loaded only when it is first
// used. In AR (#99) the same run goes on over the course on the floor, with
// its own controls in the AR overlay.

export interface RunModeHost {
  /** The course as it is now, and the way it runs. */
  readonly layout: Layout;
  readonly dir: 1 | -1;
  /** Show the 3D view and nothing selected, with picking and editing off while running. */
  enter(): void;
  leave(): void;
  /** Put the machine into the 3D view (mm, like the course), or take it out. */
  setMachine(object: THREE.Object3D | null): void;
  /** Point the 3D view's camera (course mm), or give it back to the user. */
  aim(view: CameraView | null): void;
  /** See through the fences between the camera and these points (course mm), or none (#136). */
  seeThrough(points: THREE.Vector3[] | null): void;
  /** Call `tick` before each frame the 3D view draws (in AR too), or stop. */
  onFrame(tick: (() => void) | null): void;
}

const OUT_TEXT: Record<OutReason, string> = {
  floor: 'コースアウト：床に落ちた',
  stopper: 'コースアウト：ホース・箱に当たった',
  stopped: 'コースアウト：止まった（2秒進まない）',
  flipped: 'コースアウト：ひっくり返って止まった',
  reverse: 'コースアウト：逆走した',
  lane: 'コースアウト：別のレーンに入った',
};

/** Longest real time one animation frame may run the physics for, s: a background tab comes back without a jump. */
const MAX_FRAME = 0.05;
/**
 * Longest the physics may take in one frame, ms: a phone that cannot run
 * 1 ms steps that fast shows the run slower instead of drawing less often
 * (#99, owner 2026-10-26; provisional).
 */
const FRAME_BUDGET = 12;
/** Physics time run between looks at the clock, s. */
const CHUNK = 0.005;

/** The same control in the run bar and in the AR overlay (#99). */
const both = (id: string) => [$(id), $(`ar-${id}`)];

type Physics = typeof import('../physics/run') & typeof import('../physics/machine-mesh');

export class RunMode {
  private physics: Physics | null = null;
  private run: Run | null = null;
  private mesh: THREE.Group | null = null;
  private shadow: THREE.Mesh | null = null;
  private playing = false;
  private last = 0;
  private on = false;
  private camera = new RunCamera();
  /** The physics could not keep up in the last frame. */
  private behind = false;

  constructor(private host: RunModeHost) {
    $('run').addEventListener('click', () => void (this.on ? this.exit() : this.enter()));
    $('run-exit').addEventListener('click', () => this.exit());
    $('ar-run-toggle').addEventListener('click', () => void (this.on ? this.exit() : this.enter()));
    for (const b of both('run-play')) b.addEventListener('click', () => this.setPlaying(!this.playing));
    for (const b of both('run-reset')) b.addEventListener('click', () => void this.reset());
    const lane = $<HTMLSelectElement>('run-lane');
    lane.addEventListener('change', () => void this.reset());
    $('ar-run-lane').addEventListener('click', () => {
      lane.selectedIndex = (lane.selectedIndex + 1) % lane.options.length;
      void this.reset();
    });
    const speed = $<HTMLSelectElement>('run-speed');
    $('ar-run-speed').addEventListener('click', () => {
      speed.selectedIndex = (speed.selectedIndex + 1) % speed.options.length;
      this.draw(0);
    });
    const camera = $<HTMLSelectElement>('run-camera');
    camera.addEventListener('change', () => {
      this.camera.mode = camera.value as CameraMode;
      this.camera.snap();
      if (this.camera.mode !== 'side') this.host.seeThrough(null);
      this.draw(0);
    });
  }

  get active(): boolean {
    return this.on;
  }

  async enter(): Promise<void> {
    if (this.on) return;
    this.on = true;
    this.host.enter();
    $('run').setAttribute('aria-pressed', 'true');
    document.body.classList.add('running');
    $('run-bar').hidden = false;
    $('ar-run').hidden = false;
    $('ar-run-toggle').textContent = '走行をやめる';
    this.host.onFrame(() => this.tick());
    // Set off first in the lane under the lap timer, so it times the machine.
    const timed = timedLane(this.host.layout, this.host.dir);
    if (timed !== null) $<HTMLSelectElement>('run-lane').value = String(timed);
    this.show('読み込み中…');
    this.physics ??= { ...(await import('../physics/run')), ...(await import('../physics/machine-mesh')) };
    if (this.on) await this.reset();
  }

  exit(): void {
    if (!this.on) return;
    this.on = false;
    this.setPlaying(false);
    this.free();
    $('run').setAttribute('aria-pressed', 'false');
    document.body.classList.remove('running');
    $('run-bar').hidden = true;
    $('ar-run').hidden = true;
    $('ar-run-toggle').textContent = '走らせる';
    this.host.onFrame(null);
    this.host.seeThrough(null);
    this.host.aim(null);
    this.host.leave();
  }

  /** Set the machine back at the start, standing, on the course as it is now. */
  private async reset(): Promise<void> {
    this.setPlaying(false);
    this.free();
    const physics = this.physics;
    if (!physics || !this.on) return;
    const lane = Number($<HTMLSelectElement>('run-lane').value) || 0;
    const run = await physics.Run.create(this.host.layout, this.host.dir, lane);
    if (!this.on) return run?.free();
    if (!run) {
      this.show('走らせるレーンがありません');
      toast('走らせるには、つながったコースが要ります');
      return;
    }
    this.run = run;
    this.mesh = physics.buildMachineMesh(run.spec);
    this.shadow = physics.buildShadow(run.spec);
    const group = new THREE.Group();
    group.add(this.mesh, this.shadow);
    this.host.setMachine(group);
    this.setPlaying(false);
    this.camera.snap();
    this.draw(0);
  }

  private free(): void {
    this.run?.free();
    this.run = null;
    if (this.mesh) this.host.setMachine(null);
    this.mesh = this.shadow = null;
  }

  private setPlaying(playing: boolean): void {
    const out = this.run?.state().out;
    this.playing = playing && !!this.run && !out;
    this.behind = false;
    for (const b of both('run-play')) {
      b.textContent = this.playing ? '一時停止' : 'スタート';
      b.toggleAttribute('disabled', !this.run || !!out);
    }
    this.last = performance.now();
  }

  /** How fast the run's time goes against real time: as it is, or slowed down to 1/16, in 3D and AR alike (owner, 2026-10-30). */
  private get rate(): number {
    return 1 / (Number($<HTMLSelectElement>('run-speed').value) || 1);
  }

  /**
   * Run on by the time since the last frame, in 1 ms steps for no longer
   * than the frame's budget, the rest left out (slower, #99); then draw.
   * Ticked by the 3D view, whose frames go on in AR, where the page's own
   * animation frames stop.
   */
  private tick(): void {
    const now = performance.now();
    const real = Math.min(MAX_FRAME, (now - this.last) / 1000);
    this.last = now;
    const run = this.run;
    if (!this.playing || !run) return this.draw(0);
    let left = real * this.rate;
    while (left > 1e-9 && performance.now() - now < FRAME_BUDGET && !run.state().out) {
      const t = Math.min(left, CHUNK);
      run.advance(t);
      left -= t;
    }
    this.behind = left > 1e-9 && !run.state().out;
    this.draw(real);
    if (run.state().out) this.setPlaying(false);
  }

  /** Put the machine where it is, the camera after it `dt` seconds on, and show how the run is going. */
  private draw(dt: number): void {
    const { run, mesh, shadow, physics } = this;
    $('ar-run-speed').textContent = `速さ：${$<HTMLSelectElement>('run-speed').selectedOptions[0]?.text ?? ''}`;
    $('ar-run-lane').textContent = `レーン：${$<HTMLSelectElement>('run-lane').selectedOptions[0]?.text ?? ''}`;
    if (!run || !mesh || !shadow || !physics) return;
    const s = run.state();
    mesh.position.copy(s.position);
    mesh.quaternion.copy(s.quaternion);
    physics.spinTyres(mesh, run.spec, s.distance);
    physics.placeShadow(shadow, run.spec, s.position, s.quaternion, run.ground());
    this.host.aim(this.camera.next(s.position, s.quaternion, dt));
    const facing = this.camera.facing;
    if (this.camera.mode === 'side' && facing) this.host.seeThrough(seeThroughPoints(s.position, facing));
    const kmh = Math.max(0, s.speed) * 3.6;
    const laps = s.lapTimes;
    const times = laps.length ? ` ・ ラップ ${laps[laps.length - 1].toFixed(2)} 秒（ベスト ${Math.min(...laps).toFixed(2)}）` : '';
    this.show(
      `${s.time.toFixed(2)} 秒 ・ ${kmh.toFixed(1)} km/h ・ ${(s.distance / 1000).toFixed(2)} m ・ ${s.laps} 周${times}` +
        (this.behind ? ' ・ 計算が追いつかずゆっくり' : '') +
        (s.out ? ` ・ ${OUT_TEXT[s.out]}` : ''),
    );
  }

  private show(text: string): void {
    for (const e of both('run-status')) e.textContent = text;
  }
}
