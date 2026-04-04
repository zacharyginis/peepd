/**
 * persona-create-inquiry
 * Creates a Persona inquiry via the hosted flow API and returns the hosted URL.
 * The Persona API key never leaves this function — it is set as a Supabase secret.
 *
 * Required Supabase secrets:
 *   PERSONA_API_KEY           — Bearer token from Persona dashboard
 *   PERSONA_TEMPLATE_ID       — Inquiry template ID (itmpl_xxx)
 *   PERSONA_ENVIRONMENT_ID    — Environment ID (env_xxx) for sandbox/production
 *   PERSONA_REDIRECT_URL      — Where Persona redirects after verification
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  try {
    const PERSONA_API_KEY        = Deno.env.get('PERSONA_API_KEY');
    const PERSONA_TEMPLATE_ID    = Deno.env.get('PERSONA_TEMPLATE_ID');
    const PERSONA_ENVIRONMENT_ID = Deno.env.get('PERSONA_ENVIRONMENT_ID');
    const PERSONA_REDIRECT_URL   = Deno.env.get('PERSONA_REDIRECT_URL') ?? 'http://localhost:3000/write-review';

    if (!PERSONA_API_KEY || !PERSONA_TEMPLATE_ID) {
      return new Response(
        JSON.stringify({ error: 'PERSONA_API_KEY and PERSONA_TEMPLATE_ID secrets are not configured.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const referenceId: string = body.reference_id ?? crypto.randomUUID();

    // Create the inquiry via Persona API
    const personaRes = await fetch('https://api.withpersona.com/api/v1/inquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERSONA_API_KEY}`,
        'Persona-Version': '2023-01-05',
        'Key-Inflection': 'snake',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            inquiry_template_id: PERSONA_TEMPLATE_ID,
            environment_id: PERSONA_ENVIRONMENT_ID || undefined,
            reference_id: referenceId,
          },
        },
      }),
    });

    if (!personaRes.ok) {
      const txt = await personaRes.text();
      return new Response(
        JSON.stringify({ error: `Persona API error: ${personaRes.status}`, detail: txt }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const result = await personaRes.json();
    const inquiryId = result.data?.id;
    const sessionToken = result.meta?.session_token;

    // Build the hosted flow URL
    // Persona hosted flow: https://inquiry.withpersona.com/verify?inquiry-id=inq_xxx&session-token=xxx&redirect-uri=xxx
    const hostedUrl = new URL('https://inquiry.withpersona.com/verify');
    hostedUrl.searchParams.set('inquiry-id', inquiryId);
    if (sessionToken) hostedUrl.searchParams.set('session-token', sessionToken);
    hostedUrl.searchParams.set('redirect-uri', PERSONA_REDIRECT_URL);

    return new Response(
      JSON.stringify({ inquiry_id: inquiryId, url: hostedUrl.toString() }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
