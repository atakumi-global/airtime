import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/pool.js';
import { signToken } from '../auth/jwt.js';
import { TOKEN_COOKIE } from '../auth/plugin.js';
import type { OidcService } from '../auth/oidc.js';
import { getPrimaryOrganisation } from '../services/organisations.js';
import {
  authenticateLocal,
  setFeedbackOptIn,
  upsertOidcMember,
} from '../services/members.js';
import { toPublicMember } from '../types.js';

const OIDC_COOKIE = 'airtime_oidc_pending';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const feedbackSchema = z.object({ optIn: z.boolean() });

export type AuthRouteDeps = {
  db: Db;
  config: AppConfig;
  oidc: OidcService | null;
};

export function authRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { db, config, oidc } = deps;
  const secureCookie = config.baseUrl.startsWith('https');

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const organisation = await getPrimaryOrganisation(db);
    if (!organisation) {
      return reply.code(503).send({ error: 'not_initialised' });
    }

    const member = await authenticateLocal(
      db,
      organisation.id,
      parsed.data.email,
      parsed.data.password,
    );
    if (!member) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const token = await signToken(
      {
        memberId: member.id,
        organisationId: member.organisation_id,
        role: member.role,
        email: member.email,
      },
      config.jwtSecret,
      config.jwtTtl,
    );

    reply.setCookie(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: secureCookie,
    });

    return { token, member: toPublicMember(member) };
  });

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(TOKEN_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/oidc/login', async (request, reply) => {
    if (!oidc) {
      return reply.code(404).send({ error: 'oidc_not_configured' });
    }
    const { url, pending } = await oidc.buildAuthorizationUrl();
    reply.setCookie(OIDC_COOKIE, JSON.stringify(pending), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: secureCookie,
      maxAge: 600,
      signed: true,
    });
    return reply.redirect(url);
  });

  app.get('/auth/oidc/callback', async (request, reply) => {
    if (!oidc) {
      return reply.code(404).send({ error: 'oidc_not_configured' });
    }
    const signed = request.cookies[OIDC_COOKIE];
    if (!signed) {
      return reply.code(400).send({ error: 'missing_oidc_state' });
    }
    const unsigned = request.unsignCookie(signed);
    if (!unsigned.valid || !unsigned.value) {
      return reply.code(400).send({ error: 'invalid_oidc_state' });
    }

    const organisation = await getPrimaryOrganisation(db);
    if (!organisation) {
      return reply.code(503).send({ error: 'not_initialised' });
    }

    try {
      const pending = JSON.parse(unsigned.value) as {
        state: string;
        nonce: string;
        codeVerifier: string;
      };
      const callbackUrl = `${config.baseUrl}${request.raw.url ?? '/auth/oidc/callback'}`;
      const identity = await oidc.exchangeCode(callbackUrl, pending);
      const member = await upsertOidcMember(db, organisation.id, identity);

      const token = await signToken(
        {
          memberId: member.id,
          organisationId: member.organisation_id,
          role: member.role,
          email: member.email,
        },
        config.jwtSecret,
        config.jwtTtl,
      );
      reply.clearCookie(OIDC_COOKIE, { path: '/' });
      reply.setCookie(TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: secureCookie,
      });
      return reply.redirect('/');
    } catch (error) {
      request.log.warn({ err: error }, 'oidc callback failed');
      return reply.code(401).send({ error: 'oidc_failed' });
    }
  });

  app.get('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    if (!request.member) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return { member: toPublicMember(request.member) };
  });

  app.patch(
    '/api/me/feedback',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = feedbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const member = await setFeedbackOptIn(
        db,
        request.member!.organisation_id,
        request.member!.id,
        parsed.data.optIn,
      );
      if (!member) {
        return reply.code(404).send({ error: 'member_not_found' });
      }
      return { member: toPublicMember(member) };
    },
  );
}
