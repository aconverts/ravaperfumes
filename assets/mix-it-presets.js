/*
  RAVA Mix It: Popular Mixes
  Add to: assets/mix-it-presets.js   (load AFTER mix-it.js)

  Tap a mix -> selects both brands + fragrances and sets the ratio.
  The customer then names it and taps Add to Cart themselves.

  TO EDIT MIXES: change the MIXES list below.
    a / b = product HANDLES (the last part of the product URL)
    r     = % of the first perfume (the second gets the rest)
  A mix is hidden automatically if either product is missing from the
  source collection (check the browser console for which one).
*/
(function () {
  'use strict';

  var MIXES = [
    /* ---------- FOR HIM ---------- */
    { g: 'him', a: 'aventus-creed', la: 'Aventus', b: 'baccarat-rouge-540', lb: 'Baccarat Rouge 540', r: 60, notes: 'Fruity, woody, sweet, luxurious', name: 'Aventus x Baccarat' },
    { g: 'him', a: 'emporio-armani-stronger-with-you-intensely', la: 'Stronger With You Intensely', b: 'tobacco-vanille-tom-ford', lb: 'Tobacco Vanille', r: 60, notes: 'Warm vanilla, tobacco, caramel', name: 'Stronger x Tobacco' },
    { g: 'him', a: 'untitled-jul23_12-51', la: 'LV Imagination', b: 'tygar-bvlgari', lb: 'Bvlgari Tygar', r: 50, notes: 'Fresh citrus, ginger, masculine', name: 'Imagination x Tygar' },
    { g: 'him', a: 'le-male-elixir', la: 'Le Male Elixir', b: 'layton-parfums-de-marly', lb: 'PDM Layton', r: 40, notes: 'Honey, vanilla, apple, spice', name: 'Le Male x Layton' },
    { g: 'him', a: 'sauvage-elixir', la: 'Sauvage Elixir', b: 'aventus-creed', lb: 'Aventus', r: 30, notes: 'Spicy, fruity, woody', name: 'Sauvage x Aventus' },
    { g: 'him', a: 'xj-1861-naxos-xerjoff', la: 'Xerjoff Naxos', b: 'angels-share-by-kilian', lb: "Kilian Angels' Share", r: 60, notes: 'Honey, tobacco, cinnamon, cognac', name: 'Naxos x Angels Share' },
    { g: 'him', a: 'l-immensite', la: "LV L'Immensité", b: 'afternoon-swim-louis-vuitton', lb: 'LV Afternoon Swim', r: 60, notes: 'Grapefruit, citrus, amber', name: 'Immensite x Afternoon Swim' },
    { g: 'him', a: 'ombre-leather-tom-ford', la: 'Ombré Leather', b: 'baccarat-rouge-540', lb: 'Baccarat Rouge 540', r: 40, notes: 'Leather, saffron, sweet amber', name: 'Leather x Baccarat' },
    { g: 'him', a: 'versace-eros', la: 'Versace Eros', b: 'ultra-male-jean-paul-gaultier', lb: 'JPG Ultra Male', r: 50, notes: 'Mint, vanilla, pear, aromatic', name: 'Eros x Ultra Male' },

    /* ---------- FOR HER ---------- */
    { g: 'her', a: 'baccarat-rouge-540', la: 'Baccarat Rouge 540', b: 'burberry-her-elixir', lb: 'Burberry Her Elixir', r: 50, notes: 'Strawberry, amber, creamy musk', name: 'Baccarat x Her Elixir' },
    { g: 'her', a: 'libre-intense', la: 'YSL Libre Intense', b: 'valentino-donna-born-in-roma-intense-women', lb: 'Born in Roma Intense', r: 60, notes: 'Vanilla, lavender, jasmine, amber', name: 'Libre x Born in Roma' },
    { g: 'her', a: 'delina-exclusif-parfums-de-marly', la: 'Delina Exclusif', b: 'love-dont-be-shy-by-kilian', lb: "Love, Don't Be Shy", r: 60, notes: 'Rose, marshmallow, vanilla, fruit', name: 'Delina x Love' },
    { g: 'her', a: 'untitled-jul4_12-48', la: 'Kayali Vanilla 28', b: 'bianco-latte-giardini-di-toscana', lb: 'Bianco Latte', r: 40, notes: 'Caramel, brown sugar, creamy vanilla', name: 'Vanilla x Bianco Latte' },
    { g: 'her', a: 'coco-mademoiselle-chanei', la: 'Coco Mademoiselle', b: 'narciso-rodriguez-for-her', lb: 'Narciso For Her', r: 50, notes: 'Rose, patchouli, soft musk', name: 'Coco x Narciso' },
    { g: 'her', a: 'erba-pura-xerjoff', la: 'Xerjoff Erba Pura', b: 'kirke-tiziana-terenzi', lb: 'Tiziana Terenzi Kirke', r: 50, notes: 'Tropical fruit, musk, sweet amber', name: 'Erba Pura x Kirke' },
    { g: 'her', a: 'untitled-jul3_14-11', la: 'YSL Black Opium', b: 'good-girl-carolina-herrera', lb: 'CH Good Girl', r: 50, notes: 'Coffee, vanilla, white florals, cacao', name: 'Black Opium x Good Girl' },
    { g: 'her', a: 'alien-women-thierry-mugler', la: 'Mugler Alien', b: 'linterdit-rouge-givenchy', lb: "L'Interdit Rouge", r: 40, notes: 'Jasmine, tuberose, warm spices', name: 'Alien x Interdit Rouge' },
    { g: 'her', a: 'la-vie-est-belle-lancome', la: 'La Vie Est Belle', b: 'flowerbomb-viktor-rolf', lb: 'Flowerbomb', r: 50, notes: 'Praline, patchouli, floral vanilla', name: 'La Vie x Flowerbomb' }
  ];

  /* ---------------- helpers ---------------- */

  function findLi(list, value) {
    if (!list) return null;
    var items = list.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.value === value) return items[i];
    }
    return null;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------------- setup ---------------- */

  function setup(root) {
    if (root.dataset.ready === '1') return;
    root.dataset.ready = '1';

    var wrapper = root.closest('.mix-it-wrapper');
    if (!wrapper) return;

    var dataEl = document.getElementById('mix-it-product-data-' + wrapper.dataset.sectionId);
    var products = [];
    try {
      products = JSON.parse((dataEl && dataEl.textContent) || '[]');
    } catch (e) {
      console.warn('Mix It presets: could not parse product data', e);
    }
    var byHandle = {};
    products.forEach(function (p) { byHandle[p.handle] = p; });

    // Same brand override map mix-it.js uses (handle -> brand)
    var brandMap = {};
    var mapReady = window.mixItBrandMapUrl
      ? fetch(window.mixItBrandMapUrl)
          .then(function (r) { return r.json(); })
          .then(function (m) { brandMap = m || {}; })
          .catch(function () {})
      : Promise.resolve();

    var tagText = root.dataset.tag || '';
    var presetInput = wrapper.querySelector('[data-mix-preset-input]');
    var nameInput = wrapper.querySelector('#mix-it-name');
    var nameRow = nameInput && (nameInput.closest('.mix-it-name-row') || nameInput);
    var defaultPlaceholder = nameInput ? nameInput.getAttribute('placeholder') : '';
    var applying = false;

    // Resolve each mix to real products in the source collection
    var resolved = [];
    var missing = [];
    MIXES.forEach(function (mix) {
      var pa = byHandle[mix.a];
      var pb = byHandle[mix.b];
      if (pa && pb) resolved.push({ mix: mix, pa: pa, pb: pb });
      else {
        if (!pa) missing.push(mix.la + ' (' + mix.a + ')');
        if (!pb) missing.push(mix.lb + ' (' + mix.b + ')');
      }
    });
    if (missing.length) {
      console.warn('Mix It presets: hidden mixes, product not in source collection:', missing);
    }

    // Render cards
    var counts = { him: 0, her: 0 };
    resolved.forEach(function (item) {
      var track = root.querySelector('.mix-presets-track[data-gender="' + item.mix.g + '"]');
      if (!track) return;
      counts[item.mix.g]++;
      var r1 = item.mix.r;
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'mix-preset';
      card.setAttribute('aria-pressed', 'false');
      card.innerHTML =
        (counts[item.mix.g] === 1 && tagText ? '<span class="mix-preset-tag">' + esc(tagText) + '</span>' : '') +
        '<span class="mix-preset-top">' +
          '<span class="mix-preset-thumbs">' +
            (item.pa.image ? '<img src="' + esc(item.pa.image) + '" alt="" width="36" height="36" loading="lazy">' : '') +
            (item.pb.image ? '<img src="' + esc(item.pb.image) + '" alt="" width="36" height="36" loading="lazy">' : '') +
          '</span>' +
          '<span class="mix-preset-ratio">' + r1 + ' / ' + (100 - r1) + '</span>' +
        '</span>' +
        '<span class="mix-preset-names">' +
          '<span>' + esc(item.mix.la) + '</span>' +
          '<span>+ ' + esc(item.mix.lb) + '</span>' +
        '</span>' +
        '<span class="mix-preset-notes">' + esc(item.mix.notes) + '</span>' +
        '<span class="mix-preset-cta">Choose this mix</span>';
      card.addEventListener('click', function () { apply(card, item); });
      track.appendChild(card);
    });

    var tabs = root.querySelectorAll('.mix-presets-tab');
    var tracks = root.querySelectorAll('.mix-presets-track');

    if (!counts.him && !counts.her) {
      root.hidden = true;
      return;
    }

    // Hide the tab switcher if only one gender has mixes
    tabs.forEach(function (tab) { if (!counts[tab.dataset.gender]) tab.hidden = true; });
    if (!counts.him || !counts.her) {
      var tabWrap = root.querySelector('.mix-presets-tabs');
      if (tabWrap) tabWrap.hidden = true;
    }

    function updateFade(track) {
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      track.classList.toggle('is-end', atEnd);
    }

    function showGender(gender) {
      tabs.forEach(function (t) {
        var on = t.dataset.gender === gender;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      tracks.forEach(function (track) {
        track.hidden = track.dataset.gender !== gender;
        if (!track.hidden) {
          track.scrollLeft = 0;
          updateFade(track);
        }
      });
    }

    var initial = root.dataset.defaultGender === 'her' ? 'her' : 'him';
    if (!counts[initial]) initial = initial === 'him' ? 'her' : 'him';
    root.hidden = false;
    showGender(initial);

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { showGender(tab.dataset.gender); });
    });
    tracks.forEach(function (track) {
      track.addEventListener('scroll', function () { updateFade(track); }, { passive: true });
    });
    window.addEventListener('resize', function () {
      tracks.forEach(function (track) { if (!track.hidden) updateFade(track); });
    });

    /* ---------------- apply a mix ---------------- */

    function setActive(card) {
      root.querySelectorAll('.mix-preset').forEach(function (c) {
        var on = c === card;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
        var ctaEl = c.querySelector('.mix-preset-cta');
        if (ctaEl) ctaEl.textContent = on ? 'Selected ✓' : 'Choose this mix';
      });
    }

    function clearActive() {
      setActive(null);
      if (presetInput) presetInput.value = '';
      if (nameInput) nameInput.setAttribute('placeholder', defaultPlaceholder);
    }

    function selectScent(index, product) {
      return new Promise(function (resolve, reject) {
        var attempts = 0;
        (function attempt() {
          var block = wrapper.querySelector('.mix-it-scent-block[data-scent-index="' + index + '"]');
          var brandList = block && block.querySelector('[data-brand-list]');
          var brandLi = brandList && (findLi(brandList, brandMap[product.handle] || product.vendor) || findLi(brandList, product.vendor));

          // Brand list is built after mix-it.js loads its brand map, so wait for it
          if (!brandLi) {
            if (attempts++ < 40) { setTimeout(attempt, 100); return; }
            reject(new Error('Brand not found for: ' + product.title));
            return;
          }
          brandLi.click();

          var fragLi = findLi(block.querySelector('[data-fragrance-list]'), product.title);
          if (!fragLi) {
            reject(new Error('Fragrance not found: ' + product.title));
            return;
          }
          fragLi.click();
          resolve();
        })();
      });
    }

    function promptName() {
      if (!nameRow) return;
      var rect = nameRow.getBoundingClientRect();
      var visible = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!visible) nameRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameRow.classList.remove('mix-it-name-prompt');
      void nameRow.offsetWidth; // restart the highlight animation
      nameRow.classList.add('mix-it-name-prompt');
    }

    function apply(card, item) {
      if (applying) return;
      applying = true;
      setActive(card);

      mapReady
        .then(function () { return selectScent(1, item.pa); })
        .then(function () { return selectScent(2, item.pb); })
        .then(function () {
          var slider = wrapper.querySelector('.mix-it-range[data-index="1"]');
          if (slider) {
            slider.value = item.mix.r;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
          }

          // Suggest a name, but let the customer write their own
          if (nameInput) nameInput.setAttribute('placeholder', 'e.g. ' + item.mix.name);

          if (presetInput) {
            presetInput.value = item.mix.la + ' + ' + item.mix.lb + ' (' + item.mix.r + '/' + (100 - item.mix.r) + ')';
          }

          promptName();
        })
        .catch(function (err) {
          console.warn('Mix It presets:', err);
          clearActive();
        })
        .then(function () { applying = false; });
    }

    // Any manual change means it is no longer the preset mix
    wrapper.addEventListener('click', function (e) {
      if (!applying && e.target.closest('.mix-it-dd-list li')) clearActive();
    });
    wrapper.addEventListener('input', function (e) {
      if (!applying && e.target.classList && e.target.classList.contains('mix-it-range')) clearActive();
    });
  }

  function init(scope) {
    (scope || document).querySelectorAll('[data-mix-presets]').forEach(setup);
  }

  // Wait for the full catalog (window.mixItReady, set in the section) before building
  (window.mixItReady || new Promise(function (resolve) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve);
    else resolve();
  })).then(function () { init(); });

  document.addEventListener('shopify:section:load', function (e) { init(e.target); });
})();