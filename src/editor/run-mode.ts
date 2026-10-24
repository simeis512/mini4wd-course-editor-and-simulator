import type * as THREE from 'three';
import type { Layout } from '../course/course';
import type { OutReason, Run } from '../physics/run';
import { $, toast } from './dom';

// Running the machine in the 3D view (#27, spec simulator.md 6): a mode of
// its own, apart from editing. The physics is loaded only when it is first
// used.

export interface RunModeHost {
  /** The course as it is now, and the way it runs. */
  readonly layout: Layout;
  readonly dir: 1 | -1;
  /** Show the 3D view and nothing selected, with picking and editing off while running. */
  enter(): void;
  leave(): void;
  /** Put the machine into the 3D view (mm, like the course), or take it out. */
  setMachine(object: THREE.Object3D | null): void;
}

const OUT_TEXT: Record<OutReason, string> = {
  floor: 'コースアウト：床に落ちた',
  fall: 'コースアウト：コースの端から落ちた',
  stopper: 'コースアウト：ホース・箱に当たった',
  stopped: 'コースアウト：止まった（2秒進まない）',
};

/** Longest real time one animation frame may run the physics for, s: a background tab comes back without a jump. */
const MAX_FRAME = 0.05;

type Physics = typeof import('../physics/run') & typeof import('../physics/machine-mesh');

export class RunMode {
  private physics: Physics | null = null;
  private run: Run | null = null;
  private mesh: THREE.Group | null = null;
  private playing = false;
  private frame = 0;
  private last = 0;
  private on = false;

  constructor(private host: RunModeHost) {
    $('run').addEventListener('click', () => void (this.on ? this.exit() : this.enter()));
    $('run-exit').addEventListener('click', () => this.exit());
    $('run-play').addEventListener('click', () => this.setPlaying(!this.playing));
    $('run-reset').addEventListener('click', () => void this.reset());
    $<HTMLSelectElement>('run-lane').addEventListener('change', () => void this.reset());
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
    this.host.setMachine(this.mesh);
    this.setPlaying(false);
    this.draw();
  }

  private free(): void {
    this.run?.free();
    this.run = null;
    if (this.mesh) this.host.setMachine(null);
    this.mesh = null;
  }

  private setPlaying(playing: boolean): void {
    const out = this.run?.state().out;
    this.playing = playing && !!this.run && !out;
    $('run-play').textContent = this.playing ? '一時停止' : 'スタート';
    $('run-play').toggleAttribute('disabled', !this.run || !!out);
    cancelAnimationFrame(this.frame);
    if (!this.playing) return;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing || !this.run) return;
      this.run.advance(Math.min(MAX_FRAME, (now - this.last) / 1000));
      this.last = now;
      this.draw();
      if (this.run.state().out) return this.setPlaying(false);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Put the machine where it is and show how the run is going. */
  private draw(): void {
    const { run, mesh, physics } = this;
    if (!run || !mesh || !physics) return;
    const s = run.state();
    mesh.position.copy(s.position);
    mesh.quaternion.copy(s.quaternion);
    physics.spinTyres(mesh, run.spec, s.distance);
    const kmh = Math.max(0, s.speed) * 3.6;
    this.show(
      `${s.time.toFixed(2)} 秒 ・ ${kmh.toFixed(1)} km/h ・ ${(s.distance / 1000).toFixed(2)} m ・ ${s.laps} 周` +
        (s.out ? ` ・ ${OUT_TEXT[s.out]}` : ''),
    );
  }

  private show(text: string): void {
    $('run-status').textContent = text;
  }
}
