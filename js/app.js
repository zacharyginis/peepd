/**
 * Peepd — app.js
 * All client-side interactivity for index.html, profile.html, write-review.html
 * Vanilla JS only — no frameworks, no libraries
 * Supabase integration via js/supabase.js
 */

'use strict';

// ─── Supabase (dynamic import so pages without module type still work) ────────
let _supabase = null;
let _getProfile, _getTopProfiles, _searchProfiles,
    _getReviewsForProfile, _submitReview,
    _castAccuracyVote, _subscribeToReviews, _subscribeToScore,
    _getSocialConnections, _saveSocialConnection,
  _getProfileBySlug,
    _signInWithOAuthProvider, _getAuthSession,
    _createDiditSession, _verifyDiditSession,
    _fetchLinkedInRecommendations,
    _saveWaitlistEntry, _saveJobApplication,
    _signOut, _getOrCreateMyProfile, _updateMyProfile, _submitReviewDispute, _sendReviewEmails;

async function loadSupabase() {
  if (_supabase) return;
  try {
    // Inject the local Supabase UMD bundle if not already loaded
    if (!window.supabase?.createClient) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/js/vendor/supabase.umd.js?v=2';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load Supabase UMD bundle'));
        document.head.appendChild(s);
      });
    }
    const mod = await import('./supabase.js?v=7');
    _supabase               = mod.supabase;
    _getProfile             = mod.getProfile;
    _getProfileBySlug       = mod.getProfileBySlug;
    _getTopProfiles         = mod.getTopProfiles;
    _searchProfiles         = mod.searchProfiles;
    _getReviewsForProfile   = mod.getReviewsForProfile;
    _submitReview           = mod.submitReview;
    _castAccuracyVote       = mod.castAccuracyVote;
    _subscribeToReviews     = mod.subscribeToReviews;
    _subscribeToScore       = mod.subscribeToScore;
    _getSocialConnections    = mod.getSocialConnections;
    _saveSocialConnection    = mod.saveSocialConnection;
    _signInWithOAuthProvider = mod.signInWithOAuthProvider;
    _getAuthSession          = mod.getAuthSession;
    _createDiditSession           = mod.createDiditSession;
    _verifyDiditSession           = mod.verifyDiditSession;
    _fetchLinkedInRecommendations = mod.fetchLinkedInRecommendations;
    _saveWaitlistEntry            = mod.saveWaitlistEntry;
    _saveJobApplication           = mod.saveJobApplication;
    _signOut                      = mod.signOut;
    _getOrCreateMyProfile         = mod.getOrCreateMyProfile;
    _updateMyProfile              = mod.updateMyProfile;
    _submitReviewDispute          = mod.submitReviewDispute;
    _sendReviewEmails              = mod.sendReviewEmails;

    // Listen for OAuth callbacks on all pages
    _supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const provider = session.user?.app_metadata?.provider;
        if (provider === 'linkedin_oidc') {
          if (document.getElementById('socialGate')) {
            await handleSocialOAuthCallback(session);
          }
        }
        // Refresh the nav user menu on every page after sign-in
        initNavUserMenu().catch(() => {});
        // On my-profile page, redirect to /{slug}
        if (document.getElementById('myProfileContent')) {
          loadMyProfilePage().catch(() => {});
        }
        // On profile page, check if this is now the user's own profile
        if (document.body.classList.contains('profile-page') && window._publicProfileRecord) {
          const prof = window._publicProfileRecord;
          if (prof.user_id && prof.user_id === session.user.id && !window._myProfileRecord) {
            enableOwnerMode(prof, session);
          }
        }
      }
    });
  } catch (e) {
    console.warn('Supabase module failed to load — running in demo mode.', e);
  }
}

// ─── Shared State ─────────────────────────────────────────────────────────────
const state = {
  selectedPerson:       null,
  selectedPersonIsSelf: false,
  selectedRelationship: null,
  ratings:              {},   // { 'work-ethic': 4, 'reliability': 5, … }
  pledgeSigned:         false,
};

const RESERVED_PROFILE_ROUTES = new Set([
  '',
  'profile',
  'write-review',
  'privacy-policy',
  'terms',
  'cookies',
  'my-profile',
  'how-it-works',
  'careers',
  'index.html',
  'profile.html',
  'write-review.html',
  'privacy-policy.html',
  'terms-of-service.html',
  'cookie-policy.html',
  'my-profile.html',
  'how-it-works.html',
  'careers.html',
]);

function normalizeProfileSlug(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function buildProfilePath(profile) {
  const slug = normalizeProfileSlug(profile?.slug) || normalizeProfileSlug(profile?.full_name || 'profile');
  return slug ? `/${slug}` : '/profile';
}

function getRequestedProfileSlug() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!path || RESERVED_PROFILE_ROUTES.has(path)) return null;
  return normalizeProfileSlug(decodeURIComponent(path));
}

// ─── Current profile ID — set from URL param ?id=<uuid> or falls back to demo ─
const DEMO_PROFILE_ID = null; // set to a real UUID after seeding

function getProfileId() {
  const params = new URLSearchParams(window.location.search);
  return window._publicProfileRecord?.id || params.get('id') || DEMO_PROFILE_ID;
}

async function resolvePublicProfile() {
  const isProfilePage = document.body.classList.contains('profile-page');
  if (!isProfilePage) return null;
  if (window._publicProfileRecord) return window._publicProfileRecord;

  const params = new URLSearchParams(window.location.search);
  const profileId = params.get('id');
  const profileSlug = getRequestedProfileSlug();

  if (!_getProfile && !_getProfileBySlug) return null;

  let profile = null;
  try {
    if (profileId && _getProfile) {
      profile = await _getProfile(profileId);
    } else if (profileSlug && _getProfileBySlug) {
      profile = await _getProfileBySlug(profileSlug);
    }
  } catch (e) {
    console.warn('Public profile resolve failed:', e);
    return null;
  }

  if (!profile) return null;

  window._publicProfileRecord = profile;
  applyPublicProfileData(profile);

  const canonicalPath = buildProfilePath(profile);
  const currentPath = window.location.pathname;
  if (canonicalPath && currentPath !== canonicalPath) {
    window.history.replaceState({}, '', canonicalPath);
  }

  // Detect if the signed-in user is viewing their own profile → enable owner mode
  try {
    const session = _getAuthSession ? await _getAuthSession() : null;
    if (session && profile.user_id && profile.user_id === session.user.id) {
      enableOwnerMode(profile, session);
    }
  } catch (e) { console.warn('Owner-mode check failed:', e); }

  return profile;
}

// ─── Owner Mode (viewing own profile at /{slug}) ──────────────────────────────
function enableOwnerMode(profile, session) {
  window._myProfileRecord = profile;

  // Replace hero action buttons with owner controls
  const heroActions = document.querySelector('.profile-hero__actions');
  if (heroActions) {
    heroActions.innerHTML = `
      <button class="btn btn--primary" onclick="openEditProfileModal()"><i class="fas fa-pen"></i> Edit Profile</button>
      <button class="btn btn--secondary" onclick="openRequestReviewModal()"><i class="fas fa-paper-plane"></i> Ask for Reviews</button>
      <button class="btn btn--ghost" onclick="openShareScoreModal()"><i class="fas fa-sparkles"></i> Share Score</button>
      <button class="btn btn--ghost" onclick="shareProfileUrl()"><i class="fas fa-link"></i> Copy Link</button>
    `;
  }

  // Inject Edit Profile modal if not already present
  if (!document.getElementById('editProfileModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="editProfileModal" onclick="closeEditProfileModal(event)">
        <div class="modal edit-profile-modal">
          <button class="auth-modal__close" onclick="closeEditProfileModal()" aria-label="Close"><i class="fas fa-xmark"></i></button>
          <div class="edit-profile-modal__header">
            <h2><i class="fas fa-user-pen" style="color:var(--purple); margin-right:8px;"></i> Edit Profile</h2>
            <p>Update your public profile. Changes are visible to everyone on Peepd.</p>
          </div>
          <form id="editProfileForm" onsubmit="saveProfileEdits(event)" novalidate>
            <div class="ep-field-row">
              <div class="ep-field"><label class="ep-label" for="epName">Full Name <span style="color:var(--purple);">*</span></label><input type="text" id="epName" class="social-input" placeholder="Jane Smith" autocomplete="name" /></div>
              <div class="ep-field"><label class="ep-label" for="epTitle">Job Title</label><input type="text" id="epTitle" class="social-input" placeholder="Product Designer" /></div>
            </div>
            <div class="ep-field-row">
              <div class="ep-field"><label class="ep-label" for="epCompany">Company</label><input type="text" id="epCompany" class="social-input" placeholder="Acme Inc." /></div>
              <div class="ep-field"><label class="ep-label" for="epLocation">Location</label><input type="text" id="epLocation" class="social-input" placeholder="San Francisco, CA" /></div>
            </div>
            <div class="ep-field"><label class="ep-label" for="epBio">Bio <span style="color:var(--text-muted); font-weight:400; text-transform:none;">(max 280 chars)</span></label><textarea id="epBio" class="ep-textarea" placeholder="Tell people a bit about yourself…" maxlength="280"></textarea></div>
            <div class="ep-field-row">
              <div class="ep-field"><label class="ep-label" for="epWebsite">Website</label><input type="url" id="epWebsite" class="social-input" placeholder="https://yoursite.com" /></div>
              <div class="ep-field"><label class="ep-label" for="epIndustry">Industry</label><select id="epIndustry" class="social-input"><option value="">&#8212; Select industry &#8212;</option><option value="Technology">Technology</option><option value="Finance">Finance</option><option value="Healthcare">Healthcare</option><option value="Marketing">Marketing</option><option value="Education">Education</option><option value="Legal">Legal</option><option value="Design">Design</option><option value="Engineering">Engineering</option><option value="Sales">Sales</option><option value="Human Resources">Human Resources</option><option value="Operations">Operations</option><option value="Media &amp; Entertainment">Media &amp; Entertainment</option><option value="Real Estate">Real Estate</option><option value="Other">Other</option></select></div>
            </div>
            <div class="ep-field"><label class="ep-label">Avatar Color</label><div class="avatar-picker" id="avatarPicker"><button type="button" class="avatar-pick avatar-1" data-class="avatar-1" title="Orange / Amber"></button><button type="button" class="avatar-pick avatar-2" data-class="avatar-2" title="Green / Cyan"></button><button type="button" class="avatar-pick avatar-3" data-class="avatar-3" title="Red / Orange"></button><button type="button" class="avatar-pick avatar-4" data-class="avatar-4" title="Orange / Pink"></button><button type="button" class="avatar-pick avatar-5" data-class="avatar-5" title="Cyan / Teal"></button><button type="button" class="avatar-pick avatar-6" data-class="avatar-6" title="Amber / Red"></button></div></div>
            <div id="epError" class="ep-error" style="display:none;"></div>
            <button type="submit" class="btn btn--primary" style="width:100%;" id="epSaveBtn"><i class="fas fa-check"></i> Save Changes</button>
          </form>
        </div>
      </div>
    `);
  }

  // Inject Dispute modal if not already present
  if (!document.getElementById('disputeModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="disputeModal" onclick="closeDisputeModal(event)">
        <div class="modal dispute-modal">
          <button class="auth-modal__close" onclick="closeDisputeModal()" aria-label="Close"><i class="fas fa-xmark"></i></button>
          <div id="disputeStateForm">
            <div class="dispute-modal__header"><div class="dispute-modal__icon"><i class="fas fa-flag"></i></div><h2>Dispute This Review</h2><p>Tell us why this review is inaccurate or violates our guidelines. Our team reviews disputes within 48 hours.</p></div>
            <form id="disputeForm" onsubmit="submitDisputeForm(event)" novalidate>
              <div class="ep-field"><label class="ep-label" for="disputeReason">Reason <span style="color:var(--purple);">*</span></label><select id="disputeReason" class="social-input"><option value="">— Select a reason —</option><option value="false_info">False or inaccurate information</option><option value="mistaken_identity">Wrong person / mistaken identity</option><option value="harassment">Harassment or bullying</option><option value="spam">Spam or fake review</option><option value="privacy">Privacy violation</option><option value="other">Other</option></select></div>
              <div class="ep-field"><label class="ep-label" for="disputeDetails">Additional Context <span style="color:var(--text-muted); font-weight:400; text-transform:none;">(optional)</span></label><textarea id="disputeDetails" class="ep-textarea" placeholder="Provide any details that help our team review this…" maxlength="500" style="min-height:80px;"></textarea></div>
              <div id="disputeError" class="ep-error" style="display:none;"></div>
              <button type="submit" class="btn btn--primary" style="width:100%;" id="disputeSubmitBtn"><i class="fas fa-flag"></i> Submit Dispute</button>
            </form>
            <p style="font-size:0.75rem; color:var(--text-muted); margin-top:12px; text-align:center;"><i class="fas fa-lock"></i> Disputes are fully confidential. We never reveal who disputed a review.</p>
          </div>
          <div id="disputeStateSuccess" style="display:none; text-align:center; padding:8px 0;"><div class="dispute-success-icon"><i class="fas fa-circle-check"></i></div><h2 style="margin-bottom:10px;">Dispute Submitted</h2><p style="color:var(--text-secondary); margin-bottom:24px;">We've received your dispute and will review it within 48 hours. You'll be notified if action is taken.</p><button class="btn btn--secondary" style="width:100%;" onclick="closeDisputeModal()">Close</button></div>
        </div>
      </div>
    `);
  }

  // Inject Request Review modal if not already present
  if (!document.getElementById('requestReviewModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="requestReviewModal" onclick="closeRequestReviewModal(event)">
        <div class="modal rr-modal">
          <button class="auth-modal__close" onclick="closeRequestReviewModal()" aria-label="Close"><i class="fas fa-xmark"></i></button>
          <div class="rr-modal__icon"><i class="fas fa-paper-plane"></i></div>
          <h2>Ask for Reviews</h2>
          <p>Share your profile with people who know you. Their honest reviews raise your Peepd Score.</p>
          <div class="rr-url-box"><input type="text" id="rrProfileUrl" class="rr-url-input" readonly placeholder="Loading your link…" /><button class="rr-copy-btn" onclick="copyReviewLink()" id="rrCopyBtn" title="Copy link"><i class="fas fa-copy"></i></button></div>
          <div class="rr-channels">
            <button class="rr-channel-btn rr-channel-btn--sms" onclick="requestReviewVia('sms')"><i class="fas fa-comment-sms"></i><span>Text / iMessage</span></button>
            <button class="rr-channel-btn rr-channel-btn--email" onclick="requestReviewVia('email')"><i class="fas fa-envelope"></i><span>Email</span></button>
            <button class="rr-channel-btn rr-channel-btn--linkedin" onclick="requestReviewVia('linkedin')"><i class="fab fa-linkedin"></i><span>LinkedIn</span></button>
            <button class="rr-channel-btn rr-channel-btn--email" onclick="requestReviewVia('copy')"><i class="fas fa-copy"></i><span>Copy Message</span></button>
          </div>
          <p class="rr-modal__note"><i class="fas fa-shield-halved"></i> Only people who know you can review you — self-reviews are blocked.</p>
        </div>
      </div>
    `);
  }

  // Inject Share Score modal if not already present
  if (!document.getElementById('shareScoreModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="shareScoreModal" onclick="closeShareScoreModal(event)">
        <div class="modal score-share-modal">
          <button class="auth-modal__close" onclick="closeShareScoreModal()" aria-label="Close"><i class="fas fa-xmark"></i></button>
          <div class="rr-modal__icon"><i class="fas fa-sparkles"></i></div>
          <h2>Share Your Peep'd Score</h2>
          <p>Pick who you're sending it to, then copy or send a polished message with your live score and public profile.</p>
          <div class="score-share__summary"><div class="score-share__stat"><span class="score-share__label">Score</span><strong id="ssScoreValue">—</strong></div><div class="score-share__stat"><span class="score-share__label">Tier</span><strong id="ssTierValue">—</strong></div><div class="score-share__stat"><span class="score-share__label">Reviews</span><strong id="ssReviewValue">—</strong></div></div>
          <div class="score-share__audiences">
            <button class="score-audience-btn active" data-audience="boss" onclick="selectScoreAudience('boss')"><i class="fas fa-briefcase"></i><span>Boss</span></button>
            <button class="score-audience-btn" data-audience="recruiter" onclick="selectScoreAudience('recruiter')"><i class="fas fa-magnifying-glass"></i><span>Recruiter</span></button>
            <button class="score-audience-btn" data-audience="date" onclick="selectScoreAudience('date')"><i class="fas fa-heart"></i><span>Date</span></button>
            <button class="score-audience-btn" data-audience="client" onclick="selectScoreAudience('client')"><i class="fas fa-handshake"></i><span>Client</span></button>
          </div>
          <div class="score-share__context" id="ssAudienceTitle">Sharing with a boss</div>
          <div class="rr-url-box"><input type="text" id="ssProfileUrl" class="rr-url-input" readonly placeholder="Loading your link…" /><button class="rr-copy-btn" onclick="copyScoreShareLink()" id="ssLinkCopyBtn" title="Copy profile link"><i class="fas fa-link"></i></button></div>
          <label class="ep-label" for="ssMessagePreview" style="text-align:left; display:block; margin-bottom:8px;">Message Preview</label>
          <textarea id="ssMessagePreview" class="ep-textarea score-share__preview" readonly></textarea>
          <div class="rr-channels score-share__channels">
            <button class="rr-channel-btn rr-channel-btn--email" onclick="shareScoreVia('copy')"><i class="fas fa-copy"></i><span>Copy Message</span></button>
            <button class="rr-channel-btn rr-channel-btn--sms" onclick="shareScoreVia('sms')"><i class="fas fa-comment-sms"></i><span>Text / iMessage</span></button>
            <button class="rr-channel-btn rr-channel-btn--email" onclick="shareScoreVia('email')"><i class="fas fa-envelope"></i><span>Email</span></button>
            <button class="rr-channel-btn rr-channel-btn--linkedin" onclick="shareScoreVia('linkedin')"><i class="fab fa-linkedin"></i><span>LinkedIn</span></button>
          </div>
          <p class="rr-modal__note"><i class="fas fa-shield-halved"></i> Your message always uses your live public profile URL and current Peep'd score.</p>
        </div>
      </div>
    `);
  }

  // Pre-fill edit form
  const ep = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  ep('epName',     profile.full_name);
  ep('epTitle',    profile.title);
  ep('epCompany',  profile.company);
  ep('epLocation', profile.location);
  ep('epBio',      profile.bio);
  ep('epWebsite',  profile.website);
  ep('epIndustry', profile.industry);

  // Load user's own reviews in the reviews tab
  if (_getReviewsForProfile) {
    _getReviewsForProfile(profile.id).then(reviews => {
      renderOwnerReviews(reviews);
    }).catch(e => console.warn('Owner reviews load failed:', e));
  }
}

function renderOwnerReviews(reviews) {
  const panel = document.getElementById('tab-reviews');
  if (!panel) return;

  if (!reviews || reviews.length === 0) {
    panel.innerHTML = `
      <div style="text-align:center; padding:48px 24px;">
        <i class="fas fa-star" style="font-size:2.5rem; color:var(--border-accent); margin-bottom:12px;"></i>
        <h4 style="margin-bottom:8px;">No reviews yet</h4>
        <p style="color:var(--text-muted); margin-bottom:20px;">Start collecting signal by inviting people who genuinely know you.</p>
        <button class="btn btn--primary" onclick="openRequestReviewModal()"><i class="fas fa-paper-plane"></i> Ask for Reviews</button>
      </div>`;
    const countEl = document.querySelector('[data-tab="reviews"] .tab-count');
    if (countEl) countEl.textContent = '0';
    return;
  }

  const catKeys   = ['rating_work_ethic','rating_reliability','rating_honesty','rating_character','rating_intelligence','rating_social_skills'];
  const catLabels = ['Work Ethic','Reliability','Honesty','Character','Intelligence','Social Skills'];

  const cards = reviews.map(r => {
    const rated    = catKeys.filter(k => r[k] != null);
    const avg      = rated.length ? rated.reduce((s,k) => s + r[k], 0) / rated.length : null;
    const starFull = avg ? Math.round(avg) : 0;
    const stars    = '\u2605'.repeat(starFull) + '\u2606'.repeat(5 - starFull);
    const rel      = r.relationship ? r.relationship.charAt(0).toUpperCase() + r.relationship.slice(1) : 'Reviewer';
    const cats     = rated.slice(0,3).map(k => '<span class="cat-rating"><span class="cat-label">' + catLabels[catKeys.indexOf(k)] + '</span><span class="cat-val">' + r[k] + '.0</span></span>').join('');
    const text     = r.review_text ? r.review_text.replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
    let html = '<div class="review-card">';
    html += '<div class="review-card__header">';
    html += '<div class="avatar avatar-2" style="width:40px;height:40px;font-size:0.8rem;flex-shrink:0;">?</div>';
    html += '<div class="review-card__reviewer"><div class="review-card__name">Anonymous Reviewer</div><div class="review-card__meta">' + rel + ' \u00b7 ' + timeAgo(r.created_at) + '</div></div>';
    html += '<div class="review-card__stars"><span class="stars-display">' + stars + '</span>';
    if (avg) html += '<span style="font-size:0.8rem;color:var(--text-muted);margin-left:4px;">' + avg.toFixed(1) + '</span>';
    html += '</div></div>';
    if (text) html += '<p class="review-card__text">&ldquo;' + text + '&rdquo;</p>';
    if (cats) html += '<div class="review-card__cats">' + cats + '</div>';
    html += '<div class="review-card__vote-dispute">';
    html += '<div class="review-card__vote"><span style="font-size:0.78rem;color:var(--text-muted);">Accurate?</span>';
    html += '<button class="vote-btn vote-yes" onclick="castVote(this,\'yes\')"><i class="fas fa-thumbs-up"></i> Yes</button>';
    html += '<button class="vote-btn vote-no" onclick="castVote(this,\'no\')"><i class="fas fa-thumbs-down"></i> No</button></div>';
    html += '<button class="btn-dispute-review" onclick="openDisputeModal(\'' + r.id + '\')"><i class="fas fa-flag"></i> Dispute</button>';
    html += '</div></div>';
    return html;
  }).join('');

  panel.innerHTML = '<div class="reviews-header"><h3 style="font-family:\'Sora\',sans-serif; font-size:1rem; font-weight:700;">Your Reviews</h3></div>' + cards;

  const countEl = document.querySelector('[data-tab="reviews"] .tab-count');
  if (countEl) countEl.textContent = reviews.length;

  // Animate accuracy meters
  setTimeout(() => {
    panel.querySelectorAll('.accuracy-meter__fill[data-width]').forEach(el => {
      el.style.width = el.dataset.width + '%';
    });
  }, 300);
}

function applyPublicProfileData(profile) {
  document.title = `${profile.full_name || 'Profile'} — Peepd Profile`;

  const hero = document.querySelector('.profile-hero');
  if (!hero) return;

  const avatarEl = hero.querySelector('.profile-hero__left .avatar');
  const nameEl = hero.querySelector('.profile-hero__name');
  const metaEl = hero.querySelector('.profile-hero__meta');
  const summaryEl = hero.querySelector('.profile-hero__summary');
  const tierBadge = hero.querySelector('.badge--tier-elite, .badge--tier-trusted, .badge--tier-established, .badge--tier-emerging, .badge--tier-phantom, .badge--tier-legendary');
  const scoreTierEl = document.querySelector('.score-gauge__tier');
  const reviewTabCount = document.querySelector('[data-tab="reviews"] .tab-count');

  if (avatarEl) {
    if (profile.avatar_url) {
      avatarEl.className = 'avatar avatar--photo avatar-xl';
      avatarEl.innerHTML = `<img src="${escHtml(profile.avatar_url)}" alt="${escHtml(profile.initials || profile.full_name || '')}" loading="lazy">`;
    } else {
      avatarEl.className = `avatar ${profile.avatar_class || 'avatar-1'} avatar-xl`;
      avatarEl.textContent = profile.initials || (profile.full_name || '').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    }
  }

  if (nameEl) nameEl.textContent = profile.full_name || 'Peepd Profile';

  if (metaEl) {
    const metaParts = [
      profile.title ? `<span><i class="fas fa-briefcase"></i> ${escHtml(profile.title)}</span>` : '',
      profile.company ? `<span><i class="fas fa-building"></i> ${escHtml(profile.company)}</span>` : '',
      profile.location ? `<span><i class="fas fa-map-pin"></i> ${escHtml(profile.location)}</span>` : '',
      profile.created_at ? `<span><i class="fas fa-calendar"></i> Joined Peepd ${escHtml(new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</span>` : '',
    ].filter(Boolean);
    metaEl.innerHTML = metaParts.join('');
  }

  if (summaryEl) {
    const reviews = Number(profile.review_count || 0);
    const tier = profile.tier || 'Emerging';
    const score = Number(profile.peep_score || 0);
    summaryEl.textContent = profile.bio
      || `${profile.full_name || 'This person'} has a Peepd Score of ${score} with ${reviews} verified review${reviews === 1 ? '' : 's'}, placing them in the ${tier} tier.`;
  }

  if (tierBadge && profile.tier) {
    tierBadge.textContent = `${tierEmoji(profile.tier)} ${profile.tier} Tier`;
    tierBadge.className = `badge badge--tier-${String(profile.tier).toLowerCase()}`;
  }

  if (scoreTierEl) scoreTierEl.textContent = profile.tier || 'Phantom';
  if (reviewTabCount) reviewTabCount.textContent = profile.review_count || 0;

  const scoreValue = document.getElementById('scoreValue');
  const gaugeArc = document.getElementById('gaugeArc');
  if (scoreValue && gaugeArc) {
    scoreValue.textContent = '0';
    animateGauge(gaugeArc, scoreValue, Number(profile.peep_score || 0), 1000, GAUGE_CIRCUMFERENCE);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  injectAnimations();
  await loadSupabase();
  await resolvePublicProfile();
  init();
  initNavUserMenu().catch(e => console.warn('NavUserMenu:', e));
  loadMyProfilePage().catch(e => console.warn('MyProfile:', e));
});

function init() {
  initNav();
  initScrollAnimations();
  initScoreGauge();
  initCategoryBars();
  initAccuracyMeters();
  initMiniScoreBars();
  initProfileTabs();
  initReviewFilters();
  initStarRatings();
  initReviewForm();
  initHistoryChart();
  initSearch();
  initSocialGate();
  initIdGate();
  initWaitlistForm();
  initProfileSocialConnections();
  loadTopProfiles();
  // Profile page: load live data
  const profileId = getProfileId();
  if (profileId) {
    loadReviews(profileId);
  }
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function initNav() {
  const nav = document.getElementById('mainNav');
  if (!nav) return;
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ─── Scroll Animations ────────────────────────────────────────────────────────
function initScrollAnimations() {
  const els = document.querySelectorAll('.fade-up');
  if (!els.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach(el => observer.observe(el));
}

// ─── Score Gauge (profile.html) ───────────────────────────────────────────────
const GAUGE_TARGET      = 847;
const GAUGE_MAX         = 1000;
const GAUGE_RADIUS      = 85;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS; // ≈ 534.07
// We only animate 75% of the circle (270 degrees) — the arc spans 3/4 of 360
const GAUGE_ARC_LENGTH  = GAUGE_CIRCUMFERENCE * 0.75;   // ≈ 400.55

function initScoreGauge() {
  const wrapper = document.getElementById('scoreGauge');
  if (!wrapper) return;
  const arc     = document.getElementById('gaugeArc');
  const valueEl = document.getElementById('scoreValue');
  if (!arc || !valueEl) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animateGauge(arc, valueEl, GAUGE_TARGET, GAUGE_MAX, GAUGE_CIRCUMFERENCE);
        observer.unobserve(wrapper);
      }
    });
  }, { threshold: 0.3 });
  observer.observe(wrapper);
}

function animateGauge(arc, valueEl, target, max, circumference) {
  const duration = 2000;
  const start    = performance.now();
  const arcLen   = circumference * 0.75; // 270-degree sweep

  const tick = (now) => {
    const t       = Math.min((now - start) / duration, 1);
    const eased   = easeOutCubic(t);
    const current = Math.round(eased * target);

    // stroke-dashoffset: full circumference = empty; 0 = full arc drawn
    // At score 0:   offset = circumference      (nothing drawn)
    // At score max: offset = circumference - arcLen (full arc drawn)
    const progress = current / max;
    const offset   = circumference - progress * arcLen;
    arc.setAttribute('stroke-dashoffset', offset.toFixed(2));
    valueEl.textContent = current;

    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── Category Bars (profile.html sidebar) ────────────────────────────────────
function initCategoryBars() {
  const fills = document.querySelectorAll('.category-bar__fill[data-width]');
  if (!fills.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animateBarToWidth(e.target);
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.3 });
  fills.forEach(fill => observer.observe(fill));
}

function animateBarToWidth(el) {
  const targetWidth = parseFloat(el.dataset.width);
  let start = null;
  const duration = 900;
  const tick = (ts) => {
    if (!start) start = ts;
    const t = Math.min((ts - start) / duration, 1);
    el.style.width = (easeOutCubic(t) * targetWidth) + '%';
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── Accuracy Meters (profile.html reviews) ──────────────────────────────────
function initAccuracyMeters() {
  const fills = document.querySelectorAll('.accuracy-meter__fill[data-width]');
  if (!fills.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animateBarToWidth(e.target);
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.2 });
  fills.forEach(fill => observer.observe(fill));
}

// ─── Mini Score Bars (index.html profile cards) ───────────────────────────────
function initMiniScoreBars() {
  const fills = document.querySelectorAll('.mini-score__fill');
  if (!fills.length) return;

  // Store original widths then reset to 0
  fills.forEach(fill => {
    const orig = fill.style.width;
    fill.dataset.origWidth = orig;
    fill.style.width = '0%';
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const orig = parseFloat(e.target.dataset.origWidth);
        if (!isNaN(orig)) {
          let start = null;
          const duration = 1000;
          const tick = (ts) => {
            if (!start) start = ts;
            const t = Math.min((ts - start) / duration, 1);
            e.target.style.width = (easeOutCubic(t) * orig) + '%';
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.3 });

  fills.forEach(fill => observer.observe(fill));
}

// ─── Profile Tabs ─────────────────────────────────────────────────────────────
function initProfileTabs() {
  const tabs = document.querySelectorAll('.profile-tab[data-tab]');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      // Deactivate all tabs and panels
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-tab-panel').forEach(p => p.classList.remove('active'));

      // Activate selected
      tab.classList.add('active');
      const panel = document.getElementById('tab-' + target);
      if (panel) panel.classList.add('active');

      // Re-trigger bar animations when switching to stats/about tabs
      if (target === 'stats') {
        setTimeout(() => {
          document.querySelectorAll('#tab-stats .category-bar__fill[data-width]').forEach(animateBarToWidth);
        }, 50);
      }
    });
  });
}

// ─── Review Filters (profile.html) ───────────────────────────────────────────
function initReviewFilters() {
  const btns = document.querySelectorAll('.filter-btn[data-filter]');
  if (!btns.length) return;
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// ─── Star Ratings (write-review.html) ────────────────────────────────────────
function initStarRatings() {
  const groups = document.querySelectorAll('.star-rating[data-category]');
  if (!groups.length) return;

  groups.forEach(group => {
    const category = group.dataset.category;
    const stars    = group.querySelectorAll('.star');
    const valLabel = document.getElementById('val-' + category);

    stars.forEach(star => {
      const val = parseInt(star.dataset.val, 10);

      star.addEventListener('mouseenter', () => {
        highlightStars(stars, val);
      });

      star.addEventListener('mouseleave', () => {
        const current = state.ratings[category] || 0;
        highlightStars(stars, current);
      });

      star.addEventListener('click', () => {
        state.ratings[category] = val;
        highlightStars(stars, val);

        if (valLabel) {
          const labels = ['', 'Poor', 'Below Average', 'Average', 'Good', 'Excellent'];
          valLabel.textContent = labels[val] || '';
          valLabel.style.color = val >= 4 ? 'var(--green)' : val === 3 ? 'var(--amber)' : 'var(--red)';
        }
      });
    });
  });
}

function highlightStars(stars, upTo) {
  stars.forEach(s => {
    const v = parseInt(s.dataset.val, 10);
    s.classList.toggle('active', v <= upTo);
  });
}

// ─── Char Counter (write-review.html) ────────────────────────────────────────
function updateCharCounter() {
  const textarea = document.getElementById('reviewText');
  const counter  = document.getElementById('charCounter');
  const warning  = document.getElementById('charWarning');
  if (!textarea || !counter) return;

  const len = textarea.value.length;
  counter.textContent = len + ' / 1200';

  // Update progress bar fill
  const fill = document.getElementById('charBarFill');
  if (fill) {
    const pct = Math.min(100, (len / 1200) * 100);
    fill.style.width = pct + '%';
    if (len === 0)        fill.style.background = '';
    else if (len < 80)    fill.style.background = 'var(--amber)';
    else if (len < 400)   fill.style.background = 'linear-gradient(90deg, var(--purple), var(--cyan))';
    else                  fill.style.background = 'linear-gradient(90deg, var(--green), #34D399)';
  }

  if (len === 0) {
    counter.className = 'char-counter';
    if (warning) warning.style.display = 'none';
  } else if (len < 80) {
    counter.className = 'char-counter warn';
    if (warning) warning.style.display = 'flex';
  } else {
    counter.className = 'char-counter ok';
    if (warning) warning.style.display = 'none';
  }
}

// ─── Writing Prompt Chip Inject (write-review.html) ──────────────────────────
function injectPrompt(text) {
  const textarea = document.getElementById('reviewText');
  if (!textarea) return;
  const cur = textarea.value.trim();
  textarea.value = cur ? cur + ' ' + text + ' ' : text + ' ';
  textarea.focus();
  updateCharCounter();
}

// ─── Relationship Selector (write-review.html) ───────────────────────────────
function selectRel(btn) {
  document.querySelectorAll('.rel-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.selectedRelationship = btn.dataset.rel;
}

// ─── Person Selector (write-review.html) ─────────────────────────────────────
function openPersonSearch() {
  // In a real app this would open a search modal.
  // Here we just focus the nav search input as a demo.
  const ns = document.getElementById('navSearch');
  if (ns) ns.focus();
}

function selectPerson(name, meta, initials, isSelf) {
  if (isSelf) {
    openModal('selfReviewModal');
    state.selectedPerson       = null;
    state.selectedPersonIsSelf = true;

    const alert = document.getElementById('selfReviewAlert');
    if (alert) alert.style.display = 'block';

    // Reset selector to placeholder
    const info        = document.getElementById('targetInfo');
    const placeholder = document.getElementById('targetPlaceholder');
    const selector    = document.getElementById('targetSelector');
    if (info)        info.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    if (selector)    selector.classList.remove('target-selected');
    return;
  }

  // Not self — populate the selector
  state.selectedPerson       = name;
  state.selectedPersonId     = null; // will be set by real search; null for demo quick-select
  state.selectedPersonIsSelf = false;

  const alert = document.getElementById('selfReviewAlert');
  if (alert) alert.style.display = 'none';

  const avatar      = document.getElementById('targetAvatar');
  const nameEl      = document.getElementById('targetName');
  const metaEl      = document.getElementById('targetMeta');
  const info        = document.getElementById('targetInfo');
  const placeholder = document.getElementById('targetPlaceholder');
  const selector    = document.getElementById('targetSelector');

  if (avatar)  { avatar.textContent  = initials; }
  if (nameEl)  { nameEl.textContent  = name; }
  if (metaEl)  { metaEl.textContent  = meta; }
  if (info)        info.style.display        = 'flex';
  if (placeholder) placeholder.style.display = 'none';
  if (selector)    selector.classList.add('target-selected');
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.querySelectorAll('.modal-overlay.open').forEach(m => {
    m.classList.remove('open');
  });
  document.body.style.overflow = '';
}

// Close on overlay backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ─── Hero Search ──────────────────────────────────────────────────────────────
function heroSearchSubmit() {
  const input = document.getElementById('heroSearch');
  if (!input || !input.value.trim()) return;
  const container = input.closest('.hero__search');
  const dropdown = container ? container.querySelector('.search-dropdown') : null;
  navigateToFirstResult(input, dropdown);
}

// ─── Review Form Validation & Submission ─────────────────────────────────────
function initReviewForm() {
  const form = document.getElementById('reviewForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitReview();
  });
}

function submitReview() {
  clearFormError();

  // 0. Social verification check
  const socialSession = getSocialSession();
  if (!socialSession || !socialSession.auth_verified) {
    const gate = document.getElementById('socialGate');
    if (gate) {
      gate.style.opacity = '1';
      gate.classList.remove('hidden');
      gate.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    showFormError('Please connect a verified social account before submitting a review.');
    return;
  }

  // 0b. ID verification check
  const idSession = getIdSession();
  if (!idSession || !idSession.verified) {
    const gate = document.getElementById('idGate');
    if (gate) {
      gate.style.opacity = '1';
      gate.classList.remove('hidden');
      gate.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    showFormError('You must complete ID and face verification before submitting a review.');
    return;
  }

  // 1. Self-review check
  if (state.selectedPersonIsSelf) {
    openModal('selfReviewModal');
    return;
  }

  // 2. Person selected?
  if (!state.selectedPerson) {
    showFormError('Please select who you are reviewing before submitting.');
    const selector = document.getElementById('targetSelector');
    if (selector) shakeEl(selector);
    return;
  }

  // 3. Relationship selected?
  if (!state.selectedRelationship) {
    showFormError('Please select your relationship with this person.');
    const relGrid = document.querySelector('.wr-rel-grid') || document.querySelector('.rel-grid');
    if (relGrid) shakeEl(relGrid);
    return;
  }

  // 4. At least one rating?
  const hasRating = Object.keys(state.ratings).length > 0;
  if (!hasRating) {
    showFormError('Please rate this person in at least one category.');
    const ratingsGrid = document.querySelector('.wr-rating-grid') || document.querySelector('.ratings-grid');
    if (ratingsGrid) shakeEl(ratingsGrid);
    return;
  }

  // 5. Text length?
  const textarea = document.getElementById('reviewText');
  if (!textarea || textarea.value.trim().length < 80) {
    showFormError('Your written review must be at least 80 characters long.');
    if (textarea) shakeEl(textarea);
    return;
  }

  // 6. Pledge signed?
  const pledge = document.getElementById('pledgeCheck');
  if (!pledge || !pledge.checked) {
    showFormError('You must agree to the accuracy pledge before submitting.');
    const pledgeLabel = document.querySelector('.pledge-label');
    if (pledgeLabel) shakeEl(pledgeLabel);
    return;
  }

  // All good — submit to Supabase then show success
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

  if (_submitReview) {
    const targetId = state.selectedPersonId || null;
    const review = {
      profile_id:            targetId,
      relationship:          state.selectedRelationship,
      rating_work_ethic:     state.ratings['work-ethic']     || null,
      rating_reliability:    state.ratings['reliability']    || null,
      rating_honesty:        state.ratings['honesty']        || null,
      rating_character:      state.ratings['character']      || null,
      rating_intelligence:   state.ratings['intelligence']   || null,
      rating_social_skills:  state.ratings['social-skills']  || null,
      review_text:           textarea.value.trim(),
    };
    _submitReview(review)
      .then(async () => {
        // Fire review emails (fire-and-forget)
        try {
          const session = _getAuthSession ? await _getAuthSession() : null;
          if (session && _sendReviewEmails) {
            const meta = session.user.user_metadata || {};
            _sendReviewEmails({
              reviewerEmail:     session.user.email || '',
              reviewerName:      (meta.full_name || meta.name || 'Someone').trim(),
              reviewedName:      state.selectedPerson || 'Someone',
              reviewedProfileId: state.selectedPersonId || '',
              relationship:      state.selectedRelationship || 'other',
            });
          }
        } catch { /* non-fatal */ }
        openModal('successModal');
      })
      .catch(err => {
        showFormError('Submission failed: ' + err.message);
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Review'; }
      });
  } else {
    // Demo mode
    openModal('successModal');
  }
}

function showFormError(msg) {
  clearFormError();
  const area = document.querySelector('.form-submit-area');
  if (!area) return;
  const div = document.createElement('div');
  div.id = 'formError';
  div.style.cssText = `
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.4);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 0.875rem;
    color: #FCA5A5;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  div.innerHTML = '<i class="fas fa-circle-exclamation"></i> ' + msg;
  area.insertBefore(div, area.firstChild);
}

function clearFormError() {
  const existing = document.getElementById('formError');
  if (existing) existing.remove();
}

function shakeEl(el) {
  el.classList.remove('shake');
  void el.offsetWidth; // trigger reflow
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 600);
}

// ─── Accuracy Votes (profile.html reviews + index accuracy section) ───────────
function castVote(btn, type) {
  const voteRow = btn.closest('.review-card__vote, .accuracy-votes');
  if (!voteRow) return;

  const allBtns = voteRow.querySelectorAll('.vote-btn');
  allBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

  btn.style.opacity = '1';
  if (type === 'yes') {
    btn.style.background = 'rgba(16,185,129,0.2)';
    btn.style.borderColor = 'rgba(16,185,129,0.6)';
    btn.style.color = 'var(--green)';
    showToast('Thanks! Your vote has been recorded.', 'success');
  } else {
    btn.style.background = 'rgba(239,68,68,0.15)';
    btn.style.borderColor = 'rgba(239,68,68,0.5)';
    btn.style.color = 'var(--red)';
    showToast('Review flagged as disputed. Thank you.', 'warning');
  }

  // Persist to Supabase
  const reviewCard = btn.closest('.review-card');
  const reviewId   = reviewCard ? reviewCard.dataset.reviewId : null;
  if (reviewId && _castAccuracyVote) {
    _castAccuracyVote(reviewId, type).catch(e => console.warn('Vote error:', e.message));
  }
}

function demoVote(btn, type) {
  castVote(btn, type);
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function showToast(msg, type) {
  const existing = document.querySelector('.peepd-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'peepd-toast';

  const colors = {
    success: { bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.4)',  icon: '✓', color: '#6EE7B7' },
    warning: { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.4)',  icon: '⚠', color: '#FCD34D' },
    info:    { bg: 'rgba(6,182,212,0.15)',   border: 'rgba(6,182,212,0.4)',   icon: 'ℹ', color: '#67E8F9' },
    error:   { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.4)',   icon: '✕', color: '#FCA5A5' },
  };
  const c = colors[type] || colors.info;

  toast.style.cssText = `
    position: fixed;
    bottom: 28px;
    right: 28px;
    z-index: 9999;
    background: ${c.bg};
    border: 1px solid ${c.border};
    color: ${c.color};
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 340px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    backdrop-filter: blur(12px);
    animation: toastIn 0.3s ease forwards;
  `;
  toast.innerHTML = `<span style="font-size:1.1rem">${c.icon}</span>${msg}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 310);
  }, 3000);
}

// ─── Score History Chart (profile.html stats tab) ─────────────────────────────
function initHistoryChart() {
  const container = document.getElementById('historyChart');
  if (!container) return;

  const scores = [640, 670, 695, 710, 720, 738, 755, 780, 800, 818, 832, 847];
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const W      = container.clientWidth || 600;
  const H      = 120;
  const padL   = 32;
  const padR   = 12;
  const padT   = 10;
  const padB   = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const minS   = Math.min(...scores) - 30;
  const maxS   = Math.max(...scores) + 20;
  const range  = maxS - minS;

  const toX = (i)  => padL + (i / (scores.length - 1)) * chartW;
  const toY = (s)  => padT + chartH - ((s - minS) / range) * chartH;

  // Build SVG polyline path
  const points = scores.map((s, i) => `${toX(i).toFixed(1)},${toY(s).toFixed(1)}`).join(' ');

  // Area fill path
  const firstX = toX(0).toFixed(1);
  const lastX  = toX(scores.length - 1).toFixed(1);
  const baseY  = (padT + chartH).toFixed(1);
  const areaPoints = `${firstX},${baseY} ` + scores.map((s, i) => `${toX(i).toFixed(1)},${toY(s).toFixed(1)}`).join(' ') + ` ${lastX},${baseY}`;

  // Build label ticks
  const labelTicks = labels.map((l, i) =>
    `<text x="${toX(i).toFixed(1)}" y="${H - 4}" fill="#64748B" font-size="9" text-anchor="middle">${l}</text>`
  ).join('');

  // Horizontal guide lines
  const guides = [minS + range * 0.25, minS + range * 0.5, minS + range * 0.75].map(v => {
    const y = toY(v).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  }).join('');

  container.innerHTML = `
    <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="overflow:visible;">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#7C3AED" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#7C3AED" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${guides}
      <polygon points="${areaPoints}" fill="url(#chartGrad)" />
      <polyline points="${points}" fill="none" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <defs>
        <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#7C3AED"/>
          <stop offset="50%"  stop-color="#06B6D4"/>
          <stop offset="100%" stop-color="#10B981"/>
        </linearGradient>
      </defs>
      ${scores.map((s, i) => {
        const x = toX(i).toFixed(1);
        const y = toY(s).toFixed(1);
        const isLast = i === scores.length - 1;
        return `<circle cx="${x}" cy="${y}" r="${isLast ? 5 : 3}" fill="${isLast ? '#10B981' : '#7C3AED'}" />`;
      }).join('')}
      ${labelTicks}
    </svg>
  `;
}

// ─── Search (nav + hero) ──────────────────────────────────────────────────────
function initSearch() {
  const pairs = [
    { inputId: 'navSearch',  containerSel: '.nav__search'  },
    { inputId: 'heroSearch', containerSel: '.hero__search' },
  ];

  pairs.forEach(({ inputId, containerSel }) => {
    const input = document.getElementById(inputId);
    const container = document.querySelector(containerSel);
    if (!input || !container) return;

    // Inject dropdown once
    let dropdown = container.querySelector('.search-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'search-dropdown hidden';
      container.appendChild(dropdown);
    }

    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (!q) { hideSearchDropdown(dropdown); return; }
      dropdown.innerHTML = '<div class="search-loading"><i class="fas fa-circle-notch fa-spin"></i></div>';
      dropdown.classList.remove('hidden');
      debounce = setTimeout(() => liveSearch(q, dropdown), 280);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateToFirstResult(input, dropdown);
      }
      if (e.key === 'Escape') hideSearchDropdown(dropdown);
    });
  });

  // Close all dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.search-dropdown').forEach(d => {
      if (!d.parentElement.contains(e.target)) hideSearchDropdown(d);
    });
  });
}

function hideSearchDropdown(dropdown) {
  if (!dropdown) return;
  dropdown.classList.add('hidden');
  dropdown.innerHTML = '';
}

async function liveSearch(query, dropdown) {
  if (!query) return;
  if (!_searchProfiles) {
    dropdown.innerHTML = '<div class="search-no-results">Search unavailable — please reload.</div>';
    return;
  }
  try {
    const results = await _searchProfiles(query);
    renderSearchDropdown(results, dropdown);
  } catch (e) {
    console.warn('Search error:', e.message);
    dropdown.innerHTML = '<div class="search-no-results">Something went wrong. Try again.</div>';
  }
}

function renderSearchDropdown(results, dropdown) {
  if (!dropdown) return;
  if (!results || results.length === 0) {
    dropdown.innerHTML = '<div class="search-no-results">No people found matching that name.</div>';
    dropdown.classList.remove('hidden');
    return;
  }
  dropdown.innerHTML = results.map(p => {
    const meta = [p.title, p.company].filter(Boolean).map(escHtml).join(' · ');
    const href = buildProfilePath(p);
    return `
      <a href="${href}" class="search-result-item">
        ${mkAvatarHtml(p)}
        <div class="search-result-info">
          <div class="search-result-name">${escHtml(p.full_name)}</div>
          ${meta ? `<div class="search-result-meta">${meta}</div>` : ''}
        </div>
        <span class="search-result-score">${p.peep_score ?? ''}</span>
      </a>`;
  }).join('');
  dropdown.classList.remove('hidden');
}

async function navigateToFirstResult(input, dropdown) {
  const q = input ? input.value.trim() : '';
  if (!q) return;
  // Use cached dropdown result if already rendered
  const firstLink = dropdown ? dropdown.querySelector('a.search-result-item') : null;
  if (firstLink) {
    window.location.href = firstLink.href;
    return;
  }
  // Fetch on-the-fly (e.g. if user pressed Enter before debounce fired)
  if (!_searchProfiles) return;
  try {
    const results = await _searchProfiles(q);
    if (results && results.length > 0) {
      window.location.href = buildProfilePath(results[0]);
    } else {
      if (dropdown) renderSearchDropdown([], dropdown);
    }
  } catch (e) {
    console.warn('Search navigate error:', e.message);
  }
}

// ─── Load Top Profiles (index.html) ──────────────────────────────────────────
async function loadTopProfiles() {
  if (!_getTopProfiles) return; // demo mode — static HTML already shown
  const grid = document.querySelector('.profiles-grid');
  if (!grid) return;
  try {
    const profiles = await _getTopProfiles(6);
    if (!profiles || profiles.length === 0) return;
    grid.innerHTML = profiles.map(p => `
      <a href="${buildProfilePath(p)}" class="card card--glow profile-card fade-up">
        <div class="profile-card__top">
          ${mkAvatarHtml(p)}
          <div class="profile-card__info">
            <div class="profile-card__name">${escHtml(p.full_name)}</div>
            <div class="profile-card__meta"><i class="fas fa-map-pin"></i> ${escHtml(p.location || '')} &nbsp;·&nbsp; ${escHtml(p.title || '')}</div>
            <div class="mini-score">
              <span class="mini-score__value">${p.peep_score}</span>
              <div class="mini-score__bar"><div class="mini-score__fill" style="width:${p.peep_score / 10}%"></div></div>
            </div>
          </div>
        </div>
        <div class="profile-card__footer">
          <div class="profile-card__review-count"><span>${p.review_count}</span> reviews &nbsp;·&nbsp; ${p.accuracy_rate}% accurate</div>
          <span class="badge badge--tier-${(p.tier || '').toLowerCase()}">${tierEmoji(p.tier)} ${p.tier}</span>
        </div>
      </a>
    `).join('');
    initScrollAnimations();
    initMiniScoreBars();
  } catch (e) {
    console.warn('Could not load top profiles:', e.message);
  }
}

// ─── Load Reviews (profile.html) ─────────────────────────────────────────────
async function loadReviews(profileId) {
  if (!_getReviewsForProfile || !profileId) return;
  const panel = document.getElementById('tab-reviews');
  if (!panel) return;
  try {
    const reviews = await _getReviewsForProfile(profileId);
    const existingCards = panel.querySelectorAll('.review-card');
    existingCards.forEach((card) => card.remove());

    const list = panel.querySelector('.review-list') || panel;
    // Inject reviews above the "Load more" button
    const loadMoreBtn = panel.querySelector('.load-more-btn');
    if (!reviews || reviews.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.style.cssText = 'padding:24px; text-align:center; color:var(--text-secondary);';
      empty.innerHTML = '<i class="fas fa-comments" style="font-size:1.5rem; margin-bottom:10px; color:var(--text-muted);"></i><p>No reviews yet for this profile.</p>';
      if (loadMoreBtn) panel.insertBefore(empty, loadMoreBtn);
      else list.appendChild(empty);
      return;
    }
    reviews.forEach(r => {
      const card = buildReviewCard(r);
      if (loadMoreBtn) panel.insertBefore(card, loadMoreBtn);
      else list.appendChild(card);
    });
    initAccuracyMeters();
  } catch (e) {
    console.warn('Could not load reviews:', e.message);
  }
}

function buildReviewCard(r) {
  const el = document.createElement('div');
  const isDisputed = r.accuracy_status === 'disputed' || r.accuracy_status === 'inaccurate';
  el.className = 'review-card' + (isDisputed ? ' review-card--disputed' : '');
  el.dataset.reviewId = r.id;

  const initials = '??';
  const stars = starStr(r.rating_work_ethic || 3);
  const accuracyPct = r.accuracy_pct ?? '—';
  const statusBadge = r.accuracy_status === 'accurate'
    ? `<span class="badge badge--accurate"><i class="fas fa-circle-check"></i> Accurate</span>`
    : r.accuracy_status === 'disputed'
    ? `<span class="badge badge--disputed"><i class="fas fa-triangle-exclamation"></i> Disputed</span>`
    : `<span class="badge" style="color:var(--text-muted);">Pending</span>`;

  el.innerHTML = `
    <div class="review-card__header">
      <div class="avatar avatar-1" style="width:40px;height:40px;font-size:0.8rem;flex-shrink:0;">${initials}</div>
      <div class="review-card__reviewer">
        <div class="review-card__name">Anonymous Reviewer</div>
        <div class="review-card__meta">${escHtml(r.relationship)} · ${timeAgo(r.created_at)}</div>
      </div>
      <div class="review-card__stars">
        <span class="stars-display">${stars}</span>
      </div>
    </div>
    <p class="review-card__text">${escHtml(r.review_text)}</p>
    <div class="review-card__accuracy">
      <div class="accuracy-meter">
        <div class="accuracy-meter__fill accuracy-meter__fill--${isDisputed ? 'amber' : 'green'}"
             data-width="${accuracyPct === '—' ? 0 : accuracyPct}" style="width:0%"></div>
      </div>
      <span class="accuracy-pct" style="color:var(--${isDisputed ? 'amber' : 'green'});">
        ${accuracyPct === '—' ? 'Pending' : accuracyPct + '% accurate'}
      </span>
      ${statusBadge}
    </div>
    <div class="review-card__vote">
      <span style="font-size:0.78rem;color:var(--text-muted);">Was this review accurate?</span>
      <button class="vote-btn vote-yes" onclick="castVote(this,'yes')"><i class="fas fa-thumbs-up"></i> Yes</button>
      <button class="vote-btn vote-no"  onclick="castVote(this,'no')"><i class="fas fa-thumbs-down"></i> No</button>
    </div>
  `;
  return el;
}

function starStr(rating) {
  const full = Math.round(rating || 0);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function tierEmoji(tier) {
  const map = { Phantom:'👻', Emerging:'🌱', Established:'⚡', Trusted:'🔵', Elite:'🔮', Legendary:'🏆' };
  return map[tier] || '';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renders an avatar div — photo <img> if avatar_url is set, else initials with gradient. */
function mkAvatarHtml(p, extraClass = '') {
  const cls = extraClass ? ' ' + extraClass : '';
  if (p.avatar_url) {
    return `<div class="avatar avatar--photo${cls}"><img src="${escHtml(p.avatar_url)}" alt="${escHtml(p.initials || '')}" loading="lazy"></div>`;
  }
  return `<div class="avatar ${escHtml(p.avatar_class || 'avatar-1')}${cls}">${escHtml(p.initials || '?')}</div>`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 60)  return mins  + ' minutes ago';
  if (hours < 24) return hours + ' hours ago';
  return days + ' days ago';
}

// ─── Expose functions needed by inline HTML onclick handlers ─────────────────
// ES modules don't attach to window automatically, so we do it explicitly.
window.selectPerson          = selectPerson;
window.selectRel             = selectRel;
window.openPersonSearch      = openPersonSearch;
window.heroSearchSubmit      = heroSearchSubmit;
window.castVote              = castVote;
window.demoVote              = demoVote;
window.closeModal            = closeModal;
window.updateCharCounter     = updateCharCounter;
window.injectPrompt          = injectPrompt;
window.connectWithOAuth      = connectWithOAuth;
window.submitManualCount     = () => {}; // removed — no manual count entry
window.resetSocialGate       = resetSocialGate;
window.disconnectSocial      = disconnectSocial;
window.startIdVerification   = startIdVerification;
window.retryIdVerification   = retryIdVerification;
window.openAuthModal         = openAuthModal;
window.closeAuthModal        = closeAuthModal;
window.toggleLinkedInImport  = toggleLinkedInImport;
window.applyLinkedInRec      = applyLinkedInRec;
window.clearLiImport         = clearLiImport;
window.applyLiPasteText      = applyLiPasteText;
window.updateLiPasteCount    = updateLiPasteCount;
window.openWaitlistModal     = openWaitlistModal;
window.closeWaitlistModal    = closeWaitlistModal;
window.toggleNavUserMenu     = toggleNavUserMenu;
window.doSignOut             = doSignOut;
window.shareProfileUrl       = shareProfileUrl;
window.openShareScoreModal   = openShareScoreModal;
window.closeShareScoreModal  = closeShareScoreModal;
window.selectScoreAudience   = selectScoreAudience;
window.copyScoreShareLink    = copyScoreShareLink;
window.shareScoreVia         = shareScoreVia;
window.openDisputeModal      = openDisputeModal;
window.closeDisputeModal     = closeDisputeModal;
window.submitDisputeForm     = submitDisputeForm;
window.openEditProfileModal      = openEditProfileModal;
window.closeEditProfileModal     = closeEditProfileModal;
window.saveProfileEdits          = saveProfileEdits;
window.openRequestReviewModal    = openRequestReviewModal;
window.closeRequestReviewModal   = closeRequestReviewModal;
window.copyReviewLink            = copyReviewLink;
window.requestReviewVia          = requestReviewVia;
window.submitJobApplication      = submitJobApplication;

// ─── Request Reviews Modal ─────────────────────────────────────────────────────
function openRequestReviewModal() {
  const modal = document.getElementById('requestReviewModal');
  if (!modal) return;
  const profile = window._myProfileRecord;
  const url = profile
    ? `${window.location.origin}${buildProfilePath(profile)}`
    : window.location.origin;
  const input = document.getElementById('rrProfileUrl');
  if (input) input.value = url;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeRequestReviewModal(e) {
  if (e && e.target !== e.currentTarget && e.type === 'click') return;
  const modal = document.getElementById('requestReviewModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

function copyReviewLink() {
  const input = document.getElementById('rrProfileUrl');
  if (!input) return;
  const btn = document.getElementById('rrCopyBtn');
  const reset = () => { if (btn) btn.innerHTML = '<i class="fas fa-copy"></i>'; };
  const done  = () => { if (btn) btn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(reset, 2000); showToast('Link copied!', 'success'); };
  navigator.clipboard.writeText(input.value).then(done).catch(() => {
    try { input.select(); document.execCommand('copy'); done(); } catch { showToast('Copy failed — select the link manually.', 'error'); }
  });
}

function requestReviewVia(channel) {
  const input    = document.getElementById('rrProfileUrl');
  const url      = input ? input.value : window.location.origin;
  const name     = window._myProfileRecord?.full_name || 'me';
  const first    = name.split(' ')[0];
  const msg      = `Hey! I joined Peepd and I'd love your honest take on me. Can you leave me a quick review? It only takes 2 minutes: ${url}`;
  const subject  = encodeURIComponent(`Would you review ${first} on Peepd?`);
  const body     = encodeURIComponent(`Hey,\n\nI joined Peepd — a platform where peers leave each other honest reviews. I'd really value your opinion of me.\n\nCould you take 2 minutes?\n\n${url}\n\nThanks!`);

  if (channel === 'copy') {
    navigator.clipboard.writeText(msg).then(() => {
      showToast('Review request copied!', 'success');
    }).catch(() => {
      try {
        if (input) {
          input.focus();
          input.select();
        }
      } catch {}
      showToast('Copy failed — select the message manually.', 'error');
    });
    return;
  }

  if (channel === 'sms') {
    window.location.href = `sms:?&body=${encodeURIComponent(msg)}`;
  } else if (channel === 'email') {
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  } else if (channel === 'linkedin') {
    navigator.clipboard.writeText(msg).catch(() => {});
    showToast('Message copied — paste it into a LinkedIn DM!', 'info');
    setTimeout(() => window.open('https://www.linkedin.com/messaging/', '_blank'), 900);
  }
}

const SCORE_SHARE_AUDIENCES = {
  boss: {
    label: 'Sharing with a boss',
    subject: (context) => `A quick snapshot of how my peers experience working with me`,
    body: (context) => `Hi — I wanted to share my Peep’d profile as a quick snapshot of how people experience working with me. I’m currently at a Peep’d Score of ${context.score} in the ${context.tier} tier, based on ${context.reviewCountText}.\n\nHere’s my profile: ${context.url}\n\nI thought it might be a helpful extra signal alongside my work history.`
  },
  recruiter: {
    label: 'Sharing with a recruiter',
    subject: (context) => `My Peep’d profile and peer reputation snapshot`,
    body: (context) => `Hi — sharing one extra data point that may help as you evaluate me. My Peep’d Score is currently ${context.score} (${context.tier} tier), based on ${context.reviewCountText}.\n\nProfile: ${context.url}\n\nIt’s a live snapshot of how peers rate my reliability, character, and work style.`
  },
  date: {
    label: 'Sharing with a date',
    subject: (context) => `A very 2026 way to vouch for myself 😄`,
    body: (context) => `Okay, this is a little bold, but funny and real: my Peep’d Score is ${context.score} in the ${context.tier} tier, based on ${context.reviewCountText}.\n\nIf you’re curious, here’s my profile: ${context.url}\n\nBasically: third-party proof I’m hopefully as solid as I seem.`
  },
  client: {
    label: 'Sharing with a client',
    subject: (context) => `My Peep’d profile for credibility and references`,
    body: (context) => `Hi — if helpful, here’s my Peep’d profile as a quick credibility snapshot. My current Peep’d Score is ${context.score} in the ${context.tier} tier, based on ${context.reviewCountText}.\n\nProfile: ${context.url}\n\nIt gives a concise view of how peers and collaborators rate working with me.`
  },
};

function getShareScoreContext() {
  const profile = window._myProfileRecord;
  const url = profile
    ? `${window.location.origin}${buildProfilePath(profile)}`
    : window.location.origin;
  const reviewCount = Number(profile?.review_count || 0);
  return {
    profile,
    url,
    name: profile?.full_name || 'I',
    firstName: (profile?.full_name || 'I').split(' ')[0],
    score: Number(profile?.peep_score || 0),
    tier: profile?.tier || 'Emerging',
    reviewCount,
    reviewCountText: reviewCount === 1 ? '1 review' : `${reviewCount} reviews`,
  };
}

function getSelectedScoreAudience() {
  return window._scoreShareAudience || 'boss';
}

function buildScoreShareMessage(audience = getSelectedScoreAudience()) {
  const context = getShareScoreContext();
  const preset = SCORE_SHARE_AUDIENCES[audience] || SCORE_SHARE_AUDIENCES.boss;
  return {
    audience,
    title: preset.label,
    subject: preset.subject(context),
    body: preset.body(context),
    context,
  };
}

function renderScoreShareComposer() {
  const { title, body, context, audience } = buildScoreShareMessage();
  const titleEl = document.getElementById('ssAudienceTitle');
  const scoreEl = document.getElementById('ssScoreValue');
  const tierEl = document.getElementById('ssTierValue');
  const reviewEl = document.getElementById('ssReviewValue');
  const urlEl = document.getElementById('ssProfileUrl');
  const previewEl = document.getElementById('ssMessagePreview');

  if (titleEl) titleEl.textContent = title;
  if (scoreEl) scoreEl.textContent = context.score;
  if (tierEl) tierEl.textContent = context.tier;
  if (reviewEl) reviewEl.textContent = context.reviewCount;
  if (urlEl) urlEl.value = context.url;
  if (previewEl) previewEl.value = body;

  document.querySelectorAll('.score-audience-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.audience === audience);
  });
}

function openShareScoreModal() {
  const modal = document.getElementById('shareScoreModal');
  if (!modal) {
    // If the modal isn't on this page, fall back to sharing the profile URL
    shareProfileUrl();
    return;
  }
  window._scoreShareAudience = 'boss';
  renderScoreShareComposer();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeShareScoreModal(e) {
  if (e && e.target !== e.currentTarget && e.type === 'click') return;
  const modal = document.getElementById('shareScoreModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

function selectScoreAudience(audience) {
  window._scoreShareAudience = audience;
  renderScoreShareComposer();
}

function copyScoreShareLink() {
  const input = document.getElementById('ssProfileUrl');
  if (!input) return;
  const btn = document.getElementById('ssLinkCopyBtn');
  const reset = () => { if (btn) btn.innerHTML = '<i class="fas fa-link"></i>'; };
  const done = () => { if (btn) btn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(reset, 2000); showToast('Profile link copied!', 'success'); };
  navigator.clipboard.writeText(input.value).then(done).catch(() => {
    try { input.select(); document.execCommand('copy'); done(); } catch { showToast('Copy failed — select the link manually.', 'error'); }
  });
}

async function shareScoreVia(channel) {
  const { subject, body } = buildScoreShareMessage();
  if (channel === 'copy') {
    try {
      await navigator.clipboard.writeText(body);
      showToast('Message copied!', 'success');
    } catch {
      const preview = document.getElementById('ssMessagePreview');
      if (preview) {
        preview.focus();
        preview.select();
      }
      showToast('Copy failed — select the message manually.', 'error');
    }
    return;
  }
  if (channel === 'sms') {
    window.location.href = `sms:?&body=${encodeURIComponent(body)}`;
    return;
  }
  if (channel === 'email') {
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return;
  }
  if (channel === 'linkedin') {
    navigator.clipboard.writeText(body).catch(() => {});
    showToast('Message copied — paste it into a LinkedIn DM!', 'info');
    setTimeout(() => window.open('https://www.linkedin.com/messaging/', '_blank'), 900);
  }
}

// ─── Auth Modal ────────────────────────────────────────────────────────────────
function openAuthModal(mode = 'signin') {
  const modal   = document.getElementById('authModal');
  const titleEl = document.getElementById('authModalTitle');
  const descEl  = document.getElementById('authModalDesc');
  if (!modal) return;
  if (titleEl) titleEl.textContent = mode === 'signup' ? 'Create your Peepd account' : 'Sign in to Peepd';
  if (descEl)  descEl.textContent  = mode === 'signup'
    ? 'Sign up with LinkedIn. We only request your public profile & connection count.'
    : 'Connect with LinkedIn to sign in. We only request your public profile & connection count.';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAuthModal(e) {
  // If called from onclick on overlay, only close when clicking the backdrop itself
  if (e && e.target !== e.currentTarget && e.type === 'click') return;
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── Job Application Form (careers.html) ──────────────────────────────────────
async function submitJobApplication(e) {
  if (e) e.preventDefault();
  const name      = document.getElementById('jaName')?.value.trim();
  const email     = document.getElementById('jaEmail')?.value.trim();
  const phone     = document.getElementById('jaPhone')?.value.trim();
  const location  = document.getElementById('jaLocation')?.value.trim();
  const linkedin  = document.getElementById('jaLinkedin')?.value.trim();
  const portfolio = document.getElementById('jaPortfolio')?.value.trim();
  const whyPeepd  = document.getElementById('jaWhyPeepd')?.value.trim();
  const experience = document.getElementById('jaExperience')?.value.trim();

  const errEl  = document.getElementById('jaError');
  const btn    = document.getElementById('jaSubmitBtn');

  function showErr(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  }

  if (!name || !email || !linkedin || !whyPeepd) {
    showErr('Please fill in all required fields.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showErr('Please enter a valid email address.');
    return;
  }
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting…'; }

  const application = {
    position:      'Founding CMO',
    full_name:     name,
    email,
    phone:         phone || null,
    linkedin_url:  linkedin || null,
    portfolio_url: portfolio || null,
    location:      location || null,
    why_peepd:     whyPeepd || null,
    experience:    experience || null,
  };

  try {
    if (_saveJobApplication) {
      await _saveJobApplication(application);
    }
    // Show success state
    const formSection = document.getElementById('applicationFormSection');
    const successEl   = document.getElementById('applicationSuccess');
    if (formSection) formSection.style.display = 'none';
    if (successEl)   successEl.style.display   = '';
    showToast('Application submitted!', 'success');
  } catch (err) {
    const dup = err?.message?.includes('duplicate') || err?.message?.includes('unique');
    showErr(dup ? 'Looks like you have already applied!' : 'Something went wrong. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Application'; }
  }
}

// ─── Waitlist Modal ────────────────────────────────────────────────────────────
function initWaitlistForm() {
  const form = document.getElementById('waitlistForm');
  if (!form) return;
  form.addEventListener('submit', submitWaitlist);
}

function openWaitlistModal() {
  const modal = document.getElementById('waitlistModal');
  if (!modal) return;
  document.getElementById('wlStateForm').style.display    = '';
  document.getElementById('wlStateSuccess').style.display = 'none';
  const errEl = document.getElementById('wlError');
  if (errEl) errEl.style.display = 'none';
  const form = document.getElementById('waitlistForm');
  if (form) form.reset();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeWaitlistModal(e) {
  if (e && e.target !== e.currentTarget && e.type === 'click') return;
  const modal = document.getElementById('waitlistModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

async function submitWaitlist(e) {
  if (e) e.preventDefault();
  const name      = document.getElementById('wlName')?.value.trim();
  const email     = document.getElementById('wlEmail')?.value.trim();
  const linkedin  = document.getElementById('wlLinkedin')?.value.trim();
  const birthdate = document.getElementById('wlBirthdate')?.value;
  const source    = document.getElementById('wlSource')?.value;
  const errEl     = document.getElementById('wlError');
  const submitBtn = document.getElementById('wlSubmitBtn');

  const showErr = (msg) => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  };

  if (!name)                                          return showErr('Please enter your full name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Please enter a valid email address.');
  if (!birthdate)                                     return showErr('Please enter your date of birth.');
  if (!source)                                        return showErr('Please tell us how you found Peepd.');

  if (errEl) errEl.style.display = 'none';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting…'; }

  const entry = {
    full_name:       name,
    email:           email,
    linkedin_url:    linkedin  || null,
    birthdate:       birthdate || null,
    referral_source: source,
  };

  try {
    if (_saveWaitlistEntry) {
      await _saveWaitlistEntry(entry);
      // Send confirmation email (fire-and-forget)
      if (email && _supabase) {
        _supabase.functions.invoke('send-email', {
          body: { type: 'waitlist_confirmation', to_email: email, to_name: name },
        }).then(({ error }) => {
          if (error) console.warn('[send-email waitlist]', error);
        }).catch(e => console.warn('[send-email waitlist]', e));
      }
    }
    document.getElementById('wlStateForm').style.display    = 'none';
    document.getElementById('wlStateSuccess').style.display = '';
    const emailDisplay = document.getElementById('wlSuccessEmail');
    if (emailDisplay) emailDisplay.textContent = email;
  } catch (err) {
    const dup = err?.message?.includes('duplicate') || err?.message?.includes('unique');
    showErr(dup ? 'That email is already on the waitlist!' : 'Something went wrong. Please try again.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Request Access'; }
  }
}

// ─── Nav User Menu ─────────────────────────────────────────────────────────────
async function initNavUserMenu() {
  const actionsEl = document.getElementById('navActions');
  if (!actionsEl) return;
  if (!_getAuthSession) return;
  let session;
  try { session = await _getAuthSession(); } catch { return; }
  if (!session) return;

  const user      = session.user;
  const meta      = user.user_metadata || {};
  const name      = (meta.full_name || meta.name || user.email || 'Me').trim();
  const firstName = name.split(' ')[0];
  const initials  = name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const avatarUrl  = meta.avatar_url || meta.picture || null;
  const navAvSmall = avatarUrl
    ? `<div class="nav__user-avatar nav__user-avatar--photo"><img src="${escHtml(avatarUrl)}" alt="${initials}"></div>`
    : `<div class="nav__user-avatar">${initials}</div>`;
  const navAvLarge = avatarUrl
    ? `<div class="nav__user-avatar nav__user-avatar--lg nav__user-avatar--photo"><img src="${escHtml(avatarUrl)}" alt="${initials}"></div>`
    : `<div class="nav__user-avatar nav__user-avatar--lg">${initials}</div>`;
  const provider  = user.app_metadata?.provider || '';
  const providerIcon = provider === 'linkedin_oidc'
    ? '<i class="fab fa-linkedin" style="color:#0A66C2;font-size:0.85rem;"></i>'
    : '<i class="fas fa-user" style="font-size:0.85rem;"></i>';

  // Ensure profile exists (create silently if first sign-in) & get slug for links
  let profilePath = '/profile';
  if (_getOrCreateMyProfile) {
    try {
      const myProfile = await _getOrCreateMyProfile(user);
      if (myProfile) profilePath = buildProfilePath(myProfile);
    } catch (e) { console.warn('Profile fetch for nav:', e); }
  }

  actionsEl.outerHTML = `
    <div class="nav__user-menu" id="navUserMenu">
      <button class="nav__user-btn" onclick="toggleNavUserMenu()">
        ${navAvSmall}
        <span class="nav__user-name">${firstName}</span>
        <i class="fas fa-chevron-down nav__user-caret" id="navUserCaret"></i>
      </button>
      <div class="nav__user-dropdown" id="navUserDropdown">
        <div class="nav__user-dropdown-header">
          ${navAvLarge}
          <div>
            <div class="nav__user-dropdown-name">${name}</div>
            <div class="nav__user-dropdown-email">${providerIcon} ${user.email || provider}</div>
          </div>
        </div>
        <a href="${profilePath}" class="nav__dropdown-item"><i class="fas fa-user-circle"></i> My Profile</a>
        <a href="${profilePath}" class="nav__dropdown-item" onclick="event.preventDefault();window.location.href='${profilePath}';"><i class="fas fa-pen"></i> Edit Profile</a>
        <a href="/write-review" class="nav__dropdown-item"><i class="fas fa-pen-to-square"></i> Write a Review</a>
        <button class="nav__dropdown-item" onclick="openShareScoreModal()"><i class="fas fa-sparkles"></i> Share My Score</button>
        <button class="nav__dropdown-item" onclick="shareProfileUrl()"><i class="fas fa-share-nodes"></i> Share My Profile</button>
        <div class="nav__dropdown-divider"></div>
        <button class="nav__dropdown-item nav__dropdown-item--danger" onclick="doSignOut()"><i class="fas fa-arrow-right-from-bracket"></i> Sign Out</button>
      </div>
    </div>`;

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('navUserMenu');
    if (menu && !menu.contains(e.target)) {
      const dd = document.getElementById('navUserDropdown');
      if (dd) dd.classList.remove('open');
    }
  });
}

function toggleNavUserMenu() {
  const dd    = document.getElementById('navUserDropdown');
  const caret = document.getElementById('navUserCaret');
  if (!dd) return;
  dd.classList.toggle('open');
  if (caret) caret.style.transform = dd.classList.contains('open') ? 'rotate(180deg)' : '';
}

async function doSignOut() {
  try { if (_signOut) await _signOut(); } catch (e) { console.warn('Sign-out error:', e); }
  ['peepd_social_session','peepd_id_session','peepd_reviewer_uid'].forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem('peepd_li_token');
  window.location.href = '/';
}

async function shareProfileUrl() {
  const profile = window._myProfileRecord;
  const url = profile
    ? `${window.location.origin}${buildProfilePath(profile)}`
    : window.location.origin;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Profile link copied!', 'success');
  } catch {
    prompt('Copy your profile link:', url);
  }
}

// ─── Dispute Review Modal ──────────────────────────────────────────────────────
let _disputeReviewId = null;

function openDisputeModal(reviewId) {
  _disputeReviewId = reviewId;
  const modal = document.getElementById('disputeModal');
  if (!modal) return;
  document.getElementById('disputeStateForm').style.display    = '';
  document.getElementById('disputeStateSuccess').style.display = 'none';
  const errEl = document.getElementById('disputeError');
  if (errEl) errEl.style.display = 'none';
  const form = document.getElementById('disputeForm');
  if (form) form.reset();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDisputeModal(e) {
  if (e && e.target !== e.currentTarget && e.type === 'click') return;
  const modal = document.getElementById('disputeModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
  _disputeReviewId = null;
}

async function submitDisputeForm(e) {
  if (e) e.preventDefault();
  const reason    = document.getElementById('disputeReason')?.value;
  const details   = document.getElementById('disputeDetails')?.value.trim();
  const errEl     = document.getElementById('disputeError');
  const submitBtn = document.getElementById('disputeSubmitBtn');

  if (!reason) {
    if (errEl) { errEl.textContent = 'Please select a reason.'; errEl.style.display = 'block'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting…'; }

  try {
    if (_submitReviewDispute && _disputeReviewId) {
      await _submitReviewDispute(_disputeReviewId, reason, details);
    }
    document.getElementById('disputeStateForm').style.display    = 'none';
    document.getElementById('disputeStateSuccess').style.display = '';
  } catch (err) {
    const dup = err?.message?.includes('unique') || err?.message?.includes('duplicate');
    if (errEl) {
      errEl.textContent = dup ? 'You already disputed this review.' : 'Submit failed — please try again.';
      errEl.style.display = 'block';
    }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-flag"></i> Submit Dispute'; }
  }
}

// ─── Edit Profile Modal ────────────────────────────────────────────────────────
function openEditProfileModal() {
  const modal = document.getElementById('editProfileModal');
  if (!modal) return;
  const errEl = document.getElementById('epError');
  if (errEl) errEl.style.display = 'none';

  // Avatar color picker — highlight the user's current choice
  const currentClass = window._myProfileRecord?.avatar_class || 'avatar-1';
  const picker = document.getElementById('avatarPicker');
  if (picker) {
    picker.querySelectorAll('.avatar-pick').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.class === currentClass);
      btn.onclick = () => {
        picker.querySelectorAll('.avatar-pick').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      };
    });
  }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeEditProfileModal(e) {
  if (e && e.target !== e.currentTarget && e.type === 'click') return;
  const modal = document.getElementById('editProfileModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

async function saveProfileEdits(e) {
  if (e) e.preventDefault();
  const name     = document.getElementById('epName')?.value.trim();
  const title    = document.getElementById('epTitle')?.value.trim();
  const company  = document.getElementById('epCompany')?.value.trim();
  const location = document.getElementById('epLocation')?.value.trim();
  const bio      = document.getElementById('epBio')?.value.trim();
  const errEl    = document.getElementById('epError');
  const btn      = document.getElementById('epSaveBtn');

  if (!name) {
    if (errEl) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving…'; }

  const website   = document.getElementById('epWebsite')?.value.trim();
  const industry  = document.getElementById('epIndustry')?.value;
  const picker    = document.getElementById('avatarPicker');
  const avatarCls = picker?.querySelector('.avatar-pick.selected')?.dataset.class
                 || window._myProfileRecord?.avatar_class || 'avatar-1';

  const parts    = name.split(/\s+/).filter(Boolean);
  const initials = parts.map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const updates  = { full_name: name, initials, title: title||null, company: company||null, location: location||null, bio: bio||null, website: website||null, industry: industry||null, avatar_class: avatarCls };

  try {
    const profileId = window._myProfileRecord?.id;
    if (_updateMyProfile && profileId) {
      const updated = await _updateMyProfile(profileId, updates);
      window._myProfileRecord = updated;
      const fill = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
      fill('mpName',     updated.full_name);
      fill('mpTitle',    updated.title);
      fill('mpCompany',  updated.company);
      fill('mpLocation', updated.location);
      fill('mpBio',      updated.bio || 'No bio yet.');
      fill('mpInitials', updated.initials);
      fill('abName',     updated.full_name);
      fill('abTitle',    updated.title);
      fill('abCompany',  updated.company);
      fill('abLocation', updated.location);
      const avatarEl = document.getElementById('mpAvatar');
      if (avatarEl) {
        if (updated.avatar_url) {
          avatarEl.className = 'avatar avatar--photo avatar-xl';
          avatarEl.innerHTML = `<img src="${escHtml(updated.avatar_url)}" alt="${escHtml(updated.initials || '')}" loading="lazy">`;
        } else {
          avatarEl.className = `avatar ${updated.avatar_class || 'avatar-1'} avatar-xl`;
        }
      }
      // Update nav avatar initials too
      document.querySelectorAll('.nav__user-avatar').forEach(el => { if (!el.querySelector('img')) el.textContent = updated.initials; });
      // Website (my-profile elements)
      const wsEl = g('mpWebsite'); const wsSpan = g('mpWebsiteSpan');
      if (wsSpan) {
        if (updated.website) { if (wsEl) { wsEl.href = updated.website; wsEl.textContent = updated.website; } wsSpan.style.display = ''; }
        else wsSpan.style.display = 'none';
      }
      // Industry (my-profile elements)
      const indEl = g('mpIndustry'); const indSpan = g('mpIndustrySpan');
      if (indSpan) {
        if (updated.industry) { if (indEl) indEl.textContent = updated.industry; indSpan.style.display = ''; }
        else indSpan.style.display = 'none';
      }
      fill('abIndustry', updated.industry || '—');
      const wsAbEl = g('abWebsite');
      if (wsAbEl) wsAbEl.innerHTML = updated.website
        ? `<a href="${updated.website}" target="_blank" rel="noopener" style="color:var(--purple);word-break:break-all;">${updated.website}</a>`
        : '—';
      // Also refresh the public profile hero if on the /{slug} profile page
      if (window._publicProfileRecord) {
        window._publicProfileRecord = updated;
        applyPublicProfileData(updated);
        // Update URL if slug changed
        const newPath = buildProfilePath(updated);
        if (newPath && window.location.pathname !== newPath) {
          window.history.replaceState({}, '', newPath);
        }
      }
    }
    closeEditProfileModal();
    showToast('Profile updated!', 'success');
  } catch (err) {
    if (errEl) { errEl.textContent = 'Save failed — please try again.'; errEl.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save Changes'; }
  }
}

// ─── My Profile Page — now redirects to /{slug} ──────────────────────────────
async function loadMyProfilePage() {
  const content = document.getElementById('myProfileContent');
  if (!content) return; // not on my-profile.html

  const loading   = document.getElementById('myProfileLoading');
  const noSession = document.getElementById('myProfileNoSession');

  let session;
  try { session = _getAuthSession ? await _getAuthSession() : null; } catch { session = null; }

  if (!session) {
    if (loading)   loading.style.display   = 'none';
    if (noSession) noSession.style.display = 'flex';
    return;
  }

  // Get the user's profile and redirect to their slug-based URL
  try {
    const profile = _getOrCreateMyProfile ? await _getOrCreateMyProfile(session.user) : null;
    if (profile) {
      const path = buildProfilePath(profile);
      if (path && path !== '/profile') {
        window.location.replace(path);
        return;
      }
    }
  } catch (e) {
    console.warn('Profile redirect failed:', e);
  }

  // Fallback: show the old my-profile page if redirect fails
  if (noSession) noSession.style.display = 'none';

  let profile;
  try {
    profile = _getOrCreateMyProfile ? await _getOrCreateMyProfile(session.user) : null;
  } catch (err) {
    console.error('Profile load failed:', err);
    if (loading) loading.style.display = 'none';
    // Show a helpful error rather than a blank page
    if (noSession) {
      noSession.style.display = 'flex';
      const isRLS = err?.message?.includes('policy') || err?.code === '42501';
      noSession.innerHTML = `
        <i class="fas fa-circle-exclamation" style="font-size:3rem; color:var(--border-accent); margin-bottom:8px;"></i>
        <h2>Couldn't load your profile</h2>
        <p style="color:var(--text-muted); max-width:400px; line-height:1.7;">${
          isRLS
            ? 'A database permission error occurred. Please apply the latest migration in Supabase (supabase/migrations/20260328150000_profile_auth_and_columns.sql).'
            : (err?.message || 'Something went wrong. Please try again.')
        }</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
          <button class="btn btn--primary btn--lg" onclick="window.location.reload()"><i class="fas fa-rotate-right"></i> Retry</button>
          <button class="btn btn--ghost btn--lg" onclick="doSignOut()"><i class="fas fa-arrow-right-from-bracket"></i> Sign Out</button>
        </div>
      `;
    }
    return;
  }
  if (!profile) { if (loading) loading.style.display = 'none'; return; }

  window._myProfileRecord = profile;

  // Fill hero
  const g = (id) => document.getElementById(id);
  const set = (id, val) => { const el = g(id); if (el) el.textContent = val || ''; };

  const avatarEl = g('mpAvatar');
  if (avatarEl) {
    if (profile.avatar_url) {
      avatarEl.className = 'avatar avatar--photo avatar-xl';
      avatarEl.innerHTML = `<img src="${escHtml(profile.avatar_url)}" alt="${escHtml(profile.initials || '')}" loading="lazy">`;
    } else {
      avatarEl.className = `avatar ${profile.avatar_class || 'avatar-1'} avatar-xl`;
    }
  }
  set('mpInitials',  profile.initials || profile.full_name.slice(0,2).toUpperCase());
  set('mpName',      profile.full_name);
  set('mpTitle',     profile.title    || '—');
  set('mpCompany',   profile.company  || '');
  set('mpLocation',  profile.location || '');
  set('mpBio',       profile.bio      || 'No bio yet. Click Edit Profile to add one.');
  if (profile.created_at) set('mpJoined', new Date(profile.created_at).toLocaleDateString('en-US',{month:'long',year:'numeric'}));

  // Industry & website in hero meta
  const wsEl = g('mpWebsite'); const wsSpan = g('mpWebsiteSpan');
  if (wsSpan) {
    if (profile.website) { if (wsEl) { wsEl.href = profile.website; wsEl.textContent = profile.website; } wsSpan.style.display = ''; }
    else wsSpan.style.display = 'none';
  }
  const indEl = g('mpIndustry'); const indSpan = g('mpIndustrySpan');
  if (indSpan) {
    if (profile.industry) { if (indEl) indEl.textContent = profile.industry; indSpan.style.display = ''; }
    else indSpan.style.display = 'none';
  }
  const tierBadge = g('mpTierBadge');
  const tierEmoji = { Phantom:'👻',Emerging:'🌱',Established:'⚡',Trusted:'🔵',Elite:'🔮',Legendary:'🏆' };
  if (tierBadge && profile.tier) tierBadge.textContent = `${tierEmoji[profile.tier]||''} ${profile.tier} Tier`;

  // Score gauge
  const arc        = g('gaugeArc');
  const scoreValue = g('scoreValue');
  if (arc && scoreValue) animateGauge(arc, scoreValue, profile.peep_score || 0, 1000, GAUGE_CIRCUMFERENCE);
  const tierLabel = document.querySelector('.score-gauge__tier');
  if (tierLabel) tierLabel.textContent = profile.tier || 'Phantom';

  // Stats + sidebar
  set('stReviewCount', profile.review_count || 0);
  set('stAccuracy',    profile.accuracy_rate ? `${Math.round(profile.accuracy_rate)}%` : '—');
  set('stScore',       profile.peep_score || 0);
  set('stTier',        profile.tier || 'Phantom');

  // Profile details
  set('abName',        profile.full_name);
  set('abTitle',       profile.title    || '—');
  set('abCompany',     profile.company  || '—');
  set('abLocation',    profile.location || '—');
  set('abReviewCount', profile.review_count || 0);
  if (profile.created_at) set('abJoined', new Date(profile.created_at).toLocaleDateString('en-US',{month:'long',year:'numeric'}));
  set('abIndustry', profile.industry || '—');
  const wsAbEl = g('abWebsite');
  if (wsAbEl) wsAbEl.innerHTML = profile.website
    ? `<a href="${profile.website}" target="_blank" rel="noopener" style="color:var(--purple);word-break:break-all;">${profile.website}</a>`
    : '—';

  // Linked account
  const prov = session.user.app_metadata?.provider;
  const providerEl = g('mpAccountProvider');
  if (providerEl) providerEl.innerHTML = prov === 'linkedin_oidc'
    ? '<i class="fab fa-linkedin" style="color:#0A66C2;"></i> LinkedIn'
    : '<i class="fas fa-user"></i> Social Account';
  set('mpAccountEmail', session.user.email || '');

  // Pre-fill edit modal
  const ep = (id, val) => { const el = g(id); if (el) el.value = val || ''; };
  ep('epName',     profile.full_name);
  ep('epTitle',    profile.title);
  ep('epCompany',  profile.company);
  ep('epLocation', profile.location);
  ep('epBio',      profile.bio);
  ep('epWebsite',  profile.website);
  ep('epIndustry', profile.industry);

  // Show content
  if (loading) loading.style.display = 'none';
  content.style.display = '';
  if (body) body.style.display = '';

  // Load reviews
  if (_getReviewsForProfile) {
    try {
      const reviews = await _getReviewsForProfile(profile.id);
      renderMyReviews(reviews);
    } catch (e) { console.warn('Reviews load failed:', e); }
  }
}

function renderMyReviews(reviews) {
  const list = g('myReviewsList');
  if (!list) return;

  if (!reviews || reviews.length === 0) {
    list.innerHTML = `
      <div class="my-profile-empty-state">
        <i class="fas fa-star"></i>
        <h4>No reviews yet</h4>
        <p>Start collecting signal by inviting people who genuinely know you.</p>
        <div class="my-profile-empty-state__actions">
          <button class="btn btn--primary" onclick="openRequestReviewModal()"><i class="fas fa-paper-plane"></i> Ask for Reviews</button>
          <button class="btn btn--ghost" onclick="openShareScoreModal()"><i class="fas fa-sparkles"></i> Share Your Score</button>
        </div>
      </div>`;
    return;
  }

  const catKeys   = ['rating_work_ethic','rating_reliability','rating_honesty','rating_character','rating_intelligence','rating_social_skills'];
  const catLabels = ['Work Ethic','Reliability','Honesty','Character','Intelligence','Social Skills'];

  list.innerHTML = reviews.map(r => {
    const rated    = catKeys.filter(k => r[k] != null);
    const avg      = rated.length ? rated.reduce((s,k) => s + r[k], 0) / rated.length : null;
    const starFull = avg ? Math.round(avg) : 0;
    const stars    = '★'.repeat(starFull) + '☆'.repeat(5 - starFull);
    const accPct   = r.accuracy_pct != null ? Math.round(r.accuracy_pct) : null;
    const accColor = accPct != null ? (accPct >= 80 ? 'var(--green)' : accPct >= 60 ? 'var(--amber)' : 'var(--red)') : 'var(--text-muted)';
    const accClass = accPct != null ? (accPct >= 80 ? 'accuracy-meter__fill--green' : accPct >= 60 ? 'accuracy-meter__fill--amber' : 'accuracy-meter__fill--red') : '';
    const rel      = r.relationship ? r.relationship.charAt(0).toUpperCase() + r.relationship.slice(1) : 'Reviewer';
    const cats     = rated.slice(0,3).map(k => `<span class="cat-rating"><span class="cat-label">${catLabels[catKeys.indexOf(k)]}</span><span class="cat-val">${r[k]}.0</span></span>`).join('');
    const text     = r.review_text.replace(/</g,'&lt;').replace(/>/g,'&gt;');

    return `
      <div class="review-card">
        <div class="review-card__header">
          <div class="avatar avatar-2" style="width:40px;height:40px;font-size:0.8rem;flex-shrink:0;">?</div>
          <div class="review-card__reviewer">
            <div class="review-card__name">Anonymous Reviewer</div>
            <div class="review-card__meta">${rel} · ${timeAgo(r.created_at)}</div>
          </div>
          <div class="review-card__stars">
            <span class="stars-display">${stars}</span>
            ${avg ? `<span style="font-size:0.8rem;color:var(--text-muted);margin-left:4px;">${avg.toFixed(1)}</span>` : ''}
          </div>
        </div>
        <p class="review-card__text">&ldquo;${text}&rdquo;</p>
        ${cats ? `<div class="review-card__cats">${cats}</div>` : ''}
        ${accPct != null ? `
        <div class="review-card__accuracy">
          <div class="accuracy-meter"><div class="accuracy-meter__fill ${accClass}" data-width="${accPct}" style="width:0%"></div></div>
          <span class="accuracy-pct" style="color:${accColor};">${accPct}% accurate</span>
        </div>` : ''}
        <div class="review-card__vote-dispute">
          <div class="review-card__vote">
            <span style="font-size:0.78rem;color:var(--text-muted);">Accurate?</span>
            <button class="vote-btn vote-yes" onclick="castVote(this,'yes')"><i class="fas fa-thumbs-up"></i> Yes</button>
            <button class="vote-btn vote-no" onclick="castVote(this,'no')"><i class="fas fa-thumbs-down"></i> No</button>
          </div>
          <button class="btn-dispute-review" onclick="openDisputeModal('${r.id}')">
            <i class="fas fa-flag"></i> Dispute
          </button>
        </div>
      </div>`;
  }).join('');

  setTimeout(() => {
    list.querySelectorAll('.accuracy-meter__fill[data-width]').forEach(el => {
      el.style.width = el.dataset.width + '%';
    });
  }, 300);
}

function g(id) { return document.getElementById(id); }

// ─── ID Verification Gate (Didit) ───────────────────────────────────────────────────
const ID_SESSION_KEY = 'peepd_id_session';

function getIdSession() {
  try { return JSON.parse(localStorage.getItem(ID_SESSION_KEY)); } catch { return null; }
}

function saveIdSession(data) {
  localStorage.setItem(ID_SESSION_KEY, JSON.stringify(data));
}

function getOrCreateReviewerSessionId() {
  let stored = localStorage.getItem('peepd_reviewer_uid');
  if (!stored) {
    stored = crypto.randomUUID();
    localStorage.setItem('peepd_reviewer_uid', stored);
  }
  return stored;
}

function showIdGateState(state) {
  ['Default', 'Loading', 'Verifying', 'Approved', 'Declined'].forEach(s => {
    const el = document.getElementById('igState' + s);
    if (el) el.style.display = (s === state) ? '' : 'none';
  });
}

/** On page load: check URL params (Didit callback) or existing session. */
async function initIdGate() {
  const gate = document.getElementById('idGate');
  if (!gate) return;

  // Already verified in this browser?
  const existing = getIdSession();
  if (existing && existing.verified) {
    gate.classList.add('hidden');
    return;
  }

  // Didit redirected back with ?verificationSessionId=xxx&status=Approved
  const params = new URLSearchParams(window.location.search);
  const diditSessionId = params.get('verificationSessionId');
  const diditStatus    = params.get('status');

  if (diditSessionId) {
    // Clean the URL so a refresh doesn't re-trigger
    const cleanUrl = window.location.pathname + (window.location.search
      .replace(/[?&]verificationSessionId=[^&]*/g, '')
      .replace(/[?&]status=[^&]*/g, '')
      .replace(/^&/, '?') || '');
    history.replaceState(null, '', cleanUrl);

    if (diditStatus === 'Approved') {
      // Optimistic: trust callback, but also verify server-side
      showIdGateState('Verifying');
      gate.classList.remove('hidden');
      await confirmIdSession(diditSessionId);
    } else {
      // Declined or In Review
      showIdGateState('Declined');
      const descEl = document.getElementById('igDeclinedDesc');
      if (descEl) descEl.textContent = `Verification returned status: "${diditStatus}". Please try again with a valid government ID.`;
      gate.classList.remove('hidden');
    }
    return;
  }

  // Not yet verified — gate stays hidden until the user tries to submit a review.
  // showIdGateState('Default') is intentionally NOT called here.
  showIdGateState('Default'); // pre-load the correct state; gate remains hidden
}

/** User clicks "Verify My Identity" */
async function startIdVerification() {
  const gate = document.getElementById('idGate');
  if (!gate) return;
  showIdGateState('Loading');

  if (!_createDiditSession) {
    showToast('ID verification service is not configured yet. Set DIDIT_API_KEY and DIDIT_WORKFLOW_ID in Supabase.', 'error');
    showIdGateState('Default');
    return;
  }

  try {
    const reviewerSessionId = getOrCreateReviewerSessionId();
    const { url, session_id } = await _createDiditSession(reviewerSessionId);
    // Save pending state
    saveIdSession({ session_id, verified: false, started_at: new Date().toISOString() });
    // Redirect to Didit hosted verification page
    window.location.href = url;
  } catch (e) {
    console.error('Didit session creation failed:', e);
    showToast('Could not start ID verification: ' + e.message, 'error');
    showIdGateState('Default');
  }
}

/** Verify the returned session ID against Didit's API */
async function confirmIdSession(diditSessionId) {
  const gate = document.getElementById('idGate');
  if (!_verifyDiditSession) {
    // Can't verify server-side — trust the URL param (dev mode)
    saveIdSession({ session_id: diditSessionId, verified: true, verified_at: new Date().toISOString() });
    showIdGateState('Approved');
    setTimeout(() => {
      if (gate) { gate.style.transition = 'opacity 0.4s'; gate.style.opacity = '0'; }
      setTimeout(() => gate && gate.classList.add('hidden'), 420);
    }, 1400);
    showToast('Identity verified! You can now submit reviews.', 'success');
    return;
  }

  try {
    const result = await _verifyDiditSession(diditSessionId);
    if (result.verified) {
      saveIdSession({ session_id: diditSessionId, verified: true, verified_at: new Date().toISOString() });
      showIdGateState('Approved');
      showToast('Identity verified! You can now submit reviews.', 'success');
      setTimeout(() => {
        if (gate) { gate.style.transition = 'opacity 0.4s'; gate.style.opacity = '0'; }
        setTimeout(() => gate && gate.classList.add('hidden'), 420);
      }, 1400);
    } else {
      const descEl = document.getElementById('igDeclinedDesc');
      if (descEl) descEl.textContent = `Verification status is "${result.status}". Please try again.`;
      showIdGateState('Declined');
    }
  } catch (e) {
    console.error('Didit verify error:', e);
    const descEl = document.getElementById('igDeclinedDesc');
    if (descEl) descEl.textContent = 'Could not confirm your verification result. Please try again.';
    showIdGateState('Declined');
  }
}

/** User clicks "Try Again" */
function retryIdVerification() {
  localStorage.removeItem(ID_SESSION_KEY);
  showIdGateState('Default');
}

// ─── Social Verification Gate (OAuth-based) ─────────────────────────────────────
const SOCIAL_SESSION_KEY = 'peepd_social_session';

function getSocialSession() {
  try { return JSON.parse(localStorage.getItem(SOCIAL_SESSION_KEY)); } catch { return null; }
}

function saveSocialSession(data) {
  localStorage.setItem(SOCIAL_SESSION_KEY, JSON.stringify(data));
}

// Switch between gate states: 'Default' | 'Loading' | 'Insufficient'
function showSocialGateState(state) {
  ['Default', 'Loading', 'Insufficient'].forEach(s => {
    const el = document.getElementById('sgState' + s);
    if (el) el.style.display = (s === state) ? '' : 'none';
  });
}

function initSocialGate() {
  const gate = document.getElementById('socialGate');
  if (!gate) return;

  // Already have a valid local social session — stay hidden
  const socialSession = getSocialSession();
  if (socialSession && socialSession.auth_verified) {
    showConnectedBanner(socialSession);
    return;
  }

  // Check for an existing Supabase auth session (OAuth return or page refresh)
  if (_getAuthSession) {
    _getAuthSession().then(session => {
      if (session) {
        const provider = session.user?.app_metadata?.provider;
        if (provider === 'linkedin_oidc') {
          // Already OAuth-authenticated — auto-approve, gate stays hidden
          const platform    = provider === 'linkedin_oidc' ? 'linkedin' : provider;
          const handle      = session.user?.user_metadata?.full_name
                           || session.user?.user_metadata?.name
                           || session.user?.email || '';
          if (!getSocialSession()) {
            const sessionData = { platform, handle, follower_count: 0, auth_verified: true, auth_user_id: session.user.id, verified_at: new Date().toISOString() };
            saveSocialSession(sessionData);
            showConnectedBanner(sessionData);
          }
          return;
        }
      }
      // Definitively not signed in — show the gate
      showSocialGateState('Default');
      gate.classList.remove('hidden');
    }).catch(() => {
      showSocialGateState('Default');
      gate.classList.remove('hidden');
    });
  } else {
    // Demo mode — show the gate
    showSocialGateState('Default');
    gate.classList.remove('hidden');
  }
}

function showConnectedBanner(session) {
  const banner = document.getElementById('socialConnectedBanner');
  if (!banner) return;
  const icons  = { linkedin: 'fab fa-linkedin', facebook: 'fab fa-facebook', instagram: 'fab fa-instagram' };
  const colors = { linkedin: '#0A66C2', facebook: '#1877F2', instagram: '#E1306C' };
  const terms  = { linkedin: 'connections', facebook: 'friends', instagram: 'followers' };
  const p = session.platform;
  const countPart = session.follower_count > 0
    ? `&nbsp;·&nbsp; ${Number(session.follower_count).toLocaleString()} ${terms[p] || 'connections'} verified`
    : `&nbsp;·&nbsp; <i class="fas fa-circle-check" style="color:var(--green); font-size:0.75rem;"></i>&nbsp;Account verified`;
  banner.innerHTML = `
    <i class="${icons[p] || 'fas fa-check'}" style="color:${colors[p] || 'var(--green)'}"></i>
    <strong>${escHtml(session.handle)}</strong>&nbsp;connected${countPart}
    <button class="btn btn--ghost btn--sm" style="margin-left:auto;font-size:0.72rem;padding:4px 10px;" onclick="disconnectSocial()">Disconnect</button>
  `;
  banner.style.display = 'flex';

  // Reveal LinkedIn import section on write-review page
  if (p === 'linkedin') {
    const liSection = document.getElementById('liImportSection');
    if (liSection) liSection.style.display = '';
  }
}

// Redirect to LinkedIn OAuth via Supabase
async function connectWithOAuth(provider) {
  if (provider !== 'linkedin_oidc') {
    showToast('LinkedIn is the only sign-in option right now.', 'info');
    return;
  }
  if (!_signInWithOAuthProvider) {
    showToast('Social sign-in is not configured yet. See setup instructions.', 'error');
    return;
  }
  try {
    // On write-review page: stay on current page so the social gate can process the callback.
    // On all other pages: redirect to home (will auto-redirect to /{slug} once profile is resolved).
    const redirectTo = document.getElementById('socialGate')
      ? null
      : `${window.location.origin}/my-profile`;
    await _signInWithOAuthProvider(provider, redirectTo);
    // Browser will redirect — nothing runs after this
  } catch (e) {
    showToast('Sign-in failed: ' + e.message, 'error');
  }
}

// Called by onAuthStateChange after OAuth redirect returns
async function handleSocialOAuthCallback(session) {
  const gate = document.getElementById('socialGate');
  if (!gate) return;

  const provider      = session.user?.app_metadata?.provider;
  const providerToken = session.provider_token;

  // Persist LinkedIn token for recommendations import (same-tab lifetime)
  if (provider === 'linkedin_oidc' && providerToken) {
    sessionStorage.setItem('peepd_li_token', providerToken);
  }

  const platformNames = { linkedin_oidc: 'LinkedIn' };
  const pName         = platformNames[provider] || provider;

  const loadingText = document.getElementById('sgLoadingText');
  if (loadingText) loadingText.textContent = `Fetching your ${pName} connection count…`;
  showSocialGateState('Loading');
  gate.classList.remove('hidden');

  let count = null;
  if (providerToken) {
    if (provider === 'linkedin_oidc') count = await fetchLinkedInConnectionCount(providerToken);
  }

  const handle = session.user?.user_metadata?.full_name
              || session.user?.user_metadata?.name
              || session.user?.email || '';

  if (count !== null) {
    if (count >= 500) {
      // ✅ API confirmed count — auto-verified with count
      const platform    = provider === 'linkedin_oidc' ? 'linkedin' : provider;
      const sessionData = { platform, handle, follower_count: count, auth_verified: true, auth_user_id: session.user.id, verified_at: new Date().toISOString() };
      saveSocialSession(sessionData);
      if (_saveSocialConnection) {
        _saveSocialConnection({ profile_id: null, platform, handle, follower_count: count }).catch(() => {});
      }
      gate.style.transition = 'opacity 0.4s ease';
      gate.style.opacity    = '0';
      setTimeout(() => gate.classList.add('hidden'), 420);
      showConnectedBanner(sessionData);
      showToast(`${pName} verified! ${count.toLocaleString()} connections confirmed.`, 'success');
    } else {
      // ❌ API confirmed count is too low
      const descEl = document.getElementById('sgInsufficientDesc');
      if (descEl) descEl.innerHTML = `Your ${pName} account shows <strong>${count.toLocaleString()}</strong> connections — you need 500+ to review on Peepd.`;
      showSocialGateState('Insufficient');
    }
  } else {
    // Count API not accessible (standard for OIDC scopes) — trust the OAuth sign-in itself.
    // Completing OAuth with LinkedIn proves a real, authenticated account.
    const platform    = provider === 'linkedin_oidc' ? 'linkedin' : provider;
    const sessionData = { platform, handle, follower_count: 0, auth_verified: true, auth_user_id: session.user.id, verified_at: new Date().toISOString() };
    saveSocialSession(sessionData);
    if (_saveSocialConnection) {
      _saveSocialConnection({ profile_id: null, platform, handle, follower_count: 0 }).catch(() => {});
    }
    gate.style.transition = 'opacity 0.4s ease';
    gate.style.opacity    = '0';
    setTimeout(() => gate.classList.add('hidden'), 420);
    showConnectedBanner(sessionData);
    showToast(`${pName} account verified!`, 'success');
  }
}

async function fetchLinkedInConnectionCount(accessToken) {
  // Attempt 1: LinkedIn network size endpoint
  try {
    const resp = await fetch(
      'https://api.linkedin.com/v2/networkSizes/urn:li:person:~?edgeType=ConnectedMember',
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data.firstDegreeSize === 'number') return data.firstDegreeSize;
    }
  } catch {}
  // Attempt 2: legacy numConnections field
  try {
    const resp2 = await fetch(
      'https://api.linkedin.com/v2/me?projection=(id,numConnections)',
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (resp2.ok) {
      const data2 = await resp2.json();
      if (typeof data2.numConnections === 'number') return data2.numConnections;
    }
  } catch {}
  return null;
}

// ─── LinkedIn Recommendations Import (write-review.html) ─────────────────────

function toggleLinkedInImport(checked) {
  const panel = document.getElementById('liImportPanel');
  if (!panel) return;
  if (checked) {
    panel.style.display = '';
    loadLinkedInRecommendations();
  } else {
    panel.style.display = 'none';
  }
}

async function loadLinkedInRecommendations() {
  showLiPanelState('Loading');
  const token = sessionStorage.getItem('peepd_li_token');

  if (!token || !_fetchLinkedInRecommendations) {
    showLiPanelState('Paste');
    return;
  }

  try {
    const result = await _fetchLinkedInRecommendations(token);
    const recs   = result.recommendations || [];

    if (recs.length === 0 || result.scope_denied) {
      showLiPanelState('Paste');
      return;
    }

    const list = document.getElementById('liRecList');
    if (list) {
      list.innerHTML = recs.map(r => {
        const name     = escHtml(r.recommendee_name || 'Unknown');
        const headline = escHtml(r.recommendee_headline || '');
        const excerpt  = escHtml(r.text || '');
        const rawText  = JSON.stringify(r.text || '');
        const rawName  = JSON.stringify(r.recommendee_name || 'LinkedIn');
        return `
          <div class="li-rec-card" onclick="applyLinkedInRec(${rawText}, ${rawName})">
            <div class="li-rec-card__name">${name}</div>
            ${headline ? `<div class="li-rec-card__headline">${headline}</div>` : ''}
            <div class="li-rec-card__excerpt">${excerpt}</div>
          </div>`;
      }).join('');
    }
    showLiPanelState('Results');
  } catch (e) {
    console.warn('LinkedIn recs fetch error:', e);
    showLiPanelState('Paste');
  }
}

function showLiPanelState(state) {
  ['Loading', 'Results', 'Paste', 'Success'].forEach(s => {
    const el = document.getElementById('liPanel' + s);
    if (el) el.style.display = (s === state) ? '' : 'none';
  });
}

function applyLinkedInRec(text, name) {
  const textarea = document.getElementById('reviewText');
  if (textarea) {
    textarea.value = text;
    updateCharCounter();
  }
  const successEl = document.getElementById('liPanelSuccess');
  if (successEl) {
    successEl.style.display = 'flex';
    successEl.innerHTML = `
      <i class="fas fa-circle-check" style="color:var(--green);"></i>
      Imported recommendation for <strong>${escHtml(name)}</strong>. You can still edit the text below.
      <button type="button" class="btn btn--ghost btn--sm" onclick="clearLiImport()" style="margin-left:auto; font-size:0.72rem; padding:4px 10px;">Clear</button>
    `;
  }
  showLiPanelState('Success');
}

function clearLiImport() {
  const check = document.getElementById('liImportCheck');
  const panel = document.getElementById('liImportPanel');
  if (check) check.checked = false;
  if (panel) panel.style.display = 'none';
}

function updateLiPasteCount() {
  const ta  = document.getElementById('liPasteArea');
  const btn = document.getElementById('liApplyBtn');
  if (ta && btn) btn.disabled = ta.value.trim().length < 20;
}

function applyLiPasteText() {
  const ta = document.getElementById('liPasteArea');
  if (!ta || ta.value.trim().length < 20) return;
  applyLinkedInRec(ta.value.trim(), 'LinkedIn');
}

function resetSocialGate() {
  if (_supabase) _supabase.auth.signOut().catch(() => {});
  window._verifiedProvider = null;
  window._verifiedHandle   = null;
  window._verifiedAuthId   = null;
  const countEl = document.getElementById('sgManualCount');
  const errEl   = document.getElementById('sgManualError');
  if (countEl) countEl.value = '';
  if (errEl)   errEl.style.display = 'none';
  showSocialGateState('Default');
}

async function disconnectSocial() {
  localStorage.removeItem(SOCIAL_SESSION_KEY);
  if (_supabase) await _supabase.auth.signOut().catch(() => {});
  const banner = document.getElementById('socialConnectedBanner');
  if (banner) banner.style.display = 'none';
  const gate = document.getElementById('socialGate');
  if (gate) {
    showSocialGateState('Default');
    gate.style.opacity = '1';
    gate.classList.remove('hidden');
  }
  showToast('Social account disconnected.', 'info');
}

// ─── Profile Social Connections (profile.html) ────────────────────────────────
async function initProfileSocialConnections() {
  const card = document.getElementById('profileSocialCard');
  if (!card) return;
  const profile = window._publicProfileRecord || await resolvePublicProfile();
  const profileId = profile?.id || getProfileId();
  if (!profileId || !_getSocialConnections) return;
  try {
    const connections = await _getSocialConnections(profileId);
    renderProfileSocialCard(card, connections);
  } catch (e) {
    console.warn('Could not load social connections:', e.message);
  }
}

function renderProfileSocialCard(card, connections) {
  const icons  = { linkedin: 'fab fa-linkedin', facebook: 'fab fa-facebook', instagram: 'fab fa-instagram' };
  const colors = { linkedin: '#0A66C2',          facebook: '#1877F2',          instagram: '#E1306C' };
  const terms  = { linkedin: 'connections',      facebook: 'friends',          instagram: 'followers' };

  if (!connections || connections.length === 0) {
    card.innerHTML = `
      <h3><i class="fas fa-link" style="color:var(--amber);"></i> Social Verification</h3>
      <div class="social-unverified-notice">
        <i class="fas fa-triangle-exclamation" style="margin-top:2px;"></i>
        <span>This profile hasn't connected a social account. Reviews are <strong>paused</strong> until the owner verifies 500+ connections.</span>
      </div>
    `;
    return;
  }

  const items = connections.map(c => `
    <div class="social-connection-item">
      <i class="${icons[c.platform] || 'fas fa-link'}" style="color:${colors[c.platform] || 'var(--purple)'}"></i>
      <span class="soc-handle">${escHtml(c.handle)}</span>
      <span class="soc-count">${Number(c.follower_count).toLocaleString()} ${terms[c.platform] || 'connections'}</span>
    </div>
  `).join('');

  card.innerHTML = `
    <h3><i class="fas fa-link" style="color:var(--cyan);"></i> Social Verification</h3>
    ${items}
    <div class="social-verified-badge">
      <i class="fas fa-circle-check"></i>
      Profile accepts reviews · Social verified
    </div>
  `;
}

// ─── Easing ───────────────────────────────────────────────────────────────────
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ─── Inject Keyframe Animations ───────────────────────────────────────────────
function injectAnimations() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%,100% { transform: translateX(0); }
      20%      { transform: translateX(-6px); }
      40%      { transform: translateX(6px); }
      60%      { transform: translateX(-4px); }
      80%      { transform: translateX(4px); }
    }
    .shake { animation: shake 0.5s ease; }

    @keyframes toastIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    @keyframes toastOut {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(8px) scale(0.97); }
    }
  `;
  document.head.appendChild(style);
}
