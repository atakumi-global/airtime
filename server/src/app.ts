import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { AppConfig } from './config.js';
import type { OidcService } from './auth/oidc.js';
import type { Db } from './db/pool.js';
import { registerAuth } from './auth/plugin.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { memberRoutes } from './routes/members.js';
import { projectRoutes } from './routes/projects.js';
import { rateRoutes } from './routes/rates.js';
import { auditRoutes } from './routes/audit.js';

export type AppDeps = {
  db: Db;
  config: AppConfig;
  oidc: OidcService | null;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    trustProxy: true,
  });

  await app.register(cookie, { secret: deps.config.cookieSecret });

  registerAuth(app, { db: deps.db, jwtSecret: deps.config.jwtSecret });

  healthRoutes(app, deps);
  authRoutes(app, deps);
  memberRoutes(app, deps);
  projectRoutes(app, deps);
  rateRoutes(app, deps);
  auditRoutes(app, deps);

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'not_found' });
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply
        .code(statusCode)
        .send({ error: error instanceof Error ? error.message : 'request_error' });
    }
    if ((error as { code?: string }).code === '23505') {
      return reply.code(409).send({ error: 'conflict' });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  return app;
}
