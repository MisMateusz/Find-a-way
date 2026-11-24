const SUPPORTED_LANGS = ['pl', 'en'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

const cache: Partial<Record<Lang, Record<string, unknown>>> = {};
let dict: Record<string, unknown> = {};

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return null;
  }, obj);
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const raw = getByPath(dict, key);
  if (typeof raw !== 'string') return key;

  let text = raw;
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

export async function setLanguage(lang: string | null | undefined) {
  const targetLang: Lang = SUPPORTED_LANGS.includes(lang as Lang) ? (lang as Lang) : 'pl';

  try {
    if (!cache[targetLang]) {
     const res = await fetch(`${import.meta.env.BASE_URL}locales/${targetLang}.json`);
      if (!res.ok) throw new Error(`Brak pliku: ${targetLang}.json`);
      cache[targetLang] = (await res.json()) as Record<string, unknown>;
    }

    dict = cache[targetLang]!;
    localStorage.setItem('lang', targetLang);
    document.documentElement.lang = targetLang;

    document.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === targetLang);
    });

    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      const val = getByPath(dict, key);
      if (typeof val === 'string') el.textContent = val;
    });

    document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (!key) return;
      const val = getByPath(dict, key);
      if (typeof val === 'string') el.placeholder = val;
    });
  } catch (err) {
    console.error(err);
  }
}