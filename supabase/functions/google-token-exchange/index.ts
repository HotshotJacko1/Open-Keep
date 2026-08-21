// Edge function: google-token-exchange
//
// Exchanges a Google "server auth code" (obtained by the app via SocialLogin
// offline mode) for access/refresh tokens, or refreshes an existing refresh
// token into a new access token.
//
// The GOOGLE_CLIENT_SECRET never ships in the app — it lives in Supabase
// secrets. Set it once with:
//   supabase secrets set GOOGLE_CLIENT_SECRET=<secret>
// Optional:
//   GOOGLE_CLIENT_ID (defaults to the Open Keep web client ID)
//
// Contract:
//   POST { code: string }         -> exchange auth code
//   POST { refreshToken: string } -> refresh grant
//   200 { access_token, expires_in, scope, token_type, refresh_token?, id_token? }
//   200 { error, error_description? }   (Google rejection surfaced at HTTP 200
//                                        so the client can branch on the body)

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_GOOGLE_CLIENT_ID = '889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Fields we forward to the client. Everything else (e.g. client_secret) never leaves this function.
const FORWARD_FIELDS = [
  'access_token',
  'expires_in',
  'refresh_token',
  'scope',
  'token_type',
  'id_token',
] as const;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? DEFAULT_GOOGLE_CLIENT_ID;
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (!clientSecret) {
      console.error('[google-token-exchange] GOOGLE_CLIENT_SECRET is not configured in Supabase secrets');
      return new Response(JSON.stringify({ error: 'server_misconfigured', error_description: 'GOOGLE_CLIENT_SECRET not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: { code?: unknown; refreshToken?: unknown };
    try {
      body = await req.json();
    } catch (_e) {
      return new Response(JSON.stringify({ error: 'invalid_request', error_description: 'Body must be JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const code = typeof body.code === 'string' ? body.code : undefined;
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : undefined;

    if (!!code === !!refreshToken) {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Provide exactly one of "code" or "refreshToken"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (code) {
      // Empty redirect_uri is required when exchanging codes issued to installed apps.
      form.set('redirect_uri', '');
      form.set('grant_type', 'authorization_code');
      form.set('code', code);
      console.log('[google-token-exchange] Exchanging server auth code for tokens');
    } else {
      form.set('grant_type', 'refresh_token');
      form.set('refresh_token', refreshToken!);
      console.log('[google-token-exchange] Refreshing access token');
    }

    const googleRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    const payload = await googleRes.json().catch(() => ({}) as Record<string, unknown>);

    if (!googleRes.ok) {
      const error = typeof payload.error === 'string' ? payload.error : `google_http_${googleRes.status}`;
      const errorDescription = typeof payload.error_description === 'string' ? payload.error_description : undefined;
      console.error(`[google-token-exchange] Google rejected request: ${error}`);
      return new Response(JSON.stringify({ error, error_description: errorDescription }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result: Record<string, unknown> = {};
    for (const field of FORWARD_FIELDS) {
      if (payload[field] !== undefined) result[field] = payload[field];
    }
    console.log(
      `[google-token-exchange] Success (hasRefreshToken=${Boolean(result.refresh_token)}, expiresIn=${result.expires_in})`,
    );

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[google-token-exchange] Unexpected failure', e);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
