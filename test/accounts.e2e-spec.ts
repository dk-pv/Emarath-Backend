import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp } from './e2e-app';

const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';
const RECORD = '44444444-4444-4444-8444-444444444444';

type Verb = 'get' | 'post';

/**
 * Contract test for the Accounts routes (ADR-0096). Like every spec here, only what a guard or a
 * pipe decides is exercised — the Prisma driver adapter does not run under the Jest VM (see
 * e2e-app.ts): which role each route admits, and which requests are refused before the service
 * runs. The moves themselves are covered by the service unit tests, and against a real database
 * by the scratch validation.
 */
describe('Accounts routes (e2e)', () => {
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
  ) => {
    const call = request(app.getHttpServer())
      [verb](`/api/accounts/records${path}`)
      .set('Cookie', await cookieFor(role));
    return verb === 'get' ? call : call.send(body);
  };

  /*
    Each route and the roles it admits besides the Super Admin, written out by hand. A malformed
    request tells the two outcomes apart without a query: 403 means the guard refused the role,
    400 means it admitted the role and a pipe then refused the request — before the service.
  */
  const ROUTES: [Verb, string, UserRole[]][] = [
    ['get', '?size=0', [UserRole.ACCOUNTS_EXECUTIVE]],
    ['get', '/summary?status=NOPE', [UserRole.ACCOUNTS_EXECUTIVE]],
    ['get', '/not-a-uuid', [UserRole.ACCOUNTS_EXECUTIVE]],
    ['post', '/not-a-uuid/status', [UserRole.ACCOUNTS_EXECUTIVE]],
    ['post', '/not-a-uuid/correction', []],
  ];

  it.each(
    ROUTES.flatMap(([verb, path, admitted]) =>
      Object.values(UserRole).map(
        (role) =>
          [
            `${verb.toUpperCase()} ${path}`,
            role,
            admitted.includes(role) || role === UserRole.SUPERADMIN ? 400 : 403,
            verb,
            path,
          ] as const,
      ),
    ),
  )('%s as %s → %i', async (_label, role, status, verb, path) => {
    expect((await send(role, verb, path)).status).toBe(status);
  });

  // The filter options take no input, so the guard's answer is all there is to test.
  it.each(
    Object.values(UserRole).filter(
      (role) =>
        role !== UserRole.ACCOUNTS_EXECUTIVE && role !== UserRole.SUPERADMIN,
    ),
  )('refuses %s the filter options → 403', async (role) => {
    expect((await send(role, 'get', '/filter-options')).status).toBe(403);
  });

  it.each([
    {},
    { status: 'PAYMENT_RECEIVED' },
    { expectedStatus: 'INITIAL' },
    { status: 'PAID', expectedStatus: 'INITIAL' },
    { status: 'PAYMENT_RECEIVED', expectedStatus: 'NEW' },
    { status: 'PAYMENT_RECEIVED', expectedStatus: 'INITIAL', amount: '10' },
    { status: 'PAYMENT_RECEIVED', expectedStatus: 'INITIAL', remarks: 7 },
    {
      status: 'PAYMENT_RECEIVED',
      expectedStatus: 'INITIAL',
      remarks: 'x'.repeat(2001),
    },
  ])('refuses the status move %j → 400', async (body) => {
    for (const role of [UserRole.ACCOUNTS_EXECUTIVE, UserRole.SUPERADMIN]) {
      const response = await send(role, 'post', `/${RECORD}/status`, body);
      expect(response.status).toBe(400);
    }
  });

  it.each([
    { status: 'PAYMENT_PENDING', expectedStatus: 'PAYMENT_RECEIVED' },
    {
      status: 'PAYMENT_PENDING',
      expectedStatus: 'PAYMENT_RECEIVED',
      reason: '',
    },
    {
      status: 'PAYMENT_PENDING',
      expectedStatus: 'PAYMENT_RECEIVED',
      reason: '   ',
    },
    {
      status: 'PAYMENT_PENDING',
      expectedStatus: 'PAYMENT_RECEIVED',
      reason: 'x'.repeat(501),
    },
    { status: 'PAYMENT_PENDING', reason: 'Bank reversal' },
    {
      status: 'PAYMENT_PENDING',
      expectedStatus: 'PAYMENT_RECEIVED',
      reason: 'Bank reversal',
      note: 'extra',
    },
  ])(
    'refuses the correction %j → 400 (Q14: a reason is required)',
    async (body) => {
      const response = await send(
        UserRole.SUPERADMIN,
        'post',
        `/${RECORD}/correction`,
        body,
      );
      expect(response.status).toBe(400);
    },
  );

  it.each([
    '?sort=order_id',
    '?sort=id;DROP',
    '?direction=up',
    '?size=201',
    '?page=0',
    '?paymentMethod=' + 'x'.repeat(65),
    '?search=' + 'x'.repeat(201),
  ])('refuses the list query %s → 400', async (query) => {
    expect((await send(UserRole.ACCOUNTS_EXECUTIVE, 'get', query)).status).toBe(
      400,
    );
  });
});
