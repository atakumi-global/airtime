import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { viewerOf } from '../services/access.js';
import { getProject } from '../services/projects.js';
import {
  EXPENSE_CATEGORIES,
  createExpense,
  deleteExpense,
  getExpense,
  listExpenseHistory,
  listExpenses,
  updateExpense,
} from '../services/expenses.js';

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(isCalendarDate, 'invalid_date');
const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());

const createSchema = z.object({
  date: dateSchema,
  amount: z.number().positive().max(1_000_000_000),
  currency: currencySchema,
  category: z.enum(EXPENSE_CATEGORIES),
  note: z.string().trim().max(500).nullish(),
  workItemId: z.string().min(1).max(200).nullish(),
});

const updateSchema = z.object({
  date: dateSchema.optional(),
  amount: z.number().positive().max(1_000_000_000).optional(),
  currency: currencySchema.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  workItemId: z.string().min(1).max(200).nullable().optional(),
});

const listQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const idSchema = z.string().uuid();

export function expenseRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const anyMember = app.authenticate;
  const managerOnly = app.requireRole('manager', 'administrator');

  // Reading is open to every member; the interface shows it read-only.
  app.get('/api/expenses', { preHandler: anyMember }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const expenses = await listExpenses(
      db,
      request.member!.organisation_id,
      viewerOf(request.member!),
      parsed.data,
    );
    return { expenses };
  });

  app.get(
    '/api/projects/:id/expenses',
    { preHandler: anyMember },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!idSchema.safeParse(id).success) {
        return reply.code(404).send({ error: 'project_not_found' });
      }
      const orgId = request.member!.organisation_id;
      const project = await getProject(db, orgId, id, viewerOf(request.member!));
      if (!project) {
        return reply.code(404).send({ error: 'project_not_found' });
      }
      const expenses = await listExpenses(db, orgId, viewerOf(request.member!), {
        projectId: id,
      });
      return { expenses };
    },
  );

  app.post(
    '/api/projects/:id/expenses',
    { preHandler: managerOnly },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!idSchema.safeParse(id).success) {
        return reply.code(404).send({ error: 'project_not_found' });
      }
      const parsed = createSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const expense = await createExpense(db, {
        organisationId: request.member!.organisation_id,
        actorMemberId: request.member!.id,
        viewer: viewerOf(request.member!),
        projectId: id,
        workItemId: parsed.data.workItemId ?? null,
        date: parsed.data.date,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        category: parsed.data.category,
        note: parsed.data.note || null,
      });
      return reply.code(201).send({ expense });
    },
  );

  app.patch('/api/expenses/:id', { preHandler: managerOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!idSchema.safeParse(id).success) {
      return reply.code(404).send({ error: 'expense_not_found' });
    }
    const parsed = updateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const expense = await updateExpense(db, {
      organisationId: request.member!.organisation_id,
      actorMemberId: request.member!.id,
      viewer: viewerOf(request.member!),
      expenseId: id,
      date: parsed.data.date,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      category: parsed.data.category,
      note: parsed.data.note === undefined ? undefined : parsed.data.note || null,
      workItemId: parsed.data.workItemId,
    });
    if (!expense) {
      return reply.code(404).send({ error: 'expense_not_found' });
    }
    return { expense };
  });

  app.delete('/api/expenses/:id', { preHandler: managerOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!idSchema.safeParse(id).success) {
      return reply.code(404).send({ error: 'expense_not_found' });
    }
    const removed = await deleteExpense(db, {
      organisationId: request.member!.organisation_id,
      actorMemberId: request.member!.id,
      viewer: viewerOf(request.member!),
      expenseId: id,
    });
    if (!removed) {
      return reply.code(404).send({ error: 'expense_not_found' });
    }
    return { ok: true };
  });

  app.get(
    '/api/expenses/:id/history',
    { preHandler: managerOnly },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!idSchema.safeParse(id).success) {
        return reply.code(404).send({ error: 'expense_not_found' });
      }
      const orgId = request.member!.organisation_id;
      const existing = await getExpense(db, orgId, id, viewerOf(request.member!));
      if (!existing) {
        return reply.code(404).send({ error: 'expense_not_found' });
      }
      const history = await listExpenseHistory(db, orgId, id);
      return { history };
    },
  );
}
