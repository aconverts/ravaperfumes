/*
 * RAVA Free Gift Checkout Guard
 * Settings: Theme editor > "Free gift checkout guard" (sections/rava-gift-guard.liquid)
 *
 * The gift check is computed BEFORE the customer clicks Checkout:
 *   - on page load, from the cart JSON rendered by Liquid
 *   - after every cart change, by re-fetching that JSON in the background
 *
 * On Checkout click:
 *   - all gifts present -> the click is not touched at all (zero delay)
 *   - gifts missing     -> add the matching scent per perfume, show a small line
 *                          above the Checkout button, then go to checkout
 *   - any error or a slow network -> checkout anyway (never blocks a sale)
 *
 * Works alongside the existing gift popup in layout/theme.liquid; it does not change it.
 */
(function () {
  'use strict';

  if (window.RavaGiftGuard) return;

  var configNode = document.querySelector('[data-rava-gift-guard-config]');
  var cartNode = document.querySelector('[data-rava-gift-guard-cart]');
  if (!configNode || !cartNode) return;

  var config;
  var plan = null;
  try {
    config = JSON.parse(configNode.textContent);
  } catch (err) {
    return;
  }

  var ROUTES_ROOT = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  var GIFT_PROPERTY = '_free_gift';
  var GIFT_PROPERTY_VALUE = 'Auto-added at checkout (matching scent)';
  var FAILSAFE_MS = 5000;
  var rawFetch = window.fetch.bind(window);

  var stale = false; // true while a cart change is in flight or the plan is being refreshed
  var cartChangeSeq = 0; // increments on every cart change, so an old refresh never overwrites a newer one
  var inFlightChanges = 0;
  var guardRunning = false;
  var leaving = false;

  /* ---------- helpers ---------- */

  function norm(value) {
    return String(value || '').trim().toLowerCase();
  }

  function splitList(value) {
    return String(value || '').split(',').map(norm).filter(Boolean);
  }

  var qualifyingTypes = splitList(config.qualifyingTypes);
  var giftTypes = config.gifts.map(function (g) { return norm(g.productType); });
  var giftPreferredTags = config.gifts.map(function (g) { return splitList(g.preferredTags); });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ---------- gift math ---------- */

  /*
   * Each perfume unit (qty counts) needs a gift:
   *   one_of: 1 gift, any gift option
   *   each:   1 gift of every gift option
   * Gifts already in the cart are matched to perfumes first by exact scent,
   * then any remaining gift of the right type counts (customer chose another scent).
   */
  function buildPlan(cart) {
    var slots = [];
    var giftUnits = [];

    cart.items.forEach(function (item) {
      var giftIndex = giftTypes.indexOf(norm(item.productType));
      var q;

      if (giftIndex > -1) {
        for (q = 0; q < item.quantity; q++) {
          giftUnits.push({ productId: item.productId, giftIndex: giftIndex, used: false });
        }
        return;
      }

      if (qualifyingTypes.indexOf(norm(item.productType)) === -1) return;

      for (q = 0; q < item.quantity; q++) {
        if (config.mode === 'each') {
          config.gifts.forEach(function (_, gi) { slots.push(makeSlot(item, [gi])); });
        } else {
          slots.push(makeSlot(item, giftOrderFor(item)));
        }
      }
    });

    // Pass 1: exact matching scent
    slots.forEach(function (slot) {
      var unit = giftUnits.find(function (u) {
        return !u.used && slot.accepts.indexOf(u.giftIndex) > -1 && slot.productIds.indexOf(u.productId) > -1;
      });
      if (unit) { unit.used = true; slot.filled = true; }
    });

    // Pass 2: any gift of an accepted type
    slots.forEach(function (slot) {
      if (slot.filled) return;
      var unit = giftUnits.find(function (u) {
        return !u.used && slot.accepts.indexOf(u.giftIndex) > -1;
      });
      if (unit) { unit.used = true; slot.filled = true; }
    });

    var adds = slots
      .filter(function (s) { return !s.filled; })
      .map(function (s) { return s.candidates[0]; })
      .filter(Boolean);

    return { qualifying: slots.length, adds: adds };
  }

  // Gift options whose "preferred tags" match this perfume come first, then the rest in block order
  function giftOrderFor(item) {
    var tags = (item.tags || []).map(norm);
    var preferred = [];
    var rest = [];
    config.gifts.forEach(function (_, gi) {
      var wanted = giftPreferredTags[gi];
      var hit = wanted.length && wanted.some(function (t) { return tags.indexOf(t) > -1; });
      (hit ? preferred : rest).push(gi);
    });
    return preferred.concat(rest);
  }

  function makeSlot(item, order) {
    var matches = [];
    var fallbacks = [];
    order.forEach(function (gi) {
      var match = item.matches && item.matches[gi];
      if (match) matches.push(match);
      if (config.gifts[gi].fallback) fallbacks.push(config.gifts[gi].fallback);
    });
    var candidates = matches.concat(fallbacks);
    return {
      accepts: order,
      candidates: candidates,
      productIds: candidates.map(function (c) { return c.productId; }),
      filled: false
    };
  }

  /* ---------- keep the plan fresh ---------- */

  function fetchCartMap() {
    var url = ROUTES_ROOT + '?sections=' + encodeURIComponent(config.sectionId);
    return rawFetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('section fetch failed');
        return res.json();
      })
      .then(function (data) {
        var doc = new DOMParser().parseFromString(data[config.sectionId] || '', 'text/html');
        var node = doc.querySelector('[data-rava-gift-guard-cart]');
        if (!node) throw new Error('cart map missing');
        return JSON.parse(node.textContent);
      });
  }

  function refreshPlan() {
    var seq = cartChangeSeq;
    stale = true;
    return fetchCartMap().then(function (cart) {
      var fresh = buildPlan(cart);
      if (seq === cartChangeSeq && inFlightChanges === 0) {
        plan = fresh;
        stale = false;
      }
      return fresh;
    });
  }

  // Initial plan from the Liquid-rendered JSON: no request needed
  try {
    plan = buildPlan(JSON.parse(cartNode.textContent));
  } catch (err) {
    stale = true;
  }

  function isItemChange(url, method, body) {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    if (/\/cart\/(add|change|clear)(\.js)?(\?|$)/.test(url)) return true;
    if (/\/cart\/update(\.js)?(\?|$)/.test(url)) {
      // note / attribute saves don't change items
      try {
        if (typeof body === 'string') return /updates/.test(body);
        if (body && typeof body.keys === 'function') {
          for (var k of body.keys()) { if (k.indexOf('updates') === 0) return true; }
          return false;
        }
      } catch (err) {}
      return true;
    }
    return false;
  }

  function onCartChangeStart() {
    cartChangeSeq++;
    inFlightChanges++;
    stale = true;
  }

  function onCartChangeEnd() {
    inFlightChanges = Math.max(0, inFlightChanges - 1);
    if (inFlightChanges === 0) refreshPlan().catch(function () {});
  }

  var wrappedFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    var method = (init && init.method) || (input && input.method);
    var tracked = isItemChange(url, method, init && init.body);
    if (tracked) onCartChangeStart();
    var result = wrappedFetch.apply(window, arguments);
    if (tracked) {
      result.then(onCartChangeEnd, onCartChangeEnd);
    }
    return result;
  };

  // Some apps still use XMLHttpRequest
  var xhrOpen = XMLHttpRequest.prototype.open;
  var xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._ravaMethod = method;
    this._ravaUrl = String(url || '');
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (isItemChange(this._ravaUrl, this._ravaMethod, body)) {
      onCartChangeStart();
      this.addEventListener('loadend', onCartChangeEnd);
    }
    return xhrSend.apply(this, arguments);
  };

  var activeNotice = null;
  var activeTrigger = null;

  function resetGuardUi() {
    if (activeNotice && activeNotice.parentNode) activeNotice.parentNode.removeChild(activeNotice);
    if (activeTrigger) activeTrigger.removeAttribute('aria-busy');
    activeNotice = null;
    activeTrigger = null;
  }

  // Clean up before the browser stores the page in its back/forward cache,
  // so pressing Back from checkout never shows a leftover notice
  window.addEventListener('pagehide', resetGuardUi);

  // Back/forward cache restored the page: reset and re-check the cart
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      resetGuardUi();
      leaving = false;
      guardRunning = false;
      refreshPlan().catch(function () {});
    }
  });

  /* ---------- adding gifts ---------- */

  function postAdd(items) {
    return rawFetch(ROUTES_ROOT + 'cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: items })
    }).then(function (res) {
      if (!res.ok) throw new Error('add failed');
      return res.json();
    });
  }

  function addGifts(candidates) {
    var grouped = {};
    candidates.forEach(function (c) {
      if (!grouped[c.variantId]) grouped[c.variantId] = { title: c.title, quantity: 0 };
      grouped[c.variantId].quantity += 1;
    });

    var items = Object.keys(grouped).map(function (id) {
      var props = {};
      props[GIFT_PROPERTY] = GIFT_PROPERTY_VALUE;
      return { id: Number(id), quantity: grouped[id].quantity, properties: props };
    });

    return postAdd(items)
      .then(function () { return items.map(function (i) { return grouped[i.id]; }); })
      .catch(function () {
        // one gift just went out of stock: add the others one by one
        var added = [];
        return items.reduce(function (chain, item) {
          return chain.then(function () {
            return postAdd([item]).then(function () { added.push(grouped[item.id]); }, function () {});
          });
        }, Promise.resolve()).then(function () { return added; });
      });
  }

  /* ---------- checkout ---------- */

  function saveNote(trigger) {
    // The cart form is never resubmitted after adding a line: its positional
    // updates[] inputs would shift quantities. The note is saved on its own instead.
    var form = trigger.form || (trigger.closest && trigger.closest('form'));
    var note = form && form.querySelector('[name="note"]');
    if (!note) return Promise.resolve();
    return rawFetch(ROUTES_ROOT + 'cart/update.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ note: note.value })
    }).catch(function () {});
  }

  function goToCheckout() {
    if (leaving) return;
    leaving = true;
    window.location.href = ROUTES_ROOT + 'checkout';
  }

  // Small inline line right above the Checkout button (cart drawer and cart page)
  function showNotice(added, trigger) {
    var t = config.text || {};
    var names = added.map(function (row) {
      return (row.quantity > 1 ? row.quantity + ' x ' : '') + row.title;
    }).join(', ');

    var notice = el('div', 'rava-gift-inline-notice');
    notice.setAttribute('role', 'status');
    notice.appendChild(el('span', 'rava-gift-inline-notice__icon', '\u2713'));
    var text = el('span', 'rava-gift-inline-notice__text');
    text.appendChild(el('strong', '', (t.title || 'Free gift added') + ' '));
    text.appendChild(document.createTextNode(names));
    notice.appendChild(text);

    var anchor = (trigger.closest && trigger.closest('.button-group')) || trigger;
    if (anchor.parentNode) {
      anchor.parentNode.insertBefore(notice, anchor);
    } else {
      document.body.appendChild(notice);
    }
    activeNotice = notice;
  }

  function runGuard(trigger) {
    if (guardRunning) return;
    guardRunning = true;
    activeTrigger = trigger;
    trigger.setAttribute('aria-busy', 'true');

    var failsafe = setTimeout(goToCheckout, FAILSAFE_MS);
    var noteSaved = saveNote(trigger);
    var usedCache = !stale && plan;
    var planReady = usedCache ? Promise.resolve(plan) : refreshPlan();

    planReady
      .then(function (current) {
        // Cached plan said gifts are missing: confirm against the live cart before adding
        return usedCache && current.adds.length ? refreshPlan() : current;
      })
      .then(function (current) {
        if (!current.adds.length) {
          return noteSaved.then(function () {
            clearTimeout(failsafe);
            goToCheckout();
          });
        }
        return addGifts(current.adds).then(function (added) {
          return noteSaved.then(function () {
            clearTimeout(failsafe);
            var delay = Number(config.noticeDelay);
            if (!added.length || !(delay > 0)) { goToCheckout(); return; }
            showNotice(added, trigger);
            setTimeout(goToCheckout, delay);
          });
        });
      })
      .catch(function () {
        clearTimeout(failsafe);
        noteSaved.then(goToCheckout, goToCheckout);
      });
  }

  var CHECKOUT_SELECTOR = 'button[name="checkout"], input[name="checkout"], a[href$="/checkout"], a[href*="/checkout?"]';

  function findCheckoutTrigger(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (node && node.matches && node.matches(CHECKOUT_SELECTOR)) return node;
    }
    return null;
  }

  function mustIntercept() {
    // Fast path: known complete cart -> do not touch the click
    if (!stale && plan && plan.adds.length === 0) return false;
    return true;
  }

  document.addEventListener('click', function (e) {
    if (leaving) return;
    var trigger = findCheckoutTrigger(e);
    if (!trigger || !mustIntercept()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    runGuard(trigger);
  }, true);

  // Enter key in the cart form submits with the checkout button as submitter
  document.addEventListener('submit', function (e) {
    if (leaving) return;
    var submitter = e.submitter;
    if (!submitter || submitter.name !== 'checkout' || !mustIntercept()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    runGuard(submitter);
  }, true);

  /* ---------- debug: run RavaGiftGuard.check() in the browser console ---------- */

  window.RavaGiftGuard = {
    config: config,
    check: function () {
      return refreshPlan().then(function (p) {
        console.table(p.adds.map(function (a) { return { wouldAdd: a.title, variantId: a.variantId }; }));
        return p;
      });
    }
  };
})();