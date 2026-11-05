(function () {
  'use strict';

  // Wait for the full catalog to load (window.mixItReady is set in the section).
  // Falls back to normal page load if it isn't there.
  var ready = window.mixItReady || new Promise(function (resolve) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve);
    else resolve();
  });
  ready.then(function () { init(); });

  function init() {
    var wrapper = document.querySelector('.mix-it-wrapper');
    if (!wrapper) return;

    var dataEl = document.getElementById('mix-it-product-data-' + window.mixItSectionId);
    var products = [];
    try {
      products = JSON.parse(dataEl.textContent || '[]');
    } catch (e) {
      console.error('Mix It: could not parse product data', e);
    }

    var brandOverrideUrl = window.mixItBrandMapUrl;

    function buildBrandList() {
      var brands = Array.from(new Set(products.map(function (p) { return p.vendor; })))
        .filter(Boolean)
        .sort(function (a, b) { return a.localeCompare(b); });

      var brandListEls = wrapper.querySelectorAll('[data-brand-list]');
      brandListEls.forEach(function (list) {
        list.innerHTML = '';
        var index = list.closest('.mix-it-dropdown').dataset.index;
        brands.forEach(function (brand) {
          var li = document.createElement('li');
          li.textContent = brand;
          li.dataset.value = brand;
          li.addEventListener('click', function () {
            selectBrand(index, brand);
          });
          list.appendChild(li);
        });
      });
    }

    if (brandOverrideUrl) {
      fetch(brandOverrideUrl)
        .then(function (r) { return r.json(); })
        .then(function (map) {
          products.forEach(function (p) {
            if (map[p.handle]) p.vendor = map[p.handle];
          });
          buildBrandList();
        })
        .catch(function () {
          buildBrandList();
        });
    } else {
      buildBrandList();
    }

    var state = {
      1: { brand: null, fragrance: null, percent: 50 },
      2: { brand: null, fragrance: null, percent: 50 }
    };


    // --- Dropdown open/close ---
    wrapper.querySelectorAll('.mix-it-dd-trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        if (trigger.disabled) return;
        var panel = trigger.nextElementSibling;
        var isOpen = panel.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) {
          panel.classList.add('open');
          var block = trigger.closest('.mix-it-scent-block');
          if (block) block.classList.add('mix-it-block-active');
        }
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.mix-it-dropdown')) closeAllDropdowns();
    });

    function closeAllDropdowns() {
      wrapper.querySelectorAll('.mix-it-dd-panel.open').forEach(function (p) {
        p.classList.remove('open');
      });
      wrapper.querySelectorAll('.mix-it-scent-block.mix-it-block-active').forEach(function (b) {
        b.classList.remove('mix-it-block-active');
      });
    }

    // --- Brand search filter ---
    wrapper.querySelectorAll('.mix-it-dd-search').forEach(function (input) {
      input.addEventListener('input', function () {
        var term = input.value.toLowerCase();
        input.parentElement.querySelectorAll('li').forEach(function (li) {
          li.style.display = li.textContent.toLowerCase().indexOf(term) > -1 ? '' : 'none';
        });
      });
    });

    function selectBrand(index, brand) {
      state[index].brand = brand;
      state[index].fragrance = null;

      var block = wrapper.querySelector('.mix-it-scent-block[data-scent-index="' + index + '"]');
      var brandDd = block.querySelector('.mix-it-dropdown[data-type="brand"]');
      var fragDd = block.querySelector('.mix-it-dropdown[data-type="fragrance"]');

      brandDd.querySelector('.mix-it-dd-text').textContent = brand;
      brandDd.querySelector('.mix-it-brand-value').value = brand;
      closeAllDropdowns();

      // populate fragrance list
      var fragList = fragDd.querySelector('[data-fragrance-list]');
      fragList.innerHTML = '';
      var matches = products.filter(function (p) { return p.vendor === brand; });

      matches.forEach(function (p) {
        var li = document.createElement('li');
        li.textContent = p.title;
        li.dataset.value = p.title;
        li.dataset.image = p.image;
        li.addEventListener('click', function () {
          selectFragrance(index, p);
        });
        fragList.appendChild(li);
      });

      var fragTrigger = fragDd.querySelector('.mix-it-dd-trigger');
      fragTrigger.disabled = matches.length === 0;
      fragTrigger.querySelector('.mix-it-dd-text').textContent = 'Select Fragrance';
      fragDd.querySelector('.mix-it-fragrance-value').value = '';
      fragDd.querySelector('.mix-it-fragrance-image').value = '';

      renderLiquid();
      validate();
    }

    function selectFragrance(index, product) {
      state[index].fragrance = product.title;

      var block = wrapper.querySelector('.mix-it-scent-block[data-scent-index="' + index + '"]');
      var fragDd = block.querySelector('.mix-it-dropdown[data-type="fragrance"]');

      fragDd.querySelector('.mix-it-dd-text').textContent = product.title;
      fragDd.querySelector('.mix-it-fragrance-value').value = product.title;
      fragDd.querySelector('.mix-it-fragrance-image').value = product.image || '';
      closeAllDropdowns();

      renderLiquid();
      validate();
    }

    // --- Liquid fill in bottle (smooth, JS-tweened) ---
    var AREA_TOP = 8;
    var AREA_BOTTOM = 356;
    var AREA_HEIGHT = AREA_BOTTOM - AREA_TOP;

    var liquid1 = document.getElementById('mix-it-liquid-1');
    var liquid2 = document.getElementById('mix-it-liquid-2');
    var wave = document.getElementById('mix-it-wave');
    var percentLabel = document.getElementById('mix-it-percent-label');

    var current = { y1: AREA_BOTTOM, h1: 0, y2: AREA_BOTTOM, h2: 0 };
    var rafId = null;

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function animateLiquid(target, duration) {
      var start = { y1: current.y1, h1: current.h1, y2: current.y2, h2: current.h2 };
      var startTime = null;

      if (rafId) cancelAnimationFrame(rafId);

      function tweenStep(timestamp) {
        if (!startTime) startTime = timestamp;
        var elapsed = timestamp - startTime;
        var t = Math.min(elapsed / duration, 1);
        var eased = easeOutCubic(t);

        current.y1 = start.y1 + (target.y1 - start.y1) * eased;
        current.h1 = start.h1 + (target.h1 - start.h1) * eased;
        current.y2 = start.y2 + (target.y2 - start.y2) * eased;
        current.h2 = start.h2 + (target.h2 - start.h2) * eased;

        if (t < 1) {
          rafId = requestAnimationFrame(tweenStep);
        } else {
          rafId = null;
        }
      }

      rafId = requestAnimationFrame(tweenStep);
    }

    // Continuous idle ripple: runs forever so the surface always feels like real liquid,
    // independent of whether the fill level is currently changing.
    function idleLoop(timestamp) {
      var t = timestamp / 1000;
      var bobY = Math.sin(t * 1.6) * 1.6;
      var bobX = Math.sin(t * 1.1) * 5;

      if (liquid1) {
        liquid1.setAttribute('y', (current.y1 + bobY * 0.4).toFixed(2));
        liquid1.setAttribute('height', Math.max(current.h1 - bobY * 0.4, 0).toFixed(2));
      }
      if (liquid2) {
        liquid2.setAttribute('y', (current.y2 + bobY * 0.4).toFixed(2));
        liquid2.setAttribute('height', Math.max(current.h2, 0).toFixed(2));
      }
      if (wave) {
        var topIsLiquid2 = current.h2 > 0.5;
        var waveTop = topIsLiquid2 ? current.y2 : current.y1;
        var waveColor = topIsLiquid2 ? '#000' : '#EFE4BF';
        if (wave.getAttribute('data-color') !== waveColor) {
          wave.setAttribute('fill', waveColor);
          wave.setAttribute('fill-opacity', topIsLiquid2 ? '0.85' : '1');
          wave.setAttribute('data-color', waveColor);
        }
        wave.setAttribute('transform', 'translate(' + bobX.toFixed(2) + ',' + (waveTop + bobY * 0.4).toFixed(2) + ')');
      }

      requestAnimationFrame(idleLoop);
    }

    requestAnimationFrame(idleLoop);

    function renderLiquid() {
      var frac1 = state[1].fragrance ? state[1].percent / 100 : 0;
      var frac2 = state[2].fragrance ? state[2].percent / 100 : 0;

      var h1 = frac1 * AREA_HEIGHT;
      var h2 = frac2 * AREA_HEIGHT;
      var y1 = AREA_BOTTOM - h1;
      var y2 = y1 - h2;

      animateLiquid({ y1: y1, h1: h1, y2: y2, h2: h2 }, 550);

      if (percentLabel) {
        var total = Math.round((frac1 + frac2) * 100);
        percentLabel.textContent = total + '%';
      }
    }

    renderLiquid();


    var sliders = wrapper.querySelectorAll('.mix-it-range');
    sliders.forEach(function (slider) {
      slider.addEventListener('input', function () {
        var index = slider.dataset.index;
        var value = parseInt(slider.value, 10);
        var otherIndex = index === '1' ? '2' : '1';
        var otherValue = 100 - value;

        state[index].percent = value;
        state[otherIndex].percent = otherValue;

        updatePercentUI(index, value);
        updatePercentUI(otherIndex, otherValue);
        renderLiquid();
      });
    });

    function updatePercentUI(index, value) {
      var block = wrapper.querySelector('.mix-it-scent-block[data-scent-index="' + index + '"]');
      block.querySelector('.mix-it-percent-display').textContent = value + '%';
      block.querySelector('.mix-it-percent-value').value = value + '%';
      var otherSlider = block.querySelector('.mix-it-range');
      if (otherSlider.value != value) otherSlider.value = value;
    }

    // --- Validation ---
    function validate() {
      var submit = document.getElementById('mix-it-submit');
      var ready = state[1].brand && state[1].fragrance && state[2].brand && state[2].fragrance;
      submit.disabled = !ready;
    }

    // Plain form submission — posts to /cart/add and lets Shopify redirect to the cart page as normal.

    // initialize default 50/50 display
    updatePercentUI(1, 50);
    updatePercentUI(2, 50);
  }
})();