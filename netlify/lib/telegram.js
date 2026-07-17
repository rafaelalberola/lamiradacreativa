// Envío a Telegram — helpers compartidos por los avisos del backoffice.
//
// daily-telegram.js mantiene su propia copia del patrón (no se toca); esto es la
// versión reutilizable para los avisos nuevos (venta en tiempo real, etc.).
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const API = 'https://api.telegram.org';

// Límite duro de Telegram para el pie de foto. Si el texto se pasa, hay que
// mandarlo aparte en vez de recortarlo (recortar MarkdownV2 puede partir un
// escape por la mitad y la API devuelve 400).
const CAPTION_LIMIT = 1024;

// MarkdownV2 obliga a escapar estos caracteres: si no, la API responde 400 y el
// aviso se pierde. Ojo: hay que escapar TODO lo que venga de fuera (nombre del
// cliente, email, nombre de campaña…), no solo lo que escribimos nosotros.
function esc(s) {
  return String(s == null ? '' : s).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function creds() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no configurados');
  return { token, chatId };
}

// fetch con corte por tiempo: un Telegram lento no puede colgar al que llama.
async function withTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendMessage(text, { timeoutMs = 8000 } = {}) {
  const { token, chatId } = creds();
  const res = await withTimeout(
    `${API}/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    },
    timeoutMs
  );
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram sendMessage: ${json.description}`);
  return json;
}

// Sube el PNG como multipart. Si el pie se pasa del límite, va la foto sola y el
// texto en un mensaje aparte: así nunca se pierde información.
async function sendPhoto(png, caption, { timeoutMs = 12000, filename = 'panel.png' } = {}) {
  const { token, chatId } = creds();
  const tooLong = caption && caption.length > CAPTION_LIMIT;

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', new Blob([png], { type: 'image/png' }), filename);
  if (caption && !tooLong) {
    form.append('caption', caption);
    form.append('parse_mode', 'MarkdownV2');
  }

  const res = await withTimeout(`${API}/bot${token}/sendPhoto`, { method: 'POST', body: form }, timeoutMs);
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram sendPhoto: ${json.description}`);

  if (tooLong) await sendMessage(caption, { timeoutMs });
  return json;
}

module.exports = { esc, sendMessage, sendPhoto, CAPTION_LIMIT };
