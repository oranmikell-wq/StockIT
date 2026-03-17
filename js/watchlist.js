// watchlist.js — watchlist + התראות in-app

function getWatchlist() {
  try { return JSON.parse(localStorage.getItem('bon-watchlist') || '[]'); }
  catch { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem('bon-watchlist', JSON.stringify(list));
}

function isInWatchlist(symbol) {
  return getWatchlist().some(w => w.symbol === symbol);
}

function addToWatchlist(symbol, name, rating) {
  const list = getWatchlist();
  if (list.some(w => w.symbol === symbol)) return;
  list.push({ symbol, name, rating, addedAt: Date.now() });
  saveWatchlist(list);
  showNotification(t('watchlistAdded'));
  updateWatchlistBtn(symbol);
}

function removeFromWatchlist(symbol) {
  const list = getWatchlist().filter(w => w.symbol !== symbol);
  saveWatchlist(list);
  showNotification(t('watchlistRemoved'));
  updateWatchlistBtn(symbol);
  if (document.getElementById('page-watchlist').classList.contains('active')) {
    renderWatchlist();
  }
}

function toggleWatchlist(symbol, name, rating) {
  if (isInWatchlist(symbol)) removeFromWatchlist(symbol);
  else addToWatchlist(symbol, name, rating);
}

function updateWatchlistBtn(symbol) {
  const btn = document.getElementById('btn-watchlist-toggle');
  if (!btn) return;
  btn.textContent = isInWatchlist(symbol) ? '★' : '☆';
  btn.style.color = isInWatchlist(symbol) ? '#ca8a04' : '';
}

// Check for rating changes and notify
async function checkWatchlistAlerts() {
  const list = getWatchlist();
  if (!list.length) return;
  for (const item of list) {
    try {
      const { data } = await fetchAllData(item.symbol);
      const h5 = await fetchHistory(item.symbol, '5Y');
      const result = calcScore(data, h5);
      if (result.rating !== item.rating) {
        const oldLabel = t(item.rating === 'buy' ? 'buy' : item.rating === 'wait' ? 'wait' : 'sell');
        const newLabel = t(result.rating === 'buy' ? 'buy' : result.rating === 'wait' ? 'wait' : 'sell');
        showNotification(t('ratingChanged', { symbol: item.symbol, old: oldLabel, new: newLabel }));
        // Update stored rating
        item.rating = result.rating;
      }
    } catch {}
  }
  saveWatchlist(list);
}

function renderWatchlist() {
  const container = document.getElementById('watchlist-content');
  if (!container) return;
  const list = getWatchlist();

  if (!list.length) {
    container.innerHTML = `<div class="watchlist-empty">${t('watchlistEmpty')}</div>`;
    return;
  }

  container.innerHTML = `<div class="watchlist-list">${
    list.map(item => {
      const ratingKey = item.rating === 'buy' ? 'buy' : item.rating === 'wait' ? 'wait' : 'sell';
      const badgeClass = item.rating === 'buy' ? 'badge-buy-bg' : item.rating === 'wait' ? 'badge-wait-bg' : 'badge-sell-bg';
      return `
        <div class="watchlist-item" data-symbol="${item.symbol}">
          <span class="wl-symbol">${item.symbol}</span>
          <span class="wl-name">${item.name || ''}</span>
          <span class="wl-badge ${badgeClass}">${t(ratingKey)}</span>
          <button class="wl-remove" data-symbol="${item.symbol}" onclick="removeFromWatchlist('${item.symbol}');event.stopPropagation()">✕</button>
        </div>`;
    }).join('')
  }</div>`;

  container.querySelectorAll('.watchlist-item').forEach(el => {
    el.addEventListener('click', () => navigateTo('results', el.dataset.symbol));
  });
}
