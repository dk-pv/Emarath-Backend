import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for Tag Permissions (ADR-0091).
 *
 * Only guards and pipes are exercised — both reject before the service touches the database,
 * so they run under the Jest VM where the Prisma driver adapter does not (see STATUS.md).
 * What the permission rules decide (who may select or create which tag) is proven by the
 * service specs and by the live HTTP run, not here. What this file pins is the part a service
 * spec cannot: that the admin routes are closed to every non-admin role at the edge, so a
 * user cannot change anyone's permissions — their own included — and that the one route
 * sales users can reach still validates its input.
 */
describe('Tag Permissions (e2e)', () => {
  const uuid = '11111111-1111-1111-1111-111111111111';
  const body = {
    team: 'Sales',
    canCreate: true,
    tagAccess: 'LISTED',
    tagIds: [uuid],
  };

  describe.each([
    UserRole.SALES_AGENT,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])('as a %s', (role) => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(role));
    });

    afterAll(async () => {
      await app.close();
    });

    it('cannot read the permission matrix', async () => {
      await api.get('/api/tag-access').expect(403);
    });

    it('cannot set a team’s permissions', async () => {
      await api.put('/api/tag-access/teams').send(body).expect(403);
    });

    it('cannot reset a team’s permissions', async () => {
      await api.delete('/api/tag-access/teams?team=Sales').expect(403);
    });

    it('cannot set a user’s override — not even their own', async () => {
      await api
        .put(`/api/tag-access/users/${uuid}`)
        .send({ canCreate: true })
        .expect(403);
    });

    it('cannot reset a user’s override', async () => {
      await api.delete(`/api/tag-access/users/${uuid}`).expect(403);
    });

    it('is refused at the role gate before a malformed body is even looked at', async () => {
      await api.put('/api/tag-access/teams').send({}).expect(403);
    });
  });

  describe('as a QC user (a post-sale role)', () => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(UserRole.QC));
    });

    afterAll(async () => {
      await app.close();
    });

    it('has no tag permissions of its own to read', async () => {
      await api.get('/api/tag-access/me').expect(403);
    });

    it('cannot create a tag', async () => {
      await api.post('/api/tags').send({ name: 'NOPE' }).expect(403);
    });
  });

  describe('as an administrator', () => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(UserRole.SUPERADMIN));
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects a team policy with no team', async () => {
      await api
        .put('/api/tag-access/teams')
        .send({ ...body, team: '   ' })
        .expect(400);
    });

    it('rejects a team policy with an unknown tag mode', async () => {
      await api
        .put('/api/tag-access/teams')
        .send({ ...body, tagAccess: 'SOME' })
        .expect(400);
    });

    it('rejects a team policy with a non-boolean canCreate', async () => {
      await api
        .put('/api/tag-access/teams')
        .send({ ...body, canCreate: 'yes' })
        .expect(400);
    });

    it('rejects a team policy naming a tag that is not a uuid', async () => {
      await api
        .put('/api/tag-access/teams')
        .send({ ...body, tagIds: ['nope'] })
        .expect(400);
    });

    it('rejects a team policy listing the same tag twice', async () => {
      await api
        .put('/api/tag-access/teams')
        .send({ ...body, tagIds: [uuid, uuid] })
        .expect(400);
    });

    it('rejects a team policy with an unknown field', async () => {
      await api
        .put('/api/tag-access/teams')
        .send({ ...body, role: 'SUPERADMIN' })
        .expect(400);
    });

    it('rejects a team reset with no team', async () => {
      await api.delete('/api/tag-access/teams').expect(400);
    });

    it('rejects a user override for a non-uuid user id', async () => {
      await api
        .put('/api/tag-access/users/not-a-uuid')
        .send({ canCreate: true })
        .expect(400);
    });

    it('rejects a user override with an unknown tag mode', async () => {
      await api
        .put(`/api/tag-access/users/${uuid}`)
        .send({ tagAccess: 'EVERYTHING' })
        .expect(400);
    });

    it('rejects a user reset for a non-uuid user id', async () => {
      await api.delete('/api/tag-access/users/not-a-uuid').expect(400);
    });
  });

  describe('creating a tag, as a sales user', () => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(UserRole.SALES_AGENT));
    });

    afterAll(async () => {
      await app.close();
    });

    it('passes the role gate — the permission is decided by the service — and still validates the name', async () => {
      // A 400 from the DTO, not a 403 from the gate: the route is open to sales roles, and
      // TagsService.create is what refuses a user the Admin has not allowed.
      await api.post('/api/tags').send({}).expect(400);
    });

    it('still cannot manage the catalogue: rename, retire or list it', async () => {
      await api.get('/api/tags').expect(403);
      await api.patch(`/api/tags/${uuid}`).send({ name: 'X' }).expect(403);
      await api.delete(`/api/tags/${uuid}`).expect(403);
    });
  });
});
