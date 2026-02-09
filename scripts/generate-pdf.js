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

// Card-like proportions (340:520 ratio from the app, scaled to points)
const PAGE_W = 340;
const PAGE_H = 520;
const MARGIN = 32;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ============================================
// HELPERS
// ============================================
function cleanDesc(desc) {
  return desc
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[◻️📐🧭📚🧱🔷🎯👁️💡✨🎉🎓🛤️❤️🚀]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n');
}

function getStyle(card) {
  return CARD_STYLES[card.style] || CARD_STYLES['exercise-light'];
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
// CARD RENDERER — 1 card per page
// ============================================
function renderCard(card) {
  const style = getStyle(card);
  const bg = style.bg || '#FFFFFF';
  const text = style.text || '#111111';
  const accent = style.accent || '#FF5006';
  const isDark = style.theme !== 'light';

  doc.addPage();

  // Background
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(bg);

  // --- Layout depends on card type ---

  if (card.type === 'cover') {
    // COVER PAGE
    doc.font('Monograf').fontSize(26).fillColor(text);
    doc.text('LA MIRADA', MARGIN, PAGE_H * 0.32, { width: CONTENT_W, align: 'center' });
    doc.text('CREATIVA', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });

    const lineY = doc.y + 18;
    doc.rect(PAGE_W / 2 - 25, lineY, 50, 2).fill(accent);

    doc.font('Inter').fontSize(10).fillColor(text).opacity(0.7);
    doc.text(card.subtitle, MARGIN, lineY + 16, { width: CONTENT_W, align: 'center' });
    doc.opacity(1);

    doc.font('Inter').fontSize(8).fillColor(text).opacity(0.5);
    doc.text('Rafael A.', MARGIN, PAGE_H - MARGIN - 16, { width: CONTENT_W, align: 'center' });
    doc.opacity(1);
    return;
  }

  if (card.type === 'block-cover') {
    // BLOCK COVER
    doc.font('Inter').fontSize(8).fillColor(accent).opacity(0.8);
    doc.text(`BLOQUE ${card.blockNumber || ''}`, MARGIN, PAGE_H * 0.30, {
      width: CONTENT_W, align: 'center', characterSpacing: 2
    });
    doc.opacity(1);

    doc.font('InterTight').fontSize(20).fillColor(text);
    doc.text(card.subtitle || card.title, MARGIN, doc.y + 8, { width: CONTENT_W, align: 'center' });

    const lineY = doc.y + 14;
    doc.rect(PAGE_W / 2 - 18, lineY, 36, 1.5).fill(accent);

    const desc = cleanDesc(card.desc);
    doc.font('Inter').fontSize(9.5).fillColor(text).opacity(0.8);
    doc.text(desc, MARGIN + 10, lineY + 20, { width: CONTENT_W - 20, align: 'center', lineGap: 4 });
    doc.opacity(1);
    return;
  }

  if (card.type === 'exercise') {
    // EXERCISE CARD
    // Block label (top right)
    doc.font('Inter').fontSize(6.5).fillColor(isDark ? text : '#888888').opacity(0.6);
    doc.text(card.block, MARGIN, MARGIN, { width: CONTENT_W, align: 'right', characterSpacing: 0.8 });
    doc.opacity(1);

    // Day number
    doc.font('InterTight').fontSize(11).fillColor(accent);
    doc.text(`DIA ${card.day}`, MARGIN, PAGE_H * 0.22);

    // Title
    doc.font('InterTight').fontSize(18).fillColor(text);
    doc.text(card.title, MARGIN, doc.y + 6, { width: CONTENT_W });

    // Subtitle
    doc.font('Inter').fontSize(9).fillColor(isDark ? text : '#555555').opacity(0.7);
    doc.text(card.subtitle, MARGIN, doc.y + 4, { width: CONTENT_W });
    doc.opacity(1);

    // Separator
    const sepY = doc.y + 12;
    doc.rect(MARGIN, sepY, 30, 1).fill(accent).opacity(0.4);
    doc.opacity(1);

    // Description
    const desc = cleanDesc(card.desc);
    doc.font('Inter').fontSize(10).fillColor(text).opacity(0.85);
    doc.text(desc, MARGIN, sepY + 14, { width: CONTENT_W, lineGap: 4 });
    doc.opacity(1);
    return;
  }

  if (card.type === 'special') {
    // SPECIAL / MISSION CARD
    if (card.day) {
      doc.font('Inter').fontSize(8).fillColor(text).opacity(0.8);
      doc.text(`DIA ${card.day}`, MARGIN, PAGE_H * 0.25, {
        width: CONTENT_W, align: 'center', characterSpacing: 2
      });
      doc.opacity(1);
    }

    doc.font('InterTight').fontSize(17).fillColor(text);
    doc.text(card.title, MARGIN, doc.y + 10, { width: CONTENT_W, align: 'center' });

    if (card.subtitle) {
      doc.font('Inter').fontSize(9.5).fillColor(text).opacity(0.8);
      doc.text(card.subtitle, MARGIN, doc.y + 6, { width: CONTENT_W, align: 'center' });
      doc.opacity(1);
    }

    const lineY = doc.y + 14;
    doc.rect(PAGE_W / 2 - 18, lineY, 36, 1.5).fill(text).opacity(0.4);
    doc.opacity(1);

    const desc = cleanDesc(card.desc);
    doc.font('Inter').fontSize(10).fillColor(text).opacity(0.9);
    doc.text(desc, MARGIN + 10, lineY + 18, { width: CONTENT_W - 20, align: 'center', lineGap: 4 });
    doc.opacity(1);
    return;
  }

  // ALL OTHER TYPES (presentation, intro, rules, ready, congrats, closing)
  // Centered layout with subtitle, title, line, description

  if (card.subtitle) {
    doc.font('Inter').fontSize(7.5).fillColor(accent).opacity(0.9);
    doc.text(card.subtitle.toUpperCase(), MARGIN, PAGE_H * 0.25, {
      width: CONTENT_W, align: 'center', characterSpacing: 1.5
    });
    doc.opacity(1);
  }

  doc.font('InterTight').fontSize(18).fillColor(text);
  doc.text(card.title, MARGIN, doc.y + 8, { width: CONTENT_W, align: 'center' });

  const lineY = doc.y + 14;
  doc.rect(PAGE_W / 2 - 18, lineY, 36, 1.5).fill(accent);

  const desc = cleanDesc(card.desc);
  doc.font('Inter').fontSize(9.5).fillColor(text).opacity(0.85);
  doc.text(desc, MARGIN + 10, lineY + 20, {
    width: CONTENT_W - 20,
    align: 'center',
    lineGap: 4
  });
  doc.opacity(1);
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
