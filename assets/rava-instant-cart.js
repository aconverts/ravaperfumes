/*
 * RAVA Instant Cart + Gift Picker
 * Loaded from layout/theme.liquid. Markup: snippets/rava-gift-picker.liquid (rendered inside the cart drawer).
 *
 * 1. Instant feedback: the cart drawer opens the moment "Add to cart" is tapped, with a loading bar,
 *    instead of waiting ~1.5s for Shopify to answer.
 * 2. Gift picker: right after a perfume is added, the drawer switches to "Choose your free gifts"
 *    (Roll On / Hair Mist tabs, search, matching scent first). One tap adds a gift (property _rava_gift = 1).
 *    The customer never leaves the page; the picker reopens after each perfume while gifts are left.
 * 3. Safety: if perfumes are removed and there are more chosen gifts than allowed, the extra gifts are removed,
 *    so nobody pays for a "gift".
 */
(function () {
  'use strict';

  if (window.RavaInstantCart) return;
  window.RavaInstantCart = true;

  var ROOT = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  var GIFTS_PER_PERFUME = 2;
  var baseFetch = window.fetch.bind(window);

  var state = {
    open: false,
    tab: 'Roll On',
    query: '',
    autoOpen: false,
    pending: 0,     // gifts tapped but not yet confirmed by Shopify
    msg: '',        // message shown at the top of the picker
    justDone: false // all gifts chosen: flash them in the cart
  };
  var addQueue = Promise.resolve();
  var searchCache = {};
  var searchTimer = null;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function drawer() {
    return document.querySelector('cart-drawer');
  }

  /* Scroll INSIDE the drawer only. Never use scrollIntoView here: on iPhone it also pans the page under the
     fixed drawer, which makes the product page show through / overlap the cart. */
  function scrollDrawerTo(el) {
    var d = drawer();
    var scroller = d && typeof d.getShadowPartByName === 'function' ? d.getShadowPartByName('body') : null;
    if (!scroller) return;
    var top = 0;
    if (el) {
      top = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    }
    scroller.scrollTop = Math.max(top, 0);
  }

  function picker() {
    return document.querySelector('cart-drawer [data-rava-gift-picker]');
  }

  function serverSlotsLeft() {
    var p = picker();
    return p ? parseInt(p.getAttribute('data-slots-left'), 10) || 0 : 0;
  }

  function slotsLeft() {
    return Math.max(serverSlotsLeft() - state.pending, 0);
  }

  /* Sections the theme wants re-rendered after a cart change (cart drawer, cart count...).
     Asked to the theme itself: the open drawer is moved under <body>, so closest('.shopify-section') fails. */
  function drawerSectionId() {
    var sections = [];
    document.documentElement.dispatchEvent(new CustomEvent('cart:prepare-bundled-sections', {
      bubbles: true,
      detail: { sections: sections }
    }));
    if (!sections.length) {
      var node = document.querySelector('.shopify-section--cart-drawer, [id$="__cart-drawer"].shopify-section');
      if (node) sections.push(node.id.replace('shopify-section-', ''));
    }
    return sections.join(',');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isGiftLine(item) {
    var p = item.properties || {};
    return !!(p._rava_gift || p._free_gift);
  }

  /* ------------------------------------------------------------------ */
  /* 1. Instant drawer on add to cart                                    */
  /* ------------------------------------------------------------------ */
  function opensDrawer(form) {
    var s = (window.themeVariables && window.themeVariables.settings) || {};
    if (!drawer() || s.pageType === 'cart') return false;
    var onSuccess = form.querySelector('[name="on_success"]');
    return s.cartType === 'drawer' || (onSuccess && onSuccess.value === 'force_open_drawer');
  }

  function stopLoading() {
    var d = drawer();
    if (d) d.classList.remove('rava-is-adding');
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.matches || !form.matches('form[action*="/cart/add"]')) return;
    if (!form.closest('product-form')) return;

    prefetchPopular();

    if (opensDrawer(form) && form.checkValidity()) {
      var d = drawer();
      d.classList.add('rava-is-adding');
      if (!d.open && typeof d.show === 'function') d.show();
    }
  }, true);

  document.addEventListener('cart:change', stopLoading);
  document.addEventListener('theme:loading:end', function () {
    setTimeout(stopLoading, 400);
  });
  document.addEventListener('cart:error', function () {
    var d = drawer();
    stopLoading();
    if (d && d.open && typeof d.hide === 'function') d.hide();
  }, true);

  /* A perfume was added: open the picker once the drawer has re-rendered */
  document.addEventListener('variant:add', function (event) {
    var items = (event.detail && event.detail.items) || [];
    if (items.some(function (i) { return i.product_type === 'Perfume' && !isGiftLine(i); })) {
      state.autoOpen = true;
      state.query = '';
    }
  });

  /* ------------------------------------------------------------------ */
  /* 2. Picker                                                           */
  /* ------------------------------------------------------------------ */
  function render() {
    var p = picker();
    var d = drawer();
    if (!p || !d) return;

    var panel = p.querySelector('[data-rgp-panel]');
    var left = slotsLeft();

    if (!state.open || left <= 0) {
      state.open = false;
      panel.hidden = true;
      d.classList.remove('rava-picking');
      if (state.justDone && state.pending === 0) {
        state.justDone = false;
        flashGifts();
      }
      return;
    }

    panel.hidden = false;
    d.classList.add('rava-picking');
    fillPopular(p);

    var msgNode = p.querySelector('[data-rgp-msg]');
    if (msgNode) {
      msgNode.textContent = state.msg;
      msgNode.hidden = !state.msg;
    }

    var leftNode = p.querySelector('[data-rgp-left]');
    if (leftNode) leftNode.textContent = left + (left === 1 ? ' gift' : ' gifts') + ' left to choose, any scent';

    p.querySelectorAll('[data-rgp-tab]').forEach(function (tab) {
      var on = tab.getAttribute('data-rgp-tab') === state.tab;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var input = p.querySelector('[data-rgp-search]');
    if (input && input.value !== state.query) input.value = state.query;

    var results = p.querySelector('[data-rgp-results]');
    var searching = state.query.trim().length > 1;
    results.hidden = !searching;
    p.querySelectorAll('[data-rgp-list]').forEach(function (list) {
      list.hidden = searching || list.getAttribute('data-rgp-list') !== state.tab;
    });

    if (searching) runSearch();
  }

  function openPicker() {
    if (slotsLeft() <= 0) return;
    state.open = true;
    state.msg = '';
    render();
    var p = picker();
    if (p) scrollDrawerTo(p);
  }

  function closePicker() {
    state.open = false;
    state.query = '';
    state.msg = '';
    render();
  }

  document.addEventListener('cart-drawer:refreshed', function () {
    if (state.autoOpen) {
      state.autoOpen = false;
      if (slotsLeft() > 0) state.open = true;
    }
    render();
  });

  /* Search: Shopify predictive search rendered through sections/rava-gift-search.liquid
     (same tiles as the Liquid lists, with real variant ids) */
  function runSearch() {
    var q = state.query.trim();
    var tab = state.tab;
    var key = q.toLowerCase() + '|' + tab;
    var p = picker();
    var results = p && p.querySelector('[data-rgp-results]');
    if (!results) return;

    function show(html) {
      if (state.query.trim() !== q || state.tab !== tab) return;
      var box = document.createElement('div');
      box.innerHTML = html;
      var grid = box.querySelector('[data-rgp-search-results]');
      var tiles = grid ? Array.prototype.filter.call(grid.children, function (t) {
        return t.getAttribute('data-type') === tab;
      }) : [];
      if (!tiles.length) {
        results.innerHTML = '<p class="rgp-empty">No ' + tab + ' found for "' + escapeHtml(q) + '". Try another scent name.</p>';
        return;
      }
      var out = document.createElement('div');
      out.className = 'rgp-grid';
      tiles.forEach(function (t) { out.appendChild(t); });
      results.innerHTML = '';
      results.appendChild(out);
    }

    if (searchCache[key] != null) return show(searchCache[key]);

    results.innerHTML = '<p class="rgp-empty">Searching...</p>';
    var url = ROOT + 'search/suggest?q=' + encodeURIComponent(q + ' ' + tab) +
      '&resources[type]=product&resources[limit]=10&resources[options][unavailable_products]=hide' +
      '&section_id=rava-gift-search';

    baseFetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        searchCache[key] = html;
        show(html);
      })
      .catch(function () { show(''); });
  }

  /* Best sellers: the 100 top Roll Ons / Hair Mists, loaded ONCE per visit (kept 30 min in sessionStorage)
     from sections/rava-gift-list.liquid, then re-inserted after every drawer re-render. */
  var POPULAR_TTL = 30 * 60 * 1000;
  var popularHtml = {};
  var popularLoading = {};

  function popularKey(src) {
    return 'rava-gifts:' + src;
  }

  function readStored(src) {
    try {
      var raw = sessionStorage.getItem(popularKey(src));
      if (!raw) return null;
      var data = JSON.parse(raw);
      return Date.now() - data.t < POPULAR_TTL ? data.html : null;
    } catch (e) {
      return null;
    }
  }

  function loadPopular(src) {
    if (!src) return Promise.resolve('');
    if (popularHtml[src] != null) return Promise.resolve(popularHtml[src]);

    var stored = readStored(src);
    if (stored != null) {
      popularHtml[src] = stored;
      return Promise.resolve(stored);
    }

    if (!popularLoading[src]) {
      // Shopify returns at most 50 products per page: load pages 1 and 2 together = top 100
      popularLoading[src] = Promise.all([src, src + '&page=2'].map(function (u) {
        return baseFetch(u).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; });
      }))
        .then(function (pages) {
          var inner = pages.map(function (html) {
            var box = document.createElement('div');
            box.innerHTML = html;
            var grid = box.querySelector('[data-rgp-popular-grid]');
            return grid ? grid.innerHTML : '';
          }).join('');
          popularHtml[src] = inner;
          try { sessionStorage.setItem(popularKey(src), JSON.stringify({ t: Date.now(), html: inner })); } catch (e) {}
          return inner;
        })
        .catch(function () {
          delete popularLoading[src];
          return '';
        });
    }
    return popularLoading[src];
  }

  function fillPopular(scope) {
    (scope || document).querySelectorAll('cart-drawer [data-rgp-popular]').forEach(function (box) {
      if (box.getAttribute('data-filled') === '1') return;
      var src = box.getAttribute('data-src');
      loadPopular(src).then(function (inner) {
        if (!box.isConnected) return;
        var list = box.closest('[data-rgp-list]');
        // Do not repeat the "Matches your perfume" tiles
        var skip = {};
        if (list) list.querySelectorAll('.rgp-grid [data-rgp-add]').forEach(function (t) { skip[t.getAttribute('data-rgp-add')] = true; });
        var tmp = document.createElement('div');
        tmp.innerHTML = inner;
        var grid = document.createElement('div');
        grid.className = 'rgp-grid';
        Array.prototype.forEach.call(tmp.children, function (tile) {
          if (!skip[tile.getAttribute('data-rgp-add')]) grid.appendChild(tile);
        });
        box.innerHTML = '';
        if (grid.children.length) {
          box.appendChild(grid);
        } else {
          box.innerHTML = '<p class="rgp-empty">Use the search above to find your scent.</p>';
        }
        box.setAttribute('data-filled', '1');
      });
    });
  }

  /* Start loading as early as possible: at "Add to cart" tap, in parallel with Shopify's add */
  function prefetchPopular() {
    var p = picker();
    if (p) {
      p.querySelectorAll('[data-rgp-popular]').forEach(function (box) { loadPopular(box.getAttribute('data-src')); });
    } else {
      var root = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
      ['roll-on', 'hair-mist'].forEach(function (h) {
        loadPopular(root + 'collections/' + h + '?sort_by=best-selling&section_id=rava-gift-list');
      });
    }
  }

  function flashGifts() {
    var bar = document.querySelector('cart-drawer .rgp-bar');
    if (bar) {
      bar.classList.remove('rava-gift-pop');
      void bar.offsetWidth;
      bar.classList.add('rava-gift-pop');
    }
    document.querySelectorAll('cart-drawer .line-item--gift').forEach(function (line) {
      line.classList.remove('rava-gift-pop');
      void line.offsetWidth;
      line.classList.add('rava-gift-pop');
    });
    scrollDrawerTo(null);
  }

  /* Add one gift: instant feedback, then Shopify confirms in the background.
     Taps are queued one after the other (Shopify does not like parallel cart writes). */
  function addGift(variantId, button) {
    if (slotsLeft() <= 0) return;

    state.pending += 1;
    var name = button ? (button.querySelector('.rgp-tile__name') || {}).textContent || '' : '';
    var typeLabel = state.tab;
    var left = slotsLeft();

    if (button) {
      button.classList.add('is-added');
      var cta = button.querySelector('.rgp-tile__cta');
      if (cta) cta.textContent = 'Added \u2713';
    }

    if (left > 0) {
      state.msg = '\u2713 ' + (name ? name + ' ' : '') + typeLabel + ' added. Now choose your next gift (' + left + ' left).';
      // Nudge towards the other product line (they can still switch back)
      state.tab = state.tab === 'Roll On' ? 'Hair Mist' : 'Roll On';
      state.query = '';
    } else {
      state.msg = '\u2713 All your gifts are added!';
      state.justDone = true;
    }
    render();
    var panel = picker() && picker().querySelector('[data-rgp-panel]');
    if (panel && left > 0) scrollDrawerTo(panel);

    addQueue = addQueue.then(function () {
      var payload = {
        items: [{ id: Number(variantId), quantity: 1, properties: { _rava_gift: '1' } }]
      };
      var sid = drawerSectionId();
      if (sid) payload.sections = sid;

      return baseFetch(ROOT + 'cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (json) {
            if (!res.ok) throw new Error(json.description || 'Could not add this gift');
            return json;
          });
        })
        .then(function (json) {
          return baseFetch(ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
            state.pending = Math.max(state.pending - 1, 0);
            cart.sections = json.sections || {};
            document.documentElement.dispatchEvent(new CustomEvent('cart:change', {
              bubbles: true,
              detail: { baseEvent: 'rava:gift-add', cart: cart }
            }));
            if (!json.sections) document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
          });
        })
        .catch(function () {
          state.pending = Math.max(state.pending - 1, 0);
          state.justDone = false;
          state.open = true;
          state.msg = 'Sorry, this one just went out of stock. Please choose another gift.';
          if (button && button.isConnected) {
            button.classList.remove('is-added');
            button.classList.add('is-error');
            var c = button.querySelector('.rgp-tile__cta');
            if (c) c.textContent = 'Out of stock';
          }
          render();
        });
    });
  }

  /* Delegated events: they survive every re-render of the drawer */
  document.addEventListener('click', function (event) {
    var t = event.target;
    if (!t.closest || !t.closest('cart-drawer')) return;

    var openBtn = t.closest('[data-rgp-open]');
    if (openBtn) { event.preventDefault(); openPicker(); return; }

    var closeBtn = t.closest('[data-rgp-close]');
    if (closeBtn) { event.preventDefault(); closePicker(); return; }

    var tab = t.closest('[data-rgp-tab]');
    if (tab) {
      event.preventDefault();
      state.tab = tab.getAttribute('data-rgp-tab');
      render();
      return;
    }

    var add = t.closest('[data-rgp-add]');
    if (add && (add.classList.contains('is-added') || add.classList.contains('is-error'))) {
      event.preventDefault();
      return;
    }
    if (add) {
      event.preventDefault();
      addGift(add.getAttribute('data-rgp-add'), add);
    }
  });

  document.addEventListener('input', function (event) {
    if (!event.target.matches || !event.target.matches('cart-drawer [data-rgp-search]')) return;
    state.query = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 250);
  });

  /* ------------------------------------------------------------------ */
  /* 2b. Remove / quantity buttons never fail                            */
  /* Shopify re-splits lines when a discount moves (a line's key changes, */
  /* e.g. 2 Roll Ons become "1 free + 1 paid"). If the drawer still has  */
  /* an old key, /cart/change.js answers "no valid id or line parameter". */
  /* We then find the line again (same variant) and retry once.          */
  /* ------------------------------------------------------------------ */
  var fetchBeforeRetry = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var request = fetchBeforeRetry.apply(this, arguments);
    if (url.indexOf('/cart/change') === -1 || !init || typeof init.body !== 'string') return request;

    var payload;
    try { payload = JSON.parse(init.body); } catch (e) { return request; }
    if (!payload || typeof payload.id !== 'string' || payload.id.indexOf(':') === -1) return request;

    return request.then(function (res) {
      if (res.status !== 400) return res;
      var variantId = Number(payload.id.split(':')[0]);

      return baseFetch(ROOT + 'cart.js')
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          var lines = (cart.items || []).filter(function (item) { return item.variant_id === variantId; });
          if (!lines.length) return res;

          // Prefer the paid line (the one the customer sees as "the product"), then the biggest one
          lines.sort(function (a, b) {
            return (b.final_line_price > 0) - (a.final_line_price > 0) || b.quantity - a.quantity;
          });

          var retry = Object.assign({}, payload, { id: lines[0].key });
          if (payload.quantity === 0) {
            // Removing: remove every line of that variant that is not a chosen gift
            var updates = {};
            lines.forEach(function (l) {
              if (!(l.properties && l.properties._rava_gift)) updates[l.key] = 0;
            });
            var body = { updates: updates };
            if (payload.sections) body.sections = payload.sections;
            return baseFetch(ROOT + 'cart/update.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
          }
          return baseFetch(ROOT + 'cart/change.js', Object.assign({}, init, { body: JSON.stringify(retry) }));
        })
        .catch(function () { return res; });
    });
  };

  /* ------------------------------------------------------------------ */
  /* 3. Never more gifts than allowed                                    */
  /* ------------------------------------------------------------------ */
  var syncing = false;

  function syncGifts(cart) {
    if (syncing || !cart || !cart.items) return;

    var perfumes = 0;
    var giftLines = [];
    var gifts = 0;
    cart.items.forEach(function (item) {
      var p = item.properties || {};
      if (p._rava_gift) {
        giftLines.push(item);
        gifts += item.quantity;
      } else if (p._free_gift) {
        gifts += item.quantity; // added by the checkout guard: counted, never touched here
      } else if (item.product_type === 'Perfume') {
        perfumes += item.quantity;
      }
    });

    var extra = gifts - perfumes * GIFTS_PER_PERFUME;
    if (extra <= 0) return;

    var updates = {};
    for (var i = giftLines.length - 1; i >= 0 && extra > 0; i--) {
      var take = Math.min(extra, giftLines[i].quantity);
      updates[giftLines[i].key] = giftLines[i].quantity - take;
      extra -= take;
    }
    if (!Object.keys(updates).length) return;

    syncing = true;
    baseFetch(ROOT + 'cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ updates: updates })
    })
      .then(function () {
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      })
      .catch(function () {})
      .then(function () { syncing = false; });
  }

  document.addEventListener('cart:change', function (event) {
    var detail = event.detail || {};
    if (detail.baseEvent === 'variant:add' || detail.baseEvent === 'rava:gift-add') return;
    syncGifts(detail.cart);
  });
})();