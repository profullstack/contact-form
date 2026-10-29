import type { ContactFormProps } from './index.js';

/**
 * Fetch a fresh token from `src` (a route exporting contact.GET) and add the token input and the
 * hidden honeypot to `form`, replacing any added before. The page's CSS must hide `hpClass` (cf-hp).
 */
export declare function mountGuard(
  form: HTMLFormElement,
  src: string,
  options?: { hpClass?: string; fetch?: typeof fetch },
): Promise<ContactFormProps>;
export default mountGuard;
