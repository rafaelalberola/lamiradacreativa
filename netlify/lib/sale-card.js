// Tarjeta PNG del aviso de venta.
//
// NO es una captura literal del panel: /metrics/ está detrás de cookie firmada y
// ningún servicio de capturas puede verlo. En vez de eso reconstruimos una tarjeta
// con LOS MISMOS DATOS que muestra el panel (mismo bundle de metrics.js) y la misma
// paleta, así que se lee como el panel pero se genera en 100 ms y sin navegador.
//
// satori (JSX -> SVG, wasm embebido) + @resvg/resvg-js (SVG -> PNG, binario nativo).
// Puro render: recibe un view-model ya formateado, no llama a ninguna API.

const fs = require('fs');
const path = require('path');

// Paleta del panel (metrics/index.html) — que la tarjeta se lea como "el panel".
const C = {
  ink: '#0B0B0D',
  surface: '#131317',
  line: '#24242B',
  text: '#F4F3F1',
  muted: '#8B8B96',
  faint: '#5A5A65',
  green: '#2FC177',
  amber: '#FFB020',
  coral: '#FF6B6B',
};

// El fichero se empaqueta con esbuild, así que __dirname en runtime es el del
// bundle, no el de este fuente. Probamos varias rutas en vez de apostar por una:
// si Netlify cambia el layout del zip, la tarjeta sigue saliendo.
function fontCandidates(file) {
  return [
    path.join(__dirname, 'assets', 'fonts', file),
    path.resolve(__dirname, '..', '..', 'assets', 'fonts', file),
    path.resolve(__dirname, '..', 'functions', 'assets', 'fonts', file),
    path.resolve(process.cwd(), 'assets', 'fonts', file),
    path.resolve('/var/task', 'assets', 'fonts', file),
  ];
}

function loadFont(file) {
  for (const p of fontCandidates(file)) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      /* siguiente candidata */
    }
  }
  throw new Error(`Fuente no encontrada: ${file}`);
}

// Cache a nivel de módulo: en contenedores calientes las fuentes se leen una vez.
let FONTS = null;
function fonts() {
  if (!FONTS) {
    FONTS = [
      { name: 'Inter', data: loadFont('Inter-Regular.ttf'), weight: 400, style: 'normal' },
      { name: 'Inter', data: loadFont('InterTight-SemiBold.ttf'), weight: 600, style: 'normal' },
    ];
  }
  return FONTS;
}

// --- helpers de nodos (satori exige display:flex explícito en todo contenedor) ---
const box = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
const txt = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

function statTile(label, value, color) {
  return box(
    {
      flexDirection: 'column',
      flex: 1,
      background: C.surface,
      border: `1px solid ${C.line}`,
      borderRadius: 14,
      padding: '18px 20px',
    },
    [
      txt({ fontSize: 17, color: C.muted, letterSpacing: '0.04em' }, label),
      txt({ fontSize: 34, fontWeight: 600, color: color || C.text, marginTop: 8 }, value),
    ]
  );
}

function row(label, value) {
  return box({ marginTop: 10 }, [
    txt({ fontSize: 21, color: C.faint, width: 108 }, label),
    txt({ fontSize: 21, color: C.text, fontWeight: 600 }, value),
  ]);
}

/**
 * @param {object} v view-model YA formateado (strings listos para pintar)
 *   v.amount   '69 €'          v.name    'Lucía Fernández' | null
 *   v.email    'x@y.com'       v.source  'facebook · cpc'
 *   v.when     '17 jul, 15:42'
 *   v.panel    null | { since:'desde 12 jul · día 6', spend, revenue, roas, orders, roasState:'ok'|'warn'|'bad' }
 *   v.panelNote  texto alternativo si no hay panel
 * @returns {Promise<Buffer>} PNG
 */
async function renderSaleCard(v) {
  // require perezoso: si estas deps faltan o el binario nativo no cargó, el fallo
  // se queda aquí dentro y el aviso sale en texto (lo gestiona sale-alert.js).
  const satoriMod = require('satori');
  const satori = satoriMod.default || satoriMod;
  const { Resvg } = require('@resvg/resvg-js');

  const W = 900;

  const head = box({ alignItems: 'center', justifyContent: 'space-between' }, [
    box({ alignItems: 'center' }, [
      box({ width: 12, height: 12, borderRadius: 6, background: C.green, marginRight: 12 }, []),
      txt({ fontSize: 22, fontWeight: 600, color: C.green, letterSpacing: '0.16em' }, 'NUEVA VENTA'),
    ]),
    txt({ fontSize: 19, color: C.faint }, v.when || ''),
  ]);

  const amount = box({ alignItems: 'baseline', marginTop: 18 }, [
    txt({ fontSize: 78, fontWeight: 600, color: C.text, letterSpacing: '-0.03em' }, v.amount),
  ]);

  const who = box({ flexDirection: 'column', marginTop: 22 }, [
    row('Cliente', v.name || '—'),
    row('Email', v.email || '—'),
    row('Origen', v.source || 'directo'),
  ]);

  const divider = box({ height: 1, background: C.line, marginTop: 30, marginBottom: 24 }, []);

  const panelChildren = [
    txt({ fontSize: 18, color: C.muted, letterSpacing: '0.1em', marginBottom: 14 }, v.panel ? v.panel.since : 'PANEL'),
  ];

  if (v.panel) {
    const roasColor = v.panel.roasState === 'ok' ? C.green : v.panel.roasState === 'warn' ? C.amber : C.coral;
    panelChildren.push(
      box({ gap: 12 }, [
        statTile('GASTO', v.panel.spend),
        statTile('INGRESOS', v.panel.revenue),
        statTile('ROAS', v.panel.roas, roasColor),
        statTile('VENTAS', v.panel.orders),
      ])
    );
  } else {
    panelChildren.push(
      box(
        { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '18px 20px' },
        [txt({ fontSize: 20, color: C.muted }, v.panelNote || 'Panel no disponible ahora mismo.')]
      )
    );
  }

  const panel = box({ flexDirection: 'column' }, panelChildren);

  const foot = box({ marginTop: 26, justifyContent: 'space-between' }, [
    txt({ fontSize: 17, color: C.faint }, 'La Mirada Creativa'),
    txt({ fontSize: 17, color: C.faint }, 'lamiradacreativa.com/backoffice'),
  ]);

  const tree = box(
    {
      flexDirection: 'column',
      width: '100%',
      background: C.ink,
      padding: 44,
      fontFamily: 'Inter',
    },
    [head, amount, who, divider, panel, foot]
  );

  // Sin `height`: satori mide el contenido y ajusta el alto. Así un nombre o un
  // email largos (que hacen wrap) no quedan cortados por un alto fijo.
  const svg = await satori(tree, { width: W, fonts: fonts() });

  // loadSystemFonts:false es CRÍTICO: por defecto resvg escanea las fuentes del
  // sistema y eso cuesta ~2,2 s por render. Sin ello: ~5 ms. Además satori ya
  // entrega el texto como paths, así que resvg no necesita ninguna fuente.
  // Se rasteriza a 2x para que se vea nítido en el móvil.
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: W * 2 },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
}

module.exports = { renderSaleCard };
