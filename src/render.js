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

/**
 * The empty first option of a select, if it has one: its placeholder
 * ("Select a service..."), or "-" when it is optional. A required select
 * with a placeholder starts on it, so the browser makes the person choose
 * instead of submitting whatever happens to be listed first.
 */
export function blankOption(q) {
  if (q.placeholder) return q.placeholder;
  return q.required ? null : '-';
}

/** The value a question starts with: what was submitted, else its default. */
export function initialValue(q, values) {
  const v = values?.[q.name];
  if (v !== undefined && v !== null) return String(v);
  if (q.type === 'hidden') return q.value ?? q.default ?? '';
  return q.default ?? '';
}

function control(q, value, id) {
  const common = `${attr('id', id)}${attr('name', q.name)}${attr('required', q.required)}${q.type === 'select' ? '' : attr('placeholder', q.placeholder)}${attr('autocomplete', q.autocomplete)}`;
  switch (q.type) {
    case 'textarea':
      return `<textarea${common}${attr('rows', q.rows ?? 5)}${attr('minlength', q.minLength)}${attr('maxlength', q.maxLength)}>${escapeHtml(value)}</textarea>`;
    case 'select': {
      const opts = q.options
        .map(
          (o) =>
            `<option${attr('value', o.value)}${attr('selected', o.value === value)}>${escapeHtml(o.label)}</option>`,
        )
        .join('');
      const blank = blankOption(q);
      return `<select${common}>${blank === null ? '' : `<option value=""${attr('selected', value === '')}>${escapeHtml(blank)}</option>`}${opts}</select>`;
    }
    case 'checkbox':
      return `<input type="checkbox"${common}${attr('checked', value === 'yes' || value === 'on')}>`;
    case 'hidden':
      return `<input type="hidden"${attr('name', q.name)}${attr('value', value)}>`;
    default:
      return `<input${attr('type', q.type)}${common}${attr('minlength', q.minLength)}${attr('maxlength', q.maxLength)}${attr('pattern', q.pattern)}${attr('title', q.pattern ? q.patternMessage : undefined)}${attr('value', value)}>`;
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
      const value = initialValue(q, values);
      const help = q.help ? `<p class="cf-help">${escapeHtml(q.help)}</p>` : '';
      if (q.type === 'section')
        return `<h3 class="cf-section"${attr('id', id)}>${escapeHtml(q.label)}</h3>${help}`;
      if (q.type === 'hidden') return control(q, value, id);
      const label = `<label${attr('for', id)}>${escapeHtml(q.label)}${q.required || q.type === 'checkbox' ? '' : ' <span class="cf-optional">(optional)</span>'}</label>`;
      if (q.type === 'checkbox')
        return `<div class="cf-field cf-check">${control(q, value, id)} ${label}${help}</div>`;
      return `<div class="cf-field">${label}${control(q, value, id)}${help}</div>`;
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
