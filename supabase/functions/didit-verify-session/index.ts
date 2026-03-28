/**
 * didit-verify-session
 * Retrieves a Didit session's decision and returns whether it is Approved.
 * Called by the frontend after Didit redirects back to write-review.html.
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
    const DIDIT_API_KEY = Deno.env.get('DIDIT_API_KEY');

    if (!DIDIT_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'DIDIT_API_KEY secret is not configured.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: 'session_id is required.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // First check the session status (lightweight)
    const sessionRes = await fetch(
      `https://verification.didit.me/v3/session/${session_id}/`,
      { headers: { 'x-api-key': DIDIT_API_KEY } }
    );

    if (!sessionRes.ok) {
      // Fall back to decision endpoint
      const decisionRes = await fetch(
        `https://verification.didit.me/v3/session/${session_id}/decision/`,
        { headers: { 'x-api-key': DIDIT_API_KEY } }
      );
      if (!decisionRes.ok) {
        return new Response(
          JSON.stringify({ verified: false, status: 'unknown', error: 'Could not retrieve session.' }),
          { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
      }
      const d = await decisionRes.json();
      return new Response(
        JSON.stringify({ verified: d.status === 'Approved', status: d.status }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const data = await sessionRes.json();
    const status = data.status ?? 'unknown';

    return new Response(
      JSON.stringify({ verified: status === 'Approved', status }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
