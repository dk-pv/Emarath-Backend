import { BadRequestException } from '@nestjs/common';
import {
  assertUploadAllowed,
  buildObjectKey,
  extensionOf,
} from './storage-policy';

const POLICY = { allowedExtensions: ['png', 'pdf'], maxBytes: 1024 };

describe('extensionOf', () => {
  it('returns the lower-case extension without the dot', () => {
    expect(extensionOf('Photo.PNG')).toBe('png');
    expect(extensionOf('a/b/report.pdf')).toBe('pdf');
  });
  it('returns empty when there is no extension', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.env')).toBe('');
  });
});

describe('assertUploadAllowed (FND-05.2 AC3)', () => {
  it('accepts an allowed type within the size limit', () => {
    expect(() =>
      assertUploadAllowed(
        { originalFileName: 'a.png', sizeBytes: 500 },
        POLICY,
      ),
    ).not.toThrow();
  });

  it('rejects an empty file', () => {
    expect(() =>
      assertUploadAllowed({ originalFileName: 'a.png', sizeBytes: 0 }, POLICY),
    ).toThrow(BadRequestException);
  });

  it('rejects an oversized file', () => {
    expect(() =>
      assertUploadAllowed(
        { originalFileName: 'a.png', sizeBytes: 2048 },
        POLICY,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a disallowed type', () => {
    expect(() =>
      assertUploadAllowed({ originalFileName: 'a.exe', sizeBytes: 10 }, POLICY),
    ).toThrow(BadRequestException);
  });

  it('rejects a file with no extension', () => {
    expect(() =>
      assertUploadAllowed({ originalFileName: 'noext', sizeBytes: 10 }, POLICY),
    ).toThrow(BadRequestException);
  });
});

describe('buildObjectKey', () => {
  it('builds <prefix>/<uuid>/<name> and is unique per call', () => {
    const a = buildObjectKey('Report.pdf', 'documents');
    const b = buildObjectKey('Report.pdf', 'documents');
    expect(a).toMatch(/^documents\/[0-9a-f-]{36}\/Report\.pdf$/);
    expect(a).not.toBe(b); // random segment guarantees no collision
  });

  it('sanitises the name and strips any client path (no traversal)', () => {
    const key = buildObjectKey('../../etc/pa ss?wd.png');
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\/pa_ss_wd\.png$/);
    expect(key).not.toContain('..');
  });

  it('falls back to a default prefix when given a junk prefix', () => {
    expect(buildObjectKey('a.png', '///')).toMatch(/^uploads\//);
  });
});
