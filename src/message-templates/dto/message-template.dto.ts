import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import {
  MessageTemplateStatus,
  MessageTemplateType,
} from '../../generated/prisma/client';

export const MESSAGE_TEMPLATE_TYPES = Object.values(MessageTemplateType);
export const MESSAGE_TEMPLATE_STATUSES = Object.values(MessageTemplateStatus);

export const MAX_TEMPLATE_NAME = 180;
export const MAX_TEMPLATE_CONTENT = 20_000;
export const MAX_TEMPLATE_SEARCH = 120;

/** The list page's own paging; the reference footer opens on "05". */
export const DEFAULT_TEMPLATE_PAGE_SIZE = 5;
export const MAX_TEMPLATE_PAGE_SIZE = 100;

/**
 * Exactly the markup the editor's ten toolbar buttons can produce, and nothing else.
 *
 * The content is authored HTML that is written back into a `contentEditable`, so it is an
 * execution surface: an accepted `<script>` or `onclick` would run for the next
 * administrator who opened the template. The allow-list therefore **rejects** rather than
 * strips — a cleaner rewrites input and can be tricked into rewriting it into something
 * valid, whereas refusing anything unrecognised fails closed and needs no HTML parser to
 * be correct.
 */
const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'p',
  'div',
  'br',
  'span',
  'ol',
  'ul',
  'li',
  'pre',
  'code',
]);

const TAG_NAME = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g;
/** Any `on…=` handler, in any casing, with or without spaces around the equals. */
const EVENT_HANDLER = /\son[a-z]+\s*=/i;
const SCRIPT_URL = /(javascript|data|vbscript)\s*:/i;
const COMMENT_OR_PI = /<!|<\?/;

export function findUnsafeHtml(html: string): string | null {
  if (COMMENT_OR_PI.test(html)) return 'comments and doctypes';
  if (EVENT_HANDLER.test(html)) return 'event handler attributes';
  if (SCRIPT_URL.test(html)) return 'script URLs';

  for (const [, tag] of html.matchAll(TAG_NAME)) {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return `the <${tag}> tag`;
  }
  return null;
}

/** The editor's text, with tags and entities removed — "is anything actually typed?". */
export function templateTextContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, '')
    .trim();
}

@ValidatorConstraint({ name: 'safeTemplateContent', async: false })
class SafeTemplateContent implements ValidatorConstraintInterface {
  private reason: string | null = null;

  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (templateTextContent(value) === '') {
      this.reason = 'Template Content is required.';
      return false;
    }
    const unsafe = findUnsafeHtml(value);
    this.reason = unsafe ? `Template Content cannot contain ${unsafe}.` : null;
    return unsafe === null;
  }

  defaultMessage(): string {
    return this.reason ?? 'Template Content is not valid.';
  }
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** What the list and the form both read; `createdByName` fills the audit trail. */
export interface MessageTemplateRow {
  id: string;
  name: string;
  type: MessageTemplateType;
  content: string;
  status: MessageTemplateStatus;
  /**
   * Always null for now: templates carry no attachments, and the reference's
   * "Attachements" column shows a placeholder in every captured row (ADR-0068).
   */
  attachments: null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplateList {
  rows: MessageTemplateRow[];
  total: number;
}

export class CreateMessageTemplateDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Template Name is required.' })
  @MaxLength(MAX_TEMPLATE_NAME)
  name!: string;

  @IsIn(MESSAGE_TEMPLATE_TYPES, { message: 'Template Type is required.' })
  type!: MessageTemplateType;

  @IsString()
  @MaxLength(MAX_TEMPLATE_CONTENT)
  @Validate(SafeTemplateContent)
  content!: string;

  /**
   * The reference's modal carries a Status switch reading "Status : Active", on by
   * default. On is `ACTIVE`; off is the other state the list draws.
   */
  @IsBoolean()
  isActive!: boolean;
}

/** Every field optional: the modal saves what changed, the service leaves the rest. */
export class UpdateMessageTemplateDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Template Name is required.' })
  @MaxLength(MAX_TEMPLATE_NAME)
  name?: string;

  @IsOptional()
  @IsIn(MESSAGE_TEMPLATE_TYPES, { message: 'Template Type is required.' })
  type?: MessageTemplateType;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEMPLATE_CONTENT)
  @Validate(SafeTemplateContent)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The list query. `page`/`size` mirror the Leads and Activities lists so the shape is the
 * one the frontend already knows; `type` is the reference's own filter, whose "All
 * templates" option simply omits the parameter.
 */
export class ListMessageTemplatesQueryDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEMPLATE_SEARCH)
  search?: string;

  @IsOptional()
  @IsIn(MESSAGE_TEMPLATE_TYPES)
  type?: MessageTemplateType;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TEMPLATE_PAGE_SIZE)
  size?: number;
}
