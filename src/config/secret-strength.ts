import { createHash } from 'node:crypto';

/**
 * Outside development, a secret that signs sessions or links must be long and random (ADR-0095):
 * set, at least 32 characters, not a placeholder or a development default shipped in this
 * repository, not a value this repository once published, and not a short run of repeated
 * characters. The error names the variable and the rule it breaks, never the value.
 */
export const MIN_SECRET_LENGTH = 32;

/** The markers of the example and development values in `.env.example` and the config files. */
const PLACEHOLDER =
  /change[-_ ]?me|placeholder|replace[-_ ]?me|your[-_ ]?secret|example|insecure/i;

/**
 * SHA-256 of the secrets `.env.example` once published (S1): `JWT_ACCESS_SECRET` in e4865ea and
 * `STORAGE_SIGNING_SECRET` in 626d197. Anyone with the history holds them, so either one signs
 * forgeries; compared by fingerprint, so the values never appear here. Whitespace and one pair of
 * surrounding quotes are removed first: a copy pasted with either is as guessable as the original.
 */
export const PUBLISHED_SECRET_SHA256: ReadonlySet<string> = new Set([
  '4b39d8507d0df7827a3fca3b6bd1f00070382abafe911a81d9591dde0e49db8f',
  '289db462b7e403a7964d7f438076b08a24988402d3a741cc2ba1fb9d4bb6510d',
]);

const published = (value: string) =>
  PUBLISHED_SECRET_SHA256.has(
    createHash('sha256')
      .update(
        value
          .trim()
          .replace(/^(['"])([\s\S]*)\1$/, '$2')
          .trim(),
      )
      .digest('hex'),
  );

export function assertStrongSecret(
  name: string,
  value: string | undefined,
): asserts value is string {
  const problem = !value
    ? 'is not set'
    : value.length < MIN_SECRET_LENGTH
      ? `is shorter than ${MIN_SECRET_LENGTH} characters`
      : PLACEHOLDER.test(value)
        ? 'is a placeholder or a development default'
        : published(value)
          ? 'was published in this repository and must be rotated'
          : new Set(value).size < 10
            ? 'is too repetitive to be random'
            : null;
  if (problem) {
    throw new Error(
      `${name} ${problem}. Outside development it must be a long random value, for example the output of \`openssl rand -base64 48\`.`,
    );
  }
}
