/**
 * send-email — Peepd transactional email via Resend
 *
 * Required secrets (set with `supabase secrets set KEY=value`):
 *   RESEND_API_KEY     — from resend.com dashboard
 *   SITE_URL           — e.g. https://peepd.com  (used for CTA links)
 *
 * POST body shapes:
 *   { type: 'welcome',           to_email, to_name }
 *   { type: 'review_submitted',  to_email, to_name, reviewed_name, profile_id }
 *   { type: 'review_received',   profile_id, relationship }
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const RESEND_KEY     = Deno.env.get('RESEND_API_KEY')           ?? '';
const SB_URL         = Deno.env.get('SUPABASE_URL')             ?? '';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SITE_URL       = Deno.env.get('SITE_URL')                 ?? 'https://peepd.com';
const FROM_EMAIL     = 'Peepd <noreply@peepd.com>';

// ─── Shared HTML shell ───────────────────────────────────────────────────────

function shell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Peepd</title>
</head>
<body style="margin:0;padding:0;background:#F0F0EF;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F0EF;padding:44px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

          <!-- HEADER -->
          <tr>
            <td align="center" style="background:#0A0804;padding:34px 40px;border-radius:14px 14px 0 0;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:900;color:#E05527;letter-spacing:6px;text-transform:uppercase;line-height:1;">PEEPD</div>
              <div style="margin-top:8px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:#6B5B4E;letter-spacing:2.5px;text-transform:uppercase;">Your Social Reputation Score</div>
            </td>
          </tr>

          <!-- ORANGE ACCENT LINE -->
          <tr>
            <td style="background:linear-gradient(90deg,#E05527,#F09000);height:3px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background:#FFFFFF;padding:44px 48px 36px;">
              ${body}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td align="center" style="background:#FAFAFA;padding:28px 40px;border-radius:0 0 14px 14px;border-top:1px solid #EBEBEB;">
              <p style="margin:0 0 6px;font-size:12px;color:#ABABAB;line-height:1.7;">You received this email because you have an account on Peepd.</p>
              <p style="margin:0 0 6px;font-size:12px;color:#ABABAB;">Peepd Inc. All rights reserved.</p>
              <p style="margin:0;font-size:12px;">
                <a href="${SITE_URL}" style="color:#E05527;text-decoration:none;font-weight:600;">Visit Peepd</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Reusable components ─────────────────────────────────────────────────────

function btn(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px auto 0;">
    <tr>
      <td align="center" bgcolor="#E05527" style="border-radius:8px;">
        <a href="${url}" style="display:inline-block;padding:15px 36px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.3px;border-radius:8px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

const divider = `<div style="border-top:1px solid #F0F0EF;margin:28px 0;"></div>`;

function step(num: string, title: string, desc: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
    <tr>
      <td width="36" valign="top">
        <div style="width:30px;height:30px;background:#FFF3EE;border-radius:8px;text-align:center;line-height:30px;font-size:13px;font-weight:800;color:#E05527;font-family:Arial,sans-serif;">${num}</div>
      </td>
      <td style="padding-left:14px;">
        <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#111827;font-family:Arial,sans-serif;">${title}</p>
        <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;font-family:Arial,sans-serif;">${desc}</p>
      </td>
    </tr>
  </table>`;
}

function bullet(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:12px;">
    <tr>
      <td width="20" valign="top" style="padding-top:5px;">
        <div style="width:8px;height:8px;background:#E05527;border-radius:50%;"></div>
      </td>
      <td>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.65;font-family:Arial,sans-serif;">${text}</p>
      </td>
    </tr>
  </table>`;
}

// ─── Template 1: Welcome ─────────────────────────────────────────────────────

function welcomeEmail(name: string): { subject: string; html: string } {
  const first = name.split(' ')[0];
  const html  = shell(`
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#111827;line-height:1.25;font-family:Arial,sans-serif;">Welcome to Peepd, ${first}.</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.7;font-family:Arial,sans-serif;">Your profile is live. Peepd is the community-powered reputation platform where your score is built entirely by people who know you best. No self-promotion. Only truth.</p>

    ${divider}

    <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:#ABABAB;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;">How it works</p>

    ${step('1', 'Share your profile link', 'Send it to colleagues, friends, and peers who can give you an honest review.')}
    ${step('2', 'Collect verified reviews', 'Every reviewer is identity-verified. No anonymous spam, no fake accounts.')}
    ${step('3', 'Build your Peepd Score', 'Your score (0 to 1000) updates in real time as reviews come in and are community-verified.')}

    ${btn('View My Profile', `${SITE_URL}/my-profile.html`)}

    ${divider}

    <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.7;text-align:center;font-family:Arial,sans-serif;">Questions? Reply to this email and our team will get back to you promptly.</p>
  `);
  return { subject: `Welcome to Peepd, ${first}`, html };
}

// ─── Template 2: Review Submitted ────────────────────────────────────────────

function reviewSubmittedEmail(reviewerFirstName: string, reviewedName: string, profileId: string): { subject: string; html: string } {
  const profileUrl = `${SITE_URL}/profile.html?id=${encodeURIComponent(profileId)}`;
  const html = shell(`
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom:24px;">
          <div style="display:inline-block;width:60px;height:60px;background:#FFF3EE;border-radius:16px;line-height:60px;font-size:28px;text-align:center;color:#E05527;font-family:Arial,sans-serif;">&#10003;</div>
        </td>
      </tr>
    </table>

    <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#111827;line-height:1.3;text-align:center;font-family:Arial,sans-serif;">Review Posted</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#6B7280;line-height:1.7;text-align:center;font-family:Arial,sans-serif;">Your honest review of <strong style="color:#111827;">${reviewedName}</strong> is now live on Peepd.</p>

    ${divider}

    ${bullet('The community can now vote on your review for accuracy. High-accuracy reviews carry more weight in their final Peepd Score.')}
    ${bullet('Your identity remains private. The person you reviewed will never see who wrote it.')}
    ${bullet('Thank you for making Peepd more honest. Every verified review strengthens the community.')}

    ${btn(`View ${reviewedName}'s Profile`, profileUrl)}

    ${divider}

    <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.7;text-align:center;font-family:Arial,sans-serif;">If you believe a review should be corrected, visit the profile page and use the dispute option.</p>
  `);
  return { subject: `Your review of ${reviewedName} was posted`, html };
}

// ─── Template 3: Review Received ─────────────────────────────────────────────

function reviewReceivedEmail(fullName: string, relationship: string): { subject: string; html: string } {
  const first = fullName.split(' ')[0];
  const relLabel: Record<string, string> = {
    colleague: 'A colleague',
    manager:   'A former or current manager',
    report:    'A direct report',
    friend:    'A friend',
    classmate: 'A classmate',
    other:     'Someone who knows you',
  };
  const from = relLabel[relationship] ?? 'Someone who knows you';
  const html = shell(`
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom:20px;">
          <div style="display:inline-block;padding:9px 20px;background:#FFF3EE;border-radius:10px;font-size:12px;font-weight:700;color:#E05527;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;">New Review</div>
        </td>
      </tr>
    </table>

    <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#111827;line-height:1.3;text-align:center;font-family:Arial,sans-serif;">${first}, you have a new review.</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#6B7280;line-height:1.7;text-align:center;font-family:Arial,sans-serif;">${from} just left you a review on Peepd. See what they said and how it affects your Peepd Score.</p>

    ${divider}

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F9FAFB;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #F0F0EF;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#ABABAB;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;">Reviewer relationship</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#111827;font-family:Arial,sans-serif;">${from}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#ABABAB;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;">Reviewer identity</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#111827;font-family:Arial,sans-serif;">Anonymous (Peepd-verified)</p>
        </td>
      </tr>
    </table>

    ${btn('See My Review', `${SITE_URL}/my-profile.html`)}

    ${divider}

    <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.7;text-align:center;font-family:Arial,sans-serif;">If this review seems inaccurate or violates community guidelines, you can submit a dispute from your profile page.</p>
  `);
  return { subject: `${first}, you just received a new review on Peepd`, html };
}

// ─── Template 4: Waitlist Confirmation ─────────────────────────────────────

function waitlistEmail(name: string): { subject: string; html: string } {
  const first = name.split(' ')[0];
  const html  = shell(`
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom:20px;">
          <div style="font-size:52px;line-height:1;">&#127881;</div>
        </td>
      </tr>
    </table>

    <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#111827;line-height:1.3;text-align:center;font-family:Arial,sans-serif;">You're on the list, ${first}!</h1>
    <p style="margin:0 0 28px;font-size:16px;color:#6B7280;line-height:1.75;text-align:center;font-family:Arial,sans-serif;">Consider yourself officially in the club. We got your spot saved and we are beyond excited to have you here.</p>

    ${divider}

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(135deg,#FFF7F4,#FFF3EE);border-radius:12px;border:1px solid #FDDCC8;margin-bottom:28px;">
      <tr>
        <td style="padding:28px 32px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#E05527;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">Mark your calendar</p>
          <p style="margin:0 0 4px;font-size:28px;font-weight:900;color:#111827;font-family:Arial,sans-serif;line-height:1.2;">Q2 2026</p>
          <p style="margin:0;font-size:14px;color:#6B7280;font-family:Arial,sans-serif;line-height:1.6;">That's when we're opening the doors. Early waitlist members get in first, and we'll send you a personal invite the moment your spot is ready.</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:#ABABAB;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,sans-serif;">What to expect</p>

    ${bullet('Early access before the public launch so you are first to build your Peepd Score.')}
    ${bullet('A personal invite email the day your account is activated.')}
    ${bullet('The ability to review people you know and be reviewed by people who know you.')}
    ${bullet('A verified, community-powered reputation score that actually means something.')}

    ${divider}

    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;text-align:center;font-family:Arial,sans-serif;">In the meantime, feel free to spread the word. The more honest people on Peepd, the better it works for everyone.</p>

    ${btn('Share Peepd', '${SITE_URL}')}

    ${divider}

    <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.7;text-align:center;font-family:Arial,sans-serif;">Got questions? Just reply to this email. We read every one.</p>
  `);
  return { subject: `You're on the Peepd waitlist, ${first}! (Q2 2026 launch)`, html };
}

// ─── Resend helper ───────────────────────────────────────────────────────────

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY secret is not set. Add it via: supabase secrets set RESEND_API_KEY=re_xxxx');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Resend error (${res.status}): ${txt}`);
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const body = await req.json();
    const { type } = body;

    if (type === 'welcome') {
      const { to_email, to_name } = body;
      if (!to_email || !to_name) throw new Error('Missing to_email or to_name');
      const { subject, html } = welcomeEmail(to_name);
      await send(to_email, subject, html);

    } else if (type === 'review_submitted') {
      const { to_email, to_name, reviewed_name, profile_id } = body;
      if (!to_email) throw new Error('Missing to_email');
      const { subject, html } = reviewSubmittedEmail(to_name ?? 'there', reviewed_name ?? 'Someone', profile_id ?? '');
      await send(to_email, subject, html);

    } else if (type === 'review_received') {
      const { profile_id, relationship } = body;
      if (!profile_id) throw new Error('Missing profile_id');

      // Use service role to look up the reviewed person's email server-side
      const admin = createClient(SB_URL, SB_SERVICE_KEY);
      const { data: profile, error: pe } = await admin
        .from('profiles')
        .select('user_id, full_name')
        .eq('id', profile_id)
        .single();
      if (pe || !profile?.user_id) throw new Error('Profile not found');

      const { data: userData, error: ue } = await admin.auth.admin.getUserById(profile.user_id);
      if (ue || !userData?.user?.email) throw new Error('User email not found');

      const { subject, html } = reviewReceivedEmail(profile.full_name, relationship ?? 'other');
      await send(userData.user.email, subject, html);

    } else if (type === 'waitlist_confirmation') {
      const { to_email, to_name } = body;
      if (!to_email || !to_name) throw new Error('Missing to_email or to_name');
      const { subject, html } = waitlistEmail(to_name);
      await send(to_email, subject, html);

    } else {
      throw new Error(`Unknown email type: "${type}"`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[send-email]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status:  500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
