import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_LENGTH = 12;
const ALGORITHM = 'aes-256-gcm';

export class DecryptionError extends Error {}

export function parseEncryptionKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptToken(payload: string, key: Buffer): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(':');
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new DecryptionError('unsupported encrypted token format');
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivPart, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new DecryptionError((error as Error).message);
  }
}
