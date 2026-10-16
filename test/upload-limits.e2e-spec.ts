import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Uploads over their limit are refused with a 413 while they stream in, before the file is
 * buffered or any service sees it (ADR-0095). A file under the limit still reaches the service:
 * these send a type the service refuses itself (400), which stores nothing and needs no database.
 */
const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('upload size limits', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    // A 1 KB storage limit, so the document test sends kilobytes rather than 25 MB. The storage
    // config is read when the app is compiled, so it sees this.
    process.env.STORAGE_MAX_BYTES = '1024';
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    delete process.env.STORAGE_MAX_BYTES;
    await app.close();
  });

  it('refuses a document over the storage limit with 413', async () => {
    await api
      .post('/api/documents')
      .field('title', 'Too big')
      .attach('file', Buffer.alloc(2048, 'a'), 'big.txt')
      .expect(413);
  });

  it('lets a document within the limit through to the service', async () => {
    const response = await api
      .post('/api/documents')
      .field('title', 'Small')
      .attach('file', Buffer.alloc(100, 'a'), 'small.exe');
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/is not allowed/);
  });

  it('refuses a profile picture over 5 MB with 413', async () => {
    await api
      .post(`/api/users/${USER_ID}/avatar`)
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'face.png')
      .expect(413);
  });

  it('lets a profile picture within 5 MB through to the service', async () => {
    const response = await api
      .post(`/api/users/${USER_ID}/avatar`)
      .attach('file', Buffer.alloc(100), 'face.gif');
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/PNG or JPG/);
  });
});
