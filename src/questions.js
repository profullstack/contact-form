/**
 * The questions a contact form asks.
 *
 * Every site starts from DEFAULT_QUESTIONS (name, email, message) and a site
 * with a custom form passes its own list, or adjusts the defaults with
 * withQuestions(). The same list drives the rendered markup, the server-side
 * validation, the labels in the notification email and the client component,
 * so they can never disagree about which fields exist.
 */

/** @typedef {'text'|'email'|'textarea'|'select'|'url'|'tel'|'number'|'checkbox'|'hidden'} QuestionType */

/** The generic contact form. */
export const DEFAULT_QUESTIONS = Object.freeze([
  Object.freeze({
    name: 'name',
    label: 'Your name',
    type: 'text',
    required: true,
    maxLength: 120,
    autocomplete: 'name',
  }),
  Object.freeze({
    name: 'email',
    label: 'Email',
    type: 'email',
    required: true,
    maxLength: 254,
    autocomplete: 'email',
  }),
  Object.freeze({
    name: 'message',
    label: 'How can we help?',
    type: 'textarea',
    required: true,
    maxLength: 5000,
    rows: 6,
  }),
]);

const TYPES = new Set([
  'text',
  'email',
  'textarea',
  'select',
  'url',
  'tel',
  'number',
  'checkbox',
  'hidden',
  // Not a field: a heading (label) and optional help line between groups of fields.
  'section',
]);
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

/** "projectType" -> "Project Type". */
export function humanize(field) {
  return String(field)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Check and fill in a question list. Throws on a list that cannot work
 * (duplicate or unsafe names, a select with no options), because a form
 * that silently drops a field loses real messages.
 */
export function normalizeQuestions(questions = DEFAULT_QUESTIONS) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new TypeError('contact-form: `questions` must be a non-empty array');
  }
  const seen = new Set();
  return Object.freeze(
    questions.map((q) => {
      if (!q || typeof q.name !== 'string' || !NAME_RE.test(q.name)) {
        throw new TypeError(
          `contact-form: question name ${JSON.stringify(q?.name)} is not a safe field name`,
        );
      }
      if (seen.has(q.name)) throw new TypeError(`contact-form: duplicate question "${q.name}"`);
      seen.add(q.name);
      const type =
        q.type ?? (q.name === 'email' ? 'email' : q.name === 'message' ? 'textarea' : 'text');
      if (!TYPES.has(type))
        throw new TypeError(`contact-form: question "${q.name}" has unknown type "${type}"`);
      const options =
        type === 'select'
          ? (q.options ?? []).map((o) =>
              typeof o === 'string'
                ? { value: o, label: o }
                : { value: String(o.value), label: String(o.label ?? o.value) },
            )
          : undefined;
      if (type === 'select' && options.length === 0) {
        throw new TypeError(`contact-form: select question "${q.name}" needs options`);
      }
      if (
        type === 'select' &&
        q.default !== undefined &&
        !options.some((o) => o.value === String(q.default))
      ) {
        throw new TypeError(
          `contact-form: select question "${q.name}" defaults to "${q.default}", which is not an option`,
        );
      }
      return Object.freeze({
        ...q,
        type,
        label: q.label ?? humanize(q.name),
        required: type === 'section' ? false : q.required === true,
        ...(q.default !== undefined
          ? {
              default:
                type === 'checkbox'
                  ? q.default === true || q.default === 'yes' || q.default === 'on'
                    ? 'yes'
                    : ''
                  : String(q.default),
            }
          : {}),
        maxLength: q.maxLength ?? (type === 'textarea' ? 5000 : 500),
        ...(options ? { options: Object.freeze(options) } : {}),
      });
    }),
  );
}

/**
 * The defaults with changes: add questions, drop some, or override one by
 * name. `insertBefore` places added questions ahead of `message`, which is
 * where extra questions read naturally.
 *
 *   withQuestions({ add: [{ name: 'company', label: 'Company' }], omit: ['name'] })
 */
export function withQuestions({
  add = [],
  omit = [],
  override = {},
  base = DEFAULT_QUESTIONS,
  insertBefore = 'message',
} = {}) {
  const kept = base
    .filter((q) => !omit.includes(q.name))
    .map((q) => (override[q.name] ? { ...q, ...override[q.name] } : q));
  const at = kept.findIndex((q) => q.name === insertBefore);
  if (at === -1) return [...kept, ...add];
  return [...kept.slice(0, at), ...add, ...kept.slice(at)];
}

/** A label fit for a sentence: "Name *" and "Email:" read as "Name" and "Email". */
export function plainLabel(q) {
  // `errorLabel` names the field in messages when the label is a question
  // ("What do you want the corpus for?" -> "Your use case").
  if (q.errorLabel) return String(q.errorLabel);
  return (
    String(q.label)
      .replace(/\s*[*:]+\s*$/, '')
      .trim() || humanize(q.name)
  );
}

/**
 * The message for a validation failure. One function, so the JSON answer and
 * a page rebuilding the message from `?error=invalid&field=&reason=` (see
 * contact.errorMessage) always say the same thing.
 */
export function validationMessage(q, reason) {
  const label = plainLabel(q);
  switch (reason) {
    case 'required':
      return `${label} is required`;
    case 'tooLong':
      return `${label} is too long (${q.maxLength} characters at most)`;
    case 'tooShort':
      return `${label} is too short (${q.minLength} characters at least)`;
    case 'email':
      return `${label} must be a valid email address`;
    case 'url':
      return `${label} must be a link starting with https://`;
    case 'number':
      return `${label} must be a number`;
    case 'select':
      return `Choose one of the options for ${label}`;
    case 'pattern':
      return q.patternMessage ?? `${label} is not in the expected format`;
    default:
      return `Check ${label} and try again`;
  }
}

export const VALIDATION_REASONS = Object.freeze([
  'required',
  'tooLong',
  'tooShort',
  'email',
  'url',
  'number',
  'select',
  'pattern',
]);

/**
 * Validate submitted values against the questions.
 *
 * @returns {{ ok: true, values: Record<string,string> } | { ok: false, error: string, field: string, reason: string }}
 *   `values` holds every question's trimmed value (unknown body keys are
 *   left out, so a bot cannot smuggle extra fields into the email).
 */
export function validate(questions, body) {
  const values = {};
  const fail = (q, reason) => ({
    ok: false,
    field: q.name,
    reason,
    error: validationMessage(q, reason),
  });
  for (const q of questions) {
    if (q.type === 'section') continue;
    const raw = body?.[q.name];
    let v;
    if (q.type === 'checkbox')
      v =
        raw === true || raw === 'on' || raw === 'true' || raw === '1' || raw === 'yes' ? 'yes' : '';
    else
      v = raw === undefined || raw === null ? '' : String(Array.isArray(raw) ? raw[0] : raw).trim();
    if (v === '') {
      if (q.required) return fail(q, 'required');
      values[q.name] = '';
      continue;
    }
    if (v.length > q.maxLength) return fail(q, 'tooLong');
    if (q.minLength && v.length < q.minLength) return fail(q, 'tooShort');
    if (q.type === 'email' && !EMAIL_RE.test(v)) return fail(q, 'email');
    if (q.type === 'url' && !URL_RE.test(v)) return fail(q, 'url');
    if (q.type === 'number' && !Number.isFinite(Number(v))) return fail(q, 'number');
    if (q.type === 'select' && !q.options.some((o) => o.value === v)) return fail(q, 'select');
    if (q.pattern && !new RegExp(`^(?:${q.pattern})$`).test(v)) return fail(q, 'pattern');
    values[q.name] = v;
  }
  return { ok: true, values };
}

/** A copy of the questions that is safe to hand to a browser (JSON-serialisable). */
export function publicQuestions(questions) {
  return questions.map(
    ({
      name,
      label,
      type,
      required,
      maxLength,
      placeholder,
      options,
      rows,
      autocomplete,
      help,
      value,
      default: initial,
      minLength,
      pattern,
      patternMessage,
      errorLabel,
    }) => ({
      name,
      label,
      type,
      required,
      maxLength,
      ...(placeholder ? { placeholder } : {}),
      ...(options ? { options } : {}),
      ...(rows ? { rows } : {}),
      ...(autocomplete ? { autocomplete } : {}),
      ...(help ? { help } : {}),
      ...(value !== undefined ? { value: String(value) } : {}),
      ...(initial !== undefined ? { default: initial } : {}),
      ...(minLength ? { minLength } : {}),
      ...(pattern ? { pattern } : {}),
      ...(patternMessage ? { patternMessage } : {}),
      ...(errorLabel ? { errorLabel } : {}),
    }),
  );
}
