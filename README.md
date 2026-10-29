# @profullstack/contact-form

The contact form every Profullstack site uses. One object knows the
questions, mints and checks the spam token, validates, sends the email and
answers, so the page and the route can never disagree.

```
npm i @profullstack/contact-form
```

- **Questions you can change.** Generic defaults (name, email, message); a
  site with a custom form passes its own list or adjusts the defaults.
- **Spam protection on by default** through
  [@profullstack/form-guard](https://github.com/profullstack/form-guard): a
  signed proof-of-render token (the check that catches bots that POST
  straight at the handler, which a honeypot cannot), a honeypot, a
  fill-time floor and 5 messages per hour per address. Anything caught is
  answered like a success, so a bot learns nothing.
- **Delivery** through Resend (`RESEND_API_KEY`), a custom `send`, or an
  `@profullstack/emailer`. The email carries the labelled answers, `Reply-To`
  the sender, a `[spam? N]` subject tag when content scoring flags it, and a
  provenance block (IP, user agent, fill time, signals). A flagged message is
  still delivered.
- **Any framework.** `POST` takes a standard `Request` (Next App Router,
  Hono, Bun, Workers, SvelteKit). JSON in gets JSON out; a plain `<form>`
  post gets a 303 back to the page with `?sent=1` or `?error=...`.
- **Markup** as an HTML string (`render()`) or a React component
  (`@profullstack/contact-form/react`). Plain `cf-*` classes, no inline
  styles, so it works under a strict CSP and takes each site's own CSS.

## Use

One module both the page and the route import:

```js
// lib/contact.js
import { createContactForm } from '@profullstack/contact-form';

export const contact = createContactForm({
  site: 'example.com', // token binding: "example.com:contact"
  to: 'hello@example.com',
  from: 'Example <hello@example.com>',
  brandTerms: ['example'], // words a scraper echoes back
});
```

The secret is `FORM_GUARD_SECRET`, or `RESEND_API_KEY` if that is unset
(sending needs it anyway). It must be the same on every instance serving the
form. With neither set the form logs a warning and keeps only its honeypot.

### Next.js (App Router)

```js
// app/api/contact/route.js
import { contact } from '@/lib/contact';
export const POST = contact.POST;
```

```jsx
// app/contact/page.jsx (a server component)
import { ContactForm } from '@profullstack/contact-form/react';
import { contact } from '@/lib/contact';

export const dynamic = 'force-dynamic'; // a token per render, never a cached page

export default async function Page() {
  return <ContactForm {...(await contact.props())} />;
}
```

A page that is a client component all the way down can fetch the props:
export `GET = contact.GET` from the route and render
`<ContactForm src="/api/contact" />`.

### Hono, Express-style, SvelteKit, any template string

```js
app.get('/contact', async (c) =>
  c.html(
    layout(
      await contact.render({
        action: '/contact',
        notice: c.req.query('sent') ? 'Thanks!' : undefined,
        error: c.req.query('error'),
      }),
    ),
  ),
);
app.post('/contact', (c) => contact.POST(c.req.raw));
```

Serve the page with `cache-control: no-store`: a cached page shares one token
between visitors and expires it for all of them.

## Questions

```js
import { createContactForm, withQuestions } from '@profullstack/contact-form';

createContactForm({
  to: 'hello@example.com',
  questions: withQuestions({
    add: [
      { name: 'company', label: 'Company / Project' },
      {
        name: 'budget',
        type: 'select',
        options: ['Under $5k', '$5k-$25k', '$25k+'],
        required: true,
      },
    ],
    override: { message: { label: 'Tell us about the project' } },
  }),
});
```

Or a whole list: `questions: [{ name: 'email', required: true }, { name: 'idea', type: 'textarea', required: true }]`.

| Field                                                                                       |                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `name`                                                                                      | body key and input name (letters, digits, `_`, `-`)                         |
| `label`                                                                                     | shown on the form and in the email; default from the name                   |
| `type`                                                                                      | `text` `email` `textarea` `select` `url` `tel` `number` `checkbox` `hidden` |
| `required`, `maxLength` (500, textarea 5000), `placeholder`, `rows`, `autocomplete`, `help` |                                                                             |
| `options`                                                                                   | for `select`: strings or `{ value, label }`; the answer must be one of them |
| `pattern`, `patternMessage`                                                                 | a regex source the answer must match                                        |

Only answers to questions reach the email or `persist`: an extra key in the
body is ignored, so nobody can smuggle fields into what you read.

## Forms that ask for something specific

An order form, a build request or a bug report asked for something; the
stock "I have a few questions about pricing, availability, and the general
process of working with you" note answers none of it. `requireSubstance`
names the questions that must say something. A submission with fewer than
`minSubstance` (20) characters left after form-guard's `substance()` is
answered like a success and not delivered (`onQuarantine` sees it). Never use
it on a general contact form, where "please tell me more" is a fair message.

## Options

| Option                                                         | Default                                   |                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `to`                                                           | required                                  | who receives the notification                                                                   |
| `from`                                                         |                                           | From header                                                                                     |
| `site`, `binding`                                              | `site:contact`                            | token binding                                                                                   |
| `questions`                                                    | `DEFAULT_QUESTIONS`                       |                                                                                                 |
| `guard`                                                        | built from env                            | form-guard options (`minAgeMs`, `rateLimit`, `requireToken`, ...), a guard instance, or `false` |
| `brandTerms`                                                   | `[]`                                      | content scoring                                                                                 |
| `subject`                                                      | `New contact form submission from {name}` | string or function of the submission                                                            |
| `send`, `emailer`, `emailerConfig`                             | Resend from `RESEND_API_KEY`              | transport                                                                                       |
| `persist(submission, verdict)`                                 |                                           | store it (Supabase etc.); an id it returns is in the response; a throw is a 500                 |
| `confirmation`                                                 |                                           | `{ subject, html }` emailed to the sender                                                       |
| `verify(body, req)`, `captcha`                                 |                                           | extra checks; `captcha: { provider: 'turnstile' \| 'hcaptcha', secretKey }`                     |
| `style`                                                        | `success`                                 | response bodies: `success` (`{success:true}`/`{error}`), `ok`, `message`                        |
| `responses`                                                    |                                           | override any response                                                                           |
| `onSendError`                                                  | `fail`                                    | `ignore` answers success when the email fails                                                   |
| `onMissingEmailer`                                             | `error` in production, else `log`         |                                                                                                 |
| `requireSubstance`, `minSubstance`, `onQuarantine`             |                                           | see above                                                                                       |
| `redirect`                                                     | the Referer                               | where a plain form post is sent back to                                                         |
| `action`, `submitLabel`, `successMessage`, `hpClass` (`cf-hp`) |                                           | rendering                                                                                       |
| `ip(req)`                                                      | from proxy headers                        | the address, where the platform keeps it elsewhere (Hono `c.env.ip`)                            |

`FORM_GUARD_ENFORCE=0` scores without blocking, if a real sender is ever
turned away.

## Styling

`BASE_CSS` hides `.cf-hp` and lays the fields out; use it, or style
`.cf-form`, `.cf-field`, `.cf-error`, `.cf-notice`, `.cf-submit` yourself. Hide
`.cf-hp` from your stylesheet whatever you do: a visible honeypot drops the
real people who fill it in.

## Migrating from `@profullstack/stack/email`

`createContactRoute` and `createContactGuard` are here unchanged (and
`@profullstack/stack/email` re-exports them from here), so existing routes
keep working. New code uses `createContactForm`, which also owns the page.

MIT © Profullstack, Inc.
