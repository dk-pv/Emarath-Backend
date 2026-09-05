import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MessageTemplateStatus,
  MessageTemplateType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessageTemplatesService } from './message-templates.service';
import {
  CreateMessageTemplateDto,
  DEFAULT_TEMPLATE_PAGE_SIZE,
  findUnsafeHtml,
  ListMessageTemplatesQueryDto,
  templateTextContent,
  UpdateMessageTemplateDto,
} from './dto/message-template.dto';

const ACTOR = '11111111-1111-1111-1111-111111111111';
const ID = '22222222-2222-2222-2222-222222222222';

const stored = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'testing',
  type: MessageTemplateType.WHATSAPP,
  content: '<p>hello</p>',
  status: MessageTemplateStatus.ACTIVE,
  createdAt: new Date('2026-09-05T10:00:00.000Z'),
  updatedAt: new Date('2026-09-05T10:00:00.000Z'),
  createdBy: { name: 'Emarath Admin' },
  ...over,
});

/** Mocks held as locals, so no assertion references an unbound class method. */
function makeService() {
  const findMany = jest.fn().mockResolvedValue([stored()]);
  const count = jest.fn().mockResolvedValue(1);
  const create = jest.fn().mockResolvedValue(stored());
  const update = jest.fn().mockResolvedValue(stored());
  const findFirst = jest.fn().mockResolvedValue({ id: ID });

  const prisma = {
    messageTemplate: { findMany, count, create, update, findFirst },
  } as unknown as PrismaService;

  return {
    service: new MessageTemplatesService(prisma),
    findMany,
    count,
    create,
    update,
    findFirst,
  };
}

const listArgs = (findMany: jest.Mock) =>
  (
    findMany.mock.calls[0] as [
      {
        where: Record<string, unknown>;
        skip: number;
        take: number;
        orderBy: unknown;
      },
    ]
  )[0];

describe('MessageTemplatesService — list', () => {
  const query = (
    over: Partial<ListMessageTemplatesQueryDto> = {},
  ): ListMessageTemplatesQueryDto => ({ ...over });

  it('returns the page and the total, shaped as the other lists are', async () => {
    const { service } = makeService();

    await expect(service.list(query())).resolves.toEqual({
      rows: [
        {
          id: ID,
          name: 'testing',
          type: 'WHATSAPP',
          content: '<p>hello</p>',
          status: 'ACTIVE',
          attachments: null,
          createdByName: 'Emarath Admin',
          createdAt: '2026-09-05T10:00:00.000Z',
          updatedAt: '2026-09-05T10:00:00.000Z',
        },
      ],
      total: 1,
    });
  });

  it('never returns soft-deleted rows', async () => {
    const { service, findMany } = makeService();

    await service.list(query());

    expect(listArgs(findMany).where).toMatchObject({ deletedAt: null });
  });

  it('opens on the reference page size', async () => {
    const { service, findMany } = makeService();

    await service.list(query());

    expect(listArgs(findMany).take).toBe(DEFAULT_TEMPLATE_PAGE_SIZE);
    expect(listArgs(findMany).skip).toBe(0);
  });

  it('pages in the query, not in the client', async () => {
    const { service, findMany } = makeService();

    await service.list(query({ page: 3, size: 10 }));

    expect(listArgs(findMany).skip).toBe(20);
    expect(listArgs(findMany).take).toBe(10);
  });

  it('filters by type when one is chosen, and by none when it is not', async () => {
    const withType = makeService();
    await withType.service.list(query({ type: MessageTemplateType.EMAIL }));
    expect(listArgs(withType.findMany).where).toMatchObject({ type: 'EMAIL' });

    const withoutType = makeService();
    await withoutType.service.list(query());
    expect(listArgs(withoutType.findMany).where).not.toHaveProperty('type');
  });

  it('searches the template name, case-insensitively, in the query', async () => {
    const { service, findMany } = makeService();

    await service.list(query({ search: 'disp' }));

    expect(listArgs(findMany).where).toMatchObject({
      name: { contains: 'disp', mode: 'insensitive' },
    });
  });

  it('combines search and type filter into one query', async () => {
    const { service, findMany } = makeService();

    await service.list(
      query({ search: 'test', type: MessageTemplateType.WHATSAPP }),
    );

    expect(listArgs(findMany).where).toMatchObject({
      deletedAt: null,
      type: 'WHATSAPP',
      name: { contains: 'test', mode: 'insensitive' },
    });
  });

  it('counts against the same predicate it lists with', async () => {
    const { service, findMany, count } = makeService();

    await service.list(query({ search: 'test' }));

    const counted = (count.mock.calls[0] as [{ where: unknown }])[0].where;
    expect(counted).toEqual(listArgs(findMany).where);
  });
});

describe('MessageTemplatesService — create, update, delete', () => {
  it('stamps the author from the session', async () => {
    const { service, create } = makeService();

    await service.create(
      {
        name: 'testing',
        type: MessageTemplateType.WHATSAPP,
        content: '<p>hello</p>',
        isActive: true,
      },
      ACTOR,
    );

    const args = (
      create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0];
    expect(args.data.createdById).toBe(ACTOR);
  });

  it('maps the status switch onto the enum the list draws', async () => {
    const on = makeService();
    await on.service.create(
      {
        name: 'a',
        type: MessageTemplateType.EMAIL,
        content: '<p>a</p>',
        isActive: true,
      },
      ACTOR,
    );
    expect(
      (on.create.mock.calls[0] as [{ data: { status: string } }])[0].data
        .status,
    ).toBe('ACTIVE');

    const off = makeService();
    await off.service.create(
      {
        name: 'a',
        type: MessageTemplateType.EMAIL,
        content: '<p>a</p>',
        isActive: false,
      },
      ACTOR,
    );
    expect(
      (off.create.mock.calls[0] as [{ data: { status: string } }])[0].data
        .status,
    ).toBe('VERIFICATION_PENDING');
  });

  it('edits the row in place rather than creating a second one', async () => {
    const { service, update, create } = makeService();

    await service.update(ID, { name: 'renamed' });

    expect(create).not.toHaveBeenCalled();
    const args = (
      update.mock.calls[0] as [
        { where: { id: string }; data: Record<string, unknown> },
      ]
    )[0];
    expect(args.where.id).toBe(ID);
    expect(args.data).toEqual({ name: 'renamed' });
  });

  it('writes only the fields the modal sent', async () => {
    const { service, update } = makeService();

    await service.update(ID, { isActive: false });

    const args = (
      update.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0];
    expect(args.data).toEqual({ status: 'VERIFICATION_PENDING' });
  });

  it('refuses to update a template that is gone', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue(null);

    await expect(service.update(ID, { name: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('deletes softly, leaving the record in place', async () => {
    const { service, update } = makeService();

    await expect(service.remove(ID)).resolves.toEqual({ id: ID });

    const args = (update.mock.calls[0] as [{ data: { deletedAt: Date } }])[0];
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('refuses to delete a template that is already gone', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue(null);

    await expect(service.remove(ID)).rejects.toThrow(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('template content safety', () => {
  it('accepts everything the editor toolbar can produce', () => {
    const editorOutput =
      '<div><b>bold</b> <i>i</i> <u>u</u> <s>s</s>' +
      '<ol><li>one</li></ol><ul><li>two</li></ul>' +
      '<pre><code>x</code></pre>' +
      '<div style="text-align:center">centred</div></div>';
    expect(findUnsafeHtml(editorOutput)).toBeNull();
  });

  it('rejects a script tag', () => {
    expect(findUnsafeHtml('<p>hi</p><script>alert(1)</script>')).toContain(
      'script',
    );
  });

  it('rejects an event handler on an allowed tag', () => {
    expect(findUnsafeHtml('<b onclick="alert(1)">hi</b>')).toContain(
      'event handler',
    );
    // Casing and spacing must not slip past it.
    expect(findUnsafeHtml('<b ONMOUSEOVER = "x">hi</b>')).not.toBeNull();
  });

  it('rejects script, data and vbscript URLs', () => {
    expect(findUnsafeHtml('<p>javascript:alert(1)</p>')).toContain(
      'script URLs',
    );
    expect(findUnsafeHtml('<p>data:text/html;base64,x</p>')).not.toBeNull();
  });

  it('rejects tags the toolbar cannot produce', () => {
    for (const bad of [
      '<img src=x>',
      '<a href="/x">x</a>',
      '<iframe></iframe>',
      '<style>x</style>',
      '<svg></svg>',
      '<object></object>',
    ]) {
      expect(findUnsafeHtml(bad)).not.toBeNull();
    }
  });

  it('rejects comments and doctypes, which can smuggle a parse switch', () => {
    expect(findUnsafeHtml('<!-- <script> -->')).not.toBeNull();
    expect(findUnsafeHtml('<!DOCTYPE html>')).not.toBeNull();
  });

  it('sees through empty markup when asking whether anything was typed', () => {
    expect(templateTextContent('<p><br></p>')).toBe('');
    expect(templateTextContent('<div>&nbsp;</div>')).toBe('');
    expect(templateTextContent('<p>  hello  </p>')).toBe('hello');
  });
});

describe('CreateMessageTemplateDto validation', () => {
  const messages = async (
    over: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const dto = plainToInstance(CreateMessageTemplateDto, {
      name: 'testing',
      type: 'WHATSAPP',
      content: '<p>hello</p>',
      isActive: true,
      ...over,
    });
    const errors = await validate(dto);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts a complete template', async () => {
    expect(await messages()).toEqual([]);
  });

  it('requires the three starred fields', async () => {
    expect((await messages({ name: '' })).length).toBeGreaterThan(0);
    expect((await messages({ name: '   ' })).length).toBeGreaterThan(0);
    expect((await messages({ type: undefined })).length).toBeGreaterThan(0);
    expect((await messages({ content: '' })).length).toBeGreaterThan(0);
  });

  it('treats markup with no text as empty content', async () => {
    expect((await messages({ content: '<p><br></p>' })).length).toBeGreaterThan(
      0,
    );
  });

  it('accepts only the two types the dropdown offers', async () => {
    expect(await messages({ type: 'EMAIL' })).toEqual([]);
    expect(await messages({ type: 'WHATSAPP' })).toEqual([]);
    expect((await messages({ type: 'TEXT' })).length).toBeGreaterThan(0);
  });

  it('trims the template name', () => {
    const dto = plainToInstance(CreateMessageTemplateDto, {
      name: '  testing  ',
      type: 'EMAIL',
      content: '<p>x</p>',
      isActive: true,
    });
    expect(dto.name).toBe('testing');
  });

  it('rejects unsafe content', async () => {
    const errors = await messages({ content: '<script>alert(1)</script>' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('script');
  });

  it('bounds the field lengths', async () => {
    expect((await messages({ name: 'x'.repeat(181) })).length).toBeGreaterThan(
      0,
    );
    expect(
      (await messages({ content: `<p>${'x'.repeat(20_001)}</p>` })).length,
    ).toBeGreaterThan(0);
  });
});

describe('UpdateMessageTemplateDto validation', () => {
  const messages = async (raw: Record<string, unknown>): Promise<string[]> => {
    const dto = plainToInstance(UpdateMessageTemplateDto, raw);
    const errors = await validate(dto);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts a partial edit', async () => {
    expect(await messages({ name: 'renamed' })).toEqual([]);
    expect(await messages({ isActive: false })).toEqual([]);
    expect(await messages({})).toEqual([]);
  });

  it('applies the same rules as create to whatever it does send', async () => {
    expect((await messages({ name: '   ' })).length).toBeGreaterThan(0);
    expect((await messages({ type: 'TEXT' })).length).toBeGreaterThan(0);
    expect(
      (await messages({ content: '<script>x</script>' })).length,
    ).toBeGreaterThan(0);
  });
});

describe('ListMessageTemplatesQueryDto validation', () => {
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(ListMessageTemplatesQueryDto, raw);

  it('coerces the numeric query parameters', () => {
    const dto = parse({ page: '2', size: '10' });
    expect(dto.page).toBe(2);
    expect(dto.size).toBe(10);
  });

  it('treats an empty search as no search', () => {
    expect(parse({ search: '   ' }).search).toBeUndefined();
  });

  it('caps the page size', async () => {
    const errors = await validate(parse({ size: '1000' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a type outside the two the filter offers', async () => {
    expect((await validate(parse({ type: 'TEXT' }))).length).toBeGreaterThan(0);
    expect((await validate(parse({ type: 'EMAIL' }))).length).toBe(0);
  });
});
