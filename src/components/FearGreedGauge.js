// FearGreedGauge.js — CNN Fear & Greed Index widget for home page

import { fetchProxy } from '../services/StockService.js';
import { t } from '../utils/i18n.js';

const FNG_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

// ── Zone definitions ───────────────────────────────────
const ZONES = [
  { max: 25,  key: 'fng_extreme_fear',  color: '#dc2626' },
  { max: 45,  key: 'fng_fear',          color: '#f97316' },
  { max: 55,  key: 'fng_neutral',       color: '#f59e0b' },
  { max: 75,  key: 'fng_greed',         color: '#84cc16' },
  { max: 100, key: 'fng_extreme_greed', color: '#16a34a' },
];

function getZone(score) {
  return ZONES.find(z => score <= z.max) || ZONES[ZONES.length - 1];
}

function ratingToKey(cnnRating) {
  const map = {
    'Extreme Fear': 'fng_extreme_fear',
    'Fear':         'fng_fear',
    'Neutral':      'fng_neutral',
    'Greed':        'fng_greed',
    'Extreme Greed':'fng_extreme_greed',
  };
  return map[cnnRating] || getZone(50).key;
}

// ── SVG gauge ──────────────────────────────────────────
const CX = 120, CY = 120, R = 100;
const DASHLEN = Math.PI * R;

function buildGaugeSVG(score, color) {
  const filled   = (DASHLEN * score / 100).toFixed(1);
  const unfilled = (DASHLEN - DASHLEN * score / 100).toFixed(1);
  const arcPath  = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  // Needle
  const angle     = Math.PI * (1 - score / 100);
  const needleLen = R - 22;
  const nx = (CX + needleLen * Math.cos(angle)).toFixed(1);
  const ny = (CY - needleLen * Math.sin(angle)).toFixed(1);

  // Zone tick lines at zone boundaries
  const ticks = [25, 45, 55, 75].map(tick => {
    const a  = Math.PI * (1 - tick / 100);
    const ix = (CX + (R - 12) * Math.cos(a)).toFixed(1);
    const iy = (CY - (R - 12) * Math.sin(a)).toFixed(1);
    const ox = (CX + (R + 11) * Math.cos(a)).toFixed(1);
    const oy = (CY - (R + 11) * Math.sin(a)).toFixed(1);
    return `<line x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}" stroke="var(--bg)" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 240 130" fill="none" class="fng-svg">
      <defs>
        <filter id="fng-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="fng-bg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#dc2626"/>
          <stop offset="25%"  stop-color="#f97316"/>
          <stop offset="50%"  stop-color="#f59e0b"/>
          <stop offset="75%"  stop-color="#84cc16"/>
          <stop offset="100%" stop-color="#16a34a"/>
        </linearGradient>
      </defs>

      <!-- Faint full-arc gradient background (zone reference) -->
      <path d="${arcPath}" stroke="url(#fng-bg-grad)" stroke-width="18" stroke-linecap="round" opacity="0.25"/>

      <!-- Grey track -->
      <path d="${arcPath}" stroke="var(--bg-3)" stroke-width="18" stroke-linecap="round"/>

      <!-- Filled progress arc -->
      <path d="${arcPath}" stroke="${color}" stroke-width="18" stroke-linecap="round"
        stroke-dasharray="${DASHLEN.toFixed(1)}" stroke-dashoffset="${unfilled}"
        filter="url(#fng-glow)" class="fng-arc"/>

      <!-- Zone tick separators -->
      ${ticks}

      <!-- Needle -->
      <line x1="${CX}" y1="${CY}" x2="${nx}" y2="${ny}"
        stroke="var(--text)" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${CX}" cy="${CY}" r="5" fill="var(--text)"/>
    </svg>`;
}

// ── Compare row ────────────────────────────────────────
function compareRow(labelKey, prevScore, currentScore) {
  if (prevScore == null) return '';
  const prev = Math.round(prevScore);
  const diff = Math.round(currentScore) - prev;
  const zone = getZone(prev);
  const arrow     = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
  const arrowColor = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text-3)';
  const diffStr   = diff !== 0 ? ` ${diff > 0 ? '+' : ''}${diff}` : '';

  return `
    <div class="fng-row">
      <span class="fng-row-label">${t(labelKey)}</span>
      <span class="fng-row-score" style="color:${zone.color}">${prev}</span>
      <span class="fng-row-arrow" style="color:${arrowColor}">${arrow}${diffStr}</span>
    </div>`;
}

// ── Public: load & render ──────────────────────────────
export async function loadFearGreed() {
  const container = document.getElementById('fng-container');
  if (!container) return;

  try {
    const json = await fetchProxy(FNG_URL);
    const fg   = json?.fear_and_greed;
    if (!fg?.score) throw new Error('no_data');

    const score    = Math.round(fg.score);
    const zone     = getZone(score);
    const labelKey = ratingToKey(fg.rating);

    container.innerHTML = `
      <div class="fng-gauge-wrap">
        ${buildGaugeSVG(score, zone.color)}
        <div class="fng-center">
          <span class="fng-score" style="color:${zone.color}">${score}</span>
          <span class="fng-label" style="color:${zone.color}">${t(labelKey)}</span>
        </div>
      </div>
      <div class="fng-compare">
        ${compareRow('fng_prev_close', fg.previous_close,   score)}
        ${compareRow('fng_prev_week',  fg.previous_1_week,  score)}
        ${compareRow('fng_prev_month', fg.previous_1_month, score)}
        ${compareRow('fng_prev_year',  fg.previous_1_year,  score)}
        <p class="fng-source">${t('fng_source')}</p>
      </div>`;
  } catch (e) {
    container.innerHTML = `<p class="fng-error">${t('fng_error')}</p>`;
  }
}
