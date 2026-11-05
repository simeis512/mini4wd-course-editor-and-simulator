import { AMAZON_CHOICES, AMAZON_COOKIE_NOTE, AMAZON_DISCLOSURE, AMAZON_TRACKING_ID, type AmazonChoice } from '../course/store-links';
import { $ } from './dom';

// Opening Amazon from the shopping list (#128, owner 2026-10-30): a box
// lets the user pick the associate link or a plain one, both real links
// that look the same; "don't ask again" keeps the pick in this browser,
// and the about panel can set it back.

const CHOICE_KEY = 'shopping.amazonLink';

export function amazonChoice(): AmazonChoice {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === 'tag' || v === 'plain' ? v : 'ask';
  } catch {
    // Storage blocked: ask every time.
    return 'ask';
  }
}

function keepChoice(choice: AmazonChoice): void {
  try {
    if (choice === 'ask') localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Not kept: asked again next time.
  }
}

/** Ask which way to open Amazon, with both links ready to click. */
export function askAmazon(links: { tagged: string; plain: string }): void {
  const dialog = $<HTMLDialogElement>('amazon-dialog');
  $<HTMLAnchorElement>('amazon-tagged').href = links.tagged;
  $<HTMLAnchorElement>('amazon-plain').href = links.plain;
  $<HTMLInputElement>('amazon-remember').checked = false;
  dialog.showModal();
}

/** Wire the box and the setting in the about panel; `changed` redraws the shopping list. */
export function bindAmazon(changed: () => void): void {
  for (const id of ['amazon-disclosure', 'about-amazon-disclosure']) $(id).textContent = AMAZON_DISCLOSURE;
  for (const id of ['amazon-cookie', 'about-amazon-cookie']) $(id).textContent = AMAZON_COOKIE_NOTE;
  // Nothing about Amazon shows until the site has a tracking ID.
  $('about-amazon').hidden = !AMAZON_TRACKING_ID;
  const dialog = $<HTMLDialogElement>('amazon-dialog');
  for (const [id, choice] of [['amazon-tagged', 'tag'], ['amazon-plain', 'plain']] as const) {
    // A real link the user clicks (Amazon's rules): it opens by itself; only remember and close here.
    $(id).addEventListener('click', () => {
      if ($<HTMLInputElement>('amazon-remember').checked) {
        keepChoice(choice);
        changed();
        setting.value = choice;
      }
      dialog.close();
    });
  }
  const setting = $<HTMLSelectElement>('amazon-choice');
  setting.innerHTML = (Object.keys(AMAZON_CHOICES) as AmazonChoice[]).map((c) => `<option value="${c}">${AMAZON_CHOICES[c]}</option>`).join('');
  setting.value = amazonChoice();
  setting.addEventListener('change', () => {
    keepChoice(setting.value as AmazonChoice);
    changed();
  });
}
