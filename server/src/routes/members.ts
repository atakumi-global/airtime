import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { ROLES, toPublicMember } from '../types.js';
import {
  createMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from '../services/members.js';
import { writeAudit } from '../services/audit.js';

const createSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: z.enum(ROLES),
  password: z.string().min(8).optional(),
});

const roleSchema = z.object({ role: z.enum(ROLES) });

export function memberRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const managerOnly = app.requireRole('manager', 'administrator');
  const adminOnly = app.requireRole('administrator');

  app.get('/api/members', { preHandler: managerOnly }, async (request) => {
    const orgId = request.member!.organisation_id;
    const members = await listMembers(db, orgId);
    return { members: members.map(toPublicMember) };
  });

  app.post('/api/members', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const orgId = request.member!.organisation_id;
    const member = await createMember(db, {
      organisationId: orgId,
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      password: parsed.data.password,
    });
    return reply.code(201).send({ member: toPublicMember(member) });
  });

  app.patch(
    '/api/members/:id/role',
    { preHandler: adminOnly },
    async (request, reply) => {
      const parsed = roleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const { id } = request.params as { id: string };
      const orgId = request.member!.organisation_id;
      const member = await updateMemberRole(db, orgId, id, parsed.data.role);
      if (!member) {
        return reply.code(404).send({ error: 'member_not_found' });
      }
      return { member: toPublicMember(member) };
    },
  );

  app.delete(
    '/api/members/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = request.member!.organisation_id;
      const before = await removeMember(db, orgId, id);
      if (!before) {
        return reply.code(404).send({ error: 'member_not_found' });
      }
      await db.withTransaction((client) =>
        writeAudit(client, {
          organisationId: orgId,
          actorMemberId: request.member!.id,
          action: 'member.removed',
          entityType: 'member',
          entityId: before.id,
          before,
          after: null,
        }),
      );
      return { member: toPublicMember(before) };
    },
  );
}
