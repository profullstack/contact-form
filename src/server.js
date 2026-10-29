/**
 * The contact form, server side: one object that knows the questions, mints
 * and checks the form-guard token, validates, delivers and answers.
 *
 *   import { createContactForm } from '@profullstack/contact-form';
 *   export const contact = createContactForm({ site: 'example.com', to: 'hello@example.com' });
 *
 *   // a page:   contact.render({ action: '/contact' })   or   await contact.props()  (React)
 *   // a route:  export const POST = contact.POST;          (Next) / app.post('/contact', (c) => contact.POST(c.req.raw))
 *
 * The order of checks matters and is the same everywhere:
 *   1. honeypot, 2. proof-of-render token + fill time, 3. rate limit   (form-guard; a failure here
 *      is answered like a success, so a bot learns nothing about the form)
 *   4. the site's own verify hook and captcha
 *   5. validation against the questions
 *   6. substance: a form that asked for something specific quarantines a stock enquiry
 *   7. persist, then the notification email (tagged and annotated, never dropped for its score)
 */

import { createEmailer } from '@profullstack/emailer';
import { createFormGuard, provenanceBlock, substance, tagSubject } from '@profullstack/form-guard';
import {
  DEFAULT_QUESTIONS,
  EMAIL_RE,
  humanize,
  normalizeQuestions,
  plainLabel,
  publicQuestions,
  VALIDATION_REASONS,
  validate,
  validationMessage,
} from './questions.js';
import { escapeHtml, renderForm } from './render.js';

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Response shapes found across the fleet:
 * - "message": `{ message }` bodies (naallo, libertyhillcoin)
 * - "success": `{ success: true }` / `{ error }` (communitygardens, marksyncr, threatcrush), the default
 * - "ok":      `{ ok: true }` / `{ ok: false, error }` (profullstack-web, d0rz)
 */
export const STYLE_PRESETS = Object.freeze({
  message: {
    honeypot: { body: { message: 'Message received!' } },
    invalid: (ctx) => ({ body: { message: ctx.error ?? 'Invalid submission.' }, status: 400 }),
    success: { body: { message: "Message received! We'll be in touch." } },
    sendFailed: { body: { message: 'Something went wrong.' }, status: 500 },
    error: { body: { message: 'Something went wrong.' }, status: 500 },
    retry: { body: { message: 'That took too long. Please send it again.' }, status: 400 },
    limited: { body: { message: 'Too many messages. Please try again later.' }, status: 429 },
  },
  success: {
    honeypot: { body: { success: true } },
    invalid: (ctx) => ({ body: { error: ctx.error ?? 'Invalid submission.' }, status: 400 }),
    success: (ctx) => ({
      body: {
        success: true,
        ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
        ...(ctx.id ? { id: ctx.id } : {}),
      },
    }),
    sendFailed: { body: { error: 'Failed to send message. Please try again later.' }, status: 500 },
    error: { body: { error: 'An unexpected error occurred' }, status: 500 },
    retry: { body: { error: 'That took too long. Please send it again.' }, status: 400 },
    limited: { body: { error: 'Too many messages. Please try again later.' }, status: 429 },
  },
  ok: {
    honeypot: { body: { ok: true } },
    invalid: (ctx) => ({
      body: { ok: false, error: ctx.error ?? 'Invalid submission.' },
      status: 400,
    }),
    success: (ctx) => ({ body: { ok: true, ...(ctx.id ? { id: ctx.id } : {}) } }),
    sendFailed: { body: { ok: false, error: 'Failed to send email' }, status: 500 },
    error: (ctx) => ({
      body: { ok: false, error: ctx.error ?? 'Internal server error' },
      status: 500,
    }),
    retry: { body: { ok: false, error: 'That took too long. Please send it again.' }, status: 400 },
    limited: {
      body: { ok: false, error: 'Too many messages. Please try again later.' },
      status: 429,
    },
  },
});

/** The ?error= codes a plain form post can be redirected with. */
export const ERROR_CODES = Object.freeze(['invalid', 'retry', 'limited', 'sendFailed', 'error']);

function toGetter(query) {
  if (!query) return () => null;
  if (typeof query === 'string') {
    const p = new URLSearchParams(
      query.includes('?') ? query.slice(query.indexOf('?') + 1) : query,
    );
    return (k) => p.get(k);
  }
  if (query instanceof URL) return (k) => query.searchParams.get(k);
  if (typeof query.get === 'function') return (k) => query.get(k);
  return (k) => {
    const v = query[k];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function spec(value, ctx) {
  return typeof value === 'function' ? value(ctx) : value;
}

// ---------------------------------------------------------------------------
// Captcha (optional, for the few sites that already run one)
// ---------------------------------------------------------------------------

const CAPTCHA_VERIFY_URLS = {
  hcaptcha: 'https://hcaptcha.com/siteverify',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
};
const CAPTCHA_TOKEN_FIELDS = { hcaptcha: 'h-captcha-response', turnstile: 'cf-turnstile-response' };

/** Verify a captcha token with the provider. Fails closed on any error. */
export async function verifyCaptcha(token, options) {
  const verifyUrl = options.verifyUrl ?? CAPTCHA_VERIFY_URLS[options.provider];
  try {
    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: options.secretKey, response: token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Request parsing: JSON from fetch() forms, urlencoded/multipart from plain <form> posts.
// ---------------------------------------------------------------------------

/** @returns {Promise<{ body: Record<string, unknown> | null, html: boolean }>} */
export async function readBody(req) {
  const type = (req.headers?.get?.('content-type') ?? '').toLowerCase();
  const html =
    type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
  try {
    if (html && typeof req.formData === 'function') {
      const fd = await req.formData();
      const body = {};
      for (const [k, v] of fd.entries()) if (typeof v === 'string' && !(k in body)) body[k] = v;
      return { body, html: true };
    }
    const raw = await req.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { body: null, html: false };
    return { body: raw, html: false };
  } catch {
    return { body: null, html };
  }
}

function isProduction() {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

function env(name) {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Build the form-guard instance, or pass one through. With no `guard` option
 * the secret comes from FORM_GUARD_SECRET, then RESEND_API_KEY (which sending
 * already needs), so every form is protected by default. `guard: false`
 * turns it off (tests, internal tools).
 */
export function resolveGuard(guard, { binding, brandTerms } = {}) {
  if (guard === false) return null;
  if (guard && typeof guard.check === 'function') return guard;
  const opts = guard ?? {};
  const secret = opts.secret ?? env('FORM_GUARD_SECRET') ?? env('RESEND_API_KEY');
  if (!secret) {
    console.warn(
      '[contact-form] no FORM_GUARD_SECRET or RESEND_API_KEY: the form has only its honeypot',
    );
    return null;
  }
  return createFormGuard({
    binding,
    brandTerms,
    rateLimit: { max: 5, windowMs: 60 * 60 * 1000 },
    requireToken: env('FORM_GUARD_ENFORCE') !== '0',
    ...opts,
    secret,
  });
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function senderFor(options) {
  let cached;
  return () => {
    if (options.send) return options.send;
    if (options.emailer) return (mail) => options.emailer.send(mail);
    if (!cached) {
      const config =
        options.emailerConfig ??
        (env('RESEND_API_KEY')
          ? { resendApiKey: env('RESEND_API_KEY'), defaultFrom: options.from }
          : null);
      if (!config) return null;
      cached = createEmailer(config);
    }
    return (mail) => cached.send(mail);
  };
}

/** The notification email for a submission: labelled rows, the message, then where it came from. */
export function notificationEmail({ subject, rows, message, verdict }) {
  const html = [`<h2>${escapeHtml(subject)}</h2>`];
  const text = [];
  for (const [label, value] of rows) {
    html.push(
      `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value).replace(/\n/g, '<br />')}</p>`,
    );
    text.push(`${label}: ${value}`);
  }
  if (message) {
    html.push(
      '<hr />',
      '<p><strong>Message:</strong></p>',
      `<p>${escapeHtml(message).replace(/\n/g, '<br />')}</p>`,
    );
    text.push('', 'Message:', message);
  }
  // Where it came from and why it scored as it did. None of this is in the
  // headers: the notification is sent by us to us, so it authenticates
  // perfectly whoever filled the form in.
  if (verdict) {
    const provenance = provenanceBlock({ ip: verdict.ip, userAgent: verdict.userAgent, verdict });
    html.push(
      '<hr />',
      `<pre style="font:12px/1.5 monospace;color:#666">${escapeHtml(provenance)}</pre>`,
    );
    text.push('', provenance);
  }
  return { html: html.join('\n'), text: text.join('\n') };
}

// ---------------------------------------------------------------------------
// The shared pipeline
// ---------------------------------------------------------------------------

/**
 * Run one submission through the checks. Both createContactForm and the
 * legacy createContactRoute call this; they differ only in how they turn the
 * body into a submission (`collect`).
 *
 * @returns {Promise<{ kind: string, ctx: object, submission?: object }>}
 */
async function pipeline({ req, body, options, guard, collect, getSender }) {
  if (options.mapBody) body = options.mapBody(body);

  const honeypot = options.honeypot === undefined ? 'website' : options.honeypot;
  if (honeypot !== false) {
    const trap = body[honeypot];
    if (typeof trap === 'string' && trap.trim() !== '') return { kind: 'honeypot', ctx: {} };
  }

  // Runs before validation on purpose: a bot that gets "Name is required"
  // back has learned what to send next time.
  let verdict = null;
  if (guard) {
    verdict = await guard.check({
      fields: body,
      headers: req.headers ?? null,
      ...(options.ip ? { ip: options.ip(req) } : {}),
    });
    if (!verdict.allow) {
      if (verdict.action === 'drop') {
        console.warn(`[contact] dropped submission (${verdict.reason}) ip=${verdict.ip ?? '?'}`);
        return { kind: 'honeypot', ctx: {} };
      }
      if (verdict.action === 'limited')
        return { kind: 'limited', ctx: { error: 'Too many messages. Please try again later.' } };
      return { kind: 'retry', ctx: { error: 'That took too long. Please send it again.' } };
    }
  }

  // verify(): true accepts; false or a string refuses as `invalid`; an object
  // { kind: 'limited' | 'retry' | 'invalid', error? } refuses as that kind, so
  // a database-backed rate limit answers like the guard's own (429, and
  // ?error=limited on a plain form post).
  if (options.verify) {
    const ok = await options.verify(body, req);
    if (ok !== true) {
      if (ok && typeof ok === 'object') {
        const kind = ['limited', 'retry', 'invalid'].includes(ok.kind) ? ok.kind : 'invalid';
        return { kind, ctx: ok.error ? { error: String(ok.error) } : {} };
      }
      return {
        kind: 'invalid',
        ctx: { error: typeof ok === 'string' ? ok : 'Verification failed' },
      };
    }
  }

  if (options.captcha) {
    const field = options.captcha.tokenField ?? CAPTCHA_TOKEN_FIELDS[options.captcha.provider];
    const token = body[field];
    const passed =
      typeof token === 'string' && token !== ''
        ? await verifyCaptcha(token, options.captcha)
        : false;
    if (!passed) return { kind: 'invalid', ctx: { error: 'Captcha verification failed' } };
  }

  const collected = collect(body);
  if (!collected.ok)
    return {
      kind: 'invalid',
      ctx: {
        error: collected.error,
        ...(collected.field ? { field: collected.field, reason: collected.reason } : {}),
      },
    };
  const submission = collected.submission;

  // A form that asked for something specific (an idea, a bug, an address)
  // quarantines the stock "questions about pricing and availability" note:
  // nothing is left of it once its canned sentences are taken out.
  for (const field of options.requireSubstance ?? []) {
    const text =
      submission.values?.[field] ??
      submission.fields?.[field] ??
      (field === 'message' ? submission.message : '');
    if (text && substance(text).length < (options.minSubstance ?? 20)) {
      console.warn(
        `[contact] quarantined stock enquiry (${field}) from ${submission.email || '?'}`,
      );
      if (options.onQuarantine) await options.onQuarantine(submission, verdict);
      return { kind: 'honeypot', ctx: {} };
    }
  }

  let id;
  if (options.persist) id = (await options.persist(submission, verdict)) ?? undefined;

  const sender = getSender();
  let messageId;
  if (!sender) {
    const mode = options.onMissingEmailer ?? (isProduction() ? 'error' : 'log');
    if (mode === 'error') return { kind: 'error', ctx: { error: 'Email not configured' } };
    console.log(
      `[contact] Submission from ${submission.name} <${submission.email}>:`,
      submission.fields,
      submission.message,
    );
    return { kind: 'success', ctx: { id }, submission };
  }

  const subjectText =
    typeof options.subject === 'function'
      ? options.subject(submission)
      : (options.subject ??
        (submission.name
          ? `New contact form submission from ${submission.name}`
          : 'New contact form submission'));
  // A flagged message is still delivered; the tag is there so an inbox rule can sort it.
  const mailSubject = verdict ? tagSubject(subjectText, verdict) : subjectText;
  const { html, text } = notificationEmail({
    subject: subjectText,
    rows: submission.rows,
    message: submission.message,
    verdict,
  });
  const result = await sender({
    to: options.to,
    from: options.from,
    subject: mailSubject,
    html,
    text: options.text === false ? undefined : text,
    replyTo: submission.email !== '' ? submission.email : undefined,
  });
  if (!result.sent) {
    if ((options.onSendError ?? 'fail') === 'fail') {
      console.error('Contact form send error:', result.error);
      return { kind: 'sendFailed', ctx: { error: result.error } };
    }
    console.error('Contact form send error (ignored):', result.error);
  } else {
    messageId = result.id;
  }

  if (options.confirmation && submission.email !== '') {
    try {
      const c = options.confirmation;
      const r = await sender({
        to: submission.email,
        from: c.from ?? options.from,
        subject: c.subject,
        html: typeof c.html === 'function' ? c.html(submission) : c.html,
      });
      if (!r.sent) console.error('Contact confirmation send error:', r.error);
    } catch (err) {
      console.error('Contact confirmation error:', err);
    }
  }

  return { kind: 'success', ctx: { messageId, id }, submission };
}

// ---------------------------------------------------------------------------
// createContactForm: the module every site uses
// ---------------------------------------------------------------------------

/**
 * @param {object} options see index.d.ts (ContactFormOptions)
 */
export function createContactForm(options = {}) {
  if (!options.to)
    throw new TypeError('contact-form: `to` (who receives the messages) is required');
  const questions = normalizeQuestions(options.questions ?? DEFAULT_QUESTIONS);
  const site = options.site ?? 'site';
  const guard = resolveGuard(options.guard, {
    binding: options.binding ?? `${site}:contact`,
    brandTerms: options.brandTerms ?? [],
  });
  const honeypotField = guard
    ? guard.config.honeypotField
    : options.honeypot === false
      ? null
      : (options.honeypot ?? 'website');
  const responses = { ...STYLE_PRESETS[options.style ?? 'success'], ...options.responses };
  const getSender = senderFor(options);
  const byName = new Map(questions.map((q) => [q.name, q]));
  const nameField = options.nameField ?? 'name';
  const emailField = options.emailField ?? 'email';
  const messageField = options.messageField ?? 'message';

  for (const f of options.requireSubstance ?? []) {
    if (!byName.has(f))
      throw new TypeError(`contact-form: requireSubstance names "${f}", which is not a question`);
  }

  const collect = (body) => {
    const v = validate(questions, body);
    if (!v.ok) return { ok: false, error: v.error, field: v.field, reason: v.reason };
    const values = v.values;
    const rows = [];
    const fields = {};
    for (const q of questions) {
      const value = values[q.name];
      if (!value || q.name === messageField) continue;
      fields[q.name] = value;
      // A select reads as its label in the email ("Bug Report", not "bug").
      const shown =
        q.type === 'select' ? (q.options.find((o) => o.value === value)?.label ?? value) : value;
      rows.push([plainLabel(q), shown]);
    }
    return {
      ok: true,
      submission: {
        name: values[nameField] ?? '',
        email: values[emailField] ?? '',
        message: values[messageField] ?? '',
        values,
        fields,
        rows,
        raw: body,
      },
    };
  };

  /** The token + honeypot inputs, as HTML. Mint per render: never cache a page that has one. */
  async function guardHtml() {
    if (guard)
      return guard.hiddenHTML(await guard.issue(), { className: options.hpClass ?? 'cf-hp' });
    if (!honeypotField) return '';
    return `<div aria-hidden="true" class="${escapeHtml(options.hpClass ?? 'cf-hp')}"><label>Website<input type="text" name="${escapeHtml(honeypotField)}" tabindex="-1" autocomplete="off"></label></div>`;
  }

  /** The whole form as HTML. */
  async function render(o = {}) {
    return renderForm({
      questions,
      guardHtml: await guardHtml(),
      action: o.action ?? options.action ?? '/api/contact',
      values: o.values,
      error: o.error ?? (o.query ? errorMessage(o.query) : undefined),
      notice: o.notice ?? (o.query ? sentMessage(o.query) : undefined),
      submitLabel: o.submitLabel ?? options.submitLabel,
      className: o.className,
      idPrefix: o.idPrefix,
    });
  }

  /** What a client component needs: serialisable, minted fresh. */
  async function props(o = {}) {
    const token = guard ? await guard.issue() : null;
    return {
      action: o.action ?? options.action ?? '/api/contact',
      questions: publicQuestions(questions),
      tokenField: guard ? guard.config.tokenField : null,
      token,
      honeypotField,
      submitLabel: o.submitLabel ?? options.submitLabel ?? 'Send',
      successMessage:
        o.successMessage ??
        options.successMessage ??
        "Thanks, your message is on its way. We'll be in touch.",
      // Per-render starting values (a hidden `ref` from ?ref=, a box ticked by
      // the link that led here). Only question names, as strings.
      ...(o.values ? { values: pickValues(o.values) } : {}),
    };
  }

  function pickValues(values) {
    const out = {};
    for (const q of questions) {
      if (q.type === 'section') continue;
      const v = values[q.name];
      if (v === undefined || v === null) continue;
      out[q.name] =
        q.type === 'checkbox'
          ? v === true || v === 'yes' || v === 'on' || v === '1' || v === 'true'
            ? 'yes'
            : ''
          : String(v);
    }
    return out;
  }

  function answer(kind, ctx, html, req) {
    // A plain <form> post gets a page back, not JSON: a 303 to the page with
    // ?sent=1, or ?error=<code> (and &field=&reason= for a validation
    // failure). Never free text: a page that prints ?error= would print
    // whatever a crafted link carried. contact.errorMessage(query) turns the
    // code back into this form's own message.
    if (html) {
      const back = options.redirect ?? req.headers?.get?.('referer') ?? '/';
      const url = (q) => {
        const u = new URL(back, 'http://x.invalid');
        for (const k of ['sent', 'error', 'field', 'reason']) u.searchParams.delete(k);
        for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
        return u.origin === 'http://x.invalid' ? `${u.pathname}${u.search}${u.hash}` : u.toString();
      };
      if (kind === 'success' || kind === 'honeypot')
        return new Response(null, { status: 303, headers: { location: url({ sent: '1' }) } });
      const code = ERROR_CODES.includes(kind) ? kind : 'error';
      const q = { error: code };
      if (
        code === 'invalid' &&
        ctx.field &&
        byName.has(ctx.field) &&
        VALIDATION_REASONS.includes(ctx.reason)
      ) {
        q.field = ctx.field;
        q.reason = ctx.reason;
      }
      return new Response(null, { status: 303, headers: { location: url(q) } });
    }
    const s = spec(
      responses[kind] ??
        (kind === 'retry' || kind === 'limited' ? responses.invalid : responses.error),
      ctx,
    );
    return json(s.body, s.status ?? 200);
  }

  /**
   * The message for a redirect's ?error= code, safe to print: rebuilt from
   * this form's questions and `responses`, never taken from the URL. Accepts
   * a URL, a URLSearchParams, a query string or a { error, field, reason }
   * object (Next's searchParams). Returns null when there is no error.
   */
  function errorMessage(query) {
    const get = toGetter(query);
    const code = get('error');
    if (!code) return null;
    if (code === 'invalid') {
      const q = byName.get(get('field') ?? '');
      const reason = get('reason');
      if (q && VALIDATION_REASONS.includes(reason)) return validationMessage(q, reason);
    }
    const kind = ERROR_CODES.includes(code) ? code : 'error';
    const body = spec(responses[kind] ?? responses.error, {})?.body;
    const text = body?.error ?? body?.message;
    return typeof text === 'string' && text ? text : 'Something went wrong. Please try again.';
  }

  /** "Thanks" text for ?sent=1, else null. */
  function sentMessage(query) {
    return toGetter(query)('sent') === '1'
      ? (options.successMessage ?? "Thanks, your message is on its way. We'll be in touch.")
      : null;
  }

  async function post(req) {
    let html = false;
    try {
      const parsed = await readBody(req);
      html = parsed.html;
      if (!parsed.body) return answer('invalid', { error: 'Invalid submission' }, html, req);
      const r = await pipeline({ req, body: parsed.body, options, guard, collect, getSender });
      return answer(r.kind, r.ctx, html, req);
    } catch (err) {
      console.error('Contact form error:', err);
      return answer(
        'error',
        { error: err instanceof Error ? err.message : String(err) },
        html,
        req,
      );
    }
  }

  /**
   * For frameworks that have already parsed the body (Primate's request.body,
   * Express with body-parser): the same handling as POST, from the fields.
   * `html: true` answers like a plain <form> post (303 back to `referer`).
   */
  async function handleFields(fields, o = {}) {
    const headers = new Headers(o.headers ?? {});
    if (o.ip && !headers.has('x-forwarded-for')) headers.set('x-forwarded-for', o.ip);
    if (o.referer && !headers.has('referer')) headers.set('referer', o.referer);
    const flat = {};
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (v === undefined || v === null) continue;
      flat[k] = Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'object' ? '' : String(v);
    }
    const html = o.html === true;
    headers.set('content-type', html ? 'application/x-www-form-urlencoded' : 'application/json');
    const req = new Request(o.url ?? 'http://localhost/contact', {
      method: 'POST',
      headers,
      body: html ? new URLSearchParams(flat).toString() : JSON.stringify(flat),
    });
    return post(req);
  }

  /** GET: a fresh token and the questions, for a client-only page that cannot mint one server-side. */
  async function get() {
    return new Response(JSON.stringify(await props()), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  return Object.freeze({
    questions,
    guard,
    guardHtml,
    render,
    props,
    errorMessage,
    sentMessage,
    handleFields,
    POST: post,
    GET: get,
    handle: post,
  });
}

// ---------------------------------------------------------------------------
// createContactRoute: the @profullstack/stack/email API, unchanged
// ---------------------------------------------------------------------------

/**
 * The route-only API that @profullstack/stack/email shipped (and re-exports
 * from here). It takes any submitted field, not a question list. New code
 * uses createContactForm.
 */
export function createContactRoute(options) {
  const { to, requiredFields = ['name', 'email', 'message'], validateEmail = true } = options;
  const honeypot = options.honeypot === undefined ? 'website' : options.honeypot;
  const responses = { ...STYLE_PRESETS[options.style ?? 'success'], ...options.responses };
  const labelFor = (field) => options.fieldLabels?.[field] ?? humanize(field);
  const guard = options.guard
    ? typeof options.guard.check === 'function'
      ? options.guard
      : createFormGuard(options.guard)
    : null;
  const getSender = senderFor(options);
  void to;

  const collect = (body) => {
    const str = (key) => (typeof body[key] === 'string' ? body[key].trim() : '');
    for (const field of requiredFields) {
      if (str(field) === '') return { ok: false, error: `${labelFor(field)} is required` };
    }
    const name = str('name');
    const email = str('email');
    const message = str('message');
    if (validateEmail && email !== '' && !EMAIL_RE.test(email))
      return { ok: false, error: 'Valid email is required' };
    const skip = new Set(['name', 'email', 'message', ...(options.skipFields ?? [])]);
    if (honeypot !== false) skip.add(honeypot);
    if (guard) {
      skip.add(guard.config.tokenField);
      skip.add(guard.config.honeypotField);
    }
    if (options.captcha)
      skip.add(options.captcha.tokenField ?? CAPTCHA_TOKEN_FIELDS[options.captcha.provider]);
    const fields = {};
    for (const [key, value] of Object.entries(body)) {
      if (skip.has(key) || value === undefined || value === null) continue;
      const s = typeof value === 'string' ? value.trim() : String(value);
      if (s !== '') fields[key] = s;
    }
    const rows = [];
    if (name) rows.push(['Name', name]);
    if (email) rows.push(['Email', email]);
    for (const [k, v] of Object.entries(fields)) rows.push([labelFor(k), v]);
    return { ok: true, submission: { name, email, message, fields, rows, raw: body } };
  };

  return async function contactRoute(req) {
    try {
      let raw;
      try {
        raw = await req.json();
      } catch {
        return json(...pair(responses.invalid, { error: 'Invalid JSON body' }));
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return json(...pair(responses.invalid, { error: 'Invalid JSON body' }));
      const r = await pipeline({
        req,
        body: raw,
        options: { ...options, honeypot },
        guard,
        collect,
        getSender,
      });
      const value =
        responses[r.kind] ??
        (r.kind === 'retry' || r.kind === 'limited' ? responses.invalid : responses.error);
      return json(...pair(value, r.ctx));
    } catch (err) {
      console.error('Contact form error:', err);
      return json(
        ...pair(responses.error, { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  };
}

function pair(value, ctx) {
  const s = spec(value, ctx);
  return [s.body, s.status ?? 200];
}

/** The guard a page and a route share (stack/email API). */
export function createContactGuard(options) {
  return createFormGuard(options);
}
