/**
 * supabase.js — Peepd Supabase client
 * Imports the Supabase JS client from the npm ESM build via a local path.
 *
 * Usage in other scripts:
 *   import { supabase } from './supabase.js';
 */

// createClient is provided by the UMD bundle injected by app.js (js/vendor/supabase.umd.js)
const { createClient } = window.supabase;

const SUPABASE_URL    = 'https://bluvcwdblzfdydvqmpyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsdXZjd2RibHpmZHlkdnFtcHlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNzkyODMsImV4cCI6MjA4OTY1NTI4M30.D3N42zxRw7SxZipSUueXwVDAb6IemGrMcNJCFDAArak';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Profiles ─────────────────────────────────────────────────────────────────

/**
 * Fetch a single profile by id.
 * @param {string} id
 */
export async function getProfile(id) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

function normalizeProfileSlug(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Fetch a single profile by slug-like name path (e.g. zacharyginis).
 * Prefers a real `slug` column if present, otherwise falls back to a client-side
 * normalized full_name match.
 * @param {string} slug
 */
export async function getProfileBySlug(slug) {
  const normalizedSlug = normalizeProfileSlug(slug);
  if (!normalizedSlug) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('slug', normalizedSlug)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Fetch all profiles ordered by peep_score descending.
 * @param {number} limit
 */
export async function getTopProfiles(limit = 20) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, slug, full_name, title, company, location, peep_score, tier, review_count, accuracy_rate, initials, avatar_class, avatar_url')
    .order('peep_score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * Search profiles by name (case-insensitive).
 * @param {string} query
 */
export async function searchProfiles(query) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, slug, full_name, title, company, initials, avatar_class, avatar_url, peep_score, tier')
    .ilike('full_name', `%${query}%`)
    .limit(10);
  if (error) throw error;
  return data;
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

/**
 * Fetch all reviews for a given profile.
 * @param {string} profileId
 */
export async function getReviewsForProfile(profileId) {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Submit a new review.
 * @param {object} review
 * @param {string} review.profile_id       - UUID of the person being reviewed
 * @param {string} review.relationship     - colleague | manager | report | friend | classmate | other
 * @param {number} review.rating_work_ethic
 * @param {number} review.rating_reliability
 * @param {number} review.rating_honesty
 * @param {number} review.rating_character
 * @param {number} review.rating_intelligence
 * @param {number} review.rating_social_skills
 * @param {string} review.review_text
 */
export async function submitReview(review) {
  const { data, error } = await supabase
    .from('reviews')
    .insert([review])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Accuracy Votes ───────────────────────────────────────────────────────────

/**
 * Cast an accuracy vote on a review.
 * @param {string} reviewId
 * @param {'yes'|'no'} vote
 */
export async function castAccuracyVote(reviewId, vote) {
  const { data, error } = await supabase
    .from('accuracy_votes')
    .insert([{ review_id: reviewId, vote }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Realtime ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to new reviews for a profile in realtime.
 * @param {string} profileId
 * @param {function} callback - called with the new review row
 * @returns {object} subscription — call .unsubscribe() to clean up
 */
export function subscribeToReviews(profileId, callback) {
  return supabase
    .channel(`reviews:profile_id=eq.${profileId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'reviews', filter: `profile_id=eq.${profileId}` },
      (payload) => callback(payload.new)
    )
    .subscribe();
}

/**
 * Subscribe to profile score updates in realtime.
 * @param {string} profileId
 * @param {function} callback - called with the updated profile row
 * @returns {object} subscription
 */
export function subscribeToScore(profileId, callback) {
  return supabase
    .channel(`profile:id=eq.${profileId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profileId}` },
      (payload) => callback(payload.new)
    )
    .subscribe();
}

// ─── Social Connections ────────────────────────────────────────────────────────

/**
 * Fetch verified social connections for a profile.
 * @param {string} profileId
 */
export async function getSocialConnections(profileId) {
  const { data, error } = await supabase
    .from('social_connections')
    .select('*')
    .eq('profile_id', profileId)
    .eq('is_verified', true);
  if (error) throw error;
  return data;
}

/**
 * Save (upsert) a social connection record.
 * @param {object} opts
 * @param {string|null} opts.profile_id
 * @param {string} opts.platform   - 'facebook' | 'linkedin' | 'instagram'
 * @param {string} opts.handle
 * @param {number} opts.follower_count
 */
export async function saveSocialConnection({ profile_id, platform, handle, follower_count }) {
  const row = { platform, handle, follower_count };
  if (profile_id) row.profile_id = profile_id;

  // Use insert with onConflict only when profile_id is present (unique constraint)
  if (profile_id) {
    const { data, error } = await supabase
      .from('social_connections')
      .upsert([row], { onConflict: 'profile_id,platform' })
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from('social_connections')
      .insert([row])
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────────────────────

/**
 * Sign in via OAuth (LinkedIn only).
 * Redirects the browser to the provider login page.
 */
export async function signInWithOAuthProvider(provider, overrideRedirectTo = null) {
  if (provider !== 'linkedin_oidc') {
    throw new Error('Only LinkedIn sign-in is currently available.');
  }
  const scopeMap = {
    linkedin_oidc: 'openid,profile,email',
  };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      scopes:     scopeMap[provider] || '',
      redirectTo: overrideRedirectTo || (window.location.origin + window.location.pathname),
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Get the current Supabase auth session.
 * provider_token (OAuth access token) is present right after callback.
 */
export async function getAuthSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// ─── Persona ID Verification ─────────────────────────────────────────────────

const EDGE_BASE = `${SUPABASE_URL}/functions/v1`;

/**
 * Fire-and-forget transactional email via the send-email Edge Function.
 * Never throws -- email failures are non-fatal.
 * @param {'welcome'|'review_submitted'|'review_received'} type
 * @param {object} payload
 */
async function fireEmail(type, payload) {
  try {
    const { data: s } = await supabase.auth.getSession();
    const token = s?.session?.access_token || SUPABASE_ANON_KEY;
    await fetch(`${EDGE_BASE}/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ type, ...payload }),
    });
  } catch (e) {
    console.warn('[fireEmail] non-fatal error:', e);
  }
}

/**
 * Create a Persona inquiry via the Edge Function.
 * Returns { inquiry_id, url } — redirect the user to `url`.
 * @param {string} referenceId  UUID stored in localStorage
 */
export async function createPersonaInquiry(referenceId) {
  const res = await fetch(`${EDGE_BASE}/persona-create-inquiry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ reference_id: referenceId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`createPersonaInquiry failed (${res.status}): ${txt}`);
  }
  return res.json();
}

/**
 * Fetch LinkedIn recommendations written BY the authenticated user.
 * Proxied via Edge Function to avoid CORS.
 * Returns { recommendations: Array, scope_denied?: boolean }
 * @param {string} accessToken  LinkedIn OAuth provider_token
 */
export async function fetchLinkedInRecommendations(accessToken) {
  const res = await fetch(`${EDGE_BASE}/linkedin-fetch-recs`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  if (!res.ok) throw new Error(`linkedin-fetch-recs failed: ${res.status}`);
  return res.json();
}

/**
 * Add a new entry to the waitlist table.
 * @param {{ full_name: string, email: string, linkedin_url?: string, birthdate?: string, referral_source: string }} entry
 */
export async function saveWaitlistEntry(entry) {
  const { error } = await supabase
    .from('waitlist')
    .insert([entry]);
  if (error) throw error;
}

/** Sign the current user out. */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get the profile linked to the current auth user, or create one automatically.
 * @param {object} user  supabase auth user object
 */
export async function getOrCreateMyProfile(user) {
  // First, try to find an existing profile linked to this auth user.
  // Use limit(1) + select so duplicate rows (possible before UNIQUE constraint) don't throw.
  const { data: rows, error: fe } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1);
  if (fe) throw fe;
  const existing = rows?.[0] ?? null;
  if (existing) {
    // Silently backfill avatar_url for profiles created before this feature
    const freshUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
    if (freshUrl && !existing.avatar_url) {
      supabase.from('profiles').update({ avatar_url: freshUrl }).eq('id', existing.id).then(() => {});
      existing.avatar_url = freshUrl;
    }
    return existing;
  }

  const raw      = (user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'New User').trim();
  const parts    = raw.split(/\s+/).filter(Boolean);
  const initials = parts.map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const avatarClasses = ['avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6'];
  const avatarClass   = avatarClasses[Math.abs((user.id.charCodeAt(0) || 0) - 48) % 6];
  const avatarUrl     = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

  const { data, error } = await supabase
    .from('profiles')
    .insert([{ full_name: raw, initials, avatar_class: avatarClass, avatar_url: avatarUrl, user_id: user.id }])
    .select()
    .single();

  if (error) {
    // avatar_url column not yet added (migration pending) — retry without it
    if (error.code === '42703' || error.message?.includes('avatar_url')) {
      const { data: d2, error: e2 } = await supabase
        .from('profiles')
        .insert([{ full_name: raw, initials, avatar_class: avatarClass, user_id: user.id }])
        .select()
        .single();
      if (e2) {
        if (e2.code === '23505' || e2.code === '42501' || e2.message?.includes('policy')) {
          const { data: r2rows, error: re } = await supabase.from('profiles').select('*').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1);
          if (re) throw re;
          if (r2rows?.[0]) return r2rows[0];
        }
        throw e2;
      }
      if (user.email) fireEmail('welcome', { to_email: user.email, to_name: raw });
      return d2;
    }
    // Race condition or RLS — try to SELECT the row that won the race
    if (error.code === '23505' || error.code === '42501' || error.message?.includes('policy')) {
      const { data: retryRows, error: re } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1);
      if (re) throw re;
      if (retryRows?.[0]) return retryRows[0];
    }
    throw error;
  }
  // Send welcome email to the new user (fire-and-forget)
  if (user.email) fireEmail('welcome', { to_email: user.email, to_name: raw });
  return data;
}

/**
 * Update a profile's editable fields (RLS enforces only own profile).
 * @param {string} profileId
 * @param {{ full_name?: string, title?: string, company?: string, location?: string, bio?: string, initials?: string, avatar_class?: string }} updates
 */
export async function updateMyProfile(profileId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', profileId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Fire both review-related transactional emails after a review is submitted.
 * Both calls are fire-and-forget and never block the UI.
 * @param {{ reviewerEmail: string, reviewerName: string, reviewedName: string, reviewedProfileId: string, relationship: string }} opts
 */
export function sendReviewEmails({ reviewerEmail, reviewerName, reviewedName, reviewedProfileId, relationship }) {
  // Confirmation to the reviewer
  if (reviewerEmail) {
    fireEmail('review_submitted', {
      to_email:      reviewerEmail,
      to_name:       reviewerName,
      reviewed_name: reviewedName,
      profile_id:    reviewedProfileId,
    });
  }
  // Notification to the person who was reviewed (email looked up server-side)
  if (reviewedProfileId) {
    fireEmail('review_received', {
      profile_id:   reviewedProfileId,
      relationship: relationship,
    });
  }
}

/**
 * Save a job application to the job_applications table.
 * @param {{ position: string, full_name: string, email: string, phone?: string, linkedin_url?: string, portfolio_url?: string, location?: string, why_peepd?: string, experience?: string }} application
 */
export async function saveJobApplication(application) {
  const { error } = await supabase
    .from('job_applications')
    .insert([application]);
  if (error) throw error;
}

/**
 * @param {string} reviewId
 * @param {'false_info'|'mistaken_identity'|'harassment'|'spam'|'privacy'|'other'} reason
 * @param {string} [details]
 */
export async function submitReviewDispute(reviewId, reason, details) {
  const { data, error } = await supabase
    .from('review_disputes')
    .insert([{ review_id: reviewId, reason, details: details || null }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Verify a Persona inquiry result via the Edge Function.
 * Returns { verified: boolean, status: string }
 * @param {string} inquiryId  inquiry-id from the Persona callback URL
 */
export async function verifyPersonaInquiry(inquiryId) {
  const res = await fetch(`${EDGE_BASE}/persona-verify-inquiry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ inquiry_id: inquiryId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`verifyPersonaInquiry failed (${res.status}): ${txt}`);
  }
  return res.json();
}
