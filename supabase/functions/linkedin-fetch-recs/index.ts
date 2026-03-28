/**
 * linkedin-fetch-recs
 * Proxies a request to the LinkedIn v2 recommendations API server-side
 * to avoid CORS and keep the access token off the public network.
 *
 * POST { access_token: string }
 * → { recommendations: Array<{ id, text, recommendee_name, recommendee_headline, created_at }> }
 *    scope_denied?: boolean  (true when the app lacks the required LinkedIn scope)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const body        = await req.json().catch(() => ({}));
    const accessToken = (body.access_token ?? '').trim();

    if (!accessToken) {
      return new Response(
        JSON.stringify({ recommendations: [], error: 'access_token required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // LinkedIn v2 — recommendations written BY the authenticated user
    // Requires r_basicprofile or partner-level access; gracefully degrades on 403/401.
    const liRes = await fetch(
      'https://api.linkedin.com/v2/recommendations' +
      '?q=given&count=20' +
      '&projection=(elements*(id,message,creationTime,recommendee~(firstName,lastName,headline)))',
      {
        headers: {
          'Authorization':                `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version':    '2.0.0',
          'LinkedIn-Version':             '202401',
        },
      }
    );

    if (!liRes.ok) {
      const status = liRes.status;
      // 403/401/404 = scope denied — tell the client to show the paste fallback
      return new Response(
        JSON.stringify({ recommendations: [], scope_denied: status === 403 || status === 401 || status === 404, api_status: status }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const data: any     = await liRes.json();
    const elements: any[] = data.elements ?? [];

    const recommendations = elements
      .map((el: any) => {
        const rec = el['recommendee~'] ?? {};
        const fn  = rec.firstName?.localized?.en_US ?? rec.firstName ?? '';
        const ln  = rec.lastName?.localized?.en_US  ?? rec.lastName  ?? '';
        const hl  = rec.headline?.localized?.en_US  ?? rec.headline  ?? '';
        return {
          id:                   el.id ?? '',
          text:                 el.message ?? '',
          recommendee_name:     `${fn} ${ln}`.trim(),
          recommendee_headline: hl,
          created_at:           el.creationTime ?? null,
        };
      })
      .filter((r: any) => r.text.length > 0);

    return new Response(
      JSON.stringify({ recommendations }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (e: any) {
    return new Response(
      JSON.stringify({ recommendations: [], error: String(e?.message ?? e) }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
