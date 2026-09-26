import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/pool.js';
import { verifyToken } from './jwt.js';
import type { MemberRow, Role } from '../types.js';

export const TOKEN_COOKIE = 'airtime_token';

export type AuthDeps = {
  db: Db;
  jwtSecret: string;
};

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const cookie = request.cookies?.[TOKEN_COOKIE];
  return cookie ?? null;
}

export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  app.decorateRequest('member', null);

  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const token = extractToken(request);
    if (!token) {
      await reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    let memberId: string;
    try {
      const claims = await verifyToken(token, deps.jwtSecret);
      memberId = claims.memberId;
    } catch {
      await reply.code(401).send({ error: 'invalid_token' });
      return;
    }

    const rows = await deps.db.query<MemberRow>(
      'SELECT * FROM members WHERE id = $1',
      [memberId],
    );
    const member = rows[0];
    if (!member || member.status !== 'active') {
      await reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    request.member = member;
  };

  app.decorate('authenticate', authenticate);

  app.decorate(
    'requireRole',
    (...roles: Role[]) =>
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        await authenticate(request, reply);
        if (reply.sent) {
          return;
        }
        const member = request.member;
        if (!member) {
          await reply.code(401).send({ error: 'unauthenticated' });
          return;
        }
        if (!roles.includes(member.role)) {
          await reply.code(403).send({ error: 'forbidden' });
        }
      },
  );
}
