// Shared metrics engine for the backoffice.
// Pulls from Stripe (revenue/CVR — source of truth), Meta Graph API (ad spend/ROAS),
// Supabase (leads/cohorts/engagement) and Resend (audience size), merges with the
// editable metrics_config, and derives the KPIs + an actions engine.
//
// Used by both metrics-api.js (dashboard) and daily-telegram.js (daily push) so the
// numbers can never diverge between the two.

const { createClient } = require('@supabase/supabase-js');

const DAY = 86400;
const META_API = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------- helpers
const eur = (n) =>
  (Math.round(n * 100) / 100).toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) + ' €';
const pct = (n) => (Math.round(n * 10) / 10).toFixed(1) + ' %';
const round1 = (n) => Math.round(n * 10) / 10;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MESES[parseInt(m, 10) - 1]}`;
}

function dayKey(dateOrUnix) {
  const d = typeof dateOrUnix === 'number' ? new Date(dateOrUnix * 1000) : new Date(dateOrUnix);
  return d.toISOString().slice(0, 10);
}
function isoWeek(dateInput) {
  const src = new Date(dateInput);
  const date = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- Stripe
async function loadStripe(windows, errors) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    errors.stripe = 'STRIPE_SECRET_KEY no configurada';
    return null;
  }
  const stripe = require('stripe')(key);
  const { since, since30, since7, ydayStart, ydayEnd } = windows;

  // Todas las compras completadas (paginado) — fuente de verdad de ingresos.
  const completed = await stripe.checkout.sessions
    .list({ status: 'complete', limit: 100 })
    .autoPagingToArray({ limit: 3000 });

  // Sesiones creadas en el rango (cualquier estado) — denominador del CVR.
  const createdInRange = await stripe.checkout.sessions
    .list({ created: { gte: since }, limit: 100 })
    .autoPagingToArray({ limit: 3000 });

  // Reembolsos: todos (para el neto histórico) + cortes por ventana.
  let refundsRange = 0;
  let refunds30 = 0;
  let refundsLifetime = 0;
  try {
    const refunds = await stripe.refunds.list({ limit: 100 }).autoPagingToArray({ limit: 3000 });
    for (const r of refunds) {
      refundsLifetime += r.amount / 100;
      if (r.created >= since) refundsRange += r.amount / 100;
      if (r.created >= since30) refunds30 += r.amount / 100;
    }
  } catch (e) {
    /* refunds are best-effort */
  }

  // Solo cuenta como venta real la sesión PAGADA. Un checkout puede quedar
  // 'complete' con payment_status 'no_payment_required' (cupón 100%) o 'unpaid':
  // esos NO son ingresos y no deben inflar el nº de ventas ni bajar el AOV.
  const paid = (s) => s.payment_status === 'paid';
  const euros = (s) => (s.amount_total || 0) / 100;
  const priceLabel = (s) => `${Math.round((s.amount_total || 0) / 100)} €`;

  let revenueLifetime = 0,
    ordersLifetime = 0,
    revenueRange = 0,
    ordersRange = 0,
    revenue30 = 0,
    revenue7 = 0,
    revenueYday = 0,
    ordersYday = 0;
  const bySourceRevenue = {};
  const revByDay = {};
  const completedByPrice = {}; // price -> count (rango)
  let lastSale = 0; // unix de la última venta pagada

  for (const s of completed) {
    if (!paid(s)) continue;
    const v = euros(s);
    revenueLifetime += v;
    ordersLifetime += 1;
    if (s.created > lastSale) lastSale = s.created;
    if (s.created >= since) {
      revenueRange += v;
      ordersRange += 1;
      const src = (s.metadata && s.metadata.utm_source) || 'directo';
      bySourceRevenue[src] = (bySourceRevenue[src] || 0) + v;
      completedByPrice[priceLabel(s)] = (completedByPrice[priceLabel(s)] || 0) + 1;
      revByDay[dayKey(s.created)] = (revByDay[dayKey(s.created)] || 0) + v;
    }
    if (s.created >= since30) revenue30 += v;
    if (s.created >= since7) revenue7 += v;
    if (s.created >= ydayStart && s.created < ydayEnd) {
      revenueYday += v;
      ordersYday += 1;
    }
  }

  const createdByPrice = {}; // price -> count (rango, cualquier estado)
  for (const s of createdInRange) {
    createdByPrice[priceLabel(s)] = (createdByPrice[priceLabel(s)] || 0) + 1;
  }

  // CVR por precio = completadas / creadas, por bucket de precio.
  const cvrByPrice = Object.keys(createdByPrice)
    .map((price) => {
      const created = createdByPrice[price];
      const won = completedByPrice[price] || 0;
      return { price, created, won, cvr: created ? (won / created) * 100 : 0 };
    })
    .filter((r) => r.price !== '0 €')
    .sort((a, b) => b.created - a.created);

  const checkoutStarts = createdInRange.length;

  return {
    revenueLifetime,
    ordersLifetime,
    revenueRange,
    ordersRange,
    revenue30,
    revenue7,
    revenueYday,
    ordersYday,
    refundsRange,
    refunds30,
    refundsLifetime,
    revenueRangeNet: revenueRange - refundsRange,
    revenue30Net: revenue30 - refunds30,
    revenueLifetimeNet: revenueLifetime - refundsLifetime,
    bySourceRevenue,
    revByDay,
    cvrByPrice,
    checkoutStarts,
    cvrCheckout: checkoutStarts ? (ordersRange / checkoutStarts) * 100 : 0,
    lastSaleDate: lastSale ? dayKey(lastSale) : null,
  };
}

// ---------------------------------------------------------------- Meta Ads
function sumActions(row, matcher) {
  if (!row || !Array.isArray(row.actions)) return 0;
  return row.actions
    .filter((a) => matcher(a.action_type))
    .reduce((t, a) => t + Number(a.value || 0), 0);
}

async function loadMeta(windows, errors) {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID || 'act_1405709477618981';
  if (!token) {
    errors.meta = 'META_ACCESS_TOKEN no configurada';
    return null;
  }
  const { windowDays, since30, since, ydayStart } = windows;

  const startDate = dayKey(Math.floor(Date.now() / 1000) - windowDays * DAY);
  const endDate = dayKey(Math.floor(Date.now() / 1000));

  try {
    // Serie diaria (alimenta el gráfico y los cortes por ventana).
    // OJO: la Graph API pagina; hay que seguir paging.next o se infravalora el
    // gasto del rango (y se infla el ROAS).
    const dailyUrl =
      `${META_API}/${account}/insights?` +
      `fields=spend,impressions,clicks,ctr,actions&time_increment=1&limit=500&` +
      `time_range=${encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))}&` +
      `access_token=${token}`;
    let daily = [];
    let pageUrl = dailyUrl;
    let pages = 0;
    while (pageUrl && pages < 30) {
      const res = await fetch(pageUrl);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      daily = daily.concat(json.data || []);
      pageUrl = json.paging && json.paging.next ? json.paging.next : null;
      pages++;
    }

    // Gasto acumulado histórico = capital invertido en publi.
    const lifeUrl =
      `${META_API}/${account}/insights?fields=spend&date_preset=maximum&access_token=${token}`;
    const lifeRes = await fetch(lifeUrl);
    const lifeJson = await lifeRes.json();
    const spendLifetime = lifeJson.data && lifeJson.data[0] ? Number(lifeJson.data[0].spend) : 0;

    // Fase de aprendizaje: adset activo más reciente (para no juzgar antes de 7 días).
    let activeAdsetCount = 0;
    let newestActiveAdset = null;
    const activeCampaigns = [];
    try {
      const asRes = await fetch(
        `${META_API}/${account}/adsets?fields=effective_status,created_time&limit=200&access_token=${token}`
      );
      const asJson = await asRes.json();
      for (const a of asJson.data || []) {
        if (a.effective_status === 'ACTIVE') {
          activeAdsetCount++;
          const d = a.created_time ? a.created_time.slice(0, 10) : null;
          if (d && (!newestActiveAdset || d > newestActiveAdset)) newestActiveAdset = d;
        }
      }
      const cRes = await fetch(
        `${META_API}/${account}/campaigns?fields=name,objective&effective_status=%5B%22ACTIVE%22%5D&limit=50&access_token=${token}`
      );
      const cJson = await cRes.json();
      for (const c of cJson.data || []) activeCampaigns.push({ name: c.name, objective: c.objective });
    } catch (e) {
      /* aprendizaje es best-effort */
    }

    const isLead = (t) => t === 'lead' || t.includes('lead');
    const isPurchase = (t) => t === 'purchase' || t.includes('purchase');

    const curMonth = dayKey(Math.floor(Date.now() / 1000)).slice(0, 7); // YYYY-MM actual
    let spendRange = 0,
      spend30 = 0,
      spendYday = 0,
      spendMTD = 0,
      impressions = 0,
      clicks = 0,
      leadsMeta = 0,
      purchasesMeta = 0;
    const spendByDay = {};
    for (const row of daily) {
      const ts = Math.floor(new Date(row.date_start + 'T00:00:00Z').getTime() / 1000);
      const spend = Number(row.spend || 0);
      spendByDay[row.date_start] = spend;
      if (ts >= since) {
        spendRange += spend;
        impressions += Number(row.impressions || 0);
        clicks += Number(row.clicks || 0);
        leadsMeta += sumActions(row, isLead);
        purchasesMeta += sumActions(row, isPurchase);
      }
      if (ts >= since30) spend30 += spend;
      if (row.date_start.slice(0, 7) === curMonth) spendMTD += spend; // gasto del mes en curso
      if (row.date_start === dayKey(ydayStart)) spendYday += spend;
    }

    return {
      spendRange,
      spend30,
      spendYday,
      spendMTD,
      spendLifetime,
      impressions,
      clicks,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      leadsMeta,
      purchasesMeta,
      spendByDay,
      activeAdsetCount,
      newestActiveAdset,
      activeCampaigns,
    };
  } catch (e) {
    errors.meta =
      /expired|OAuth|session|token/i.test(e.message)
        ? 'Token de Meta caducado/ inválido — regenera un token de Usuario del Sistema (no caduca).'
        : `Meta API: ${e.message}`;
    return null;
  }
}

// ---------------------------------------------------------------- Campaña activa
// Datos SOLO de la(s) campaña(s) activa(s), aisladas del histórico.
async function loadCampaigns(errors) {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID || 'act_1405709477618981';
  if (!token) return [];
  try {
    const cRes = await fetch(
      `${META_API}/${account}/campaigns?fields=id,name,objective,created_time,start_time,daily_budget&effective_status=%5B%22ACTIVE%22%5D&limit=50&access_token=${token}`
    );
    const cJson = await cRes.json();
    const actives = cJson.data || [];
    if (!actives.length) return [];

    const iRes = await fetch(
      `${META_API}/${account}/insights?level=campaign&fields=campaign_id,spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type,purchase_roas&date_preset=maximum&limit=200&access_token=${token}`
    );
    const iJson = await iRes.json();
    const byId = {};
    for (const row of iJson.data || []) byId[row.campaign_id] = row;

    return actives.map((c) => {
      const ins = byId[c.id] || {};
      const act = (t) => { const a = (ins.actions || []).find((x) => x.action_type === t); return a ? Number(a.value) : 0; };
      const cost = (t) => { const a = (ins.cost_per_action_type || []).find((x) => x.action_type === t); return a ? Number(a.value) : null; };
      const launch = (c.created_time || c.start_time || '').slice(0, 10);
      const daysRunning = launch ? Math.floor((Date.now() - new Date(launch + 'T00:00:00Z').getTime()) / 86400000) : null;
      const roasArr = ins.purchase_roas || [];
      return {
        id: c.id, name: c.name, objective: c.objective, launch, daysRunning,
        dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        learning: daysRunning != null && daysRunning < 7
          ? { day: daysRunning, total: 7, daysLeft: 7 - daysRunning, until: launch ? new Date(new Date(launch + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().slice(0, 10) : null }
          : null,
        spend: Number(ins.spend || 0),
        impressions: Number(ins.impressions || 0),
        clicks: Number(ins.clicks || 0),
        ctr: ins.ctr ? Number(ins.ctr) : null,
        cpc: ins.cpc ? Number(ins.cpc) : null,
        landingViews: act('landing_page_view') || act('omni_landing_page_view'),
        linkClicks: act('link_click'),
        checkouts: act('initiate_checkout') || act('omni_initiated_checkout'),
        purchases: act('purchase') || act('offsite_conversion.fb_pixel_purchase') || act('omni_purchase'),
        leads: act('lead') || act('offsite_conversion.fb_pixel_lead'),
        cpa: cost('purchase') || cost('offsite_conversion.fb_pixel_purchase'),
        cpl: cost('lead'),
        roas: roasArr.length ? Number(roasArr[0].value) : null,
      };
    });
  } catch (e) {
    errors.campaigns = `Meta campañas: ${e.message}`;
    return [];
  }
}

// ---------------------------------------------------------------- Supabase
async function loadSupabase(windows, errors) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    errors.supabase = 'Supabase no configurado';
    return null;
  }
  const sb = createClient(url, key);
  const { sinceISO, since30ISO, since3dISO, ydayStartISO, ydayEndISO, windowDays } = windows;

  const [freeRows, streakRows, emailRows, complAyer, complRange, eventRows] = await Promise.all([
    sb.from('free_users').select('created_at, converted').order('created_at', { ascending: false }).limit(10000),
    sb.from('streaks').select('current_streak, total_completed, auth0_user_id').limit(10000),
    sb.from('email_sequence').select('step').not('sent_at', 'is', null).limit(50000),
    sb.from('progress').select('id', { count: 'exact', head: true }).gte('completed_at', ydayStartISO).lt('completed_at', ydayEndISO),
    sb.from('progress').select('id', { count: 'exact', head: true }).gte('completed_at', sinceISO),
    sb.from('events').select('event, device_id, created_at, utm_source').gte('created_at', sinceISO).limit(50000),
  ]);

  // Leads
  const free = freeRows.data || [];
  const leadsTotal = free.length;
  const leadsRange = free.filter((r) => r.created_at >= sinceISO).length;
  const leads30 = free.filter((r) => r.created_at >= since30ISO).length;
  const leads3d = free.filter((r) => r.created_at >= since3dISO).length;
  const convertedTotal = free.filter((r) => r.converted).length;
  const leadConvRate = leadsTotal ? (convertedTotal / leadsTotal) * 100 : 0;

  // Leads por día (serie) + cohortes semanales
  const leadsByDay = {};
  const cohortMap = {};
  for (const r of free) {
    const d = dayKey(r.created_at);
    leadsByDay[d] = (leadsByDay[d] || 0) + 1;
    const w = isoWeek(r.created_at);
    if (!cohortMap[w]) cohortMap[w] = { week: w, total: 0, converted: 0 };
    cohortMap[w].total += 1;
    if (r.converted) cohortMap[w].converted += 1;
  }
  const cohorts = Object.values(cohortMap)
    .map((c) => ({ ...c, rate: c.total ? (c.converted / c.total) * 100 : 0 }))
    .sort((a, b) => (a.week < b.week ? 1 : -1))
    .slice(0, 8);

  // Rachas / engagement
  const streaks = streakRows.data || [];
  const buyers = streaks.length; // proxy de compradores activos en la app
  const activos = streaks.filter((s) => s.current_streak > 0).length;
  const positive = streaks.filter((s) => s.current_streak > 0).map((s) => s.current_streak);
  const rachaMedia = positive.length ? round1(positive.reduce((a, b) => a + b, 0) / positive.length) : 0;
  const rachaMax = streaks.reduce((m, s) => Math.max(m, s.current_streak || 0), 0);
  const distribucion = {
    inactivo: streaks.filter((s) => (s.current_streak || 0) === 0).length,
    d1_3: streaks.filter((s) => s.current_streak >= 1 && s.current_streak <= 3).length,
    d4_7: streaks.filter((s) => s.current_streak >= 4 && s.current_streak <= 7).length,
    d8_30: streaks.filter((s) => s.current_streak >= 8 && s.current_streak <= 30).length,
    d30plus: streaks.filter((s) => s.current_streak > 30).length,
  };

  // Emails secuencia
  const emailStats = {};
  for (const r of emailRows.data || []) emailStats[r.step] = (emailStats[r.step] || 0) + 1;

  // Analítica propia (visitas)
  const events = eventRows.data || [];
  const pageviews = events.filter((e) => e.event === 'pageview');
  const visitsRange = pageviews.length;
  const uniqueVisitors = new Set(pageviews.map((e) => e.device_id).filter(Boolean)).size;
  const visitsByDay = {};
  for (const e of pageviews) visitsByDay[dayKey(e.created_at)] = (visitsByDay[dayKey(e.created_at)] || 0) + 1;
  const eventsAvailable = !eventRows.error;

  return {
    leadsTotal,
    leadsRange,
    leads30,
    leads3d,
    convertedTotal,
    leadConvRate,
    leadsByDay,
    cohorts,
    buyers,
    activos,
    rachaMedia,
    rachaMax,
    distribucion,
    emailStats,
    completadosAyer: complAyer.count || 0,
    completadosRange: complRange.count || 0,
    visitsRange,
    uniqueVisitors,
    visitsByDay,
    eventsAvailable,
  };
}

// ---------------------------------------------------------------- Resend audience
async function loadResendAudience(errors) {
  const key = process.env.RESEND_FULL_KEY || process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!audienceId) return null;
  try {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      errors.resend =
        res.status === 401 || res.status === 403
          ? 'Resend: hace falta una key Full Access (RESEND_FULL_KEY) para leer la audiencia.'
          : `Resend: HTTP ${res.status}`;
      return null;
    }
    const json = await res.json();
    const contacts = json.data || [];
    const unsub = contacts.filter((c) => c.unsubscribed).length;
    return { total: contacts.length, subscribed: contacts.length - unsub, unsubscribed: unsub };
  } catch (e) {
    errors.resend = `Resend: ${e.message}`;
    return null;
  }
}

// ---------------------------------------------------------------- config
async function loadConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const defaults = {
    monthly_ad_budget: 600, // presupuesto mensual de publi que aparta el usuario
    other_ad_spend: 0, // gasto en publi NO-Meta del mes (€)
    product_price: 69,
    target_roas: 2,
    target_cpl: 3,
    target_cac: 15,
  };
  if (!url || !key) return defaults;
  try {
    const sb = createClient(url, key);
    const { data } = await sb.from('metrics_config').select('*').eq('id', 1).single();
    return data ? { ...defaults, ...data } : defaults;
  } catch {
    return defaults;
  }
}

// ---------------------------------------------------------------- windows
function buildWindows(rangeDays) {
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const ydayStartDate = new Date(todayStart);
  ydayStartDate.setUTCDate(ydayStartDate.getUTCDate() - 1);

  const windowDays = Math.max(rangeDays, 30);
  return {
    rangeDays,
    windowDays,
    since: nowSec - rangeDays * DAY,
    since30: nowSec - 30 * DAY,
    since7: nowSec - 7 * DAY,
    ydayStart: Math.floor(ydayStartDate.getTime() / 1000),
    ydayEnd: Math.floor(todayStart.getTime() / 1000),
    sinceISO: new Date((nowSec - rangeDays * DAY) * 1000).toISOString(),
    since30ISO: new Date((nowSec - 30 * DAY) * 1000).toISOString(),
    since3dISO: new Date((nowSec - 3 * DAY) * 1000).toISOString(),
    ydayStartISO: ydayStartDate.toISOString(),
    ydayEndISO: todayStart.toISOString(),
  };
}

// ---------------------------------------------------------------- main
async function computeMetrics({ rangeDays = 30 } = {}) {
  const windows = buildWindows(rangeDays);
  const errors = {};

  const [stripe, meta, sb, resend, config, campaigns] = await Promise.all([
    loadStripe(windows, errors).catch((e) => {
      errors.stripe = `Stripe: ${e.message}`;
      return null;
    }),
    loadMeta(windows, errors),
    loadSupabase(windows, errors).catch((e) => {
      errors.supabase = `Supabase: ${e.message}`;
      return null;
    }),
    loadResendAudience(errors),
    loadConfig(),
    loadCampaigns(errors),
  ]);

  // ---- derived KPIs ----
  const revenueRange = stripe ? stripe.revenueRange : 0;
  const revenueRangeNet = stripe ? stripe.revenueRangeNet : 0;
  const revenue30Net = stripe ? stripe.revenue30Net : 0;
  const ordersRange = stripe ? stripe.ordersRange : 0;

  const otherRange = (config.other_ad_spend || 0) * (rangeDays / 30);
  const spendRange = (meta ? meta.spendRange : 0) + otherRange;
  const spend30 = (meta ? meta.spend30 : 0) + (config.other_ad_spend || 0);
  const spendLifetime = meta ? meta.spendLifetime : 0;

  const roas = spendRange > 0 ? revenueRangeNet / spendRange : null;
  const cac = ordersRange > 0 ? spendRange / ordersRange : null;
  const aov = ordersRange > 0 ? revenueRange / ordersRange : null;
  const leadsRange = sb ? sb.leadsRange : 0;
  const cpl = leadsRange > 0 && spendRange > 0 ? spendRange / leadsRange : null;

  // Presupuesto de publicidad del MES en curso (lo que el usuario aparta cada mes).
  const monthlyBudget = Number(config.monthly_ad_budget) || 0;
  const spendMTD = (meta ? meta.spendMTD : 0) + (config.other_ad_spend || 0);
  const budgetRemaining = monthlyBudget - spendMTD;
  const budgetUsedPct = monthlyBudget > 0 ? (spendMTD / monthlyBudget) * 100 : null;
  // Proyección de gasto al cierre de mes según el ritmo actual.
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const budgetProjected = dayOfMonth > 0 ? (spendMTD / dayOfMonth) * daysInMonth : spendMTD;
  const netProfit30 = revenue30Net - spend30; // ingresos netos − gasto en publi

  // Fase de aprendizaje de Meta: la estrategia dice NO juzgar hasta pasados 7 días
  // desde el lanzamiento del adset activo (Meta aún está optimizando).
  const LEARNING_DAYS = 7;
  let learning = { active: false, activeCampaigns: meta ? meta.activeCampaigns || [] : [] };
  if (meta && meta.newestActiveAdset) {
    const launchMs = new Date(meta.newestActiveAdset + 'T00:00:00Z').getTime();
    const daysSince = Math.floor((Date.now() - launchMs) / (86400 * 1000));
    if (daysSince >= 0 && daysSince < LEARNING_DAYS) {
      learning = {
        active: true,
        day: daysSince,
        total: LEARNING_DAYS,
        daysLeft: LEARNING_DAYS - daysSince,
        launchDate: meta.newestActiveAdset,
        until: new Date(launchMs + LEARNING_DAYS * 86400 * 1000).toISOString().slice(0, 10),
        activeCampaigns: meta.activeCampaigns || [],
      };
    }
  }

  const bundle = {
    generatedAt: new Date().toISOString(),
    rangeDays,
    config,
    lastSaleDate: stripe ? stripe.lastSaleDate : null,
    kpi: {
      revenueYday: stripe ? stripe.revenueYday : 0,
      revenueRange,
      revenueRangeNet,
      refundsRange: stripe ? stripe.refundsRange : 0,
      revenueLifetime: stripe ? stripe.revenueLifetime : 0,
      revenueLifetimeNet: stripe ? stripe.revenueLifetimeNet : 0,
      ordersYday: stripe ? stripe.ordersYday : 0,
      ordersRange,
      ordersLifetime: stripe ? stripe.ordersLifetime : 0,
      spendYday: meta ? meta.spendYday : 0,
      spendRange,
      spendLifetime,
      roas,
      cac,
      aov,
      cpl,
      monthlyBudget,
      spendMTD,
      budgetRemaining,
      budgetUsedPct,
      budgetProjected,
      netProfit30,
      cvrCheckout: stripe ? stripe.cvrCheckout : 0,
      leadsRange,
      leadsTotal: sb ? sb.leadsTotal : 0,
      leadConvRate: sb ? sb.leadConvRate : 0,
      buyers: sb ? sb.buyers : 0,
      visitsRange: sb ? sb.visitsRange : 0,
      uniqueVisitors: sb ? sb.uniqueVisitors : 0,
    },
    funnel: {
      visits: sb ? sb.uniqueVisitors : 0,
      leads: leadsRange,
      checkoutStarts: stripe ? stripe.checkoutStarts : 0,
      orders: ordersRange,
      cvrVisitLead: sb && sb.uniqueVisitors ? (leadsRange / sb.uniqueVisitors) * 100 : null,
      cvrVisitBuy: sb && sb.uniqueVisitors ? (ordersRange / sb.uniqueVisitors) * 100 : null,
      cvrCheckout: stripe ? stripe.cvrCheckout : 0,
    },
    cvrByPrice: stripe ? stripe.cvrByPrice : [],
    bySourceRevenue: stripe ? stripe.bySourceRevenue : {},
    cohorts: sb ? sb.cohorts : [],
    streaks: sb
      ? { activos: sb.activos, rachaMedia: sb.rachaMedia, rachaMax: sb.rachaMax, distribucion: sb.distribucion }
      : null,
    emailStats: sb ? sb.emailStats : {},
    engagement: sb ? { completadosAyer: sb.completadosAyer, completadosRange: sb.completadosRange } : null,
    audience: {
      leadsByDay: sb ? sb.leadsByDay : {},
      resend,
      leadsTotal: sb ? sb.leadsTotal : 0,
      leads3d: sb ? sb.leads3d : 0,
    },
    charts: {
      revByDay: stripe ? stripe.revByDay : {},
      spendByDay: meta ? meta.spendByDay : {},
      leadsByDay: sb ? sb.leadsByDay : {},
      visitsByDay: sb ? sb.visitsByDay : {},
    },
    ownAnalytics: sb ? sb.eventsAvailable : false,
    learning,
    campaigns: campaigns || [],
    errors,
  };

  bundle.summary = buildSummary(bundle);
  bundle.verdict = buildVerdict(bundle);
  bundle.campaignVerdict = buildCampaignVerdict(bundle);
  bundle.plan = buildPlan(bundle);
  bundle.actions = buildActions(bundle);
  return bundle;
}

// ---------------------------------------------------------------- summary (progreso)
function buildSummary(b) {
  const k = b.kpi;
  const presupuesto =
    k.monthlyBudget > 0
      ? `${eur(k.spendMTD)} / ${eur(k.monthlyBudget)} (${k.budgetUsedPct == null ? '—' : round1(k.budgetUsedPct) + '%'}) · quedan ${eur(k.budgetRemaining)}`
      : 'sin presupuesto definido';
  const lines = [
    `Ingresos ${b.rangeDays}d: ${eur(k.revenueRangeNet)} · ayer ${eur(k.revenueYday)} · total ${eur(k.revenueLifetime)}`,
    `Ventas ${b.rangeDays}d: ${k.ordersRange} · ayer ${k.ordersYday} · total ${k.ordersLifetime}`,
    `Gasto publi ${b.rangeDays}d: ${eur(k.spendRange)} · ayer ${eur(k.spendYday)} · invertido total ${eur(k.spendLifetime)}`,
    `ROAS ${k.roas == null ? '—' : round1(k.roas) + 'x'} · CAC ${k.cac == null ? '—' : eur(k.cac)} · AOV ${k.aov == null ? '—' : eur(k.aov)}`,
    `Presupuesto publi del mes: ${presupuesto} · beneficio 30d ${eur(k.netProfit30)}`,
    `Leads ${b.rangeDays}d: ${k.leadsRange} (${k.leadsTotal} total) · audiencia Resend ${b.audience.resend ? b.audience.resend.total : 'n/d'}`,
    `Ejercicios completados ${b.rangeDays}d: ${b.engagement ? b.engagement.completadosRange : 0} · rachas activas ${b.streaks ? b.streaks.activos : 0}`,
  ];
  return lines;
}

// ---------------------------------------------------------------- actions engine
// Lenguaje sencillísimo (que lo entienda cualquiera): frases cortas, ejemplos
// tipo "de cada 100 personas…", y para cada aviso, qué hacer.
const ICON = { alto: '🔴', medio: '🟠', bajo: '🟡', ok: '🟢', info: 'ℹ️' };

function buildActions(b) {
  const k = b.kpi;
  const c = b.config;
  const out = [];
  const push = (level, title, plain, todo) =>
    out.push({ level, icon: ICON[level] || '•', title, plain, todo: todo || [] });

  // Fase de aprendizaje: NO dar consejos reactivos. Respetar el plan (esperar 7 días).
  if (b.learning && b.learning.active) {
    push('ok', `Fase de aprendizaje: día ${b.learning.day} de ${b.learning.total}`,
      `Lanzaste anuncios hace ${b.learning.day} día${b.learning.day === 1 ? '' : 's'}. Meta todavía está aprendiendo a quién enseñarlos, así que los números de ahora NO son fiables y es normal ver pocas ventas. Acordamos no tocar nada los primeros 7 días.`,
      [
        `Deja los anuncios correr sin cambios hasta el ${fmtDate(b.learning.until)}.`,
        `No cambies precio, presupuesto ni creatividades (reiniciarías el aprendizaje).`,
        `Mientras, la secuencia de emails va convirtiendo leads en ventas (tarda hasta 30 días).`,
      ]);
    for (const [src, msg] of Object.entries(b.errors || {})) push('info', `Aviso técnico (${src})`, msg, []);
    return out;
  }

  if (k.monthlyBudget > 0 && k.spendMTD > k.monthlyBudget) {
    push('alto', 'Te has pasado del presupuesto de anuncios del mes',
      `Este mes tu tope era ${eur(k.monthlyBudget)} y ya llevas ${eur(k.spendMTD)} gastados en anuncios.`,
      ['Pausa los anuncios, o sube el presupuesto a propósito.']);
  } else if (k.monthlyBudget > 0 && k.budgetProjected > k.monthlyBudget * 1.1) {
    push('medio', 'A este ritmo te pasarás del presupuesto del mes',
      `Vas camino de gastar ${eur(k.budgetProjected)} y tu tope es ${eur(k.monthlyBudget)}.`,
      ['Gasta un poco menos al día.']);
  }
  if (k.ordersYday === 0 && k.spendYday > 0) {
    push('alto', 'Ayer pagaste anuncios y no vendiste nada',
      `Gastaste ${eur(k.spendYday)} en anuncios y vendiste 0. Eso es tirar dinero.`,
      ['Pausa los anuncios hasta arreglar el precio (mira el plan de arriba).']);
  }
  if (k.roas != null && k.roas < c.target_roas && k.spendRange > 0) {
    push('medio', 'Los anuncios casi no te dan beneficio',
      `Por cada 1 € que metes en anuncios, recuperas ${round1(k.roas)} €. Lo bueno es ${c.target_roas} € o más.`,
      ['Apaga los anuncios que peor funcionan y deja solo los mejores.']);
  }
  if (k.cpl != null && k.cpl > c.target_cpl) {
    push('medio', 'Conseguir un email te sale carísimo',
      `Pagas ${eur(k.cpl)} por cada persona que deja su email. Debería costarte ${eur(c.target_cpl)} o menos.`,
      ['Cambia la foto y el texto del anuncio que pide el email.']);
  }
  if (k.cac != null && k.cac > c.target_cac) {
    push('medio', 'Cada cliente nuevo te cuesta más de la cuenta',
      `Gastas ${eur(k.cac)} en anuncios por cada cliente, y cada uno paga de media ${eur(k.aov)}. Te queda muy poco.`,
      ['Sube el precio, o gasta menos por cliente.']);
  }
  if (b.audience.leads3d === 0 && k.spendRange > 0) {
    push('medio', 'Llevas 3 días pagando anuncios sin conseguir ni un email',
      'Gastas en anuncios pero no entra ningún email nuevo. Algo está apagado o roto.',
      ['Comprueba que la campaña de emails está encendida.', 'Comprueba que el botón de "registrarse" funciona.']);
  }
  if (b.funnel.cvrCheckout && b.funnel.cvrCheckout < 30 && b.funnel.checkoutStarts >= 10) {
    const de100 = Math.round(b.funnel.cvrCheckout);
    push('medio', 'Mucha gente empieza a pagar pero no termina',
      `De cada 100 que llegan a la pantalla de pago, solo ${de100} compran. Los otros ${100 - de100} se van.`,
      ['Haz el pago más fácil: menos pasos y más formas de pagar (tarjeta, PayPal).']);
  }
  const priced = (b.cvrByPrice || []).filter((r) => r.created >= 10);
  if (priced.length >= 2) {
    const best = [...priced].sort((a, b) => b.cvr - a.cvr)[0];
    const worst = [...priced].sort((a, b) => a.cvr - b.cvr)[0];
    if (best.price !== worst.price && best.cvr - worst.cvr > 3) {
      push('bajo', `El precio de ${best.price} vendía mucho mejor que el de ${worst.price}`,
        `A ${best.price} compraban ${Math.round(best.cvr)} de cada 100. A ${worst.price}, solo ${Math.round(worst.cvr)} de cada 100.`,
        [`Prueba a poner el precio en ${best.price} (o los dos a la vez y compara).`]);
    }
  }
  if (Object.keys(b.errors || {}).length) {
    for (const [src, msg] of Object.entries(b.errors)) push('info', `Aviso técnico (${src})`, msg, []);
  }
  if (!out.some((a) => a.level === 'alto' || a.level === 'medio')) {
    push('ok', 'Todo va bien',
      'Los números están sanos. Sigue igual y mete un poco más de dinero en lo que mejor funciona.', []);
  }
  return out;
}

// ---------------------------------------------------------------- veredicto (histórico)
// Una frase: ¿sale rentable o no? Basado en TODO el histórico: ingresos netos
// (tras reembolsos) vs gasto en publicidad de siempre.
function buildVerdict(b) {
  const k = b.kpi;
  const netRev = k.revenueLifetimeNet || 0;
  const adSpend = k.spendLifetime || 0;
  const profit = netRev - adSpend;
  const roas = adSpend > 0 ? netRev / adSpend : null;

  if (adSpend <= 0 || roas == null) {
    return { status: 'sin-datos', sentence: 'Aún no hay suficiente gasto en publicidad para saber si es rentable.', profit, roas };
  }
  if (roas >= 1.5) {
    return { status: 'rentable', profit, roas,
      sentence: `Sí, sale rentable: por cada 1 € en publicidad recuperas ${round1(roas)} € y llevas ${eur(profit)} de beneficio en total.` };
  }
  if (roas >= 1.0) {
    return { status: 'justo', profit, roas,
      sentence: `Apenas rentable: por cada 1 € en publicidad recuperas solo ${round1(roas)} € — cubres el gasto pero ganas muy poco (${eur(profit)} en total).` };
  }
  return { status: 'perdida', profit, roas,
    sentence: `No sale rentable: por cada 1 € en publicidad recuperas ${round1(roas)} € y pierdes ${eur(Math.abs(profit))} en total.` };
}

// Misma pregunta, pero SOLO la campaña activa (tiempo real). Respeta el aprendizaje.
function buildCampaignVerdict(b) {
  const camps = b.campaigns || [];
  const c = b.config || {};
  if (!camps.length) return { status: 'sin-datos', sentence: 'No hay ninguna campaña activa ahora mismo.' };

  const spend = camps.reduce((s, x) => s + (x.spend || 0), 0);
  const purchases = camps.reduce((s, x) => s + (x.purchases || 0), 0);
  const price = Number(c.product_price) || 0;
  const revenue = purchases * price;
  const profit = revenue - spend;
  const roas = spend > 0 ? revenue / spend : null;

  const learn = camps.find((x) => x.learning);
  if (learn) {
    const L = learn.learning;
    return { status: 'sin-datos', profit, roas,
      sentence: `Todavía no se puede saber: la campaña está en aprendizaje (día ${L.day} de ${L.total})${L.until ? ', espera al ' + fmtDate(L.until) : ''}. Ahora los números no son fiables.` };
  }
  if (spend <= 0) return { status: 'sin-datos', profit, roas, sentence: 'Aún no hay gasto suficiente en la campaña para saberlo.' };
  if (purchases === 0) return { status: 'perdida', profit, roas, sentence: `De momento no sale rentable: ${eur(spend)} gastados y 0 ventas todavía.` };
  if (roas >= 1.5) return { status: 'rentable', profit, roas, sentence: `Sí, va rentable: por cada 1 € recuperas ${round1(roas)} € (${purchases} ventas, +${eur(profit)}).` };
  if (roas >= 1.0) return { status: 'justo', profit, roas, sentence: `Justo: por cada 1 € recuperas ${round1(roas)} € (${purchases} ventas). Cubres pero ganas poco.` };
  return { status: 'perdida', profit, roas, sentence: `No sale rentable: por cada 1 € recuperas ${round1(roas)} € (${purchases} ventas, ${eur(profit)}).` };
}

// ---------------------------------------------------------------- plan proactivo
// Sintetiza el problema #1 con argumento (por qué) y pasos concretos.
function buildPlan(b) {
  const k = b.kpi;
  const c = b.config;

  // En aprendizaje: el único plan sensato es esperar. Alineado a la estrategia.
  if (b.learning && b.learning.active) {
    const camp = (b.learning.activeCampaigns || [])[0];
    return {
      headline: `Espera y no toques nada: fase de aprendizaje (día ${b.learning.day} de ${b.learning.total}).`,
      problem: `Tu anuncio${camp ? ' ("' + camp.name + '")' : ''} lleva solo ${b.learning.day} día${b.learning.day === 1 ? '' : 's'}. Aún no hay datos fiables para decidir nada.`,
      why: [
        `Meta necesita unos 7 días (o ~50 ventas) para aprender a quién enseñar tus anuncios.`,
        `Si cambias precio, presupuesto o creatividad ahora, reinicias el aprendizaje y tiras el dinero ya gastado.`,
        `Además, mucha gente que hoy deja su email comprará por email en los próximos 30 días.`,
      ],
      steps: [
        `No toques nada hasta el ${fmtDate(b.learning.until)} (${b.learning.daysLeft} día${b.learning.daysLeft === 1 ? '' : 's'} más).`,
        `Ese día vuelve aquí: ROAS, CPA y CVR ya serán fiables y decidimos con datos.`,
        `Mientras, deja que la secuencia de emails haga su trabajo.`,
      ],
    };
  }

  const currentPrice = Math.round(Number(c.product_price) || 0);
  const priced = (b.cvrByPrice || []).filter((r) => r.created >= 10);
  const best = priced.slice().sort((a, d) => d.cvr - a.cvr)[0];
  const current = priced.find((r) => Math.round(parseFloat(r.price)) === currentPrice);

  const why = [];
  const steps = [];
  let headline;
  let problem = null;

  if (best && best.cvr > 0 && (!current || best.cvr - current.cvr > 5)) {
    // El precio es el problema principal
    problem = `Tu precio de ahora (${currentPrice} €) casi no vende.`;
    headline = `Baja el precio a ${best.price}: es el que más te vendía.`;
    why.push(`A ${best.price}, ${Math.round(best.cvr)} de cada 100 personas compraban.`);
    why.push(current ? `A ${currentPrice} €, solo ${Math.round(current.cvr)} de cada 100.` : `A ${currentPrice} € casi no compra nadie.`);
    if (k.spendYday > 0 && k.ordersYday === 0) why.push(`Y mientras, gastas ${eur(k.spendYday)} al día en anuncios sin vender nada.`);
    steps.push(`Pon el precio en ${best.price} (o prueba ${best.price} y ${currentPrice} € a la vez durante 2 semanas).`);
    if (k.spendYday > 0) steps.push(`Hasta que vuelva a vender, pausa los anuncios: pierdes ${eur(k.spendYday)} cada día.`);
    steps.push(`Cuando empiece a vender otra vez, enciende los anuncios poco a poco y vigila el ROAS.`);
  } else if (k.roas != null && k.roas < c.target_roas && k.spendRange > 0) {
    problem = `Tus anuncios rinden poco.`;
    headline = `Deja solo los anuncios que funcionan.`;
    why.push(`Por cada 1 € en anuncios recuperas ${round1(k.roas)} €. Lo sano es ${c.target_roas} € o más.`);
    steps.push(`Apaga los 2-3 anuncios o públicos con peor resultado.`);
    steps.push(`Pon ese dinero en el anuncio que más vende.`);
    steps.push(`Vuelve a mirar en 1 semana si el ROAS sube.`);
  } else if (k.spendYday > 0 && k.ordersYday === 0) {
    problem = `Pagas anuncios y no vendes.`;
    headline = `Pausa los anuncios y revisa la oferta.`;
    why.push(`Ayer gastaste ${eur(k.spendYday)} en anuncios y vendiste 0.`);
    steps.push(`Pausa los anuncios hoy mismo.`);
    steps.push(`Prueba a bajar el precio o a mejorar la oferta.`);
  } else {
    headline = `Vas bien. Escala lo que funciona.`;
    why.push(`No hay fugas grandes ahora mismo.`);
    steps.push(`Mete un poco más de presupuesto en el anuncio/público con mejor ROAS.`);
    steps.push(`Vigila que el ROAS siga por encima de ${c.target_roas}.`);
  }
  return { headline, problem, why, steps };
}

module.exports = { computeMetrics, buildActions, buildSummary, buildPlan, buildVerdict, buildCampaignVerdict, eur, pct, round1 };
