import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import {
  createManualEntry,
  deleteEntry,
  getEntry,
  getRunningTimer,
  listEntries,
  listEntryHistory,
  startTimer,
  stopTimer,
  updateEntry,
} from '../services/timeEntries.js';
import { getTimesheet } from '../services/costing.js';

const startSchema = z.object({
  workItemId: z.string().min(1).nullish(),
  description: z.string().max(2000).nullish(),
});

const manualSchema = z.object({
  workItemId: z.string().min(1).nullish(),
  description: z.string().max(2000).nullish(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  durationMinutes: z.number().positive().optional(),
});

const updateSchema = manualSchema.partial();

function canManage(role: string): boolean {
  return role === 'manager' || role === 'administrator';
}

export function timeRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const anyMember = app.authenticate;

  app.get('/api/timer', { preHandler: anyMember }, async (request) => {
    const timer = await getRunningTimer(
      db,
      request.member!.organisation_id,
      request.member!.id,
    );
    return { timer: timer ?? null };
  });

  app.post('/api/timer/start', { preHandler: anyMember }, async (request, reply) => {
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const timer = await startTimer(db, {
      organisationId: request.member!.organisation_id,
      memberId: request.member!.id,
      workItemId: parsed.data.workItemId ?? null,
      description: parsed.data.description ?? null,
    });
    return reply.code(201).send({ timer });
  });

  app.post('/api/timer/stop', { preHandler: anyMember }, async (request, reply) => {
    const entry = await stopTimer(db, {
      organisationId: request.member!.organisation_id,
      memberId: request.member!.id,
      actorMemberId: request.member!.id,
    });
    if (!entry) {
      return reply.code(409).send({ error: 'no_running_timer' });
    }
    return { entry };
  });

  app.get('/api/time-entries', { preHandler: anyMember }, async (request) => {
    const query = request.query as {
      memberId?: string;
      projectId?: string;
      from?: string;
      to?: string;
      includeDeleted?: string;
    };
    const member = request.member!;
    const entries = await listEntries(db, member.organisation_id, {
      memberId: canManage(member.role) ? query.memberId : member.id,
      projectId: query.projectId,
      from: query.from,
      to: query.to,
      includeDeleted: canManage(member.role) && query.includeDeleted === 'true',
    });
    return { entries };
  });

  app.get('/api/time-entries/summary', { preHandler: anyMember }, async (request) => {
    const query = request.query as {
      memberId?: string;
      from?: string;
      to?: string;
    };
    const member = request.member!;
    return getTimesheet(db, member.organisation_id, {
      memberId: canManage(member.role) ? query.memberId : member.id,
      from: query.from,
      to: query.to,
    });
  });

  app.post('/api/time-entries', { preHandler: anyMember }, async (request, reply) => {
    const parsed = manualSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const entry = await createManualEntry(db, {
      organisationId: request.member!.organisation_id,
      memberId: request.member!.id,
      workItemId: parsed.data.workItemId ?? null,
      description: parsed.data.description ?? null,
      startedAt: parsed.data.startedAt,
      endedAt: parsed.data.endedAt,
      date: parsed.data.date,
      durationMinutes: parsed.data.durationMinutes,
    });
    return reply.code(201).send({ entry });
  });

  app.patch(
    '/api/time-entries/:id',
    { preHandler: anyMember },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const member = request.member!;
      const existing = await getEntry(db, member.organisation_id, id);
      if (!existing || existing.deleted_at) {
        return reply.code(404).send({ error: 'entry_not_found' });
      }
      if (existing.member_id !== member.id && !canManage(member.role)) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const parsed = updateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const entry = await updateEntry(db, {
        organisationId: member.organisation_id,
        actorMemberId: member.id,
        entryId: id,
        workItemId: parsed.data.workItemId,
        description: parsed.data.description,
        startedAt: parsed.data.startedAt,
        endedAt: parsed.data.endedAt,
        durationMinutes: parsed.data.durationMinutes,
      });
      if (!entry) {
        return reply.code(404).send({ error: 'entry_not_found' });
      }
      return { entry };
    },
  );

  app.delete(
    '/api/time-entries/:id',
    { preHandler: anyMember },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const member = request.member!;
      const existing = await getEntry(db, member.organisation_id, id);
      if (!existing || existing.deleted_at) {
        return reply.code(404).send({ error: 'entry_not_found' });
      }
      if (existing.member_id !== member.id && !canManage(member.role)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await deleteEntry(db, {
        organisationId: member.organisation_id,
        actorMemberId: member.id,
        entryId: id,
      });
      return { ok: true };
    },
  );

  app.get(
    '/api/time-entries/:id/history',
    { preHandler: anyMember },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const member = request.member!;
      const existing = await getEntry(db, member.organisation_id, id);
      if (!existing) {
        return reply.code(404).send({ error: 'entry_not_found' });
      }
      if (existing.member_id !== member.id && !canManage(member.role)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const history = await listEntryHistory(db, member.organisation_id, id);
      return { history };
    },
  );
}
