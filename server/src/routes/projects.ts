import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { createProject, getProject, listProjects } from '../services/projects.js';
import { deleteBudget, getBudget, upsertBudget } from '../services/budgets.js';

const createSchema = z.object({
  name: z.string().min(1),
  planeProjectId: z.string().min(1).optional(),
});

const budgetSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export function projectRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const anyMember = app.authenticate;
  const managerOnly = app.requireRole('manager', 'administrator');

  app.get('/api/projects', { preHandler: anyMember }, async (request) => {
    const projects = await listProjects(db, request.member!.organisation_id);
    return { projects };
  });

  app.post('/api/projects', { preHandler: managerOnly }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const project = await createProject(db, {
      organisationId: request.member!.organisation_id,
      name: parsed.data.name,
      planeProjectId: parsed.data.planeProjectId,
    });
    return reply.code(201).send({ project });
  });

  app.get(
    '/api/projects/:id/budget',
    { preHandler: anyMember },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = request.member!.organisation_id;
      const project = await getProject(db, orgId, id);
      if (!project) {
        return reply.code(404).send({ error: 'project_not_found' });
      }
      const budget = await getBudget(db, orgId, id);
      return { budget: budget ?? null };
    },
  );

  app.put(
    '/api/projects/:id/budget',
    { preHandler: managerOnly },
    async (request, reply) => {
      const parsed = budgetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const { id } = request.params as { id: string };
      const budget = await upsertBudget(db, {
        organisationId: request.member!.organisation_id,
        actorMemberId: request.member!.id,
        projectId: id,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
      });
      return { budget };
    },
  );

  app.delete(
    '/api/projects/:id/budget',
    { preHandler: managerOnly },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const removed = await deleteBudget(db, {
        organisationId: request.member!.organisation_id,
        actorMemberId: request.member!.id,
        projectId: id,
      });
      if (!removed) {
        return reply.code(404).send({ error: 'budget_not_found' });
      }
      return { ok: true };
    },
  );
}
