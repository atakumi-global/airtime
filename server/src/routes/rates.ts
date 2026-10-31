import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { deleteRate, listRates, upsertRate } from '../services/rates.js';

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'invalid calendar date');

const rateSchema = z
  .object({
    scope: z.enum(['member', 'project', 'project_member']),
    memberId: z.string().uuid().nullish(),
    projectId: z.string().uuid().nullish(),
    fromDate: calendarDate,
    currency: z.string().length(3),
    hourlyAmount: z.number().finite().nonnegative(),
  })
  .refine((value) => {
    if (value.scope === 'member') return Boolean(value.memberId) && !value.projectId;
    if (value.scope === 'project') return Boolean(value.projectId) && !value.memberId;
    return Boolean(value.memberId) && Boolean(value.projectId);
  }, 'rate scope requires its reference ids');

const uuidSchema = z.string().uuid();

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
      fromDate: parsed.data.fromDate,
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
      if (!uuidSchema.safeParse(id).success) {
        return reply.code(404).send({ error: 'rate_not_found' });
      }
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
