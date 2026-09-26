import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { deleteRate, listRates, upsertRate } from '../services/rates.js';

const rateSchema = z
  .object({
    scope: z.enum(['member', 'project', 'client']),
    memberId: z.string().uuid().nullish(),
    projectId: z.string().uuid().nullish(),
    clientId: z.string().uuid().nullish(),
    currency: z.string().length(3),
    hourlyAmount: z.number().nonnegative(),
  })
  .refine((value) => {
    if (value.scope === 'member') return Boolean(value.memberId);
    if (value.scope === 'project') return Boolean(value.projectId);
    return Boolean(value.clientId);
  }, 'rate scope requires its reference id');

export function rateRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const managerOnly = app.requireRole('manager', 'administrator');

  app.get('/api/rates', { preHandler: managerOnly }, async (request) => {
    const rates = await listRates(db, request.member!.organisation_id);
    return { rates };
  });

  app.put('/api/rates', { preHandler: managerOnly }, async (request, reply) => {
    const parsed = rateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const rate = await upsertRate(db, {
      organisationId: request.member!.organisation_id,
      actorMemberId: request.member!.id,
      scope: parsed.data.scope,
      memberId: parsed.data.memberId ?? null,
      projectId: parsed.data.projectId ?? null,
      clientId: parsed.data.clientId ?? null,
      currency: parsed.data.currency,
      hourlyAmount: parsed.data.hourlyAmount,
    });
    return { rate };
  });

  app.delete(
    '/api/rates/:id',
    { preHandler: managerOnly },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const removed = await deleteRate(db, {
        organisationId: request.member!.organisation_id,
        actorMemberId: request.member!.id,
        rateId: id,
      });
      if (!removed) {
        return reply.code(404).send({ error: 'rate_not_found' });
      }
      return { ok: true };
    },
  );
}
