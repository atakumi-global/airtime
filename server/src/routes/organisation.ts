import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import {
  getPrimaryOrganisation,
  updateDefaultHourlyRate,
  updateReportingCurrency,
} from '../services/organisations.js';
import { writeAudit } from '../services/audit.js';

// Both settings are optional so each can be saved on its own, but at least one must be
// present. `defaultHourlyRate` can never be cleared: null and empty values are rejected.
const settingsSchema = z
  .object({
    reportingCurrency: z.string().length(3).optional(),
    defaultHourlyRate: z.number().finite().min(0).max(1_000_000).optional(),
  })
  .refine(
    (value) =>
      value.reportingCurrency !== undefined || value.defaultHourlyRate !== undefined,
    'no setting provided',
  );

type OrganisationView = {
  id: string;
  name: string;
  reporting_currency: string;
  default_hourly_rate: string;
};

function presentOrganisation(organisation: OrganisationView): {
  id: string;
  name: string;
  reportingCurrency: string;
  defaultHourlyRate: number;
} {
  return {
    id: organisation.id,
    name: organisation.name,
    reportingCurrency: organisation.reporting_currency,
    defaultHourlyRate: Number(organisation.default_hourly_rate),
  };
}

export function organisationRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const anyMember = app.authenticate;
  const adminOnly = app.requireRole('administrator');

  app.get('/api/organisation', { preHandler: anyMember }, async (request, reply) => {
    const organisation = await getPrimaryOrganisation(db);
    if (!organisation || organisation.id !== request.member!.organisation_id) {
      return reply.code(404).send({ error: 'organisation_not_found' });
    }
    return { organisation: presentOrganisation(organisation) };
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
    let current = organisation;
    if (parsed.data.reportingCurrency !== undefined) {
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
      current = updated;
    }
    if (parsed.data.defaultHourlyRate !== undefined) {
      const updated = await updateDefaultHourlyRate(
        db,
        organisation.id,
        parsed.data.defaultHourlyRate,
      );
      if (!updated) {
        return reply.code(404).send({ error: 'organisation_not_found' });
      }
      await db.withTransaction((client) =>
        writeAudit(client, {
          organisationId: organisation.id,
          actorMemberId: request.member!.id,
          action: 'organisation.default_hourly_rate_changed',
          entityType: 'organisation',
          entityId: organisation.id,
          before: { defaultHourlyRate: Number(current.default_hourly_rate), currency: 'NZD' },
          after: { defaultHourlyRate: Number(updated.default_hourly_rate), currency: 'NZD' },
        }),
      );
      current = updated;
    }
    return { organisation: presentOrganisation(current) };
  });
}
