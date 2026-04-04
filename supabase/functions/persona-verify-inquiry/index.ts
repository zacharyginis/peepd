/**
 * persona-verify-inquiry
 * Retrieves a Persona inquiry's status and returns whether it is approved.
 * Called by the frontend after Persona redirects back to write-review.
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
    const PERSONA_API_KEY = Deno.env.get('PERSONA_API_KEY');

    if (!PERSONA_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'PERSONA_API_KEY secret is not configured.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const { inquiry_id } = await req.json();

    if (!inquiry_id) {
      return new Response(
        JSON.stringify({ error: 'inquiry_id is required.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const personaRes = await fetch(
      `https://api.withpersona.com/api/v1/inquiries/${inquiry_id}`,
      {
        headers: {
          'Authorization': `Bearer ${PERSONA_API_KEY}`,
          'Persona-Version': '2023-01-05',
          'Key-Inflection': 'snake',
        },
      }
    );

    if (!personaRes.ok) {
      return new Response(
        JSON.stringify({ verified: false, status: 'unknown', error: 'Could not retrieve inquiry.' }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const result = await personaRes.json();
    const status = result.data?.attributes?.status ?? 'unknown';

    // Persona inquiry statuses: created, pending, completed, approved, declined, expired, failed
    const verified = status === 'approved' || status === 'completed';

    return new Response(
      JSON.stringify({ verified, status }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
