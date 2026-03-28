/**
 * supabase.js — Peepd Supabase client
 * Imports the Supabase JS client from the npm ESM build via a local path.
 *
 * Usage in other scripts:
 *   import { supabase } from './supabase.js';
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

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

/**
 * Fetch all profiles ordered by peep_score descending.
 * @param {number} limit
 */
export async function getTopProfiles(limit = 20) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, title, company, location, peep_score, tier, review_count, accuracy_rate, initials, avatar_class')
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
    .select('id, full_name, title, company, initials, avatar_class, peep_score, tier')
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
 * Sign in via OAuth (facebook or linkedin_oidc).
 * Redirects the browser to the provider login page.
 */
export async function signInWithOAuthProvider(provider) {
  const scopeMap = {
    facebook:      'public_profile,email,user_friends',
    linkedin_oidc: 'openid,profile,email',
  };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      scopes:     scopeMap[provider] || '',
      redirectTo: window.location.origin + '/write-review.html',
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
