import { Issuer, generators } from 'openid-client';
import type { Client } from 'openid-client';
import type { AppConfig } from '../config.js';

export type OidcIdentity = {
  subject: string;
  email: string;
  displayName: string;
};

export type OidcPending = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

export class OidcService {
  private client: Client | null = null;

  constructor(private readonly config: NonNullable<AppConfig['oidc']>) {}

  get enabled(): boolean {
    return true;
  }

  private async getClient(): Promise<Client> {
    if (!this.client) {
      const issuer = await Issuer.discover(this.config.issuer);
      this.client = new issuer.Client({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uris: [this.config.redirectUri],
        response_types: ['code'],
      });
    }
    return this.client;
  }

  async buildAuthorizationUrl(): Promise<{ url: string; pending: OidcPending }> {
    const client = await this.getClient();
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const url = client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { url, pending: { state, nonce, codeVerifier } };
  }

  async exchangeCode(
    callbackUrl: string,
    pending: OidcPending,
  ): Promise<OidcIdentity> {
    const client = await this.getClient();
    const params = client.callbackParams(callbackUrl);
    const tokenSet = await client.callback(this.config.redirectUri, params, {
      state: pending.state,
      nonce: pending.nonce,
      code_verifier: pending.codeVerifier,
    });
    const claims = tokenSet.claims();
    const email = claims.email;
    if (!claims.sub || typeof email !== 'string' || email === '') {
      throw new Error('OIDC provider did not return a subject and email');
    }
    return {
      subject: claims.sub,
      email,
      displayName:
        (typeof claims.name === 'string' && claims.name) ||
        (typeof claims.preferred_username === 'string' &&
          claims.preferred_username) ||
        email,
    };
  }
}
