/**
 * didit-create-session
 * Creates a Didit verification session and returns the hosted URL.
 * The Didit API key never leaves this function — it is set as a Supabase secret.
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
    const DIDIT_API_KEY      = Deno.env.get('DIDIT_API_KEY');
    const DIDIT_WORKFLOW_ID  = Deno.env.get('DIDIT_WORKFLOW_ID');
    const DIDIT_CALLBACK_URL = Deno.env.get('DIDIT_CALLBACK_URL') ?? 'http://localhost:3000/write-review.html';

    if (!DIDIT_API_KEY || !DIDIT_WORKFLOW_ID) {
      return new Response(
        JSON.stringify({ error: 'DIDIT_API_KEY and DIDIT_WORKFLOW_ID secrets are not configured.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const reviewer_session_id: string = body.reviewer_session_id ?? crypto.randomUUID();

    const diditRes = await fetch('https://verification.didit.me/v3/session/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DIDIT_API_KEY,
      },
      body: JSON.stringify({
        workflow_id:     DIDIT_WORKFLOW_ID,
        vendor_data:     reviewer_session_id,
        callback:        DIDIT_CALLBACK_URL,
        callback_method: 'both',
      }),
    });

    if (!diditRes.ok) {
      const txt = await diditRes.text();
      return new Response(
        JSON.stringify({ error: `Didit API error: ${diditRes.status}`, detail: txt }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const data = await diditRes.json();

    return new Response(
      JSON.stringify({ session_id: data.session_id, url: data.url }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
