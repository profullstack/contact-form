/**
 * @profullstack/contact-form/browser: for static pages that cannot mint a
 * token server-side (an SPA router loading a plain HTML view).
 *
 *   <script type="module">
 *     import { mountGuard } from 'https://esm.sh/@profullstack/contact-form/browser';
 *     mountGuard(document.querySelector('form.contact'), '/api/contact');
 *   </script>
 *
 * The route exports `GET = contact.GET`. mountGuard fetches a fresh token
 * (no-store) and adds the token input and the hidden honeypot to the form,
 * replacing any it added before. The honeypot is hidden by `hpClass`
 * (default "cf-hp"): the page's CSS must hide that class.
 *
 * @param {HTMLFormElement} form
 * @param {string} src a GET route returning contact.props()
 * @param {{ hpClass?: string, fetch?: typeof fetch }} [options]
 * @returns {Promise<object>} the props (questions, action, messages)
 */
export async function mountGuard(form, src, options = {}) {
  if (!form || typeof form.appendChild !== 'function')
    throw new TypeError('mountGuard: a <form> is required');
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(src, { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`mountGuard: ${src} answered ${res.status}`);
  const props = await res.json();
  const doc = form.ownerDocument;
  for (const el of form.querySelectorAll('[data-cf-guard]')) el.remove();
  if (props.tokenField && props.token) {
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.name = props.tokenField;
    input.value = props.token;
    input.setAttribute('data-cf-guard', '');
    form.appendChild(input);
  }
  if (props.honeypotField) {
    const wrap = doc.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.className = options.hpClass ?? 'cf-hp';
    wrap.setAttribute('data-cf-guard', '');
    const label = doc.createElement('label');
    label.textContent = 'Website';
    const input = doc.createElement('input');
    input.type = 'text';
    input.name = props.honeypotField;
    input.tabIndex = -1;
    input.autocomplete = 'off';
    label.appendChild(input);
    wrap.appendChild(label);
    form.appendChild(wrap);
  }
  return props;
}

export default mountGuard;
