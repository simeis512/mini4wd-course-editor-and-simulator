import { cleanName, uniqueName } from '../course/saves';

// Machines saved in the browser (#31), as courses are (#68): what an entry
// holds and how it is named. The storage itself is in the editor.

export interface SavedMachine {
  id: string;
  name: string;
  /** The setup as `encodeSetup` writes it, so older formats still open. */
  data: string;
  /** Milliseconds since the epoch. */
  savedAt: number;
}

/** The machine being set up, kept apart from the named saves. */
export interface MachineAutosave {
  data: string;
  savedAt: number;
  /** The named save it came from, so saving again goes there. */
  savedId?: string;
}

/** The name offered when saving: the machine's own name, or `マイマシン`. */
export function machineSaveName(name: string | undefined, names: readonly string[]): string {
  return uniqueName(cleanName(name ?? '') || 'マイマシン', names);
}

/** Saves newest first. */
export function sortMachines(saves: readonly SavedMachine[]): SavedMachine[] {
  return [...saves].sort((a, b) => b.savedAt - a.savedAt);
}
