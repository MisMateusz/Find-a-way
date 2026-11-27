import { t } from './i18n';

const MAX_LEN = 50;
const MAX_LINES = 10;
const MIN_OUT_GAP_MS = 1000;
const MIN_IN_GAP_MS = 250;

const tr = (key: string, fallback: string) => {
  const v = t(key);
  return v === key ? fallback : v;
};

export class Chat {
  private send: (text: string) => void;
  private open = false;
  private lastOut = 0;
  private lastIn = 0;
  private btn = document.getElementById('open-chat')!;
  private panel = document.getElementById('chat')!;
  private log = document.getElementById('chat-log')!;
  private input = document.getElementById('chat-input') as HTMLInputElement;

  constructor(send: (text: string) => void) {
    this.send = send;
    this.btn.addEventListener('click', () => this.toggle());
    document.getElementById('chat-send')!.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        this.toggle(false);
      }
    });
  }

  setVisible(on: boolean) {
    this.btn.hidden = !on;
    if (!on) this.toggle(false);
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.panel.hidden = !this.open;
    if (this.open) {
      this.btn.classList.remove('unread');
      this.input.focus();
    }
  }

  clear() {
    this.log.replaceChildren();
    this.btn.classList.remove('unread');
  }

  receive(text: string) {
    const now = Date.now();
    if (now - this.lastIn < MIN_IN_GAP_MS) return;
    this.lastIn = now;
    this.add(tr('chat.them', 'Partner'), text.slice(0, MAX_LEN));
    if (!this.open) this.btn.classList.add('unread');
  }

  private submit() {
    const text = this.input.value.trim().slice(0, MAX_LEN);
    const now = Date.now();
    if (!text || now - this.lastOut < MIN_OUT_GAP_MS) return;
    this.lastOut = now;
    this.send(text);
    this.add(tr('chat.me', 'You'), text);
    this.input.value = '';
  }

  private add(who: string, text: string) {
    const li = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = `${who}: `;
    li.append(name, text);
    this.log.append(li);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}