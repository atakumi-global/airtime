import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import {
  createProject,
  getProject,
  listProjects,
  updateProjectClient,
} from '../services/projects.js';
import { viewerOf } from '../services/access.js';
import {
  refreshMemberAccessQuietly,
  type AccessCheckDeps,
} from '../services/accessCheck.js';
import { deleteBudget, getBudget, upsertBudget } from '../services/budgets.js';
import {
  type BudgetSummary,
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
  price: z.number().nonnegative().nullish(),
  profitTargetPercent: z.number().min(0).max(100).nullish(),
  marginTargetAmount: z.number().nonnegative().nullish(),
});

export type WorkspaceTotals = {
  workspace: string | null;
  projectCount: number;
  archivedProjectCount: number;
  currency: string;
  /** Sums of the project figures the viewer can read, in the reporting currency. */
  budget: number;
  spent: number;
  labourCost: number;
  expenses: number;
  billableMinutes: number;
};

/**
 * Totals per workspace over the projects the viewer can read. Each figure is the
 * sum of the per-project figures (already in the reporting currency), so a
 * workspace total always equals its rows. Projects with no Plane workspace group
 * under null.
 */
export function summariseWorkspaces(
  projects: Array<{
    workspace_slug: string | null;
    archived: boolean;
    summary: BudgetSummary;
  }>,
  currency: string,
): WorkspaceTotals[] {
  const groups = new Map<string, WorkspaceTotals>();
  for (const project of projects) {
    const key = project.workspace_slug ?? '';
    let totals = groups.get(key);
    if (!totals) {
      totals = {
        workspace: project.workspace_slug,
        projectCount: 0,
        archivedProjectCount: 0,
        currency,
        budget: 0,
        spent: 0,
        labourCost: 0,
        expenses: 0,
        billableMinutes: 0,
      };
      groups.set(key, totals);
    }
    totals.projectCount += 1;
    if (project.archived) {
      totals.archivedProjectCount += 1;
    }
    totals.budget = round2(totals.budget + (project.summary.convertedBudget ?? 0));
    totals.spent = round2(totals.spent + project.summary.spent);
    totals.labourCost = round2(totals.labourCost + project.summary.labourCost);
    totals.expenses = round2(totals.expenses + project.summary.expenses.total);
    totals.billableMinutes += project.summary.billableMinutes;
  }
  return [...groups.values()].sort((a, b) =>
    (a.workspace ?? '').localeCompare(b.workspace ?? ''),
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ProjectRouteDeps = {
  db: Db;
  projectionHorizonDays: number;
  access: AccessCheckDeps;
};

export function projectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): void {
  const { db, projectionHorizonDays, access } = deps;
  const anyMember = app.authenticate;
  const managerOnly = app.requireRole('manager', 'administrator');

  app.get('/api/projects', { preHandler: anyMember }, async (request) => {
    const query = request.query as { withBudget?: string; workspace?: string };
    await refreshMemberAccessQuietly(access, request.member!);
    const viewer = viewerOf(request.member!);
    const projects = await listProjects(db, request.member!.organisation_id, viewer, {
      workspace: query.workspace,
    });

    if (query.withBudget !== 'true') {
      return { projects };
    }

    const data = await getProjectSummaries(db, request.member!.organisation_id);
    const withSummary = projects.map((project) => ({
      ...project,
      summary: summariseProject(project.id, data, projectionHorizonDays),
    }));
    return {
      projects: withSummary,
      workspaces: summariseWorkspaces(withSummary, data.fx.reportingCurrency),
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
      viewerOf(request.member!),
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
      const project = await getProject(db, orgId, id, viewerOf(request.member!));
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
      const project = await getProject(db, orgId, id, viewerOf(request.member!));
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
        price: parsed.data.price ?? null,
        profitTargetPercent: parsed.data.profitTargetPercent ?? null,
        marginTargetAmount: parsed.data.marginTargetAmount ?? null,
        viewer: viewerOf(request.member!),
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
        viewer: viewerOf(request.member!),
      });
      if (!removed) {
        return reply.code(404).send({ error: 'budget_not_found' });
      }
      return { ok: true };
    },
  );
}
