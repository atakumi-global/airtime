import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DecryptionError,
  decryptToken,
  encryptToken,
  parseEncryptionKey,
} from '../src/crypto/tokens.js';

const KEY = parseEncryptionKey('0'.repeat(64));
const OTHER_KEY = parseEncryptionKey('1'.repeat(64));

test('a token round-trips through encrypt and decrypt', () => {
  const payload = encryptToken('plane_api_example', KEY);
  assert.equal(decryptToken(payload, KEY), 'plane_api_example');
});

test('the authentication tag is 16 bytes', () => {
  const [, , tag] = encryptToken('plane_api_example', KEY).split(':');
  assert.equal(Buffer.from(tag!, 'base64').length, 16);
});

test('a truncated authentication tag is rejected', () => {
  const [version, iv, tag, data] = encryptToken('plane_api_example', KEY).split(':');
  const shortTag = Buffer.from(tag!, 'base64').subarray(0, 4).toString('base64');
  assert.throws(
    () => decryptToken([version, iv, shortTag, data].join(':'), KEY),
    DecryptionError,
  );
});

test('a tampered ciphertext is rejected', () => {
  const [version, iv, tag, data] = encryptToken('plane_api_example', KEY).split(':');
  const bytes = Buffer.from(data!, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  assert.throws(
    () => decryptToken([version, iv, tag, bytes.toString('base64')].join(':'), KEY),
    DecryptionError,
  );
});

test('the wrong key is rejected', () => {
  const payload = encryptToken('plane_api_example', KEY);
  assert.throws(() => decryptToken(payload, OTHER_KEY), DecryptionError);
});
