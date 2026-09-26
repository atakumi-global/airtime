import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/pool.js';
import { createOrganisation, getPrimaryOrganisation } from './organisations.js';
import { createMember, findMemberByEmail, listMembers } from './members.js';

export async function bootstrap(
  db: Db,
  config: AppConfig,
  log: FastifyBaseLogger,
): Promise<void> {
  let organisation = await getPrimaryOrganisation(db);
  if (!organisation) {
    organisation = await createOrganisation(db, config.bootstrap.orgName);
    log.info({ organisationId: organisation.id }, 'created organisation');
  }

  const members = await listMembers(db, organisation.id);
  if (members.length > 0) {
    return;
  }

  if (!config.bootstrap.password) {
    log.warn(
      'no members exist and BOOTSTRAP_ADMIN_PASSWORD is not set; sign-in is not possible until an administrator is created',
    );
    return;
  }

  const existing = await findMemberByEmail(
    db,
    organisation.id,
    config.bootstrap.email,
  );
  if (existing) {
    return;
  }

  await createMember(db, {
    organisationId: organisation.id,
    email: config.bootstrap.email,
    displayName: config.bootstrap.displayName,
    role: 'administrator',
    password: config.bootstrap.password,
  });
  log.info({ email: config.bootstrap.email }, 'created bootstrap administrator');
}
