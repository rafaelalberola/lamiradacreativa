#!/usr/bin/env node

// Generate PDF from La Mirada Creativa exercise data
// 1 card = 1 page, identical to the app's card design
// Rounded corners, gradients, Material Symbols icons, exact layout
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
// LOAD ICON CODEPOINTS
// ============================================
const codepointsPath = path.join(__dirname, 'codepoints.txt');
const ICON_MAP = {};
fs.readFileSync(codepointsPath, 'utf8').split('\n').forEach(line => {
  const parts = line.trim().split(/\s+/);
  if (parts.length === 2) ICON_MAP[parts[0]] = parseInt(parts[1], 16);
});
console.log(`Loaded ${Object.keys(ICON_MAP).length} icon codepoints`);

// ============================================
// CONFIGURATION
// ============================================
const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const OUTPUT_DIR = path.join(__dirname, '..', 'netlify', 'functions', 'assets');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'la-mirada-creativa.pdf');

// Card dimensions (matching app: max-width 340, max-height 550)
const CARD_W = 340;
const CARD_H = 550;
const PAGE_PAD = 18;
const PAGE_W = CARD_W + PAGE_PAD * 2;   // 376
const PAGE_H = CARD_H + PAGE_PAD * 2;   // 586
const CARD_X = PAGE_PAD;
const CARD_Y = PAGE_PAD;
const CARD_R = 12;        // border-radius
const CARD_PAD = 24;      // 1.5rem inner padding

// Content area inside card
const CX = CARD_X + CARD_PAD;
const CY = CARD_Y + CARD_PAD;
const CW = CARD_W - CARD_PAD * 2;       // 292
const CB = CARD_Y + CARD_H - CARD_PAD;  // content bottom

const PAGE_BG = '#f4f4f4';

// Font sizes (proportional to 340px card, matching CSS rem values)
const F_DAY = 11;        // 0.6875rem
const F_BLOCK = 11;      // 0.6875rem
const F_TITLE = 24;      // 1.5rem
const F_TITLE_COVER = 32;// 2rem
const F_SUBTITLE = 14;   // 0.875rem
const F_DESC = 14.4;     // 0.90rem
const F_ICON = 64;       // 80px scaled for PDF clarity

// ============================================
// HELPERS
// ============================================
function hexToRGB(hex) {
  hex = hex.replace('#', '');
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16)
  };
}

function mixColors(hex1, hex2, ratio) {
  const c1 = hexToRGB(hex1);
  const c2 = hexToRGB(hex2);
  const r = Math.round(c1.r + (c2.r - c1.r) * ratio);
  const g = Math.round(c1.g + (c2.g - c1.g) * ratio);
  const b = Math.round(c1.b + (c2.b - c1.b) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function cleanDesc(desc) {
  if (!desc) return '';
  return desc
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[◻️📐🧭📚🧱🔷🎯👁️💡✨🎉🎓🛤️❤️🚀🔥🏆⭐🌟💪🎨📷🖼️🌅🏙️🌿🪞🧩🔑⚡🪴🌊🧲🫧🪶]/g, '')
    .trim();
}

function getStyle(card) {
  return CARD_STYLES[card.style] || CARD_STYLES['exercise-light'];
}

function isLightTheme(style) {
  return style.theme === 'light';
}

// Get day label matching the app's createCardHTML logic
function getDayLabel(card) {
  if (card.day) return `Día ${card.day} / 365`;
  if (card.type === 'cover') return '';
  if (card.type === 'presentation') return 'ME PRESENTO';
  if (card.type === 'syllabus' || card.title === 'MI SISTEMA' || card.title === 'REGLAS BÁSICAS') return 'LA MIRADA CREATIVA';
  if (card.type === 'rules') return 'LA MIRADA CREATIVA';
  if (card.type === 'intro') return 'INTRODUCCIÓN';
  if (card.type === 'ready') return 'ESTÁS PREPARADO';
  if (card.type === 'block-cover') return `BLOQUE ${card.blockNumber || ''}`;
  if (card.type === 'special') return 'MISIÓN ESPECIAL';
  if (card.type === 'congrats') return 'FELICIDADES';
  if (card.type === 'closing') return 'CIERRE';
  return '';
}

// ============================================
// DRAWING PRIMITIVES
// ============================================

function drawPageBg() {
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAGE_BG);
}

function drawCardShadow() {
  // No shadow — clean flat look
}

function drawCardGradient(style) {
  const bg = style.bg || '#FFFFFF';
  const bgEnd = style.bgEnd || bg;

  doc.save();
  doc.roundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R).clip();

  // Gradient: top-left (bgEnd) → bottom-right (bg)
  const strips = 50;
  const stripH = CARD_H / strips;
  for (let i = 0; i < strips; i++) {
    const ratio = i / strips;
    const color = mixColors(bgEnd, bg, ratio);
    doc.rect(CARD_X, CARD_Y + i * stripH, CARD_W, stripH + 1).fill(color);
  }

  doc.restore();
}

function drawCardBorder(style) {
  const light = isLightTheme(style);
  // Approximate border color
  const borderColor = light ? '#d0d0d0' : '#3a3a3a';
  doc.roundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R)
    .lineWidth(1).strokeColor(borderColor).stroke();
}

function drawSpecialBorder(style) {
  if (style.theme === 'mission') {
    // special: 2px solid rgba(255,255,255,0.3) on orange
    doc.roundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R)
      .lineWidth(2).strokeColor('#ff9966').stroke();
  } else if (style.theme === 'success') {
    // congrats: 2px solid rgba(76,175,80,0.3) on dark green
    doc.roundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R)
      .lineWidth(2).strokeColor('#1a5e1d').stroke();
  }
}

// ============================================
// CONTENT RENDERERS
// ============================================

function renderHeader(card, style, centered) {
  const dayLabel = getDayLabel(card);
  const blockLabel = card.block || '';
  const hasContent = dayLabel || blockLabel;
  const light = isLightTheme(style);

  if (!hasContent) {
    // No-separator header: just a small gap
    return CY + 8;
  }

  // Day label (left or center)
  doc.font('Inter').fontSize(F_DAY).fillColor(style.text).opacity(0.6);
  if (centered) {
    doc.text(dayLabel, CX, CY, { width: CW, align: 'center' });
  } else {
    doc.text(dayLabel, CX, CY, { width: CW });
  }
  doc.opacity(1);

  // Block label (right, accent color) — only for exercise cards
  if (blockLabel && !centered) {
    doc.font('Inter').fontSize(F_BLOCK).fillColor(style.accent);
    doc.text(blockLabel, CX, CY, { width: CW, align: 'right' });
  }

  // Separator line: light cards get dark sep, dark/colored cards get light sep
  const sepY = CY + F_DAY + 12; // padding-bottom 0.75rem ≈ 12
  if (light) {
    doc.rect(CX, sepY, CW, 0.5).fill('#d0d0d0');
  } else {
    // rgba(255,255,255,0.1) — approximate as white at low opacity
    doc.rect(CX, sepY, CW, 0.5).fillColor('#ffffff').opacity(0.15).fill();
    doc.opacity(1);
  }

  // Return Y position after header (margin-bottom 1rem ≈ 16)
  return sepY + 16;
}

function renderTitle(card, style, y, centered, coverSize) {
  const fontSize = coverSize ? F_TITLE_COVER : F_TITLE;
  doc.font('InterTight').fontSize(fontSize).fillColor(style.text);
  const opts = { width: CW };
  if (centered) opts.align = 'center';
  doc.text(card.title, CX, y, opts);
  return doc.y + 4; // margin-bottom 0.25rem ≈ 4
}

function renderSubtitle(card, style, y, centered) {
  if (!card.subtitle) return y;
  doc.font('Inter').fontSize(F_SUBTITLE).fillColor(style.text).opacity(0.7);
  const opts = { width: CW };
  if (centered) opts.align = 'center';
  doc.text(card.subtitle, CX, y, opts);
  doc.opacity(1);
  return doc.y + 16; // margin-bottom 1rem ≈ 16
}

function renderIcon(card, style, centerY) {
  if (!card.icon || !ICON_MAP[card.icon]) return;

  const codepoint = ICON_MAP[card.icon];
  const char = String.fromCodePoint(codepoint);

  doc.font('MaterialSymbols').fontSize(F_ICON).fillColor(style.accent);

  // Measure icon width for centering
  const iconWidth = doc.widthOfString(char);
  const iconX = CX + (CW - iconWidth) / 2;
  const iconY = centerY - F_ICON / 2;

  doc.text(char, iconX, iconY, { width: iconWidth + 4 });
  doc.fillColor(style.text); // Reset
}

function measureDesc(text, width, lineGap) {
  const cleaned = cleanDesc(text);
  if (!cleaned) return { height: 0, text: '' };

  // Split paragraphs and measure each
  const paragraphs = cleaned.split('\n\n').map(p =>
    p.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n')
  ).filter(p => p.length > 0);

  doc.font('Inter').fontSize(F_DESC);

  let totalHeight = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    totalHeight += doc.heightOfString(paragraphs[i], { width, lineGap });
    if (i < paragraphs.length - 1) totalHeight += 14; // paragraph gap
  }

  return { height: totalHeight, paragraphs };
}

function renderDesc(paragraphs, x, y, width, style, align, lineGap) {
  doc.font('Inter').fontSize(F_DESC).fillColor(style.text).opacity(0.85);

  let currentY = y;
  for (let i = 0; i < paragraphs.length; i++) {
    doc.text(paragraphs[i], x, currentY, { width, align, lineGap });
    currentY = doc.y + (i < paragraphs.length - 1 ? 14 : 0);
  }
  doc.opacity(1);
}

// ============================================
// CARD TYPE RENDERERS
// ============================================

function renderExerciseCard(card, style) {
  const centered = false;
  const align = 'left';
  const lineGap = 3;

  // Header
  const afterHeader = renderHeader(card, style, centered);

  // Title + Subtitle
  const afterTitle = renderTitle(card, style, afterHeader, centered, false);
  const afterSubtitle = renderSubtitle(card, style, afterTitle, centered);

  // Measure description to anchor it at bottom
  const { height: descH, paragraphs } = measureDesc(card.desc, CW, lineGap);
  const descY = CB - descH;

  // Icon centered between subtitle and description
  if (descY > afterSubtitle + F_ICON + 20) {
    const iconCenterY = afterSubtitle + (descY - 16 - afterSubtitle) / 2;
    renderIcon(card, style, iconCenterY);
  }

  // Description at bottom
  if (paragraphs && paragraphs.length > 0) {
    renderDesc(paragraphs, CX, descY, CW, style, align, lineGap);
  }
}

function renderCenteredCard(card, style) {
  const centered = false;
  const align = 'left';
  const lineGap = 3;

  // Header
  const afterHeader = renderHeader(card, style, centered);

  // Title + Subtitle
  const isCover = card.type === 'cover' || card.type === 'block-cover';
  const afterTitle = renderTitle(card, style, afterHeader, centered, isCover);
  const afterSubtitle = renderSubtitle(card, style, afterTitle, centered);

  // Measure description
  const { height: descH, paragraphs } = measureDesc(card.desc, CW, lineGap);
  const descY = CB - descH;

  // Icon centered between subtitle and description
  if (descY > afterSubtitle + F_ICON + 20) {
    const iconCenterY = afterSubtitle + (descY - 16 - afterSubtitle) / 2;
    renderIcon(card, style, iconCenterY);
  }

  // Description at bottom
  if (paragraphs && paragraphs.length > 0) {
    renderDesc(paragraphs, CX, descY, CW, style, align, lineGap);
  }
}

function renderCoverCard(card, style) {
  // Special cover: Monograf Bold title, centered, no icon
  const afterHeader = renderHeader(card, style, true);

  // Main title with Monograf
  const titleY = CARD_Y + CARD_H * 0.3;
  doc.font('Monograf').fontSize(F_TITLE_COVER).fillColor(style.text);
  doc.text('LA MIRADA', CX, titleY, { width: CW, align: 'center' });
  doc.text('CREATIVA', CX, doc.y + 2, { width: CW, align: 'center' });

  // Separator
  const lineY = doc.y + 20;
  const lineW = 50;
  doc.rect(CARD_X + CARD_W / 2 - lineW / 2, lineY, lineW, 2).fill(style.accent);

  // Subtitle
  if (card.subtitle) {
    doc.font('Inter').fontSize(F_SUBTITLE).fillColor(style.text).opacity(0.7);
    const subtitleText = card.subtitle.replace('días de', 'días\nde');
    doc.text(subtitleText, CX, lineY + 18, { width: CW, align: 'center', lineGap: 3 });
    doc.opacity(1);
  }

  // Author at bottom
  doc.font('Inter').fontSize(10).fillColor(style.text).opacity(0.4);
  doc.text('Rafael A.', CX, CB - 14, { width: CW, align: 'center' });
  doc.opacity(1);
}

// ============================================
// MAIN RENDER PIPELINE
// ============================================
function renderCard(card) {
  const style = getStyle(card);

  doc.addPage();

  // 1. Page background
  drawPageBg();

  // 2. Card shadow
  drawCardShadow();

  // 3. Card gradient background (clipped to rounded rect)
  drawCardGradient(style);

  // 4. Card border
  drawCardBorder(style);

  // 5. Special borders for special/congrats
  if (card.type === 'special' || card.type === 'congrats') {
    drawSpecialBorder(style);
  }

  // 6. Card content
  if (card.type === 'cover') {
    renderCoverCard(card, style);
  } else if (card.type === 'exercise') {
    renderExerciseCard(card, style);
  } else {
    // All other types: centered layout
    // (presentation, intro, rules, syllabus, ready, block-cover, special, congrats, closing)
    renderCenteredCard(card, style);
  }
}

// ============================================
// PDF SETUP & GENERATION
// ============================================
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const doc = new PDFDocument({
  size: [PAGE_W, PAGE_H],
  margin: 0,
  info: {
    Title: 'La Mirada Creativa - 365 días de entrenamiento visual',
    Author: 'Rafael A.',
    Subject: 'Entrenamiento visual fotográfico',
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
doc.registerFont('MaterialSymbols', path.join(FONTS_DIR, 'MaterialSymbolsSharp.ttf'));

// Render all cards
for (const card of CARDS) {
  renderCard(card);
}

doc.end();

stream.on('finish', () => {
  const stats = fs.statSync(OUTPUT_PATH);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`PDF generated: ${OUTPUT_PATH}`);
  console.log(`Size: ${sizeMB} MB | Pages: ${CARDS.length}`);
});
