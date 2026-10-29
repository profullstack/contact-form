import type { Emailer, EmailerConfig, SendOptions, SendResult } from '@profullstack/emailer';
import type { FormGuard, FormGuardOptions, Verdict } from '@profullstack/form-guard';

export {
  createFormGuard,
  provenanceBlock,
  scoreSubmission,
  substance,
  tagSubject,
} from '@profullstack/form-guard';
export type { FormGuard, FormGuardOptions, Verdict };

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type QuestionType =
  | 'text'
  | 'email'
  | 'textarea'
  | 'select'
  | 'url'
  | 'tel'
  | 'number'
  | 'checkbox'
  | 'hidden'
  /** Not a field: a heading (`label`) and optional `help` between groups of fields. */
  | 'section';

export interface QuestionOption {
  value: string;
  label: string;
}

/** One field the form asks for. */
export interface Question {
  /** Body key, also the input name. Letters, digits, `_` and `-`. */
  name: string;
  /** Shown above the field and in the notification email. Default: humanised name. */
  label?: string;
  /** Default: `email` for "email", `textarea` for "message", otherwise `text`. */
  type?: QuestionType;
  required?: boolean;
  /** Default 5000 for a textarea, 500 otherwise. */
  maxLength?: number;
  /** Fewest characters an answer may have (checked in the browser too). */
  minLength?: number;
  /** How messages name the field when the label reads badly in a sentence (a label that is a question). */
  errorLabel?: string;
  placeholder?: string;
  /** For `select`. Strings are both value and label. */
  options?: ReadonlyArray<string | QuestionOption>;
  rows?: number;
  autocomplete?: string;
  /** A line of help under the field. */
  help?: string;
  /** A regex source the WHOLE value must match (as the HTML `pattern` attribute; sent to the input too). */
  pattern?: string;
  patternMessage?: string;
  /** For `hidden`: the value sent. */
  value?: string;
  /**
   * The value the field starts with (a select preset, a box ticked: true/'yes').
   * A select's default must be one of its options. Per-render values go in
   * `props({ values })` / `render({ values })` instead.
   */
  default?: string | boolean;
}

export interface NormalizedQuestion
  extends Required<Pick<Question, 'name' | 'label' | 'type' | 'required' | 'maxLength'>> {
  placeholder?: string;
  options?: ReadonlyArray<QuestionOption>;
  rows?: number;
  autocomplete?: string;
  help?: string;
  pattern?: string;
  patternMessage?: string;
  value?: string;
  default?: string;
  minLength?: number;
  errorLabel?: string;
}

/** name (required), email (required), message (required). */
export declare const DEFAULT_QUESTIONS: ReadonlyArray<Question>;

export declare function normalizeQuestions(
  questions?: ReadonlyArray<Question>,
): ReadonlyArray<NormalizedQuestion>;

/** The defaults (or `base`) with questions added before `message`, omitted, or overridden by name. */
export declare function withQuestions(options?: {
  add?: Question[];
  omit?: string[];
  override?: Record<string, Partial<Question>>;
  base?: ReadonlyArray<Question>;
  insertBefore?: string;
}): Question[];

export declare function validate(
  questions: ReadonlyArray<NormalizedQuestion>,
  body: Record<string, unknown>,
):
  | { ok: true; values: Record<string, string> }
  | { ok: false; error: string; field: string; reason: ValidationReason };

export type ValidationReason =
  | 'required'
  | 'tooLong'
  | 'tooShort'
  | 'email'
  | 'url'
  | 'number'
  | 'select'
  | 'pattern';
export declare const VALIDATION_REASONS: readonly ValidationReason[];
/** The one message for a validation failure (JSON answer and errorMessage() share it). */
export declare function validationMessage(
  question: NormalizedQuestion,
  reason: ValidationReason,
): string;
/** The label without a trailing "*" or ":", for sentences. */
export declare function plainLabel(question: NormalizedQuestion): string;

export declare function publicQuestions(
  questions: ReadonlyArray<NormalizedQuestion>,
): NormalizedQuestion[];
export declare function humanize(field: string): string;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export declare function escapeHtml(value: unknown): string;
/** Hides `.cf-hp` and lays out `.cf-*`. Each site may use its own CSS instead. */
export declare const BASE_CSS: string;
export declare function renderForm(options: {
  questions: ReadonlyArray<NormalizedQuestion>;
  guardHtml?: string;
  action: string;
  values?: Record<string, string>;
  error?: string;
  notice?: string;
  submitLabel?: string;
  className?: string;
  idPrefix?: string;
}): string;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** Anything with `json()` (and `headers`, `formData()` for plain form posts): Request, NextRequest. */
export interface ContactRequest {
  json(): Promise<unknown>;
  formData?(): Promise<FormData>;
  headers?: { get(name: string): string | null };
}

export interface ContactSubmission {
  name: string;
  email: string;
  message: string;
  /** Every non-empty field other than the message, by name. */
  fields: Record<string, string>;
  /** createContactForm: every question's value, empty ones included. */
  values?: Record<string, string>;
  /** [label, value] pairs as they appear in the email. */
  rows: Array<[string, string]>;
  raw: Record<string, unknown>;
}

export type CaptchaProvider = 'hcaptcha' | 'turnstile';
export interface CaptchaOptions {
  provider: CaptchaProvider;
  secretKey: string;
  tokenField?: string;
  verifyUrl?: string;
}
export declare function verifyCaptcha(token: string, options: CaptchaOptions): Promise<boolean>;

export interface ContactResponseContext {
  error?: string;
  messageId?: string;
  id?: string;
}
export interface ContactResponseSpec {
  body: unknown;
  status?: number;
}
export type ContactResponseValue =
  | ContactResponseSpec
  | ((ctx: ContactResponseContext) => ContactResponseSpec);
export interface ContactRouteResponses {
  honeypot: ContactResponseValue;
  invalid: ContactResponseValue;
  success: ContactResponseValue;
  sendFailed: ContactResponseValue;
  error: ContactResponseValue;
  retry?: ContactResponseValue;
  limited?: ContactResponseValue;
}
export type ContactResponseStyle = 'message' | 'success' | 'ok';
/** The ?error= codes a plain form post is redirected with. */
export declare const ERROR_CODES: readonly ['invalid', 'retry', 'limited', 'sendFailed', 'error'];
export declare const STYLE_PRESETS: Readonly<Record<ContactResponseStyle, ContactRouteResponses>>;

export type VerifyResult =
  | boolean
  | string
  | { kind: 'limited' | 'retry' | 'invalid'; error?: string };

export interface ContactConfirmation {
  subject: string;
  html: string | ((submission: ContactSubmission) => string);
  from?: string;
}

/** Options both APIs share. */
export interface ContactDeliveryOptions {
  /** Who receives the notification. */
  to: string;
  /** From header, e.g. "Example <hello@example.com>". */
  from?: string;
  emailer?: Emailer;
  emailerConfig?: EmailerConfig;
  /** A custom transport; replaces the emailer for both emails. */
  send?: (mail: SendOptions) => Promise<SendResult>;
  subject?: string | ((submission: ContactSubmission) => string);
  text?: boolean;
  confirmation?: ContactConfirmation;
  captcha?: CaptchaOptions;
  /**
   * Extra check after the guard. true accepts; false or a string refuses as `invalid`;
   * `{ kind: 'limited' | 'retry' | 'invalid', error? }` refuses as that kind (a DB rate limit -> 429).
   */
  verify?: (
    body: Record<string, unknown>,
    req: ContactRequest,
  ) => Promise<VerifyResult> | VerifyResult;
  mapBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  persist?: (
    submission: ContactSubmission,
    verdict: Verdict | null,
  ) => Promise<string | undefined> | string | undefined;
  onSendError?: 'fail' | 'ignore';
  onMissingEmailer?: 'log' | 'error';
  style?: ContactResponseStyle;
  responses?: Partial<ContactRouteResponses>;
  /** Honeypot field when no guard is used. Default "website"; false disables. */
  honeypot?: string | false;
  /** The submitter's address when the platform does not put it in a header (Hono c.env.ip). */
  ip?: (req: ContactRequest) => string | null;
}

export interface ContactFormOptions extends ContactDeliveryOptions {
  /** Used for the token binding (`<site>:contact`) when `binding` is not given. */
  site?: string;
  binding?: string;
  /** Words a scraper echoes back (the brand), for content scoring. */
  brandTerms?: string[];
  /** Default DEFAULT_QUESTIONS. */
  questions?: ReadonlyArray<Question>;
  /**
   * form-guard. Omitted: built from FORM_GUARD_SECRET, else RESEND_API_KEY (5 per hour per
   * address, token required unless FORM_GUARD_ENFORCE=0). Options: built from them (secret
   * may be omitted). A FormGuard: used as is. false: none (the honeypot still applies).
   */
  guard?: Partial<FormGuardOptions> | FormGuard | false;
  /** Where the form posts. Default "/api/contact". */
  action?: string;
  submitLabel?: string;
  successMessage?: string;
  /** Class that hides the honeypot. Default "cf-hp" (see BASE_CSS). */
  hpClass?: string;
  /**
   * Questions whose answer must say something: a stock enquiry ("a few questions about
   * pricing, availability...") with < minSubstance characters left after form-guard's
   * substance() is answered like a success and NOT delivered. For forms that ask for
   * something specific (an app idea, a bug), never a general contact form.
   */
  requireSubstance?: string[];
  minSubstance?: number;
  onQuarantine?: (submission: ContactSubmission, verdict: Verdict | null) => void | Promise<void>;
  /** A plain <form> post is redirected here (?sent=1 or ?error=...). Default: the Referer. */
  redirect?: string;
  nameField?: string;
  emailField?: string;
  messageField?: string;
}

export interface ContactFormProps {
  action: string;
  questions: NormalizedQuestion[];
  tokenField: string | null;
  token: string | null;
  honeypotField: string | null;
  submitLabel: string;
  successMessage: string;
  values?: Record<string, string>;
}

export interface ContactForm {
  readonly questions: ReadonlyArray<NormalizedQuestion>;
  readonly guard: FormGuard | null;
  /** The token + honeypot inputs. Mint per render; never cache a page that has one. */
  guardHtml(): Promise<string>;
  /** The whole form as HTML. */
  render(options?: {
    action?: string;
    values?: Record<string, string>;
    error?: string;
    notice?: string;
    submitLabel?: string;
    className?: string;
    idPrefix?: string;
    /**
     * The page's query (URL, URLSearchParams, string or Next searchParams): sets `notice` for
     * ?sent=1 and `error` from ?error= via errorMessage(), unless given explicitly.
     */
    query?: unknown;
  }): Promise<string>;
  /**
   * The safe message for a plain-form redirect's ?error=<code>&field=&reason=, rebuilt from
   * this form's questions and `responses` (never text from the URL). null when there is none.
   */
  errorMessage(query: unknown): string | null;
  /** The success message when the query has ?sent=1, else null. */
  sentMessage(query: unknown): string | null;
  /** Props for <ContactForm> from '@profullstack/contact-form/react'. */
  props(options?: {
    action?: string;
    submitLabel?: string;
    successMessage?: string;
    /** Starting values for this render (a hidden `ref` from ?ref=, a pre-ticked box). Question names only. */
    values?: Record<string, string | boolean>;
  }): Promise<ContactFormProps>;
  /**
   * The submit handler: JSON in, JSON out. A plain form post gets a 303 back to the page with
   * ?sent=1 or ?error=<code> (&field=&reason= for a validation failure); never free text.
   */
  POST(req: ContactRequest): Promise<Response>;
  /** Same as POST. */
  handle(req: ContactRequest): Promise<Response>;
  /** Fresh props as JSON (no-store), for client-only pages: <ContactForm src="/api/contact" />. */
  GET(): Promise<Response>;
}

export declare function createContactForm(options: ContactFormOptions): ContactForm;

/** The @profullstack/stack/email route API: takes any field, validates `requiredFields`. */
export interface ContactRouteOptions extends ContactDeliveryOptions {
  requiredFields?: string[];
  validateEmail?: boolean;
  fieldLabels?: Record<string, string>;
  skipFields?: string[];
  guard?: FormGuardOptions | FormGuard;
}
export declare function createContactRoute(
  options: ContactRouteOptions,
): (req: ContactRequest) => Promise<Response>;
export declare function createContactGuard(options: FormGuardOptions): FormGuard;

export declare function readBody(
  req: ContactRequest,
): Promise<{ body: Record<string, unknown> | null; html: boolean }>;
export declare function resolveGuard(
  guard: Partial<FormGuardOptions> | FormGuard | false | undefined,
  defaults?: { binding?: string; brandTerms?: string[] },
): FormGuard | null;
export declare function notificationEmail(input: {
  subject: string;
  rows: Array<[string, string]>;
  message?: string;
  verdict?: Verdict | null;
}): { html: string; text: string };
