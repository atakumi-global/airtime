import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import {
  createProject,
  getProject,
  listProjects,
  updateProjectClient,
} from '../services/projects.js';
import { deleteBudget, getBudget, upsertBudget } from '../services/budgets.js';
import {
  getProjectBudgetSummary,
  getProjectSummaries,
  summariseProject,
} from '../services/costing.js';

const createSchema = z.object({
  name: z.string().min(1),
  planeProjectId: z.string().min(1).optional(),
  clientId: z.string().uuid().nullish(),
});

const clientSchema = z.object({ clientId: z.string().uuid().nullable() });

const budgetSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export type ProjectRouteDeps = {
  db: Db;
  projectionHorizonDays: number;
};

export function projectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): void {
  const { db, projectionHorizonDays } = deps;
  const anyMember = app.authenticate;
  const managerOnly = app.requireRole('manager', 'administrator');

  app.get('/api/projects', { preHandler: anyMember }, async (request) => {
    const query = request.query as { withBudget?: string };
    const projects = await listProjects(db, request.member!.organisation_id);

    if (query.withBudget !== 'true') {
      return { projects };
    }

    const data = await getProjectSummaries(db, request.member!.organisation_id);
    return {
      projects: projects.map((project) => ({
        ...project,
        summary: summariseProject(project.id, data, projectionHorizonDays),
      })),
    };
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
      clientId: parsed.data.clientId ?? null,
    });
    return reply.code(201).send({ project });
  });

  app.patch('/api/projects/:id', { preHandler: managerOnly }, async (request, reply) => {
    const parsed = clientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { id } = request.params as { id: string };
    const project = await updateProjectClient(
      db,
      request.member!.organisation_id,
      id,
      parsed.data.clientId,
    );
    if (!project) {
      return reply.code(404).send({ error: 'project_not_found' });
    }
    return { project };
  });

  app.get(
    '/api/projects/:id/summary',
    { preHandler: anyMember },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = request.member!.organisation_id;
      const project = await getProject(db, orgId, id);
      if (!project) {
        return reply.code(404).send({ error: 'project_not_found' });
      }
      const summary = await getProjectBudgetSummary(
        db,
        orgId,
        project,
        projectionHorizonDays,
      );
      return { project, summary };
    },
  );

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
