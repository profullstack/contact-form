import type { ReactElement } from 'react';
import type { ContactFormProps } from './index.js';

export interface ContactFormComponentProps extends Partial<ContactFormProps> {
  /** A GET route returning ContactFormProps (contact.GET), for pages with no server component. */
  src?: string;
  className?: string;
  hpClass?: string;
  idPrefix?: string;
  onSent?(body: Record<string, string>, response: unknown): void;
}

export declare function ContactForm(props: ContactFormComponentProps): ReactElement;
export default ContactForm;
