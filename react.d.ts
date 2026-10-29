import type { ReactElement, ReactNode } from 'react';
import type { ContactFormProps } from './index.js';

export interface ContactFormComponentProps extends Partial<ContactFormProps> {
  /** A GET route returning ContactFormProps (contact.GET), for pages with no server component. */
  src?: string;
  className?: string;
  hpClass?: string;
  idPrefix?: string;
  /** Starting values set by the page; win over props({ values }) and question defaults. */
  defaultValues?: Record<string, string>;
  /** Shown under the success message (links, a mailto, next steps). */
  children?: ReactNode;
  /** A button under the success message that brings the form back ("Send another"). */
  resetLabel?: string;
  /** Called with the body before sending (analytics); return false to cancel. */
  onSubmit?(body: Record<string, string>): boolean | undefined;
  /** Called with the message shown when sending fails. */
  onError?(message: string, response: unknown): void;
  onSent?(body: Record<string, string>, response: unknown): void;
}

export declare function ContactForm(props: ContactFormComponentProps): ReactElement;
export default ContactForm;
