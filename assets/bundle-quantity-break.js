/**
 * Bundle Quantity Break / Mix & Match
 * ---------------------------------------------------------------
 * Self-contained Web Component, rendered as a real Prestige block
 * type ("bundle_quantity_break") inside product-info.liquid.
 *
 * IMPORTANT ARCHITECTURE NOTE:
 *   This widget has NO add-to-cart button of its own. It listens
 *   for a submit on the page's native product form (the one
 *   rendered by the "buy_buttons" block / buy-buttons.liquid) and,
 *   if a tier ≥ 2 is selected, intercepts that submit and adds the
 *   host product + every chosen bundle item together via one call
 *   to /cart/add.js. If tier 1 is selected, the native form submits
 *   exactly as it always did — completely untouched.
 *
 * Product rows inside the modal are NOT server-rendered in Liquid.
 * They're fetched client-side from /collections/{handle}/products.json
 * with cursor-based pagination (250 per page, loaded via
 * IntersectionObserver as the shopper scrolls), so collections of
 * any size load in full — no 50-item Liquid object cap.
 *
 * Pricing note (read this before wiring up a Shopify Function):
 *   The price shown in this widget is calculated client-side for
 *   display purposes only. To make checkout actually charge the
 *   discounted total, you need one of:
 *     a) A Shopify Function (Cart/Order Discount) keyed off a cart
 *        line item property this script sets (`_bundle_id`), OR
 *     b) A native Shopify "Buy X, get Y% off" automatic discount
 *        per tier (3 separate discounts, mutually exclusive via
 *        "combinations"), scoped to a collection containing every
 *        product eligible for the bundle.
 *   This script adds `_bundle_id` and `_bundle_tier` line item
 *   properties to every line in a bundle so either approach can
 *   identify and group them.
 */

const PRODUCTS_PER_PAGE = 50; // Shopify max is 250, but fetching that much
// up front (full variant/image data per product) is the main cause of the
// multi-second tab-switch delay. 50 is more than enough to fill the visible
// area plus scroll buffer, and the infinite-scroll observer transparently
// fetches more as the shopper scrolls further — this just makes the FIRST
// paint dramatically faster without losing access to the rest of the catalog.

class BundleQuantityBreak extends HTMLElement {
  constructor() {
    super();
    this.productId = this.dataset.productId;
    this.basePrice = parseInt(this.dataset.basePrice, 10);
    this.baseCompareAt = parseInt(this.dataset.baseCompareAt, 10);
    this.currency = this.dataset.currency;
    this.tierDiscounts = this.dataset.tierDiscounts
      .split(',')
      .map((n) => parseInt(n, 10));

    this.selectedTier = 1;
    // slots[tierIndex] = { [slotIndex]: { productId, variantId, title, price, image } }
    this.slots = {};
    this.activeSlotContext = null; // { tier, slotIndex } while modal is open

    // Per-collection fetch state, keyed by collection handle.
    // { page, hasMore, isLoading, products: [] }
    this.collectionState = {};
  }

  connectedCallback() {
    this.tierInputs = [...this.querySelectorAll('.bundle-qty-break__tier-radio')];
    this.incompleteHint = this.querySelector('[data-incomplete-hint]');
    this.modal = this.querySelector('[data-modal]');
    this.modalBody = this.querySelector('[data-modal-body]');
    this.modalSearch = this.querySelector('[data-modal-search]');
    this.noResultsEl = this.querySelector('[data-no-results]');
    this.tabButtons = [...this.querySelectorAll('[data-tab-target]')];
    this.tabPanels = [...this.querySelectorAll('.bundle-qty-break__tab-panel')];

    // Move the modal to <body> so it can never get trapped inside a
    // sticky/transformed ancestor's stacking context (the cause of
    // "modal hidden behind header" bugs). Keep a comment marker so
    // it's easy to find in dev tools.
    if (this.modal && this.modal.parentElement !== document.body) {
      document.body.appendChild(this.modal);
    }

    this.bindTierSelection();
    this.bindModalOpenClose();
    this.bindTabs();
    this.bindSearch();
    this.bindInfiniteScroll();
    this.bindNativeAddToCart();

    this.updateUI();

    // Load the first (active) tab's products immediately so the
    // modal isn't empty the first time it opens.
    const firstPanel = this.tabPanels[0];
    if (firstPanel) this.loadMoreForPanel(firstPanel);
  }

  /* ---------------------------------------------------------- tiers */

  bindTierSelection() {
    this.tierInputs.forEach((input) => {
      input.addEventListener('change', () => {
        this.selectedTier = parseInt(input.value, 10);
        this.querySelectorAll('.bundle-qty-break__tier').forEach((el) => {
          el.classList.toggle(
            'is-selected',
            parseInt(el.dataset.tier, 10) === this.selectedTier
          );
        });
        this.revealSlotsForSelectedTier();
        this.updateUI();
      });
    });
  }

  revealSlotsForSelectedTier() {
    this.querySelectorAll('[data-slots-for-tier]').forEach((slotsEl) => {
      const tier = parseInt(slotsEl.dataset.slotsForTier, 10);
      slotsEl.hidden = tier !== this.selectedTier;
    });
  }

  /* ---------------------------------------------------------- modal */

  bindModalOpenClose() {
    this.querySelectorAll('[data-open-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeSlotContext = {
          tier: parseInt(btn.dataset.tier, 10),
          slotIndex: parseInt(btn.dataset.slotIndex, 10),
        };
        this.openModal();
      });
    });

    // Close button (×).
    this.modal.querySelectorAll('[data-modal-close]').forEach((el) => {
      el.addEventListener('click', () => this.closeModal());
    });

    // Click-outside-to-close: rather than stopping propagation from
    // inside the panel (which would also block the delegated
    // data-choose-product handler below, since that listener lives
    // on a panel ancestor and the bubble would never reach it), we
    // simply check whether the overlay element itself was the exact
    // click target. A click anywhere inside the panel will always
    // have some other element as e.target, never the overlay.
    const overlay = this.modal.querySelector('.bundle-qty-break__modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.closeModal();
    });

    // Delegated handler for product "Choose" buttons, which are
    // generated dynamically in JS (see renderProductRows) rather
    // than server-rendered, so they can't have individual listeners
    // attached at creation time in the same way static markup can.
    this.modal.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-choose-product')) {
        this.handleChooseProduct(e.target);
      }
    });

    // Same delegation pattern, for the size/option dropdowns: update
    // the row's displayed price live as the shopper changes the
    // selection, rather than only applying it silently once they
    // click Choose. e.g. defaults to 100ml's price, switching the
    // dropdown to 50ml should immediately show 50ml's price.
    this.modal.addEventListener('change', (e) => {
      if (e.target.hasAttribute('data-variant-option-select')) {
        this.updateRowPriceForSelectedOptions(e.target.closest('[data-product-row]'));
      }
    });
  }

  openModal() {
    this.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (this.modalSearch) {
      this.modalSearch.value = '';
      this.filterProductRows('');
      requestAnimationFrame(() => this.modalSearch.focus());
    }
  }

  closeModal() {
    this.modal.hidden = true;
    document.body.style.overflow = '';
    this.activeSlotContext = null;
  }

  /* ---------------------------------------------------------- tabs */

  bindTabs() {
    this.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tabButtons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        let newlyActivePanel = null;
        this.tabPanels.forEach((panel) => {
          const isActive = panel.id === btn.dataset.tabTarget;
          panel.classList.toggle('is-active', isActive);
          if (isActive) newlyActivePanel = panel;
        });

        if (this.modalSearch) this.modalSearch.value = '';
        if (newlyActivePanel) {
          // Don't run filterProductRows() yet if this panel hasn't
          // loaded anything — that would briefly flash "No products
          // found" before the fetch below even starts, which is
          // exactly the friction this was supposed to avoid. Only
          // filter immediately if the panel already has products
          // from a previous activation; otherwise wait for
          // loadMoreForPanel() to call filterProductRows() itself
          // once real data has arrived.
          if (newlyActivePanel.dataset.loaded === 'true') {
            this.filterProductRows('');
          } else if (this.noResultsEl) {
            this.noResultsEl.hidden = true;
          }

          if (newlyActivePanel.dataset.loaded !== 'true') {
            this.loadMoreForPanel(newlyActivePanel);
          }
        }
      });
    });
  }

  /* ---------------------------------------------------------- product fetching (infinite scroll) */

  bindInfiniteScroll() {
    this.tabPanels.forEach((panel) => {
      const sentinel = panel.querySelector('[data-scroll-sentinel]');
      if (!sentinel) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) this.loadMoreForPanel(panel);
          });
        },
        { root: this.modalBody, rootMargin: '200px' }
      );
      observer.observe(sentinel);
    });
  }

  async loadMoreForPanel(panel) {
    const handle = panel.dataset.collectionHandle;
    const state =
      this.collectionState[handle] ||
      (this.collectionState[handle] = {
        page: 1,
        hasMore: true,
        isLoading: false,
        products: [],
      });

    if (state.isLoading || !state.hasMore) return;
    state.isLoading = true;

    const loadingIndicator = panel.querySelector('[data-loading-indicator]');
    if (loadingIndicator) loadingIndicator.hidden = false;

    try {
      const url = `/collections/${encodeURIComponent(handle)}/products.json?limit=${PRODUCTS_PER_PAGE}&page=${state.page}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load collection "${handle}" (page ${state.page}).`);

      const data = await response.json();
      const products = Array.isArray(data.products) ? data.products : [];

      if (products.length === 0) {
        state.hasMore = false;
      } else {
        state.products.push(...products);
        this.renderProductRows(panel, products);
        state.page += 1;
        // Shopify's products.json returns fewer than the requested
        // limit on the last page — treat that as "no more pages".
        if (products.length < PRODUCTS_PER_PAGE) state.hasMore = false;
      }

      panel.dataset.loaded = 'true';
      this.filterProductRows(this.modalSearch ? this.modalSearch.value : '');
    } catch (err) {
      console.error('[bundle-quantity-break]', err);
    } finally {
      state.isLoading = false;
      if (loadingIndicator) loadingIndicator.hidden = true;
    }
  }

  renderProductRows(panel, products) {
    const list = panel.querySelector('[data-product-list]');
    if (!list) return;

    const fragment = document.createDocumentFragment();

    products.forEach((p) => {
      // Skip the host product — it's always slot 0, locked.
      if (String(p.id) === String(this.productId)) return;

      const row = document.createElement('div');
      row.className = 'bundle-qty-break__product-row';
      row.dataset.productRow = '';
      row.dataset.productTitle = p.title;

      const image = p.images && p.images[0] ? p.images[0].src : '';

      // Default to the 100ml variant when one exists, instead of
      // whichever variant happens to be first in Shopify's array
      // (which is often the smallest/cheapest size, e.g. 50ml, simply
      // because of the order options were set up in). Falls back to
      // the product's normal selected/first-available variant if
      // there's no 100ml option at all.
      const variants = p.variants || [];
      let defaultVariant =
        variants.find((v) =>
          [v.option1, v.option2, v.option3].some(
            (opt) => typeof opt === 'string' && opt.trim().toLowerCase() === '100ml'
          )
        ) || variants.find((v) => v.available) || variants[0];

      const priceNow = defaultVariant ? parseFloat(defaultVariant.price) : 0;
      const compareAt = defaultVariant ? parseFloat(defaultVariant.compare_at_price) : 0;

      const priceHtml =
        compareAt > priceNow
          ? `<span class="bundle-qty-break__price-now" data-row-price-now>${this.formatMoney(priceNow * 100)}</span>
             <span class="bundle-qty-break__price-compare" data-row-price-compare>${this.formatMoney(compareAt * 100)}</span>`
          : `<span class="bundle-qty-break__price-now" data-row-price-now>${this.formatMoney(priceNow * 100)}</span>`;

      // product.options from /products.json is an array of objects
      // ({ name, position, values }), NOT plain strings — that
      // mismatch was the source of the "[object Object]" bug.
      const hasOptions =
        p.options &&
        p.options.length &&
        !(p.options.length === 1 && p.options[0].name === 'Title');

      let optionsHtml = '';
      if (hasOptions) {
        optionsHtml = '<span class="bundle-qty-break__product-variant-picker">';
        p.options.forEach((option, idx) => {
          const optionName = option.name;
          const values = [...new Set(variants.map((v) => v[`option${idx + 1}`]))];
          const defaultValueForThisOption = defaultVariant ? defaultVariant[`option${idx + 1}`] : null;
          optionsHtml += `
            <label class="bundle-qty-break__variant-label">
              ${this.escapeHtml(optionName)}
              <select data-variant-option-select data-option-position="${idx + 1}">
                ${values
                  .map(
                    (val) =>
                      `<option value="${this.escapeHtml(val)}"${val === defaultValueForThisOption ? ' selected' : ''}>${this.escapeHtml(val)}</option>`
                  )
                  .join('')}
              </select>
            </label>`;
        });
        optionsHtml += '</span>';
      }

      row.innerHTML = `
        <span class="bundle-qty-break__product-thumb">
          ${image ? `<img src="${image}" loading="lazy" width="64" height="64" alt="${this.escapeHtml(p.title)}">` : ''}
        </span>
        <span class="bundle-qty-break__product-info">
          <span class="bundle-qty-break__product-name">${this.escapeHtml(p.title)}</span>
          <span class="bundle-qty-break__product-price">${priceHtml}</span>
          ${optionsHtml}
        </span>
        <button type="button" class="bundle-qty-break__product-choose" data-choose-product data-product-id="${p.id}" data-default-variant-id="${defaultVariant ? defaultVariant.id : ''}">
          ${this.chooseButtonLabel()}
        </button>
      `;

      // Store full variant data on the row itself (not as inline
      // JSON in markup, since this row is built in JS) for variant
      // resolution when a size/option dropdown changes the pick.
      row._variants = variants.map((v) => ({
        id: v.id,
        title: v.title,
        price: Math.round(parseFloat(v.price) * 100),
        compare_at_price: v.compare_at_price ? Math.round(parseFloat(v.compare_at_price) * 100) : null,
        available: v.available,
        options: [v.option1, v.option2, v.option3].filter((o) => o !== null && o !== undefined),
        featured_image: (v.featured_image && v.featured_image.src) || image,
      }));

      fragment.appendChild(row);
    });

    list.appendChild(fragment);
  }

  chooseButtonLabel() {
    return (this.modal && this.modal.dataset.chooseLabel) || 'Choose';
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  /* ---------------------------------------------------------- search */

  bindSearch() {
    if (!this.modalSearch) return;
    this.modalSearch.addEventListener('input', () => {
      this.filterProductRows(this.modalSearch.value);
    });
  }

  filterProductRows(query) {
    const normalized = query.trim().toLowerCase();
    const activePanel = this.tabPanels.find((p) => p.classList.contains('is-active'));
    if (!activePanel) return;

    const rows = [...activePanel.querySelectorAll('[data-product-row]')];
    let visibleCount = 0;

    rows.forEach((row) => {
      const title = (row.dataset.productTitle || '').toLowerCase();
      const matches = normalized === '' || title.includes(normalized);
      row.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (this.noResultsEl) this.noResultsEl.hidden = visibleCount !== 0;
  }

  /* ---------------------------------------------------------- choose product */

  /**
   * Given a product row, resolves which variant matches its current
   * dropdown selections (falling back to the row's default variant
   * if there are no option dropdowns at all, e.g. a single-variant
   * product). Shared by handleChooseProduct() and
   * updateRowPriceForSelectedOptions() so both stay in sync.
   */
  resolveSelectedVariant(row, defaultVariantId) {
    const variants = row._variants || [];
    let resolved = variants.find((v) => String(v.id) === String(defaultVariantId));

    const optionSelects = [...row.querySelectorAll('[data-variant-option-select]')];
    if (optionSelects.length) {
      const chosenOptions = optionSelects
        .sort((a, b) => a.dataset.optionPosition - b.dataset.optionPosition)
        .map((sel) => sel.value);

      const match = variants.find((v) =>
        v.options.every((opt, idx) => opt === chosenOptions[idx])
      );
      if (match) resolved = match;
    }

    return resolved;
  }

  /**
   * Updates the price shown on a product row to match whichever
   * variant its dropdowns currently resolve to — e.g. switching the
   * Size dropdown from 100ml to 50ml should immediately reflect
   * 50ml's price, not silently wait until "Choose" is clicked.
   */
  updateRowPriceForSelectedOptions(row) {
    if (!row) return;
    const chooseBtn = row.querySelector('[data-choose-product]');
    if (!chooseBtn) return;

    const variant = this.resolveSelectedVariant(row, chooseBtn.dataset.defaultVariantId);
    if (!variant) return;

    const priceNowEl = row.querySelector('[data-row-price-now]');
    const priceCompareEl = row.querySelector('[data-row-price-compare]');
    const priceNow = variant.price;
    const compareAt = variant.compare_at_price;

    if (priceNowEl) priceNowEl.textContent = this.formatMoney(priceNow);

    if (compareAt && compareAt > priceNow) {
      if (priceCompareEl) {
        priceCompareEl.textContent = this.formatMoney(compareAt);
        priceCompareEl.hidden = false;
      } else if (priceNowEl) {
        // No compare-at span existed yet (the product had no
        // discount on whichever variant was the default) — create
        // one now that a discounted variant has been selected.
        const span = document.createElement('span');
        span.className = 'bundle-qty-break__price-compare';
        span.dataset.rowPriceCompare = '';
        span.textContent = this.formatMoney(compareAt);
        priceNowEl.insertAdjacentElement('afterend', span);
      }
    } else if (priceCompareEl) {
      priceCompareEl.hidden = true;
    }
  }

  handleChooseProduct(btn) {
    if (!this.activeSlotContext) return;

    const row = btn.closest('[data-product-row]');
    const chosenVariant = this.resolveSelectedVariant(row, btn.dataset.defaultVariantId);

    if (!chosenVariant) {
      console.error('[bundle-quantity-break] Could not resolve a variant for this product.');
      return;
    }

    const { tier, slotIndex } = this.activeSlotContext;
    this.slots[tier] = this.slots[tier] || {};
    this.slots[tier][slotIndex] = {
      productId: btn.dataset.productId,
      variantId: chosenVariant.id,
      title: row.dataset.productTitle,
      price: chosenVariant.price,
      // Fall back to the regular price when there's no compare-at,
      // so a product with no active discount doesn't drag the
      // bundle's displayed "full price" down below its real total.
      compareAtPrice: chosenVariant.compare_at_price || chosenVariant.price,
      image: chosenVariant.featured_image,
    };

    this.renderSlot(tier, slotIndex, this.slots[tier][slotIndex]);
    this.closeModal();
    this.updateUI();
  }

  renderSlot(tier, slotIndex, item) {
    const slotEl = this.querySelector(
      `[data-slots-for-tier="${tier}"] [data-slot-index="${slotIndex}"]`
    );
    if (!slotEl) return;

    const thumb = slotEl.querySelector('[data-slot-thumb]');
    const name = slotEl.querySelector('[data-slot-name]');
    const chooseBtn = slotEl.querySelector('.bundle-qty-break__slot-choose');

    if (thumb) {
      thumb.innerHTML = item.image
        ? `<img src="${item.image}" width="40" height="40" loading="lazy" alt="${this.escapeHtml(item.title)}">`
        : '';
    }
    if (name) name.textContent = item.title;
    if (chooseBtn) chooseBtn.textContent = 'Change';
    slotEl.classList.add('is-filled');
  }

  /* ---------------------------------------------------------- pricing / state */

  isTierComplete(tier) {
    if (tier === 1) return true;
    const slotsForTier = this.slots[tier] || {};
    for (let i = 1; i < tier; i += 1) {
      if (!slotsForTier[i]) return false;
    }
    return true;
  }

  calculateTierTotal(tier) {
    const discountPct = this.tierDiscounts[tier - 1] || 0;
    const slotsForTier = this.slots[tier] || {};

    let total = this.basePrice;
    for (let i = 1; i < tier; i += 1) {
      total += slotsForTier[i] ? slotsForTier[i].price : 0;
    }
    return total - Math.round((total * discountPct) / 100);
  }

  /**
   * The "full price" shown with strikethrough next to the discounted
   * total. This must be the sum of what's ACTUALLY in the bundle
   * (host + whichever products the shopper chose), never a fixed
   * multiple of the host product's own compare-at price — that was
   * the bug: a tier showing $47.96 crossed out when the real combined
   * compare-at value of the chosen products came to less (or more)
   * than that. Before any product is chosen for a slot, that slot's
   * contribution is unknown, so it's excluded — there is nothing
   * meaningful to add yet, not a guess.
   */
  calculateTierCompareAtTotal(tier) {
    const slotsForTier = this.slots[tier] || {};
    let total = this.baseCompareAt;
    for (let i = 1; i < tier; i += 1) {
      if (slotsForTier[i]) total += slotsForTier[i].compareAtPrice;
    }
    return total;
  }

  updateUI() {
    const complete = this.isTierComplete(this.selectedTier);
    if (this.incompleteHint) this.incompleteHint.hidden = complete;

    // Reflect completeness on the host element so CSS / the native
    // add-to-cart hook can react to it without re-deriving state.
    this.toggleAttribute('data-bundle-incomplete', !complete);

    const tierEl = this.querySelector(
      `.bundle-qty-break__tier[data-tier="${this.selectedTier}"]`
    );
    if (tierEl && this.selectedTier > 1) {
      const priceNowEl = tierEl.querySelector('[data-price-now]');
      if (priceNowEl) {
        priceNowEl.textContent = this.formatMoney(this.calculateTierTotal(this.selectedTier));
      }

      const priceCompareEl = tierEl.querySelector('[data-price-compare]');
      if (priceCompareEl) {
        priceCompareEl.textContent = this.formatMoney(
          this.calculateTierCompareAtTotal(this.selectedTier)
        );
      }
    }

    // Tiers OTHER than the currently selected one still show a
    // server-rendered "full price" based only on the host product,
    // since their slots haven't been chosen yet — update all of them
    // so none are stuck showing the old broken calculation if the
    // shopper has chosen items for more than one tier in the same
    // session (e.g. switched tiers after partially filling one out).
    this.querySelectorAll('.bundle-qty-break__tier[data-tier]').forEach((el) => {
      const tier = parseInt(el.dataset.tier, 10);
      if (tier === 1) return;
      const priceCompareEl = el.querySelector('[data-price-compare]');
      if (priceCompareEl) {
        priceCompareEl.textContent = this.formatMoney(this.calculateTierCompareAtTotal(tier));
      }
      const priceNowEl = el.querySelector('[data-price-now]');
      if (priceNowEl) {
        priceNowEl.textContent = this.formatMoney(this.calculateTierTotal(tier));
      }
    });
  }

  formatMoney(cents) {
    if (window.Shopify && window.Shopify.formatMoney) {
      return window.Shopify.formatMoney(cents, window.theme?.moneyFormat || '${{amount}}');
    }
    return `$${(cents / 100).toFixed(2)}`;
  }

  /* ---------------------------------------------------------- native add-to-cart interception */

  bindNativeAddToCart() {
    const formId = this.dataset.formId;
    const form = formId ? document.getElementById(formId) : null;

    if (!form) {
      console.warn(
        '[bundle-quantity-break] Could not find the product form (#' +
          formId +
          '). The bundle can\'t hook into the native Add to Cart button.'
      );
      return;
    }

    this.nativeForm = form;

    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) {
      console.warn('[bundle-quantity-break] Could not find the submit button inside the product form.');
      return;
    }
    this.nativeSubmitButton = submitButton;

    // We never block or replace the click/submit itself — Prestige's
    // own <product-form> component (theme.js) handles the host
    // product's add-to-cart correctly end to end on its own: builds
    // the request, calls /cart/add.js, dispatches "variant:add" on
    // success, and the cart drawer listens for that event to refresh
    // and open. We let all of that run completely untouched.
    //
    // What changed in this version: previously we waited for that
    // "variant:add" event before adding the rest of the bundle, which
    // meant two full network round trips back to back — Prestige's
    // request, THEN ours — showing up as the host item appearing
    // immediately and the rest popping in 2-3 seconds later. Now we
    // fire our request for the extra bundle items in the SAME click,
    // at the same time as Prestige's own request, so both hit Shopify
    // in parallel. Whichever finishes first primes the data; once
    // BOTH are done, we trigger exactly one drawer refresh, so the
    // drawer opens already showing the complete bundle instead of
    // visibly updating a few seconds after first appearing.
    submitButton.addEventListener(
      'click',
      (event) => {
        if (this.selectedTier === 1) return; // nothing for us to do, fully native

        if (!this.isTierComplete(this.selectedTier)) {
          event.preventDefault();
          if (this.incompleteHint) {
            this.incompleteHint.hidden = false;
            this.incompleteHint.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return;
        }

        // Tag the HOST product's own line item too, not just the
        // extra chosen items, so an order/analytics pull can identify
        // every line that came from this widget — including the
        // anchor product — and reconstruct full bundle orders rather
        // than only seeing the "extra" items tagged. Written directly
        // into Prestige's own form so its native request (which we
        // never touch otherwise) just includes it automatically.
        this.tagNativeFormForBundleTracking();

        // Fire-and-track in parallel with Prestige's own native
        // submission, which proceeds completely untouched below this.
        this.addExtraBundleItemsInParallel();
      },
      { capture: true }
    );

    this.bindDrawerRefreshAfterBothComplete(form);
  }

  /**
   * Adds hidden properties[_bundle_id] / properties[_bundle_tier]
   * inputs to the native product form so the HOST product's line
   * item gets the same tracking tags as the extra bundle items (set
   * separately in addExtraBundleItemsInParallel). Only called for
   * tier ≥ 2 — a plain Buy 1 purchase is not tagged, since it would
   * have happened with or without this widget and shouldn't be
   * counted as bundle-driven revenue.
   *
   * Re-creates these inputs fresh on every click rather than reusing
   * stale ones, since this.lastBundleId needs to match whatever ID
   * addExtraBundleItemsInParallel() generates for the SAME click.
   */
  tagNativeFormForBundleTracking() {
    if (!this.nativeForm) return;

    ['_bundle_id', '_bundle_tier'].forEach((key) => {
      const existing = this.nativeForm.querySelector(`input[name="properties[${key}]"]`);
      if (existing) existing.remove();
    });

    // Generated here (not inside addExtraBundleItemsInParallel) so
    // the host product and the extra items share the EXACT same
    // bundle ID for a given click — that's what lets an order export
    // later group every line item from one Add to Cart click together.
    this.lastBundleId = `bundle_${Date.now()}`;

    const idField = document.createElement('input');
    idField.type = 'hidden';
    idField.name = 'properties[_bundle_id]';
    idField.value = this.lastBundleId;

    const tierField = document.createElement('input');
    tierField.type = 'hidden';
    tierField.name = 'properties[_bundle_tier]';
    tierField.value = this.selectedTier;

    this.nativeForm.appendChild(idField);
    this.nativeForm.appendChild(tierField);
  }

  /**
   * Starts the request for the extra chosen bundle items (never the
   * host product — Prestige's native form submission handles that
   * one) at click time, in parallel with Prestige's own request,
   * instead of waiting for it to finish first. Stores the in-flight
   * promise so bindDrawerRefreshAfterBothComplete() can wait on it
   * alongside Prestige's "variant:add" event.
   */
  addExtraBundleItemsInParallel() {
    const tierAtSubmitTime = this.selectedTier;
    const slotsForTier = this.slots[tierAtSubmitTime] || {};
    // Reuse the SAME bundle ID just written into the native form's
    // hidden properties by tagNativeFormForBundleTracking() (called
    // immediately before this, in the same click handler), so the
    // host product and these extra items can be grouped together
    // later by that ID in an order export. Falls back to generating
    // one here only if that method somehow didn't run first.
    const bundleId = this.lastBundleId || `bundle_${Date.now()}`;
    const extraItems = [];

    for (let i = 1; i < tierAtSubmitTime; i += 1) {
      const item = slotsForTier[i];
      if (!item) continue;
      extraItems.push({
        id: item.variantId,
        quantity: 1,
        properties: {
          _bundle_id: bundleId,
          _bundle_tier: tierAtSubmitTime,
        },
      });
    }

    if (extraItems.length === 0) {
      this.pendingExtraItemsPromise = null;
      return;
    }

    this.pendingExtraItemsPromise = fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: extraItems }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.description || 'Could not add the rest of the bundle to your cart.');
        }
        this.dispatchEvent(
          new CustomEvent('bundle:added', { bubbles: true, detail: { bundleId, items: extraItems } })
        );
        return true;
      })
      .catch((err) => {
        console.error('[bundle-quantity-break]', err);
        alert(err.message || 'Something went wrong adding the rest of this bundle to your cart.');
        return false;
      });
  }

  /**
   * Waits for both Prestige's own host-product submission (signaled
   * by the "variant:add" event it dispatches on success) and our
   * parallel extra-items request to finish, then triggers exactly one
   * cart drawer refresh so it renders the complete, final cart in a
   * single update rather than visibly changing twice.
   */
  bindDrawerRefreshAfterBothComplete(form) {
    form.addEventListener('variant:add', async () => {
      // The presence of a pending promise is itself the signal that a
      // tier ≥ 2 bundle was in flight for this submission — checking
      // this.selectedTier here instead would be unreliable, since it
      // reflects whatever tier is selected right now, not necessarily
      // the one that was active when the click that triggered this
      // event happened.
      if (!this.pendingExtraItemsPromise) return;

      // Prestige's own "variant:add" already means the host product
      // succeeded and its own drawer refresh/open has already been
      // triggered by its listeners. We just need to wait for our
      // parallel request (likely already done, or very close to it,
      // since both started at the same time) before forcing the one
      // additional refresh that brings in the rest of the bundle.
      await this.pendingExtraItemsPromise;
      this.pendingExtraItemsPromise = null;

      // "cart:refresh" is the exact event Prestige's CartDrawer,
      // CartCount, and CartDot components already listen for to
      // re-fetch and re-render themselves (see fetch-cart.js and
      // cart-drawer.js in theme.js) — no custom event needed here.
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
    });
  }

}

customElements.define('bundle-quantity-break', BundleQuantityBreak);
