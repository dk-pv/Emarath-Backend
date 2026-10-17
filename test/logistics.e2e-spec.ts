import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp } from './e2e-app';

const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';
const ORDER = '33333333-3333-4333-8333-333333333333';

type Verb = 'post' | 'patch';

/**
 * Contract test for the Logistics write routes, against the client clarification of 2026-10-01.
 *
 * Like every spec here, only what a guard or a pipe decides is exercised — the Prisma driver
 * adapter does not run under the Jest VM (see e2e-app.ts). That is this layer's job: which role
 * each route admits, and which bodies are refused before the service runs. The moves themselves
 * are covered by the service unit tests.
 */
describe('Logistics write routes (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const cookieFor = async (role: UserRole): Promise<string> => {
    const token = await app
      .get(JwtService)
      .signAsync({ sub: E2E_USER_ID, role, team: 'Sales' });
    return `access_token=${token}`;
  };

  const send = async (
    role: UserRole,
    verb: Verb,
    path: string,
    body: object = {},
  ) =>
    request(app.getHttpServer())
      [verb](`/api/logistics/orders/${path}`)
      .set('Cookie', await cookieFor(role))
      .send(body);

  /** Each route and the roles it admits, written out by hand from the clarification. */
  const ROUTES: [Verb, string, UserRole[]][] = [
    ['post', 'qc-verify', [UserRole.QC]],
    ['post', 'qc-reject', [UserRole.QC]],
    ['post', 'resubmit', [UserRole.SALES_MANAGER]],
    [
      'post',
      'dispatch',
      [UserRole.LOGISTICS_MANAGER, UserRole.LOGISTICS_EXECUTIVE],
    ],
    [
      'post',
      'deliver',
      [UserRole.LOGISTICS_MANAGER, UserRole.LOGISTICS_EXECUTIVE],
    ],
    [
      'post',
      'cancel',
      [UserRole.LOGISTICS_MANAGER, UserRole.LOGISTICS_EXECUTIVE],
    ],
    ['post', 'rto', [UserRole.LOGISTICS_MANAGER]],
    ['patch', '', [UserRole.LOGISTICS_MANAGER]],
    ['patch', 'awb', [UserRole.LOGISTICS_MANAGER]],
    ['patch', 'delivery-date', [UserRole.SALES_AGENT, UserRole.SALES_MANAGER]],
    [
      'patch',
      'delivery-date-correction',
      [UserRole.LOGISTICS_MANAGER, UserRole.LOGISTICS_EXECUTIVE],
    ],
  ];

  /*
    Guards run before pipes, so a malformed order id tells the two apart for every role: 403
    means the guard refused the role, 400 means it admitted the role and the pipe then refused
    the id — before the service, so no query ever ran.
  */
  it.each(
    ROUTES.flatMap(([verb, action, admitted]) =>
      Object.values(UserRole).map(
        (role) =>
          [
            `${verb.toUpperCase()} ${action || '(edit)'}`,
            role,
            admitted.includes(role) || role === UserRole.SUPERADMIN ? 400 : 403,
            verb,
            action,
          ] as const,
      ),
    ),
  )('%s as %s → %i', async (_label, role, status, verb, action) => {
    const path = action ? `not-a-uuid/${action}` : 'not-a-uuid';
    expect((await send(role, verb, path)).status).toBe(status);
  });

  /*
    Q11 (confirmed): QC is responsible only for verification, so it holds no sales access at
    all. Every lead route — reads and writes — and the other sales modules refuse it at the
    guard, before any pipe or query runs.
  */
  it.each([
    ['get', '/api/leads'],
    ['get', `/api/leads/${ORDER}`],
    ['post', '/api/leads'],
    ['put', `/api/leads/${ORDER}`],
    ['post', `/api/leads/${ORDER}/status`],
    ['post', `/api/leads/${ORDER}/pipeline`],
    ['delete', `/api/leads/${ORDER}`],
    ['get', '/api/leads/board'],
    ['patch', `/api/leads/${ORDER}/stage`],
    ['post', '/api/leads/bulk/reassign'],
    ['post', '/api/leads/bulk/delete'],
    ['post', '/api/leads/import'],
    ['get', '/api/leads/export'],
    ['get', '/api/activities'],
    ['get', '/api/dashboard/kpis'],
  ] as const)('QC is refused %s %s → 403', async (verb, path) => {
    const response = await request(app.getHttpServer())
      [verb](path)
      .set('Cookie', await cookieFor(UserRole.QC))
      .send({});
    expect(response.status).toBe(403);
  });

  it.each([{}, { remarks: '' }, { remarks: '   ' }])(
    'QC cannot reject without a reason: %j → 400 (Q4)',
    async (body) => {
      const response = await send(
        UserRole.QC,
        'post',
        `${ORDER}/qc-reject`,
        body,
      );
      expect(response.status).toBe(400);
    },
  );

  it.each([
    [UserRole.LOGISTICS_EXECUTIVE, 'cancel'],
    [UserRole.LOGISTICS_MANAGER, 'cancel'],
    [UserRole.LOGISTICS_MANAGER, 'rto'],
  ] as const)(
    '%s cannot %s without a reason → 400 (Q7, Q8)',
    async (role, action) => {
      for (const body of [{}, { reason: '  ' }]) {
        const response = await send(role, 'post', `${ORDER}/${action}`, body);
        expect(response.status).toBe(400);
      }
    },
  );

  it('refuses a dispatch with no AWB → 400', async () => {
    const response = await send(
      UserRole.LOGISTICS_EXECUTIVE,
      'post',
      `${ORDER}/dispatch`,
      {},
    );
    expect(response.status).toBe(400);
  });

  /*
    Phase 2D: the Sales date is a calendar day. Anything else — no key at all, null or blank (a
    clear: every order must have a date, client 2026-10-17), a day that does not exist, another
    format, an instant, a number, a year out of range, or a field the route does not take — is
    refused by the pipe, before the service or a query runs.
  */
  it.each([
    {},
    { deliveryDate: null },
    { deliveryDate: '' },
    { deliveryDate: '   ' },
    { deliveryDate: '2026-02-30' },
    { deliveryDate: '15-10-2026' },
    { deliveryDate: '2026-10-15T00:00:00.000Z' },
    { deliveryDate: 20261015 },
    { deliveryDate: '1999-12-31' },
    { deliveryDate: '2026-10-20', status: 'QC_VERIFIED' },
  ])('refuses the Sales delivery date %j → 400', async (body) => {
    for (const role of [UserRole.SALES_AGENT, UserRole.SALES_MANAGER]) {
      const response = await send(
        role,
        'patch',
        `${ORDER}/delivery-date`,
        body,
      );
      expect(response.status).toBe(400);
    }
  });

  /*
    The Logistics date correction (client, 2026-10-17): a real day and a reason, both required —
    no key, a cleared or malformed date, a blank reason or a field the route does not take is
    refused by the pipe, before the service or a query runs.
  */
  it.each([
    {},
    { deliveryDate: '2026-10-20' },
    { deliveryDate: '2026-10-20', reason: '   ' },
    { deliveryDate: null, reason: 'Moved' },
    { deliveryDate: '', reason: 'Moved' },
    { deliveryDate: '2026-02-30', reason: 'Moved' },
    { deliveryDate: '20-10-2026', reason: 'Moved' },
    { deliveryDate: '2026-10-20', reason: 'x'.repeat(501) },
    { deliveryDate: '2026-10-20', reason: 'Moved', status: 'DELIVERED' },
  ])('refuses the Logistics date correction %j → 400', async (body) => {
    for (const role of [
      UserRole.LOGISTICS_MANAGER,
      UserRole.LOGISTICS_EXECUTIVE,
    ]) {
      const response = await send(
        role,
        'patch',
        `${ORDER}/delivery-date-correction`,
        body,
      );
      expect(response.status).toBe(400);
    }
  });

  it('refuses a blank corrected AWB → 400', async () => {
    const response = await send(
      UserRole.LOGISTICS_MANAGER,
      'patch',
      `${ORDER}/awb`,
      { awbNumber: ' ' },
    );
    expect(response.status).toBe(400);
  });

  const read = async (role: UserRole, path: string) =>
    request(app.getHttpServer())
      .get(`/api/logistics/orders${path}`)
      .set('Cookie', await cookieFor(role));

  /*
    The counts route sits beside `:id`. A search one character over the limit tells them apart
    without a query: only the counts route's DTO answers with the search rule, where `:id`
    would refuse "summary" as an id. Every role is a reader — Accounts too, its order scope
    narrowing it to Delivered orders.
  */
  it.each(Object.values(UserRole))(
    'GET /summary as %s reaches the counts route, not :id',
    async (role) => {
      const response = await read(role, `/summary?search=${'a'.repeat(201)}`);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(
        'search must be at most 200 characters',
      );
    },
  );

  /*
    The delivery schedule sits beside `:id` too, and is told apart the same way. Every role is
    admitted.
  */
  it.each(Object.values(UserRole))(
    'GET /delivery-schedule as %s reaches the schedule route, not :id',
    async (role) => {
      const response = await read(
        role,
        `/delivery-schedule?search=${'a'.repeat(201)}`,
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(
        'search must be at most 200 characters',
      );
    },
  );

  /*
    The list, its counts and the delivery schedule read the same filters through the same rules,
    so a value one of them refuses, the others refuse too — before any query runs.
  */
  it.each([
    [
      'a status outside the lifecycle',
      '?status=DISPATCHED&status=SHIPPED',
      'each status must be one of',
    ],
    [
      'a country longer than its column',
      `?country=${'a'.repeat(65)}`,
      'each country must be at most 64 characters',
    ],
    [
      'a city longer than its column',
      `?city=${'a'.repeat(121)}`,
      'each city must be at most 120 characters',
    ],
    [
      'a state longer than its column',
      `?state=${'a'.repeat(121)}`,
      'each state must be at most 120 characters',
    ],
    [
      'a delivery partner longer than its column',
      `?courier=${'a'.repeat(65)}`,
      'each courier must be at most 64 characters',
    ],
    [
      'a sales executive that is not a user id',
      '?assignedAgent=not-a-uuid',
      'each assignedAgent must be a user id',
    ],
    [
      'a delivery bucket that does not exist',
      '?delivery=today&delivery=someday',
      'each delivery must be one of',
    ],
    [
      'more than 100 cities',
      `?${Array.from({ length: 101 }, (_, i) => `city=c${i}`).join('&')}`,
      'city accepts at most 100 values',
    ],
    [
      'a delivery day that is not a calendar day',
      '?deliveryOn=2026-02-30',
      'deliveryOn must be a real date written YYYY-MM-DD',
    ],
    [
      'two delivery days',
      '?deliveryOn=2026-10-15&deliveryOn=2026-10-16',
      'deliveryOn must be a real date written YYYY-MM-DD',
    ],
  ])(
    'refuses %s on the list, the counts and the schedule → 400',
    async (_label, query, rule) => {
      for (const path of [
        query,
        `/summary${query}`,
        `/delivery-schedule${query}`,
      ]) {
        const response = await read(UserRole.LOGISTICS_EXECUTIVE, path);
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(rule);
      }
    },
  );

  it.each(['awbNumber', 'id;DROP', 'convertedAt desc'])(
    'refuses sorting the list by %j → 400',
    async (sort) => {
      const response = await read(
        UserRole.LOGISTICS_MANAGER,
        `?sort=${encodeURIComponent(sort)}`,
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('sort must be one of');
    },
  );

  it('refuses an edit that blanks the customer name, sends a field the order does not have, a value its column cannot hold, or a delivery date that is not a calendar day or is cleared', async () => {
    for (const body of [
      { customerName: ' ' },
      { status: 'DELIVERED' },
      { awbNumber: 'AWB-9' },
      { orderValue: '250.555' },
      { deliveryDate: '2026-02-30' },
      { deliveryDate: '15-10-2026' },
      { deliveryDate: '2026-10-15T00:00:00.000Z' },
      { deliveryDate: null },
      { deliveryDate: '' },
      { deliveryDate: '  ' },
    ]) {
      const response = await send(
        UserRole.LOGISTICS_MANAGER,
        'patch',
        ORDER,
        body,
      );
      expect(response.status).toBe(400);
    }
  });
});
