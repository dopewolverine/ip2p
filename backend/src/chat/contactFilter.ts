// Spec P4 §2.4 - "filter, don't block." Detected strings are replaced
// with a visible notice, never silently dropped, so the sender sees
// exactly why their message changed rather than assuming it just didn't send.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Common external messaging platform mentions/handles/links.
const EXTERNAL_PLATFORM_RE = /\b(?:t\.me\/\S+|wa\.me\/\S+|whatsapp(?:\.com)?\S*|telegram\.(?:me|org)\S*|signal\.(?:me|org)\S*|@[a-zA-Z0-9_]{4,32}(?=\s|$))\b/gi;

const NOTICE = '[removed — contact details and external links are filtered; keep communication on iP2P]';

export function filterContactDetails(text: string): { filtered: string; wasFiltered: boolean } {
  let wasFiltered = false;
  let result = text;

  for (const re of [PHONE_RE, EMAIL_RE, EXTERNAL_PLATFORM_RE]) {
    result = result.replace(re, () => {
      wasFiltered = true;
      return NOTICE;
    });
  }

  return { filtered: result, wasFiltered };
}
