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

  // Reembolsos del rango para el neto.
  let refundsRange = 0;
  let refunds30 = 0;
  try {
    const refunds = await stripe.refunds
      .list({ created: { gte: Math.min(since, since30) }, limit: 100 })
      .autoPagingToArray({ limit: 1000 });
    for (const r of refunds) {
      if (r.created >= since) refundsRange += r.amount / 100;
      if (r.created >= since30) refunds30 += r.amount / 100;
    }
  } catch (e) {
    /* refunds are best-effort */
  }

  const paid = (s) => s.payment_status === 'paid' || s.status === 'complete';
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

  for (const s of completed) {
    if (!paid(s)) continue;
    const v = euros(s);
    revenueLifetime += v;
    ordersLifetime += 1;
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
    revenueRangeNet: revenueRange - refundsRange,
    revenue30Net: revenue30 - refunds30,
    bySourceRevenue,
    revByDay,
    cvrByPrice,
    checkoutStarts,
    cvrCheckout: checkoutStarts ? (ordersRange / checkoutStarts) * 100 : 0,
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
    const dailyUrl =
      `${META_API}/${account}/insights?` +
      `fields=spend,impressions,clicks,ctr,actions&time_increment=1&` +
      `time_range=${encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))}&` +
      `access_token=${token}`;
    const dailyRes = await fetch(dailyUrl);
    const dailyJson = await dailyRes.json();
    if (dailyJson.error) throw new Error(dailyJson.error.message);
    const daily = dailyJson.data || [];

    // Gasto acumulado histórico = capital invertido en publi.
    const lifeUrl =
      `${META_API}/${account}/insights?fields=spend&date_preset=maximum&access_token=${token}`;
    const lifeRes = await fetch(lifeUrl);
    const lifeJson = await lifeRes.json();
    const spendLifetime = lifeJson.data && lifeJson.data[0] ? Number(lifeJson.data[0].spend) : 0;

    const isLead = (t) => t === 'lead' || t.includes('lead');
    const isPurchase = (t) => t === 'purchase' || t.includes('purchase');

    let spendRange = 0,
      spend30 = 0,
      spendYday = 0,
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
      if (row.date_start === dayKey(ydayStart)) spendYday += spend;
    }

    return {
      spendRange,
      spend30,
      spendYday,
      spendLifetime,
      impressions,
      clicks,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      leadsMeta,
      purchasesMeta,
      spendByDay,
    };
  } catch (e) {
    errors.meta =
      /expired|OAuth|session|token/i.test(e.message)
        ? 'Token de Meta caducado/ inválido — regenera un token de Usuario del Sistema (no caduca).'
        : `Meta API: ${e.message}`;
    return null;
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
    cash_balance: 0,
    monthly_fixed_costs: 0,
    other_ad_spend: 0,
    product_price: 69,
    target_roas: 2,
    target_cpl: 3,
    target_cac: 15,
    runway_alert_months: 3,
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

  const [stripe, meta, sb, resend, config] = await Promise.all([
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

  // Runway (base 30 días)
  const monthlyBurn = (config.monthly_fixed_costs || 0) + spend30 - revenue30Net;
  const runwayMonths = monthlyBurn <= 0 ? Infinity : (config.cash_balance || 0) / monthlyBurn;
  const netProfit30 = revenue30Net - spend30 - (config.monthly_fixed_costs || 0);

  const bundle = {
    generatedAt: new Date().toISOString(),
    rangeDays,
    config,
    kpi: {
      revenueYday: stripe ? stripe.revenueYday : 0,
      revenueRange,
      revenueRangeNet,
      revenueLifetime: stripe ? stripe.revenueLifetime : 0,
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
      runwayMonths,
      monthlyBurn,
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
    errors,
  };

  bundle.summary = buildSummary(bundle);
  bundle.actions = buildActions(bundle);
  return bundle;
}

// ---------------------------------------------------------------- summary (progreso)
function buildSummary(b) {
  const k = b.kpi;
  const runway = k.runwayMonths === Infinity ? 'rentable (∞)' : `${round1(k.runwayMonths)} meses`;
  const lines = [
    `Ingresos ${b.rangeDays}d: ${eur(k.revenueRangeNet)} · ayer ${eur(k.revenueYday)} · total ${eur(k.revenueLifetime)}`,
    `Ventas ${b.rangeDays}d: ${k.ordersRange} · ayer ${k.ordersYday} · total ${k.ordersLifetime}`,
    `Gasto publi ${b.rangeDays}d: ${eur(k.spendRange)} · ayer ${eur(k.spendYday)} · invertido total ${eur(k.spendLifetime)}`,
    `ROAS ${k.roas == null ? '—' : round1(k.roas) + 'x'} · CAC ${k.cac == null ? '—' : eur(k.cac)} · AOV ${k.aov == null ? '—' : eur(k.aov)}`,
    `Runway: ${runway} · beneficio 30d ${eur(k.netProfit30)}`,
    `Leads ${b.rangeDays}d: ${k.leadsRange} (${k.leadsTotal} total) · audiencia Resend ${b.audience.resend ? b.audience.resend.total : 'n/d'}`,
    `Ejercicios completados ${b.rangeDays}d: ${b.engagement ? b.engagement.completadosRange : 0} · rachas activas ${b.streaks ? b.streaks.activos : 0}`,
  ];
  return lines;
}

// ---------------------------------------------------------------- actions engine
function buildActions(b) {
  const k = b.kpi;
  const c = b.config;
  const out = [];
  const push = (level, text) => out.push({ level, text });

  if (k.runwayMonths !== Infinity && k.runwayMonths < c.runway_alert_months) {
    push('alto', `Runway ${round1(k.runwayMonths)} meses (< ${c.runway_alert_months}). Recorta burn o sube conversión antes de escalar gasto.`);
  }
  if (k.ordersYday === 0 && k.spendYday > 0) {
    push('alto', `0 ventas ayer con ${eur(k.spendYday)} de gasto. Revisa checkout, oferta y segmentación.`);
  }
  if (k.roas != null && k.roas < c.target_roas && k.spendRange > 0) {
    push('medio', `ROAS ${round1(k.roas)}x (objetivo ≥ ${c.target_roas}x). Pausa o renueva los peores creativos/públicos.`);
  }
  if (k.cpl != null && k.cpl > c.target_cpl) {
    push('medio', `CPL ${eur(k.cpl)} (objetivo ≤ ${eur(c.target_cpl)}). Revisa gancho y creatividad de la campaña de leads.`);
  }
  if (k.cac != null && k.cac > c.target_cac) {
    push('medio', `CAC ${eur(k.cac)} (objetivo ≤ ${eur(c.target_cac)}). Margen estrecho: sube AOV o baja coste de adquisición.`);
  }
  if (b.audience.leads3d === 0 && k.spendRange > 0) {
    push('medio', `0 leads en 3 días con gasto activo. ¿La campaña de leads está encendida y el pixel dispara "Lead"?`);
  }
  if (b.funnel.cvrCheckout && b.funnel.cvrCheckout < 30 && b.funnel.checkoutStarts >= 10) {
    push('medio', `CVR de checkout ${pct(b.funnel.cvrCheckout)}: muchos inician pago y no completan. Revisa fricción y métodos de pago.`);
  }
  // Insight de precio: si hay ≥2 buckets con volumen, sugiere el mejor.
  const priced = (b.cvrByPrice || []).filter((r) => r.created >= 10);
  if (priced.length >= 2) {
    const best = [...priced].sort((a, b) => b.cvr - a.cvr)[0];
    const worst = [...priced].sort((a, b) => a.cvr - b.cvr)[0];
    if (best.price !== worst.price && best.cvr - worst.cvr > 1) {
      push('bajo', `Precio: ${best.price} convierte al ${pct(best.cvr)} vs ${worst.price} al ${pct(worst.cvr)}. Considera un test de precio controlado.`);
    }
  }
  if (Object.keys(b.errors || {}).length) {
    for (const [src, msg] of Object.entries(b.errors)) push('info', `Fuente ${src}: ${msg}`);
  }
  if (!out.some((a) => a.level === 'alto' || a.level === 'medio')) {
    push('ok', `Todo en verde. Mantén rumbo y escala presupuesto en los públicos/creativos con mejor ROAS.`);
  }
  return out;
}

module.exports = { computeMetrics, buildActions, buildSummary, eur, pct, round1 };
