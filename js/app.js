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
    _castAccuracyVote, _subscribeToReviews, _subscribeToScore;

async function loadSupabase() {
  if (_supabase) return;
  try {
    const mod = await import('./supabase.js');
    _supabase               = mod.supabase;
    _getProfile             = mod.getProfile;
    _getTopProfiles         = mod.getTopProfiles;
    _searchProfiles         = mod.searchProfiles;
    _getReviewsForProfile   = mod.getReviewsForProfile;
    _submitReview           = mod.submitReview;
    _castAccuracyVote       = mod.castAccuracyVote;
    _subscribeToReviews     = mod.subscribeToReviews;
    _subscribeToScore       = mod.subscribeToScore;
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

// ─── Current profile ID — set from URL param ?id=<uuid> or falls back to demo ─
const DEMO_PROFILE_ID = null; // set to a real UUID after seeding

function getProfileId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id') || DEMO_PROFILE_ID;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  injectAnimations();
  await loadSupabase();
  init();
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

  if (len === 0) {
    counter.className = 'char-counter';
    if (warning) warning.style.display = 'none';
  } else if (len < 80) {
    counter.className = 'char-counter warn';
    if (warning) warning.style.display = 'block';
  } else {
    counter.className = 'char-counter ok';
    if (warning) warning.style.display = 'none';
  }
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
  if (input && input.value.trim()) {
    window.location.href = 'profile.html';
  }
}

// Allow pressing Enter in the hero search
document.addEventListener('DOMContentLoaded', () => {
  const heroSearch = document.getElementById('heroSearch');
  if (heroSearch) {
    heroSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') heroSearchSubmit();
    });
  }
  const navSearch = document.getElementById('navSearch');
  if (navSearch) {
    navSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && navSearch.value.trim()) {
        window.location.href = 'profile.html';
      }
    });
  }
});

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
    const relGrid = document.querySelector('.rel-grid');
    if (relGrid) shakeEl(relGrid);
    return;
  }

  // 4. At least one rating?
  const hasRating = Object.keys(state.ratings).length > 0;
  if (!hasRating) {
    showFormError('Please rate this person in at least one category.');
    const ratingsGrid = document.querySelector('.ratings-grid');
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
      .then(() => openModal('successModal'))
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
  const inputs = [
    document.getElementById('navSearch'),
    document.getElementById('heroSearch'),
  ].filter(Boolean);

  inputs.forEach(input => {
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => liveSearch(input.value.trim()), 280);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) heroSearchSubmit();
    });
  });
}

async function liveSearch(query) {
  if (!query || !_searchProfiles) return;
  try {
    const results = await _searchProfiles(query);
    // Future: render a dropdown — currently navigates on Enter
    console.debug('Search results:', results);
  } catch (e) {
    console.warn('Search error:', e.message);
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
      <a href="profile.html?id=${p.id}" class="card card--glow profile-card fade-up">
        <div class="profile-card__top">
          <div class="avatar ${p.avatar_class || 'avatar-1'}">${p.initials || '?'}</div>
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
    if (!reviews || reviews.length === 0) return;
    const list = panel.querySelector('.review-list') || panel;
    // Inject reviews above the "Load more" button
    const loadMoreBtn = panel.querySelector('.load-more-btn');
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
window.selectPerson      = selectPerson;
window.selectRel         = selectRel;
window.openPersonSearch  = openPersonSearch;
window.heroSearchSubmit  = heroSearchSubmit;
window.castVote          = castVote;
window.demoVote          = demoVote;
window.closeModal        = closeModal;
window.updateCharCounter = updateCharCounter;

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
