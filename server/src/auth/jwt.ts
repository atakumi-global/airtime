import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '../types.js';

export type TokenClaims = {
  memberId: string;
  organisationId: string;
  role: Role;
  email: string;
};

const ALGORITHM = 'HS256';

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken(
  claims: TokenClaims,
  secret: string,
  ttl: string,
): Promise<string> {
  return new SignJWT({
    organisationId: claims.organisationId,
    role: claims.role,
    email: claims.email,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.memberId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key(secret));
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, key(secret), {
    algorithms: [ALGORITHM],
  });
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.organisationId !== 'string' ||
    typeof payload.role !== 'string' ||
    typeof payload.email !== 'string'
  ) {
    throw new Error('Malformed token claims');
  }
  return {
    memberId: payload.sub,
    organisationId: payload.organisationId,
    role: payload.role as Role,
    email: payload.email,
  };
}
