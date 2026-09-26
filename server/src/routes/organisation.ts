import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import {
  getPrimaryOrganisation,
  updateReportingCurrency,
} from '../services/organisations.js';
import { writeAudit } from '../services/audit.js';

const settingsSchema = z.object({
  reportingCurrency: z.string().length(3),
});

export function organisationRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const anyMember = app.authenticate;
  const adminOnly = app.requireRole('administrator');

  app.get('/api/organisation', { preHandler: anyMember }, async (request, reply) => {
    const organisation = await getPrimaryOrganisation(db);
    if (!organisation || organisation.id !== request.member!.organisation_id) {
      return reply.code(404).send({ error: 'organisation_not_found' });
    }
    return {
      organisation: {
        id: organisation.id,
        name: organisation.name,
        reportingCurrency: organisation.reporting_currency,
      },
    };
  });

  app.patch('/api/organisation', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const organisation = await getPrimaryOrganisation(db);
    if (!organisation || organisation.id !== request.member!.organisation_id) {
      return reply.code(404).send({ error: 'organisation_not_found' });
    }
    const updated = await updateReportingCurrency(
      db,
      organisation.id,
      parsed.data.reportingCurrency,
    );
    if (!updated) {
      return reply.code(404).send({ error: 'organisation_not_found' });
    }
    await db.withTransaction((client) =>
      writeAudit(client, {
        organisationId: organisation.id,
        actorMemberId: request.member!.id,
        action: 'organisation.reporting_currency_changed',
        entityType: 'organisation',
        entityId: organisation.id,
        before: { reportingCurrency: organisation.reporting_currency },
        after: { reportingCurrency: updated.reporting_currency },
      }),
    );
    return {
      organisation: {
        id: updated.id,
        name: updated.name,
        reportingCurrency: updated.reporting_currency,
      },
    };
  });
}
