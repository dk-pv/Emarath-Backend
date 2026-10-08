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

  it('refuses a blank corrected AWB → 400', async () => {
    const response = await send(
      UserRole.LOGISTICS_MANAGER,
      'patch',
      `${ORDER}/awb`,
      { awbNumber: ' ' },
    );
    expect(response.status).toBe(400);
  });

  it('refuses an edit that blanks the customer name, sends a field the order does not have, or a value its column cannot hold', async () => {
    for (const body of [
      { customerName: ' ' },
      { status: 'DELIVERED' },
      { awbNumber: 'AWB-9' },
      { orderValue: '250.555' },
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
