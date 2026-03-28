/**
 * didit-webhook
 * Receives real-time status updates from Didit and stores them in Supabase.
 * Uses X-Signature-V2 verification (recommended by Didit).
 *
 * Table written to: reviewer_verifications
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Recursively convert whole-number floats to ints (Didit signature requirement). */
function shortenFloats(data: unknown): unknown {
  if (Array.isArray(data))        return data.map(shortenFloats);
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, shortenFloats(v)])
    );
  }
  if (typeof data === 'number' && !Number.isInteger(data) && data % 1 === 0) return Math.trunc(data);
  return data;
}

function sortKeysRecursive(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysRecursive);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj as object).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortKeysRecursive((obj as Record<string, unknown>)[key]);
      return acc;
    }, {});
  }
  return obj;
}

async function verifySignatureV2(
  body: unknown,
  sig: string,
  timestamp: string,
  secret: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const processed  = shortenFloats(body);
  const sorted     = sortKeysRecursive(processed);
  const canonical  = JSON.stringify(sorted);

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
  const expected = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === sig;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const WEBHOOK_SECRET = Deno.env.get('DIDIT_WEBHOOK_SECRET');
    const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const sigV2    = req.headers.get('x-signature-v2');
    const timestamp = req.headers.get('x-timestamp');
    const body = await req.json();

    // Verify signature when secret is configured
    if (WEBHOOK_SECRET && sigV2 && timestamp) {
      const valid = await verifySignatureV2(body, sigV2, timestamp, WEBHOOK_SECRET);
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    const { session_id, status, vendor_data } = body;
    console.log(`Didit webhook: session=${session_id} status=${status} vendor=${vendor_data}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    await supabase.from('reviewer_verifications').upsert({
      reviewer_session_id: vendor_data ?? session_id,
      didit_session_id:    session_id,
      status:              status,
      verified_at:         status === 'Approved' ? new Date().toISOString() : null,
    }, { onConflict: 'didit_session_id' });

    return new Response(
      JSON.stringify({ message: 'Webhook event dispatched' }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
