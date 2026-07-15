// La Mirada Creativa - Free Trial Logic
// Handles form submission, UTM capture, and analytics

(function() {
  'use strict';

  // ============================================
  // UTM Capture
  // ============================================
  function getUTMParams() {
    var params = new URLSearchParams(window.location.search);
    var utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var utm = {};
    utmKeys.forEach(function(key) {
      var val = params.get(key);
      if (val) utm[key] = val;
    });
    // Also check localStorage (from main landing)
    try {
      var stored = JSON.parse(localStorage.getItem('lmc_utm_data') || '{}');
      utmKeys.forEach(function(key) {
        if (!utm[key] && stored[key]) utm[key] = stored[key];
      });
    } catch(e) {}
    return utm;
  }

  // Store UTMs on page load
  var utmParams = getUTMParams();
  if (Object.keys(utmParams).length > 0) {
    try {
      localStorage.setItem('lmc_utm_data', JSON.stringify(utmParams));
    } catch(e) {}
  }

  // ============================================
  // Analytics helpers
  // ============================================
  function trackEvent(name, props) {
    props = props || {};
    // (Amplitude/Mixpanel retirados — usamos analítica propia + GA4)
    // GA4
    if (window.gtag) {
      try { gtag('event', name.replace(/\s+/g, '_').toLowerCase(), props); } catch(e) {}
    }
  }

  // Track page visit
  trackEvent('free_landing_visited', { page: window.location.pathname });

  // ============================================
  // Email validation
  // ============================================
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // ============================================
  // Form submission
  // ============================================
  function setupForm(formEl) {
    if (!formEl) return;

    var input = formEl.querySelector('input[type="email"]');
    var btn = formEl.querySelector('button[type="submit"]');
    var errorEl = formEl.querySelector('.ft-form-error');
    var btnText = btn ? btn.textContent : 'Empezar gratis';

    formEl.addEventListener('submit', function(e) {
      e.preventDefault();

      var email = (input.value || '').trim().toLowerCase();

      // Validate
      if (!email || !isValidEmail(email)) {
        if (errorEl) {
          errorEl.textContent = 'Introduce un email válido';
          errorEl.classList.add('visible');
        }
        input.focus();
        return;
      }

      // Hide previous error
      if (errorEl) errorEl.classList.remove('visible');

      // Disable button
      btn.disabled = true;
      btn.textContent = 'Enviando...';

      // Build payload
      var payload = { email: email };
      var utm = getUTMParams();
      if (utm.utm_source) payload.utm_source = utm.utm_source;
      if (utm.utm_medium) payload.utm_medium = utm.utm_medium;
      if (utm.utm_campaign) payload.utm_campaign = utm.utm_campaign;
      if (utm.utm_content) payload.utm_content = utm.utm_content;
      if (utm.utm_term) payload.utm_term = utm.utm_term;

      // Track form submitted
      trackEvent('free_form_submitted', { email: email });

      fetch('/.netlify/functions/free-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
      .then(function(result) {
        if (result.ok && result.data.success) {
          // Track success
          trackEvent('free_signup_completed', { email: email });

          // Meta Pixel Lead event
          if (window.fbq) {
            try { fbq('track', 'Lead', { content_name: 'free_trial' }); } catch(e) {}
          }

          // Redirect to confirmation
          window.location.href = '/prueba-gratis/confirmado/';
        } else if (result.data.existing) {
          // Existing user — show callout replacing the form
          if (errorEl) errorEl.classList.remove('visible');
          var callout = document.createElement('div');
          callout.className = 'ft-callout';
          callout.innerHTML = '<p class="ft-callout-title">Este email ya está registrado</p>' +
            '<p class="ft-callout-desc">Accede a tus ejercicios desde la app.</p>' +
            '<a href="/prueba-gratis/ejercicio/?day=1" class="btn btn--primary ft-callout-btn">Acceder a mis ejercicios</a>' +
            '<p class="ft-callout-help">¿Problemas? Escribe a <a href="mailto:hola@lamiradacreativa.com">hola@lamiradacreativa.com</a></p>';
          formEl.replaceWith(callout);
          trackEvent('free_existing_user', { email: email });
        } else {
          // Show error
          if (errorEl) {
            errorEl.textContent = result.data.error || 'Error al registrar. Inténtalo de nuevo.';
            errorEl.classList.add('visible');
          }
          btn.disabled = false;
          btn.textContent = btnText;
        }
      })
      .catch(function() {
        if (errorEl) {
          errorEl.textContent = 'Error de conexión. Inténtalo de nuevo.';
          errorEl.classList.add('visible');
        }
        btn.disabled = false;
        btn.textContent = btnText;
      });
    });
  }

  // Setup all forms on the page
  document.querySelectorAll('.ft-form').forEach(setupForm);

  // ============================================
  // "More exercises" scroll-to-form
  // ============================================
  var moreBtn = document.querySelector('.ft-cards-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', function() {
      var ctaSection = document.querySelector('.ft-final-cta');
      if (ctaSection) {
        ctaSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var input = ctaSection.querySelector('input[type="email"]');
        if (input) setTimeout(function() { input.focus(); }, 500);
      }
    });
  }
})();
