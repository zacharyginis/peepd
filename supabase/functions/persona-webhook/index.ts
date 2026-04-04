/**
 * persona-webhook
 * Receives real-time event notifications from Persona and stores them in Supabase.
 * Handles inquiry.approved, inquiry.completed, inquiry.failed, inquiry.expired events.
 *
 * Table written to: reviewer_verifications
 *
 * Persona webhook signature verification uses HMAC-SHA256.
 * The webhook secret is configured in the Persona dashboard.
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Verify Persona webhook signature.
 * Persona sends: Persona-Signature header with format "t=<timestamp>,v1=<signature>"
 */
async function verifyPersonaSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = signatureHeader.split(',');
    const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
    const signature = parts.find(p => p.startsWith('v1='))?.slice(3);

    if (!timestamp || !signature) return false;

    // Check timestamp is within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

    // Compute expected signature: HMAC-SHA256(secret, "timestamp.rawBody")
    const payload = `${timestamp}.${rawBody}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const expected = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    return expected === signature;
  } catch {
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const WEBHOOK_SECRET = Deno.env.get('PERSONA_WEBHOOK_SECRET');
    const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const rawBody = await req.text();
    const signatureHeader = req.headers.get('persona-signature') || '';

    // Verify signature when secret is configured
    if (WEBHOOK_SECRET && signatureHeader) {
      const valid = await verifyPersonaSignature(rawBody, signatureHeader, WEBHOOK_SECRET);
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    const body = JSON.parse(rawBody);
    const eventName = body.data?.attributes?.name; // e.g. "inquiry.approved"
    const inquiry   = body.data?.attributes?.payload?.data;
    const inquiryId = inquiry?.id;                  // e.g. "inq_xxx"
    const status    = inquiry?.attributes?.status;   // e.g. "approved"
    const referenceId = inquiry?.attributes?.reference_id;

    console.log(`Persona webhook: event=${eventName} inquiry=${inquiryId} status=${status} ref=${referenceId}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Map Persona status to our status
    let ourStatus = status || 'pending';
    if (status === 'approved' || status === 'completed') ourStatus = 'Approved';
    else if (status === 'declined' || status === 'failed') ourStatus = 'Declined';
    else if (status === 'expired') ourStatus = 'Expired';

    await supabase.from('reviewer_verifications').upsert({
      reviewer_session_id: referenceId ?? inquiryId,
      persona_inquiry_id:  inquiryId,
      status:              ourStatus,
      verified_at:         ourStatus === 'Approved' ? new Date().toISOString() : null,
    }, { onConflict: 'persona_inquiry_id' });

    return new Response(
      JSON.stringify({ message: 'Webhook processed' }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Persona webhook error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
