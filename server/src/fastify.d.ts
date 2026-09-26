import type { MemberRow, Role } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    member: MemberRow | null;
  }

  interface FastifyInstance {
    authenticate: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
    requireRole: (
      ...roles: Role[]
    ) => (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
  }
}
