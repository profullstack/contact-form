'use client';
/**
 * <ContactForm>: the client component for Next/React sites.
 *
 * Give it the props a server component got from `contact.props()` (token
 * minted at render), or `src` (a GET route returning the same props) for a
 * page that is a client component all the way down. It posts JSON to
 * `action` and shows the server's error or the success message in place.
 *
 *   // app/contact/page.tsx (server component)
 *   import { ContactForm } from '@profullstack/contact-form/react';
 *   import { contact } from '@/lib/contact';
 *   export const dynamic = 'force-dynamic'; // a token per render, never a cached page
 *   export default async function Page() { return <ContactForm {...await contact.props()} />; }
 *
 * No JSX, so the package ships without a build step.
 */
import { createElement as h, useEffect, useState } from 'react';

const errorOf = (body) =>
  (body &&
    (body.error ||
      (body.ok === false && body.message) ||
      (body.success === false && body.message))) ||
  null;

export function ContactForm(props) {
  const [loaded, setLoaded] = useState(props.src ? null : props);
  const [values, setValues] = useState({});
  const [state, setState] = useState({ status: 'idle', message: '' });

  useEffect(() => {
    if (!props.src) return;
    let live = true;
    fetch(props.src, { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => live && setLoaded(p))
      .catch(
        () =>
          live &&
          setState({
            status: 'error',
            message: 'The form could not load. Please refresh the page.',
          }),
      );
    return () => {
      live = false;
    };
  }, [props.src]);

  if (!loaded) return h('p', { className: 'cf-loading' }, 'Loading…');
  const p = { ...loaded, ...props, questions: loaded.questions ?? props.questions };
  // Where each field starts: the question's default, then the values the
  // server put in props({ values }), then `defaultValues` from the page.
  // `values` state only holds what the person changed, so a reset returns here.
  const start = {};
  for (const q of p.questions) {
    if (q.type === 'section') continue;
    const v =
      p.defaultValues?.[q.name] ??
      p.values?.[q.name] ??
      (q.type === 'hidden' ? (q.value ?? q.default) : q.default);
    if (v !== undefined && v !== null) start[q.name] = String(v);
  }
  const current = (name) => values[name] ?? start[name] ?? '';
  const isOn = (v) => v === 'yes' || v === 'on' || v === 'true' || v === '1';
  const set = (name) => (e) =>
    setValues((v) => ({
      ...v,
      [name]: e.target.type === 'checkbox' ? (e.target.checked ? 'yes' : '') : e.target.value,
    }));

  async function onSubmit(e) {
    e.preventDefault();
    setState({ status: 'sending', message: '' });
    const form = new FormData(e.currentTarget);
    const body = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') body[k] = v;
    // Analytics hook ("contact_submit"); returning false cancels the send.
    if (p.onSubmit && p.onSubmit(body) === false) {
      setState({ status: 'idle', message: '' });
      return;
    }
    const fail = (message, data) => {
      setState({ status: 'error', message });
      if (p.onError) p.onError(message, data);
    };
    try {
      const res = await fetch(p.action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || errorOf(data)) {
        fail(errorOf(data) || 'Something went wrong. Please try again.', data);
        return;
      }
      setState({ status: 'sent', message: p.successMessage });
      setValues({});
      if (p.onSent) p.onSent(body, data);
    } catch {
      fail('Could not send. Check your connection and try again.', null);
    }
  }

  if (state.status === 'sent')
    return h(
      'div',
      { className: 'cf-sent' },
      h('p', { className: 'cf-notice', role: 'status' }, state.message),
      // Anything the page passes as children (links, a mailto, next steps).
      p.children ?? null,
      p.resetLabel
        ? h(
            'button',
            {
              type: 'button',
              className: 'cf-reset',
              onClick: () => setState({ status: 'idle', message: '' }),
            },
            p.resetLabel,
          )
        : null,
    );

  const id = (name) => `${p.idPrefix ?? 'cf'}-${name}`;
  const field = (q) => {
    const common = {
      id: id(q.name),
      name: q.name,
      required: q.required,
      placeholder: q.placeholder,
      autoComplete: q.autocomplete,
      value: current(q.name),
      onChange: set(q.name),
    };
    if (q.type === 'section')
      return h(
        'div',
        { key: q.name, className: 'cf-section-group' },
        h('h3', { className: 'cf-section', id: id(q.name) }, q.label),
        q.help ? h('p', { className: 'cf-help' }, q.help) : null,
      );
    if (q.type === 'hidden')
      return h('input', { key: q.name, type: 'hidden', name: q.name, value: current(q.name) });
    let control;
    if (q.type === 'textarea')
      control = h('textarea', {
        ...common,
        rows: q.rows ?? 5,
        minLength: q.minLength,
        maxLength: q.maxLength,
      });
    else if (q.type === 'select') {
      // A placeholder (or "-" when optional) is an empty first option, so a
      // required select makes the person choose instead of submitting the
      // first option listed.
      const { placeholder, ...rest } = common;
      const blank = placeholder ? placeholder : q.required ? null : '-';
      control = h(
        'select',
        rest,
        blank === null ? null : h('option', { value: '' }, blank),
        ...q.options.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
      );
    } else if (q.type === 'checkbox') {
      const { value, placeholder, ...rest } = common;
      control = h('input', { ...rest, type: 'checkbox', checked: isOn(value) });
    } else
      control = h('input', {
        ...common,
        type: q.type,
        minLength: q.minLength,
        maxLength: q.maxLength,
        pattern: q.pattern,
        title: q.pattern ? q.patternMessage : undefined,
      });
    const label = h(
      'label',
      { htmlFor: id(q.name) },
      q.label,
      q.required ? null : h('span', { className: 'cf-optional' }, ' (optional)'),
    );
    const help = q.help ? h('p', { className: 'cf-help' }, q.help) : null;
    return q.type === 'checkbox'
      ? h('div', { key: q.name, className: 'cf-field cf-check' }, control, ' ', label, help)
      : h('div', { key: q.name, className: 'cf-field' }, label, control, help);
  };

  return h(
    'form',
    {
      className: `cf-form${p.className ? ` ${p.className}` : ''}`,
      action: p.action,
      method: 'post',
      onSubmit,
    },
    state.status === 'error'
      ? h('p', { className: 'cf-error', role: 'alert' }, state.message)
      : null,
    ...p.questions.map(field),
    p.tokenField && p.token
      ? h('input', { type: 'hidden', name: p.tokenField, value: p.token })
      : null,
    p.honeypotField
      ? h(
          'div',
          { 'aria-hidden': 'true', className: p.hpClass ?? 'cf-hp' },
          h(
            'label',
            null,
            'Website',
            h('input', { type: 'text', name: p.honeypotField, tabIndex: -1, autoComplete: 'off' }),
          ),
        )
      : null,
    h(
      'button',
      { className: 'cf-submit', type: 'submit', disabled: state.status === 'sending' },
      state.status === 'sending' ? 'Sending…' : p.submitLabel,
    ),
  );
}

export default ContactForm;
