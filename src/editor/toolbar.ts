import { $ } from './dom';

// The header (#106): icons on its buttons, and the ファイル／共有 menus.

/** Line drawings on a 24 × 24 grid, stroked in the text colour. */
const ICONS: Record<string, string> = {
  plan: 'M4 4h16v16H4zm0 8h16M12 4v16',
  perspective: 'M3 20h18L17 8H7zm5 0 1.5-12M16 20l-1.5-12M5 14h14',
  run: 'M7 4.5v15l12-7.5z',
  track: 'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zm1 4h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
  car: 'M5 15V11l2-4h10l2 4v4zM3 15h18M7.5 18a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3M16.5 18a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5m5 5H9a5 5 0 0 0 0 10h3',
  save: 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M7 21v-7h10v7',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  share: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  expand: 'M4 9V4h5m11 5V4h-5M4 15v5h5m11-5v5h-5',
  new: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zm0 0v5h5m-7 3v6m-3-3h6',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  import: 'M12 3v12m-5-5 5 5 5-5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  export: 'M12 15V3M7 8l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M4 5h16v14H4zm0 11 5-5 4 4 2-2 5 5M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
  qr: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h2v2h-2zm4 4h2v2h-2zm-4 2v-2m6-2v-2',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zm0 9 8-4.5M12 12v9m0-9L4 7.5',
};

const SVG = 'http://www.w3.org/2000/svg';

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.append(path);
  return svg;
}

export function bindToolbar(): void {
  const bar = $('toolbar');
  for (const el of bar.querySelectorAll<HTMLElement>('[data-icon]')) el.prepend(icon(el.dataset.icon!));
  // A menu item standing in for a button shown elsewhere, such as 保存.
  for (const el of bar.querySelectorAll<HTMLElement>('[data-click]')) {
    el.addEventListener('click', () => $(el.dataset.click!).click());
  }
  const menus = [...bar.querySelectorAll<HTMLButtonElement>('.menu-button')].map((button) => new Menu(button));
  // Any click outside a menu, or a choice in it, closes it.
  document.addEventListener('pointerdown', (e) => {
    for (const m of menus) if (!m.wrap.contains(e.target as Node)) m.close();
  });
  window.addEventListener('blur', () => menus.forEach((m) => m.close()));
}

class Menu {
  readonly wrap: HTMLElement;
  private readonly list: HTMLElement;

  constructor(private readonly button: HTMLButtonElement) {
    this.wrap = button.parentElement!;
    this.list = $(button.getAttribute('aria-controls')!);
    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      this.open();
    });
    // The item's own handler runs first, then the menu folds away.
    this.list.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')) this.close();
    });
    this.list.addEventListener('keydown', (e) => this.key(e));
  }

  get isOpen(): boolean {
    return !this.list.hidden;
  }

  open(): void {
    this.list.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    // Kept on screen: a menu near the right edge opens leftwards.
    this.list.classList.remove('align-right');
    if (this.list.getBoundingClientRect().right > window.innerWidth - 4) this.list.classList.add('align-right');
    this.items()[0]?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    const hadFocus = this.list.contains(document.activeElement);
    this.list.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (hadFocus) this.button.focus();
  }

  private items(): HTMLButtonElement[] {
    return [...this.list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  }

  private key(e: KeyboardEvent): void {
    const items = this.items();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      // Kept from the editor, where Esc would also clear the selection.
      if (e.key === 'Escape') e.stopPropagation();
      this.close();
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  }
}
