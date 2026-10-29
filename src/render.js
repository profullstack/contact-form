/**
 * The form as an HTML string, for template-string views (Hono, Express,
 * SvelteKit {@html}, a static page served by a function).
 *
 * The markup is plain and classed `cf-*` so each site styles it with its own
 * CSS. Nothing is inline-styled: the honeypot is hidden by the `hpClass`
 * class (default `cf-hp`), because an inline style is blocked by a strict
 * CSP and a visible honeypot silently drops the real people who fill it in.
 */

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const attr = (name, value) =>
  value === undefined || value === null || value === false
    ? ''
    : value === true
      ? ` ${name}`
      : ` ${name}="${escapeHtml(value)}"`;

function control(q, value, id) {
  const common = `${attr('id', id)}${attr('name', q.name)}${attr('required', q.required)}${attr('placeholder', q.placeholder)}${attr('autocomplete', q.autocomplete)}`;
  switch (q.type) {
    case 'textarea':
      return `<textarea${common}${attr('rows', q.rows ?? 5)}${attr('maxlength', q.maxLength)}>${escapeHtml(value)}</textarea>`;
    case 'select': {
      const opts = q.options
        .map(
          (o) =>
            `<option${attr('value', o.value)}${attr('selected', o.value === value)}>${escapeHtml(o.label)}</option>`,
        )
        .join('');
      return `<select${common}>${q.required ? '' : '<option value="">-</option>'}${opts}</select>`;
    }
    case 'checkbox':
      return `<input type="checkbox"${common}${attr('checked', value === 'yes' || value === 'on')}>`;
    case 'hidden':
      return `<input type="hidden"${attr('name', q.name)}${attr('value', value || q.value)}>`;
    default:
      return `<input${attr('type', q.type)}${common}${attr('maxlength', q.maxLength)}${attr('value', value)}>`;
  }
}

/**
 * @param {object} o
 * @param {ReadonlyArray<object>} o.questions normalised questions
 * @param {string} o.guardHtml the token + honeypot inputs (form.guardHtml())
 * @param {string} o.action where the form posts
 * @param {Record<string,string>} [o.values] values to refill after an error
 * @param {string} [o.error] message shown above the fields
 * @param {string} [o.notice] success message shown instead of the error
 * @param {string} [o.submitLabel]
 * @param {string} [o.className] extra class on the <form>
 * @param {string} [o.idPrefix]
 */
export function renderForm(o) {
  const values = o.values ?? {};
  const prefix = o.idPrefix ?? 'cf';
  const rows = o.questions
    .map((q) => {
      const id = `${prefix}-${q.name}`;
      if (q.type === 'hidden') return control(q, values[q.name] ?? '', id);
      const label = `<label${attr('for', id)}>${escapeHtml(q.label)}${q.required ? '' : ' <span class="cf-optional">(optional)</span>'}</label>`;
      const help = q.help ? `<p class="cf-help">${escapeHtml(q.help)}</p>` : '';
      if (q.type === 'checkbox')
        return `<div class="cf-field cf-check">${control(q, values[q.name] ?? '', id)} ${label}${help}</div>`;
      return `<div class="cf-field">${label}${control(q, values[q.name] ?? '', id)}${help}</div>`;
    })
    .join('\n  ');
  const banner = o.error
    ? `<p class="cf-error" role="alert">${escapeHtml(o.error)}</p>`
    : o.notice
      ? `<p class="cf-notice" role="status">${escapeHtml(o.notice)}</p>`
      : '';
  return `<form class="cf-form${o.className ? ` ${escapeHtml(o.className)}` : ''}" action="${escapeHtml(o.action)}" method="post">
  ${banner}
  ${rows}
  ${o.guardHtml ?? ''}
  <button class="cf-submit" type="submit">${escapeHtml(o.submitLabel ?? 'Send')}</button>
</form>`;
}

/** The CSS every site can start from: hides the honeypot and lays the fields out. */
export const BASE_CSS = `.cf-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.cf-form{display:grid;gap:.9rem;max-width:40rem}
.cf-field{display:grid;gap:.3rem}
.cf-check{display:flex;gap:.5rem;align-items:center}
.cf-optional,.cf-help{opacity:.7;font-size:.9em}
.cf-error{color:#b42318}
.cf-notice{color:#067647}`;
