/**
 * Progress & Streak System — La Mirada Creativa
 * Handles exercise completion, streaks, progress bar, and calendar view.
 */
(function () {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  const SUPABASE_URL = 'https://qcyfcnpqfbjefxsvxkpk.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_cVfgS4Eqz8s4VlhwUhLAnQ_UNG7T1ZY';
  const TOTAL_EXERCISES = 365;
  const DEBOUNCE_MS = 300;
  const CACHE_KEY = 'lmc_progress_cache';
  const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

  const EXERCISE_MILESTONES = [7, 30, 60, 90, 180, 270, 365];
  const STREAK_MILESTONES = [7, 14, 30, 60, 90];

  const MILESTONE_MESSAGES = {
    7: '¡Primera semana completada!',
    30: '¡Un mes de entrenamiento!',
    60: '¡Dos meses! Vas en serio.',
    90: '¡Bloque 1 terminado!',
    180: '¡Medio camino recorrido!',
    270: '¡Tres bloques completados!',
    365: '¡LO HAS CONSEGUIDO! 365 días.'
  };

  const STREAK_MESSAGES = {
    7: '¡7 días de racha!',
    14: '¡2 semanas seguidas!',
    30: '¡30 días de racha! Imparable.',
    60: '¡60 días seguidos!',
    90: '¡90 días de racha! Leyenda.'
  };

  // ============================================
  // STATE
  // ============================================
  let completedDays = new Set();
  let streakData = { current: 0, longest: 0, last_completed_date: null };
  let totalCompleted = 0;
  let nextExercise = 1;
  let byBlock = { tecnica: 0, sensible: 0, conceptual: 0, propia: 0 };

  let completedToday = false; // one-per-day limit
  let pendingClicks = new Set(); // debounce guard
  let supabaseClient = null;
  let calendarData = {};
  let calendarCurrentYear = new Date().getFullYear();
  let calendarCurrentMonth = new Date().getMonth() + 1;
  let observerSetup = false;

  // ============================================
  // HELPERS
  // ============================================
  function getUserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {
      return 'Europe/Madrid';
    }
  }

  function getTodayStr() {
    return new Date().toLocaleDateString('en-CA', { timeZone: getUserTimezone() });
  }

  function safeGetItem(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function safeRemoveItem(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ============================================
  // AUTH TOKEN
  // ============================================
  async function getToken() {
    if (typeof auth0Client === 'undefined' || !auth0Client) {
      throw new Error('Auth0 client not initialized');
    }
    try {
      // Auth0 SDK handles caching and refresh internally
      return await auth0Client.getTokenSilently();
    } catch (err) {
      console.error('Failed to get Auth0 token:', err);
      throw err;
    }
  }

  // ============================================
  // API LAYER
  // ============================================
  async function apiCall(endpoint, method, body) {
    const token = await getToken();
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };
    if (body && method === 'POST') {
      opts.body = JSON.stringify(body);
    }

    let url = `/.netlify/functions/${endpoint}`;
    if (method === 'GET' && body) {
      const params = new URLSearchParams(body);
      url += '?' + params.toString();
    }

    const response = await fetch(url, opts);

    if (response.status === 401) {
      // Token might be expired — force a fresh token from Auth0 SDK
      try {
        const retryToken = await auth0Client.getTokenSilently({ cacheMode: 'off' });
        opts.headers['Authorization'] = `Bearer ${retryToken}`;
        const retryResponse = await fetch(url, opts);
        if (!retryResponse.ok) {
          throw new Error(`API error: ${retryResponse.status}`);
        }
        return retryResponse.json();
      } catch (retryErr) {
        console.error('Token refresh retry failed:', retryErr);
        throw new Error(`API error: 401`);
      }
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return response.json();
  }

  // ============================================
  // CACHE (localStorage fallback)
  // ============================================
  function saveCache() {
    const cache = {
      ts: Date.now(),
      completedDays: Array.from(completedDays),
      streakData,
      totalCompleted,
      nextExercise,
      byBlock
    };
    safeSetItem(CACHE_KEY, JSON.stringify(cache));
  }

  function loadCache() {
    const raw = safeGetItem(CACHE_KEY);
    if (!raw) return false;
    try {
      const cache = JSON.parse(raw);
      if (Date.now() - cache.ts > CACHE_MAX_AGE_MS) return false;
      completedDays = new Set(cache.completedDays);
      streakData = cache.streakData;
      totalCompleted = cache.totalCompleted;
      nextExercise = cache.nextExercise;
      byBlock = cache.byBlock;
      completedToday = (streakData.last_completed_date === getTodayStr());
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================
  // CORE: LOAD PROGRESS
  // ============================================
  async function loadProgress() {
    try {
      const tz = getUserTimezone();
      const data = await apiCall('progress-get', 'GET', { timezone: tz });

      completedDays = new Set(data.completed_days || []);
      streakData = data.streak || { current: 0, longest: 0, last_completed_date: null };
      totalCompleted = data.total_completed || 0;
      nextExercise = data.next_exercise || 1;
      byBlock = data.by_block || { tecnica: 0, sensible: 0, conceptual: 0, propia: 0 };
      completedToday = (streakData.last_completed_date === getTodayStr());

      saveCache();
    } catch (err) {
      console.error('Failed to load progress, trying cache:', err);
      if (!loadCache()) {
        console.warn('No cached progress available');
      }
    }

    updateStreakDashboard();
    updateAllCardButtons();
  }

  // ============================================
  // CORE: COMPLETE EXERCISE
  // ============================================
  async function completeExercise(day) {
    if (completedDays.has(day)) return;
    // Sequential order: all previous days must be completed
    for (let d = 1; d < day; d++) {
      if (!completedDays.has(d)) {
        showToastSafe('Hay cartas anteriores sin completar', 'info', 'warning', 3000);
        return;
      }
    }
    if (completedToday) {
      showToastSafe('Podrás continuar el próximo día', 'info', 'schedule', 3000);
      return;
    }
    if (pendingClicks.has(day)) return;
    pendingClicks.add(day);

    // Optimistic UI
    completedDays.add(day);
    totalCompleted++;
    updateButtonState(day, true);
    updateStreakDashboard();

    try {
      const result = await apiCall('progress-complete', 'POST', {
        exercise_day: day,
        timezone: getUserTimezone()
      });

      // Update with server-confirmed data
      streakData = result.streak;
      totalCompleted = result.total_completed;
      completedToday = true;
      updateStreakDashboard();
      saveCache();

      // Check milestones
      checkMilestones(totalCompleted, streakData.current);

      // Analytics
      track('exercise_completed', {
        day: day,
        block: getBlockName(day),
        streak_after: streakData.current,
        total: totalCompleted
      });

    } catch (err) {
      console.error('Failed to complete exercise:', err);
      // Rollback
      completedDays.delete(day);
      totalCompleted--;
      updateButtonState(day, false);
      updateStreakDashboard();
      showToastSafe('Error al guardar. Inténtalo de nuevo.', 'error', 'error', 3000);
    } finally {
      setTimeout(() => pendingClicks.delete(day), DEBOUNCE_MS);
    }
  }

  // ============================================
  // CORE: UNCOMPLETE EXERCISE
  // ============================================
  async function uncompleteExercise(day) {
    if (!completedDays.has(day)) return;
    if (pendingClicks.has(day)) return;
    pendingClicks.add(day);

    // Optimistic UI
    completedDays.delete(day);
    totalCompleted--;
    updateButtonState(day, false);
    updateStreakDashboard();

    try {
      const result = await apiCall('progress-uncomplete', 'POST', {
        exercise_day: day,
        timezone: getUserTimezone()
      });

      streakData = result.streak;
      totalCompleted = result.total_completed;
      completedToday = (streakData.last_completed_date === getTodayStr());
      updateStreakDashboard();
      saveCache();

      track('exercise_uncompleted', { day: day });

    } catch (err) {
      console.error('Failed to uncomplete exercise:', err);
      // Rollback
      completedDays.add(day);
      totalCompleted++;
      updateButtonState(day, true);
      updateStreakDashboard();
      showToastSafe('Error al guardar. Inténtalo de nuevo.', 'error', 'error', 3000);
    } finally {
      setTimeout(() => pendingClicks.delete(day), DEBOUNCE_MS);
    }
  }

  // ============================================
  // UI: BUTTON STATE
  // ============================================
  function updateButtonState(day, completed) {
    const btns = document.querySelectorAll(`.progress-complete-btn[data-day="${day}"]`);
    btns.forEach(btn => {
      if (completed) {
        btn.classList.add('completed');
        btn.innerHTML = '<span class="progress-complete-icon">✓</span> Completado';
      } else {
        btn.classList.remove('completed');
        btn.innerHTML = '<span class="progress-complete-icon">○</span> Marcar como completado';
      }
      // Toggle completed state on parent card
      const wrapper = btn.closest('.swipe-card-wrapper, .scroll-card-wrapper');
      const card = wrapper && wrapper.querySelector('.card');
      if (card) {
        card.classList.toggle('card-completed', completed);
      }
    });
  }

  // ============================================
  // UI: INJECT BUTTONS INTO CARDS
  // ============================================
  function updateAllCardButtons() {
    // Access the global filteredCards and allCards from app/index.html
    const cards = window.CARDS || [];
    if (cards.length === 0) return;

    const wrappers = document.querySelectorAll('.swipe-card-wrapper, .scroll-card-wrapper');
    const currentFiltered = window._filteredCards || cards;

    wrappers.forEach(wrapper => {
      const index = parseInt(wrapper.dataset.index);
      const card = currentFiltered[index] || cards[index];

      if (!card || !card.day) return; // Only exercises have day property

      injectButton(wrapper, card.day, card.style);
    });
  }

  function injectButton(wrapper, day, cardStyle) {
    // Check if button already exists (could be inside wrapper)
    let btn = wrapper.querySelector('.progress-complete-btn');
    if (btn) {
      const isCompleted = completedDays.has(day);
      const btnIsCompleted = btn.classList.contains('completed');
      if (isCompleted !== btnIsCompleted) {
        updateSingleButton(btn, day, isCompleted);
      }
      return;
    }
    // Check if wrapper already exists (re-render without button)
    if (wrapper.querySelector('.progress-bottom-wrap')) return;

    // Create button
    btn = document.createElement('button');
    btn.className = 'progress-complete-btn';
    btn.dataset.day = day;

    // Determine if card has light theme (needs different button styling)
    if (cardStyle === 'exercise-light') {
      btn.classList.add('progress-btn-light');
    }

    const isCompleted = completedDays.has(day);
    if (isCompleted) {
      btn.classList.add('completed');
      btn.innerHTML = '<span class="progress-complete-icon">✓</span> Completado';
    } else {
      btn.innerHTML = '<span class="progress-complete-icon">○</span> Marcar como completado';
    }

    // Set initial completed state on card
    const card = wrapper.querySelector('.card');
    if (card) {
      card.classList.toggle('card-completed', isCompleted);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const d = parseInt(btn.dataset.day);
      if (completedDays.has(d)) {
        uncompleteExercise(d);
      } else {
        completeExercise(d);
      }
    });

    // Wrap .card-desc and button together in a flex container
    const cardContent = wrapper.querySelector('.card-content');
    if (cardContent) {
      const desc = cardContent.querySelector('.card-desc');
      if (desc) {
        const bottomWrap = document.createElement('div');
        bottomWrap.className = 'progress-bottom-wrap';
        desc.parentNode.insertBefore(bottomWrap, desc);
        bottomWrap.appendChild(desc);
        bottomWrap.appendChild(btn);
      } else {
        cardContent.appendChild(btn);
      }
    }
  }

  function updateSingleButton(btn, day, completed) {
    if (completed) {
      btn.classList.add('completed');
      btn.innerHTML = '<span class="progress-complete-icon">✓</span> Completado';
    } else {
      btn.classList.remove('completed');
      btn.innerHTML = '<span class="progress-complete-icon">○</span> Marcar como completado';
    }
    const wrapper = btn.closest('.swipe-card-wrapper, .scroll-card-wrapper');
    const card = wrapper && wrapper.querySelector('.card');
    if (card) {
      card.classList.toggle('card-completed', completed);
    }
  }

  // MutationObserver for lazy-loaded cards
  function setupAutoInjection() {
    if (observerSetup) return;
    observerSetup = true;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList && (node.classList.contains('swipe-card-wrapper') || node.classList.contains('scroll-card-wrapper'))) {
            const index = parseInt(node.dataset.index);
            const cards = window.CARDS || [];
            // Use the same lookup as updateAllCardButtons
            let card = null;
            if (window._filteredCards && window._filteredCards[index]) {
              card = window._filteredCards[index];
            } else if (cards[index]) {
              card = cards[index];
            }
            if (card && card.day) {
              injectButton(node, card.day, card.style);
            }
          }
        }
      }
    });

    const swipeView = document.getElementById('swipeView');
    const scrollView = document.getElementById('scrollView');
    if (swipeView) observer.observe(swipeView, { childList: true });
    if (scrollView) observer.observe(scrollView, { childList: true });
  }

  // ============================================
  // UI: STREAK DASHBOARD
  // ============================================
  function createStreakDashboard() {
    // iOS tab-based UI: Calendario tab has inline HTML elements in app/index.html
    const tabCalendario = document.getElementById('tabCalendarioContent');
    if (tabCalendario) {
      // Wire up calendar nav buttons (if not already wired)
      const prevBtn = document.getElementById('calNavPrev');
      const nextBtn = document.getElementById('calNavNext');
      if (prevBtn && !prevBtn._wired) {
        prevBtn._wired = true;
        prevBtn.addEventListener('click', () => navigateCalendar(-1));
      }
      if (nextBtn && !nextBtn._wired) {
        nextBtn._wired = true;
        nextBtn.addEventListener('click', () => navigateCalendar(1));
      }
      setupAutoInjection();
      return;
    }

    // Fallback: legacy inline dashboard (for contexts without the iOS tab UI)
    if (document.getElementById('streakDashboard')) return;

    const dashboard = document.createElement('div');
    dashboard.id = 'streakDashboard';
    dashboard.className = 'streak-dashboard';
    dashboard.innerHTML = `
      <div class="streak-dashboard-inner">
        <div class="streak-left">
          <div class="streak-counter">
            <span class="streak-fire" id="streakFire">🔥</span>
            <span class="streak-number" id="streakNumber">0</span>
            <span class="streak-label">días</span>
          </div>
          <span class="streak-best" id="streakBest">Mejor racha: 0 días</span>
        </div>
        <div class="streak-right">
          <div class="progress-bar-global">
            <div class="progress-fill-global" id="progressFillGlobal"></div>
            <div class="progress-block-marker" style="left: 24.6%"></div>
            <div class="progress-block-marker" style="left: 49.3%"></div>
            <div class="progress-block-marker" style="left: 74%"></div>
          </div>
          <div class="progress-label-row">
            <span class="progress-label-global" id="progressLabelGlobal">0/${TOTAL_EXERCISES}</span>
            <button class="streak-calendar-btn" id="streakCalendarBtn">
              <span class="material-symbols-sharp">calendar_month</span>
              Ver calendario
            </button>
          </div>
        </div>
      </div>
    `;

    const main = document.querySelector('.app .main');
    if (main && main.parentNode) {
      main.parentNode.insertBefore(dashboard, main);
    }

    const calBtn = document.getElementById('streakCalendarBtn');
    if (calBtn) {
      calBtn.addEventListener('click', () => {
        openCalendar();
        track('calendar_viewed', { month: `${calendarCurrentYear}-${String(calendarCurrentMonth).padStart(2, '0')}` });
      });
    }

    setupAutoInjection();
  }

  function updateStreakDashboard() {
    const newStreak = streakData.current || 0;
    const longest = streakData.longest || 0;
    const pct = Math.min(100, (totalCompleted / TOTAL_EXERCISES) * 100);

    // --- iOS Progreso tab elements ---
    const progresoNum = document.getElementById('progresoNumber');
    const progresoBest = document.getElementById('progresoBest');
    const progresoFill = document.getElementById('progresoFill');
    const progresoTotal = document.getElementById('progresoTotal');
    const progresoFire = document.getElementById('progresoFire');
    const progresoLabel = document.getElementById('progresoLabel');

    if (progresoNum) {
      const prevStreak = parseInt(progresoNum.textContent) || 0;
      progresoNum.textContent = newStreak;
      if (progresoLabel) {
        progresoLabel.textContent = newStreak === 1 ? 'día de racha' : 'días de racha';
      }
      if (progresoBest) {
        progresoBest.textContent = `Mejor racha: ${longest} día${longest !== 1 ? 's' : ''}`;
      }
      if (progresoFill) progresoFill.style.width = pct + '%';
      if (progresoTotal) progresoTotal.textContent = `${totalCompleted}/${TOTAL_EXERCISES}`;
      if (progresoFire) {
        if (newStreak === 0 && longest > 0) {
          progresoFire.classList.add('streak-risk');
        } else {
          progresoFire.classList.remove('streak-risk');
        }
      }
      // Bounce animation
      if (newStreak !== prevStreak && newStreak > 0) {
        progresoNum.classList.remove('streak-bounce');
        void progresoNum.offsetWidth;
        progresoNum.classList.add('streak-bounce');
      }
    }

    // --- Tab bar streak badge ---
    const badge = document.getElementById('streakBadge');
    if (badge) {
      badge.textContent = newStreak > 0 ? newStreak : '';
      badge.style.display = newStreak > 0 ? 'flex' : 'none';
    }

    // --- Legacy inline dashboard (fallback) ---
    const numEl = document.getElementById('streakNumber');
    const bestEl = document.getElementById('streakBest');
    const fillEl = document.getElementById('progressFillGlobal');
    const labelEl = document.getElementById('progressLabelGlobal');
    const fireEl = document.getElementById('streakFire');

    if (numEl) {
      const prevStreak = parseInt(numEl.textContent) || 0;
      numEl.textContent = newStreak;
      if (bestEl) bestEl.textContent = `Mejor racha: ${longest} día${longest !== 1 ? 's' : ''}`;
      if (fillEl) fillEl.style.width = pct + '%';
      if (labelEl) labelEl.textContent = `${totalCompleted}/${TOTAL_EXERCISES}`;
      if (fireEl) {
        if (newStreak === 0 && longest > 0) {
          fireEl.classList.add('streak-risk');
        } else {
          fireEl.classList.remove('streak-risk');
        }
      }
      if (newStreak !== prevStreak && newStreak > 0) {
        numEl.classList.remove('streak-bounce');
        void numEl.offsetWidth;
        numEl.classList.add('streak-bounce');
      }
    }
  }

  // ============================================
  // UI: CALENDAR MODAL
  // ============================================
  function createCalendarModal() {
    // Skip modal if calendar is rendered inline in the Calendario tab
    if (document.getElementById('tabCalendarioContent')) return;
    if (document.getElementById('progressCalendarModal')) return;

    const modal = document.createElement('div');
    modal.id = 'progressCalendarModal';
    modal.className = 'progress-calendar-modal';
    modal.innerHTML = `
      <div class="progress-calendar-content">
        <div class="progress-calendar-header">
          <button class="progress-calendar-nav" id="calNavPrev">
            <span class="material-symbols-sharp">chevron_left</span>
          </button>
          <h3 class="progress-calendar-title" id="calTitle"></h3>
          <button class="progress-calendar-nav" id="calNavNext">
            <span class="material-symbols-sharp">chevron_right</span>
          </button>
          <button class="progress-calendar-close" id="calClose">
            <span class="material-symbols-sharp">close</span>
          </button>
        </div>
        <div class="progress-calendar-weekdays">
          <span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span>
        </div>
        <div class="progress-calendar-grid" id="calGrid"></div>
        <div class="progress-calendar-legend">
          <span class="progress-cal-legend-item"><span class="progress-cal-swatch progress-cal-swatch-0"></span>Sin actividad</span>
          <span class="progress-cal-legend-item"><span class="progress-cal-swatch progress-cal-swatch-1"></span>1 ejercicio</span>
          <span class="progress-cal-legend-item"><span class="progress-cal-swatch progress-cal-swatch-3"></span>3+</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCalendar();
    });
    document.getElementById('calClose').addEventListener('click', closeCalendar);
    document.getElementById('calNavPrev').addEventListener('click', () => navigateCalendar(-1));
    document.getElementById('calNavNext').addEventListener('click', () => navigateCalendar(1));
  }

  async function openCalendar() {
    const modal = document.getElementById('progressCalendarModal');
    if (!modal) return;

    await renderCalendar();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeCalendar() {
    const modal = document.getElementById('progressCalendarModal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  async function navigateCalendar(direction) {
    calendarCurrentMonth += direction;
    if (calendarCurrentMonth > 12) {
      calendarCurrentMonth = 1;
      calendarCurrentYear++;
    } else if (calendarCurrentMonth < 1) {
      calendarCurrentMonth = 12;
      calendarCurrentYear--;
    }
    await renderCalendar();
  }

  const calendarCache = {};

  async function renderCalendar(forceRefresh) {
    const titleEl = document.getElementById('calTitle');
    const gridEl = document.getElementById('calGrid');
    if (!titleEl || !gridEl) return;

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    titleEl.textContent = `${monthNames[calendarCurrentMonth - 1]} ${calendarCurrentYear}`;

    const cacheKey = `${calendarCurrentYear}-${calendarCurrentMonth}`;

    // Fetch calendar data (use cache if available)
    let days = [];
    if (!forceRefresh && calendarCache[cacheKey]) {
      days = calendarCache[cacheKey];
    } else {
      try {
        const tz = getUserTimezone();
        const data = await apiCall('progress-calendar', 'GET', {
          year: calendarCurrentYear,
          month: calendarCurrentMonth,
          timezone: tz
        });
        days = data.days || [];
        calendarCache[cacheKey] = days;
      } catch (err) {
        console.error('Failed to load calendar:', err);
        // Use cached data as fallback if available
        if (calendarCache[cacheKey]) {
          days = calendarCache[cacheKey];
        }
      }
    }

    // Build grid
    const firstDay = new Date(calendarCurrentYear, calendarCurrentMonth - 1, 1);
    // getDay() returns 0=Sunday, we want Monday=0
    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: getUserTimezone() });

    // Pre-compute streak-break days:
    // A past day with count=0 that comes AFTER any day with activity → streak was broken
    const streakBreakDates = new Set();
    let hadActivity = false;
    for (const day of days) {
      if (day.count > 0) {
        hadActivity = true;
      } else if (hadActivity && day.date < todayStr) {
        streakBreakDates.add(day.date);
      }
    }

    let html = '';

    // Empty cells for alignment
    for (let i = 0; i < startDay; i++) {
      html += '<div class="progress-cal-day progress-cal-empty"></div>';
    }

    for (const day of days) {
      const dayNum = parseInt(day.date.split('-')[2]);
      const count = day.count;
      const isToday = day.date === todayStr;

      let intensityClass = 'progress-cal-level-0';
      if (count >= 3) intensityClass = 'progress-cal-level-3';
      else if (count >= 2) intensityClass = 'progress-cal-level-2';
      else if (count >= 1) intensityClass = 'progress-cal-level-1';
      else if (streakBreakDates.has(day.date)) intensityClass = 'progress-cal-streak-break';

      const todayClass = isToday ? ' progress-cal-today' : '';
      const tooltip = count > 0
        ? `${count} ejercicio${count > 1 ? 's' : ''} completado${count > 1 ? 's' : ''}`
        : streakBreakDates.has(day.date) ? 'Racha rota' : '';

      html += `<div class="progress-cal-day ${intensityClass}${todayClass}" ${tooltip ? `title="${tooltip}"` : ''}>
        <span class="progress-cal-daynum">${dayNum}</span>
      </div>`;
    }

    gridEl.innerHTML = html;
  }

  // ============================================
  // MILESTONES
  // ============================================
  function checkMilestones(total, streak) {
    // Exercise milestones
    if (EXERCISE_MILESTONES.includes(total)) {
      const msg = MILESTONE_MESSAGES[total] || `¡${total} ejercicios completados!`;
      showToastSafe(msg, 'success', 'emoji_events', 5000);
      track('streak_milestone', { milestone: total, type: 'exercises' });
    }

    // Streak milestones
    if (STREAK_MILESTONES.includes(streak)) {
      const msg = STREAK_MESSAGES[streak] || `¡${streak} días de racha!`;
      // Show slightly delayed if exercise milestone also triggered
      const delay = EXERCISE_MILESTONES.includes(total) ? 2000 : 0;
      setTimeout(() => {
        showToastSafe(msg, 'success', 'local_fire_department', 5000);
      }, delay);
      track('streak_milestone', { milestone: streak, type: 'streak' });
    }
  }

  // ============================================
  // ANALYTICS
  // ============================================
  function track(eventName, props) {
    try {
      // Google Analytics
      if (typeof gtag === 'function') {
        gtag('event', eventName, props);
      }
      // Amplitude
      if (typeof amplitude !== 'undefined' && amplitude.track) {
        amplitude.track(eventName, props);
      }
      // Mixpanel
      if (typeof mixpanel !== 'undefined' && mixpanel.track) {
        mixpanel.track(eventName, props);
      }
      // Facebook Pixel (only for key events)
      if (typeof fbq === 'function' && eventName === 'exercise_completed') {
        fbq('trackCustom', 'ExerciseCompleted', props);
      }
    } catch (e) {
      // Analytics should never break the app
    }
  }

  // ============================================
  // HELPERS
  // ============================================
  function getBlockName(day) {
    if (day >= 1 && day <= 90) return 'tecnica';
    if (day >= 91 && day <= 180) return 'sensible';
    if (day >= 181 && day <= 270) return 'conceptual';
    if (day >= 271 && day <= 365) return 'propia';
    return 'unknown';
  }

  function showToastSafe(message, type, icon, duration) {
    if (typeof showToast === 'function') {
      showToast(message, type, icon, duration);
    }
  }

  // ============================================
  // PUBLIC API
  // ============================================
  window.ProgressSystem = {
    loadProgress,
    completeExercise,
    uncompleteExercise,
    isCompleted: (day) => completedDays.has(day),
    getStreak: () => ({ ...streakData }),
    getCompletedDays: () => new Set(completedDays),
    getTotalCompleted: () => totalCompleted,
    getNextExercise: () => nextExercise,
    updateAllCardButtons,
    createStreakDashboard,
    createCalendarModal,
    openCalendar,
    closeCalendar,
    clearCache: () => safeRemoveItem(CACHE_KEY),
    getStreakData: () => ({ ...streakData, totalCompleted, nextExercise }),
    renderCalendar
  };

})();
