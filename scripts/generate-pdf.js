#!/usr/bin/env node

// Generate PDF from La Mirada Creativa exercise data
// 1 card = 1 page, matching the visual style from the app
// Usage: node scripts/generate-pdf.js

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ============================================
// LOAD DATA
// ============================================
const dataPath = path.join(__dirname, '..', 'app', 'data.js');
const dataCode = fs.readFileSync(dataPath, 'utf8');
const context = { window: {} };
vm.runInNewContext(dataCode, context);

const CARDS = context.window.CARDS;
const CARD_STYLES = context.window.CARD_STYLES;

if (!CARDS || !CARDS.length) {
  console.error('No cards found in data.js');
  process.exit(1);
}

console.log(`Loaded ${CARDS.length} cards`);

// ============================================
// CONFIGURATION
// ============================================
const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const OUTPUT_DIR = path.join(__dirname, '..', 'netlify', 'functions', 'assets');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'la-mirada-creativa.pdf');

// Card proportions matching the app (9:16-ish ratio)
const PAGE_W = 360;
const PAGE_H = 560;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RADIUS = 0; // No rounded corners on PDF pages

// ============================================
// HELPERS
// ============================================

// Parse hex color to RGB components
function hexToRGB(hex) {
  hex = hex.replace('#', '');
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16)
  };
}

// Mix two hex colors at a given ratio (0 = color1, 1 = color2)
function mixColors(hex1, hex2, ratio) {
  const c1 = hexToRGB(hex1);
  const c2 = hexToRGB(hex2);
  const r = Math.round(c1.r + (c2.r - c1.r) * ratio);
  const g = Math.round(c1.g + (c2.g - c1.g) * ratio);
  const b = Math.round(c1.b + (c2.b - c1.b) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function cleanDesc(desc) {
  return desc
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[◻️📐🧭📚🧱🔷🎯👁️💡✨🎉🎓🛤️❤️🚀🔥🏆⭐🌟💪🎨📷🖼️🌅🏙️🌿🪞🧩🔑]/g, '')
    .trim();
}

function getStyle(card) {
  return CARD_STYLES[card.style] || CARD_STYLES['exercise-light'];
}

// Draw gradient background (simulated with horizontal bands)
function drawGradientBg(style) {
  const bg = style.bg || '#FFFFFF';
  const bgEnd = style.bgEnd || bg;

  // Simulate linear-gradient(to top left, bg 0%, bgEnd 100%)
  // Draw in horizontal strips for smooth gradient
  const strips = 60;
  const stripH = PAGE_H / strips;
  for (let i = 0; i < strips; i++) {
    const ratio = i / strips; // 0 = top (bgEnd), 1 = bottom (bg)
    const color = mixColors(bgEnd, bg, ratio);
    doc.rect(0, i * stripH, PAGE_W, stripH + 1).fill(color);
  }
}

// Render text with paragraph support (\n\n = paragraph break with extra space)
function renderParagraphs(text, x, y, options = {}) {
  const {
    width = CONTENT_W,
    fontSize = 9.5,
    font = 'Inter',
    color = '#111111',
    opacity = 0.85,
    align = 'left',
    lineGap = 3,
    paragraphGap = 10
  } = options;

  const cleaned = cleanDesc(text);
  const paragraphs = cleaned.split('\n\n');

  doc.font(font).fontSize(fontSize).fillColor(color).opacity(opacity);

  let currentY = y;
  for (let i = 0; i < paragraphs.length; i++) {
    const lines = paragraphs[i].split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
    if (!lines) continue;

    doc.text(lines, x, currentY, { width, align, lineGap });
    currentY = doc.y + (i < paragraphs.length - 1 ? paragraphGap : 0);
  }

  doc.opacity(1);
  return doc.y;
}

// Draw a thin separator line
function drawSeparator(y, color, width = 30, centered = false) {
  const x = centered ? (PAGE_W / 2 - width / 2) : MARGIN;
  doc.rect(x, y, width, 1.5).fill(color);
}

// ============================================
// PDF SETUP
// ============================================
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const doc = new PDFDocument({
  size: [PAGE_W, PAGE_H],
  margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  info: {
    Title: 'La Mirada Creativa - 365 dias de entrenamiento visual',
    Author: 'Rafael A.',
    Subject: 'Entrenamiento visual fotografico',
    Creator: 'La Mirada Creativa'
  },
  autoFirstPage: false
});

const stream = fs.createWriteStream(OUTPUT_PATH);
doc.pipe(stream);

// Register fonts
doc.registerFont('Inter', path.join(FONTS_DIR, 'Inter-Regular.ttf'));
doc.registerFont('InterTight', path.join(FONTS_DIR, 'InterTight-SemiBold.ttf'));
doc.registerFont('Monograf', path.join(FONTS_DIR, 'MonografBold.ttf'));

// ============================================
// CARD RENDERERS — 1 card per page
// ============================================

function renderCover(card, style) {
  const text = style.text;
  const accent = style.accent;

  // Title
  doc.font('Monograf').fontSize(28).fillColor(text);
  doc.text('LA MIRADA', MARGIN, PAGE_H * 0.34, { width: CONTENT_W, align: 'center' });
  doc.text('CREATIVA', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });

  // Separator
  const lineY = doc.y + 20;
  drawSeparator(lineY, accent, 50, true);

  // Subtitle
  doc.font('Inter').fontSize(9.5).fillColor(text).opacity(0.7);
  doc.text(card.subtitle, MARGIN, lineY + 18, { width: CONTENT_W, align: 'center', lineGap: 3 });
  doc.opacity(1);

  // Author at bottom
  doc.font('Inter').fontSize(8).fillColor(text).opacity(0.4);
  doc.text('Rafael A.', MARGIN, PAGE_H - MARGIN - 14, { width: CONTENT_W, align: 'center' });
  doc.opacity(1);
}

function renderBlockCover(card, style) {
  const text = style.text;
  const accent = style.accent;

  // Block number label
  doc.font('Inter').fontSize(8).fillColor(accent).opacity(0.8);
  doc.text(`BLOQUE ${card.blockNumber || ''}`, MARGIN, PAGE_H * 0.32, {
    width: CONTENT_W, align: 'center', characterSpacing: 2
  });
  doc.opacity(1);

  // Title
  doc.font('InterTight').fontSize(22).fillColor(text);
  doc.text(card.subtitle || card.title, MARGIN, doc.y + 10, { width: CONTENT_W, align: 'center' });

  // Separator
  const lineY = doc.y + 16;
  drawSeparator(lineY, accent, 36, true);

  // Description
  renderParagraphs(card.desc, MARGIN + 12, lineY + 22, {
    width: CONTENT_W - 24,
    fontSize: 9.5,
    color: text,
    opacity: 0.8,
    align: 'center',
    lineGap: 4,
    paragraphGap: 12
  });
}

function renderExercise(card, style) {
  const text = style.text;
  const accent = style.accent;
  const isDark = style.theme !== 'light';

  // Header row: day (left) + block (right)
  const headerY = MARGIN;

  // Day label (left)
  doc.font('Inter').fontSize(7).fillColor(text).opacity(0.5);
  doc.text(`DIA ${card.day}`, MARGIN, headerY, { width: CONTENT_W });
  doc.opacity(1);

  // Block label (right, overlapping same line)
  doc.font('Inter').fontSize(7).fillColor(accent);
  doc.text(card.block, MARGIN, headerY, { width: CONTENT_W, align: 'right' });

  // Header separator line
  const headerLineY = headerY + 16;
  doc.rect(MARGIN, headerLineY, CONTENT_W, 0.5).fill(isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)');

  // Title
  const titleY = headerLineY + 20;
  doc.font('InterTight').fontSize(19).fillColor(text);
  doc.text(card.title, MARGIN, titleY, { width: CONTENT_W });

  // Subtitle
  doc.font('Inter').fontSize(9).fillColor(text).opacity(0.6);
  doc.text(card.subtitle, MARGIN, doc.y + 4, { width: CONTENT_W });
  doc.opacity(1);

  // Accent separator
  const sepY = doc.y + 14;
  drawSeparator(sepY, accent, 30, false);

  // Description with paragraph spacing
  renderParagraphs(card.desc, MARGIN, sepY + 16, {
    width: CONTENT_W,
    fontSize: 9.5,
    color: text,
    opacity: 0.85,
    align: 'left',
    lineGap: 3.5,
    paragraphGap: 12
  });
}

function renderSpecial(card, style) {
  const text = style.text;
  const accent = style.accent;

  let startY = PAGE_H * 0.28;

  // Day label
  if (card.day) {
    doc.font('Inter').fontSize(8).fillColor(text).opacity(0.7);
    doc.text(`DIA ${card.day}`, MARGIN, startY, {
      width: CONTENT_W, align: 'center', characterSpacing: 2
    });
    doc.opacity(1);
    startY = doc.y + 8;
  }

  // Title
  doc.font('InterTight').fontSize(18).fillColor(text);
  doc.text(card.title, MARGIN, startY, { width: CONTENT_W, align: 'center' });

  // Subtitle
  if (card.subtitle) {
    doc.font('Inter').fontSize(9.5).fillColor(text).opacity(0.7);
    doc.text(card.subtitle, MARGIN, doc.y + 6, { width: CONTENT_W, align: 'center' });
    doc.opacity(1);
  }

  // Separator
  const lineY = doc.y + 16;
  doc.rect(PAGE_W / 2 - 18, lineY, 36, 1.5).fill(text).opacity(0.3);
  doc.opacity(1);

  // Description
  renderParagraphs(card.desc, MARGIN + 10, lineY + 20, {
    width: CONTENT_W - 20,
    fontSize: 9.5,
    color: text,
    opacity: 0.9,
    align: 'center',
    lineGap: 3.5,
    paragraphGap: 12
  });
}

function renderGeneric(card, style) {
  // For: presentation, intro, rules, ready, congrats, closing
  const text = style.text;
  const accent = style.accent;

  let startY = PAGE_H * 0.28;

  // Subtitle label (uppercase, accent color)
  if (card.subtitle) {
    doc.font('Inter').fontSize(7.5).fillColor(accent).opacity(0.9);
    doc.text(card.subtitle.toUpperCase(), MARGIN, startY, {
      width: CONTENT_W, align: 'center', characterSpacing: 1.5
    });
    doc.opacity(1);
    startY = doc.y + 8;
  }

  // Title
  doc.font('InterTight').fontSize(20).fillColor(text);
  doc.text(card.title, MARGIN, startY, { width: CONTENT_W, align: 'center' });

  // Separator
  const lineY = doc.y + 16;
  drawSeparator(lineY, accent, 36, true);

  // Description
  renderParagraphs(card.desc, MARGIN + 10, lineY + 22, {
    width: CONTENT_W - 20,
    fontSize: 9.5,
    color: text,
    opacity: 0.85,
    align: 'center',
    lineGap: 3.5,
    paragraphGap: 12
  });
}

// ============================================
// MAIN RENDERER
// ============================================
function renderCard(card) {
  const style = getStyle(card);

  doc.addPage();

  // Gradient background
  drawGradientBg(style);

  // Route to the right renderer
  switch (card.type) {
    case 'cover':
      renderCover(card, style);
      break;
    case 'block-cover':
      renderBlockCover(card, style);
      break;
    case 'exercise':
      renderExercise(card, style);
      break;
    case 'special':
      renderSpecial(card, style);
      break;
    default:
      renderGeneric(card, style);
      break;
  }
}

// ============================================
// RENDER ALL CARDS
// ============================================
for (const card of CARDS) {
  renderCard(card);
}

// ============================================
// FINALIZE
// ============================================
doc.end();

stream.on('finish', () => {
  const stats = fs.statSync(OUTPUT_PATH);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`PDF generated: ${OUTPUT_PATH}`);
  console.log(`Size: ${sizeMB} MB | Pages: ${CARDS.length}`);
});
