'use strict';
// Chat con Benito. No usa IA paga: entiende las preguntas más comunes sobre tu plata
// con reglas y las responde con tus datos reales. Usa funciones de asesor.js y app.js.

let chatMsgs = [];          // conversación de esta sesión
let chatPendientes = [];    // comentarios que Benito guardó para cuando lo abras
let chatUltimaApertura = 0;
let escribiendo = false;
let consejoIdx = 0;

const SUGERENCIAS = ['¿Cómo vengo?', '¿Cuánto puedo gastar hoy?', '¿En qué gasto más?',
  '¿Me alcanza para algo de 50 lucas?', 'Dame un consejo', 'Mi plan', '¿Qué más sabés hacer?'];

function guardarComentario(m) { chatPendientes.push(m); actualizarAviso(); }

// ---------- Entender lo que escribís ----------
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const SINONIMOS = {
  ALIMENTO: ['comida', 'comidas', 'comer', 'super', 'supermercado', 'almuerzo', 'almuerzos', 'cena', 'cenas', 'desayuno', 'merienda',
    'delivery', 'pedidosya', 'rappi', 'verduleria', 'carniceria', 'carne', 'jumbo', 'coto', 'carrefour', 'kiosco', 'cafe', 'cafes',
    'alimento', 'alimentos', 'mercado', 'panaderia'],
  OCIO: ['salida', 'salidas', 'bar', 'bares', 'boliche', 'cine', 'recital', 'recitales', 'juntada', 'birra', 'birras', 'cerveza',
    'ocio', 'entretenimiento', 'teatro', 'show', 'viaje', 'viajes', 'finde'],
  TRANSPORTE: ['colectivo', 'bondi', 'sube', 'uber', 'cabify', 'didi', 'taxi', 'nafta', 'subte', 'tren', 'transporte', 'remis',
    'estacionamiento', 'peaje'],
  SERVICIO: ['servicio', 'servicios', 'luz', 'gas', 'agua', 'internet', 'wifi', 'alquiler', 'expensas', 'telecentro', 'spotify',
    'netflix', 'gym', 'gimnasio', 'ejercicio', 'celular', 'telefono', 'cable', 'streaming'],
  SALUD: ['salud', 'medico', 'medica', 'psicologa', 'psicologo', 'terapia', 'farmacia', 'remedios', 'dentista', 'prepaga',
    'kinesiologo', 'atenea'],
  'ESTÉTICA': ['estetica', 'peluqueria', 'pelo', 'unas', 'depilacion', 'maquillaje', 'cosmetica', 'dietetica'],
  REGALO: ['regalo', 'regalos', 'cumple', 'cumpleanos'],
  HOGAR: ['hogar', 'casa', 'muebles', 'limpieza', 'bazar', 'ferreteria'],
  MONOTRIBUTO: ['monotributo', 'afip', 'arca', 'impuestos'],
  ROPA: ['ropa', 'zapatillas', 'zapatos', 'campera', 'remera', 'jean'],
};

function detectarCategoria(t) {
  const words = ' ' + t.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const c of data.categorias) if (words.includes(' ' + norm(c) + ' ')) return c;
  for (const [cat, lista] of Object.entries(SINONIMOS)) {
    if (lista.some(w => words.includes(' ' + w + ' '))) {
      return data.categorias.find(c => norm(c) === norm(cat)) || null;
    }
  }
  return null;
}

// "80 lucas", "50k", "$12.500", "un palo", "1,5 millones"
function detectarMonto(t) {
  if (/medio palo/.test(t)) return 500000;
  if (/\bun palo\b/.test(t)) return 1000000;
  const mult = { k: 1e3, mil: 1e3, luca: 1e3, lucas: 1e3, palo: 1e6, palos: 1e6, millon: 1e6, millones: 1e6 };
  let best = null;
  for (const m of t.matchAll(/(\d[\d.,]*)\s*(k\b|mil\b|lucas?\b|palos?\b|millon(?:es)?\b|%)?/g)) {
    if (m[2] === '%') continue;
    const v = parseMonto(m[1]) * (mult[m[2]] || 1);
    if (v >= 1000 && (!best || v > best)) best = v;
  }
  return best;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function isoDias(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function mesPeriodo(key, actual) {
  return { key, desde: key + '-01', hasta: key + '-31', label: actual ? 'este mes' : 'en ' + mesCorto(key).toLowerCase() };
}
function detectarPeriodo(t) {
  const hoyKey = nowKey();
  if (/\bhoy\b/.test(t)) return { desde: todayISO(), hasta: todayISO(), label: 'hoy' };
  if (/\bayer\b/.test(t)) { const d = isoDias(-1); return { desde: d, hasta: d, label: 'ayer' }; }
  if (/semana/.test(t)) return { desde: isoDias(-6), hasta: todayISO(), label: 'en los últimos 7 días' };
  if (/mes pasado|mes anterior|ultimo mes/.test(t)) return mesPeriodo(shiftMonth(hoyKey, -1));
  for (let i = 0; i < 12; i++) {
    if (new RegExp('\\b' + MESES[i] + '\\b').test(t)) {
      let key = new Date().getFullYear() + '-' + String(i + 1).padStart(2, '0');
      if (key > hoyKey) key = shiftMonth(key, -12);
      return mesPeriodo(key, key === hoyKey);
    }
  }
  return mesPeriodo(hoyKey, true);
}
function gastosEntre(desde, hasta) {
  return Object.values(data.meses).flatMap(m => m.gastos).filter(g => g.fecha >= desde && g.fecha <= hasta);
}

function responder(texto) {
  const t = norm(texto).trim();
  const monto = detectarMonto(t), cat = detectarCategoria(t), per = detectarPeriodo(t);

  if (/invert|inversion|plazo fijo|cripto|bitcoin|usdt|acciones|cedear|\bfci\b|fondo comun|bonos|(conviene|deberia|comprar|compro).*dolar/.test(t)) return R.invertir();
  const metaM = t.match(/(\d{1,2})\s*%/);
  if (metaM && /meta|ahorr/.test(t) && /(cambi|pone|subi|baja|quiero|configur|setea|deja)/.test(t)) return R.meta(Number(metaM[1]));
  if (/(cual|cuanto) es mi meta|mi meta de ahorro/.test(t)) return R.metaActual();
  if (monto && !/cuanto/.test(t) && /\b(anota|anotame|anotalo|carga|cargame|cargalo|registra|registralo|gaste|pague|compre|me gaste)\b/.test(t)) return R.anotar(monto, cat, texto);
  if (monto && /(puedo|podria|alcanza|conviene|deberia|compro|comprar|comprarme|gastar|darme|pagar|me doy)/.test(t)) return R.compra(monto, cat);
  if (/me alcanza|puedo comprar|puedo gastar en/.test(t)) return [{ mood: 'feliz', texto: '¡Decime cuánto sale y te digo! Por ejemplo: <i>"¿Puedo gastar 50 lucas en ropa?"</i>' }];
  if (/cuanto puedo gastar|presupuesto|por dia|x dia|diario|disponible/.test(t)) return R.presupuesto();
  if (/(cuanto|que|cuanta plata) me queda|saldo|me sobra|cuanta plata tengo/.test(t)) return R.saldo();
  if (/hormiga|gastos? chicos?|compras? chicas?/.test(t)) return R.hormiga();
  if (/\bfijos?\b/.test(t)) return R.fijos();
  if (/en que (gasto|gaste|se me va|se va)|donde se (me )?va|mas gast|mas gasto|categorias?|ranking/.test(t)) return R.top(per);
  if (/compar|\bvs\b|respecto|contra el mes/.test(t)) return R.comparar();
  if (/ahorr/.test(t) && !/consejo|tip|como ahorr|ahorrar mas/.test(t)) return R.ahorro(per);
  if (/cuanto (gaste|llevo|gasto|van|va|lleve)|gaste|gastado|\btotal\b/.test(t) || (cat && /cuanto/.test(t))) return R.total(cat, per);
  if (/\bplan\b|\bmetas?\b|objetivos?|\bpasos?\b|habitos?/.test(t)) return R.plan();
  if (/informe|reporte|resumen del mes/.test(t)) return R.informe();
  if (/como (vengo|voy|estoy|ando|viene|va)|proyecc|resumen|situacion|panorama/.test(t)) return R.estado();
  if (/consejo|tip|como ahorr|ahorrar mas|recomend|que (hago|me sugeris)|sugerencia|mejorar|optimiz/.test(t)) return R.consejo();
  if (/que (mas )?(podes|sabes)|puedo preguntarte|quien sos|como funcionas|ayuda|help/.test(t)) return R.ayuda();
  if (/^(hola|holi|buen|buenas|hey|que tal|como estas)/.test(t)) return R.saludo();
  if (/gracias|genial|buenisimo|joya|perfecto|\bdale\b|\bok\b|barbaro|genio/.test(t)) {
    return [{ mood: 'feliz', texto: pick(['¡De nada! Acá estoy cuando me necesites 🦉', '¡Para eso estoy! 💪', '¡Joya! Cualquier cosa, preguntame.']) }];
  }
  if (cat) return R.total(cat, per);
  if (monto) return R.compra(monto, cat);
  return R.noEntendi();
}

// ---------- Respuestas ----------
const sinIngresos = () => [{ mood: 'pensando', texto: 'Para hacer esa cuenta necesito tus ingresos de este mes. Cargalos en <b>Ingresos</b> y te respondo.',
  accion: { label: 'Ir a Ingresos', fn: () => setView('ingresos') } }];

const R = {
  estado() {
    return mensajesAlAbrir().slice(0, 3).map(m => ({ ...m, texto: m.texto.replace(/^¡(Buen día|Buenas tardes|Buenas noches)! /, '') }));
  },

  presupuesto() {
    const p = proyeccion();
    if (!p.mt.ingresos) return sinIngresos();
    const nd = numeroDelDia(p);
    if (nd.monto <= 0) {
      return [{ mood: 'pensando', texto: 'Este mes los gastos ya alcanzaron a lo que entró. No te preocupes: priorizá lo esencial (comida, transporte, salud) y el mes que viene lo encaramos juntos. Si entra alguna plata extra, cargala en <b>Ingresos</b> y rehago la cuenta.' }];
    }
    const restoHoy = nd.monto - p.hoy;
    return [{ mood: 'feliz', texto: `Tenés ~<b>${money(nd.monto)} por día</b> para gastos variables en los ${p.quedan} días que quedan${
      nd.conAhorro ? ', ya contando tu ahorro' : ''}.${nd.extra ? '<br>' + nd.extra : ''}<br>Hoy llevás ${money(p.hoy)}${
      restoHoy > 0 ? `, así que te quedan ~${money(restoHoy)} para hoy.` : '. Es un promedio: hay días de más y días de menos, se compensa solo.'}` }];
  },

  saldo() {
    const p = proyeccion(), t = totals(p.key);
    if (!p.mt.ingresos) return sinIngresos();
    let txt = `De lo que entró este mes te quedan <b>${money(t.restante)}</b>.`;
    const faltanFijos = p.fijosEsperados - p.mt.fijos;
    if (faltanFijos > 1000) txt += `<br>Tené en cuenta que todavía faltarían ~${money(faltanFijos)} de gastos fijos (lo del mes pasado con la inflación).`;
    const trasFijos = t.restante - Math.max(faltanFijos, 0);
    const libre = trasFijos - p.metaMonto;
    if (p.metaMonto > 0 && libre > 0 && libre >= trasFijos * 0.5) txt += `<br>Si apartás tu ahorro (${money(r1k(p.metaMonto))}), te quedan libres ~<b>${money(libre)}</b>.`;
    else if (trasFijos > 0) txt += `<br>Para el resto del mes te quedan libres ~<b>${money(trasFijos)}</b>.${p.metaMonto > 0 ? ' Lo que no gastes de eso, es tu ahorro.' : ''}`;
    return [{ mood: 'feliz', texto: txt }];
  },

  total(cat, per) {
    let gs = gastosEntre(per.desde, per.hasta);
    if (cat) gs = gs.filter(g => g.categoria === cat);
    if (!gs.length) return [{ mood: 'pensando', texto: `No tengo gastos ${cat ? `en <b>${esc(cat)}</b> ` : ''}cargados ${per.label}.` }];
    const tot = sum(gs);
    let txt = `${cap(per.label)} gastaste <b>${money(tot)}</b>${cat ? ` en <b>${esc(cat)}</b>` : ''} (${gs.length} ${gs.length === 1 ? 'gasto' : 'gastos'}).`;
    if (per.key) {
      const prevKey = shiftMonth(per.key, -1);
      let prev = peekMonth(prevKey).gastos;
      if (cat) prev = prev.filter(g => g.categoria === cat);
      if (prev.length) txt += ` En ${mesCorto(prevKey).toLowerCase()} fueron ${money(sum(prev))} en total.`;
    }
    if (cat && gs.length > 1) {
      const mayor = gs.slice().sort((a, b) => b.monto - a.monto)[0];
      txt += `<br>El más grande: ${money(mayor.monto)}${mayor.nota ? ` (${esc(mayor.nota)})` : ''}.`;
    }
    const tope = cat && per.key === nowKey() && pasosActivos().find(x => x.tipo === 'tope' && x.categoria === cat && x.desde <= per.key);
    if (tope) txt += `<br>Tu techo para ${esc(cat)} es ${money(tope.meta)}: ${tot > tope.meta ? 'este mes lo pasaste, no pasa nada.' : `te quedan ${money(tope.meta - tot)}.`}`;
    return [{ mood: 'pensando', texto: txt }];
  },

  top(per) {
    const key = per.key || nowKey(), mt = metricas(key);
    const cats = Object.entries(mt.porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (!cats.length) return [{ mood: 'pensando', texto: `No tengo gastos variables cargados ${per.key ? per.label : 'este mes'}.` }];
    const lista = cats.map(([c, v], i) => `${['🥇', '🥈', '🥉'][i]} <b>${esc(c)}</b>: ${money(v)} (${pct(mt.variables ? (v / mt.variables) * 100 : 0)})`).join('<br>');
    return [{ mood: 'pensando', texto: `Sin contar los fijos, ${per.key ? per.label : 'este mes'} lo que más pesa es:<br>${lista}${mt.fijos ? `<br>Además tenés ${money(mt.fijos)} en gastos fijos.` : ''}` }];
  },

  comparar() {
    const key = nowKey(), dia = new Date().getDate(), prevKey = shiftMonth(key, -1);
    const a = metricas(key, dia), b = metricas(prevKey, dia);
    if (!b.gastado) return [{ mood: 'pensando', texto: `No tengo gastos de ${mesCorto(prevKey).toLowerCase()} para comparar.` }];
    const d = ((a.gastado - ajustado(b.gastado)) / ajustado(b.gastado)) * 100;
    let txt = `Al día ${dia} llevás <b>${money(a.gastado)}</b>. En ${mesCorto(prevKey).toLowerCase()}, a esta altura, ibas ${money(b.gastado)}.`;
    txt += infl()
      ? (Math.abs(d) < 3 ? `<br>Descontando la inflación (~${cfg().inflacion}%), venís prácticamente igual.` : `<br>Descontando la inflación (~${cfg().inflacion}%), venís un ${pct(Math.abs(d))} ${d > 0 ? 'arriba' : 'abajo'}.`)
      : '';
    let max = null;
    for (const c of new Set([...Object.keys(a.porCat), ...Object.keys(b.porCat)])) {
      const dif = (a.porCat[c] || 0) - ajustado(b.porCat[c] || 0);
      if (!max || Math.abs(dif) > Math.abs(max.dif)) max = { c, dif };
    }
    if (max && Math.abs(max.dif) > 10000) txt += `<br>La mayor diferencia está en <b>${esc(max.c)}</b> (${max.dif > 0 ? '+' : '−'}${money(Math.abs(max.dif))}). A veces es algo puntual, y está bien.`;
    return [{ mood: d < -3 ? 'feliz' : 'pensando', texto: txt }];
  },

  ahorro(per) {
    const out = [];
    if (per.key && per.key !== nowKey()) {
      const mt = metricas(per.key);
      out.push({ mood: 'pensando', texto: mt.ingresos
        ? `En ${mesCorto(per.key).toLowerCase()} ahorraste <b>${money(mt.ahorro)}</b> (${pct(mt.tasa)} de tus ingresos).`
        : `No tengo ingresos de ${mesCorto(per.key).toLowerCase()} para calcularlo.` });
    } else {
      const p = proyeccion();
      if (p.mt.ingresos && p.dia >= 7) {
        out.push(p.ahorroProyectado > 0
          ? { mood: 'feliz', texto: `Si seguís a este ritmo, este mes te sobran ~<b>${money(p.ahorroProyectado)}</b> (${pct((p.ahorroProyectado / p.mt.ingresos) * 100)}).${cfg().metaAhorro > 0 ? ` Tu meta es ${cfg().metaAhorro}%; si no llegás, terminar en positivo ya vale.` : ''}` }
          : { mood: 'pensando', texto: `Este mes viene justo, algo muy común con los aumentos.${p.presupuestoDiaLibre > 0 ? ` Si gastás menos de ~${money(p.presupuestoDiaLibre)} por día, lo que sobre es tu ahorro del mes.` : ''} El objetivo ahora es cerrar tranqui y sin deudas; el ahorro lo retomamos después.` });
      } else if (p.mt.ingresos) {
        out.push({ mood: 'feliz', texto: `Recién arranca el mes, es temprano para proyectar.${cfg().metaAhorro > 0 ? ` Si podés, separá ${money(r1k(p.metaMonto))} (${cfg().metaAhorro}%) apenas cobres.` : ''}` });
      }
    }
    const usd = data.ahorros.filter(a => a.moneda === 'USD').reduce((s, a) => s + a.monto, 0);
    const ars = data.ahorros.filter(a => a.moneda !== 'USD').reduce((s, a) => s + a.monto, 0);
    if (usd || ars) out.push({ mood: 'feliz', texto: `En tus cuentas de ahorro tenés ${[usd ? money(usd, 'USD') : '', ars ? money(ars) : ''].filter(Boolean).join(' y ')}. 💪` });
    return out.length ? out : [{ mood: 'pensando', texto: 'Todavía no tengo datos de ahorro. Cargá tus ingresos, y tus cuentas en la pestaña <b>Ahorro</b>.' }];
  },

  compra(monto, cat) {
    const p = proyeccion(), { mt } = p;
    if (!mt.ingresos) return sinIngresos();
    const meta = cfg().metaAhorro;
    const margen = mt.ingresos - p.metaMonto - p.fijosEsperados - mt.variables;   // sin tocar el ahorro
    const margenLibre = margen + p.metaMonto;                                       // usando el ahorro del mes
    const libreHoy = p.presupuestoDia - p.hoy;
    const out = [];
    if (monto <= libreHoy) {
      out.push({ mood: 'feliz', texto: `¡Sí! ${money(monto)} entra en lo que tenés para hoy. Disfrutalo 🙌` });
    } else if (monto <= margen) {
      const nuevo = (margen - monto) / p.quedan;
      out.push({ mood: 'feliz', texto: `Sí, te alcanza${meta > 0 ? ' sin tocar tu ahorro' : ''}. Después de comprarlo te quedarían ~<b>${money(nuevo)} por día</b> para los ${p.quedan} días que quedan.${
        nuevo < p.presupuestoDia * 0.6 ? ' Si no es urgente, una opción es esperar a principio de mes que viene.' : ''}` });
    } else if (monto <= margenLibre) {
      out.push({ mood: 'pensando', texto: `Te alcanza, pero usarías parte de lo que pensabas ahorrar este mes (${money(monto - Math.max(margen, 0))}). Si lo necesitás, está bien: el ahorro es para vivir mejor, no para sufrir.` });
    } else {
      out.push({ mood: 'pensando', texto: `Este mes no entra sin quedar en negativo. No es que esté mal quererlo: es que este mes viene justo.` });
      const porMes = Math.max(r1k(mt.ingresos * 0.05), 1000);
      const meses = Math.ceil(monto / porMes);
      out.push({ mood: 'pensando', texto: `Una opción: juntarlo de a poco. Separando ${money(porMes)} por mes (5% de lo que entra), lo tenés en <b>${meses} ${meses === 1 ? 'mes' : 'meses'}</b>. Como los precios suben, conviene ir mirando el precio cada tanto.` });
    }
    // Clásico argentino: cuotas sin interés. Con inflación, las últimas cuotas pesan menos.
    if (monto > libreHoy && mt.ingresos) {
      const margenMes = Math.max(margenLibre, 0);
      const cuotas = [3, 6, 12].find(n => monto / n <= Math.max(margenMes, mt.ingresos * 0.1));
      if (cuotas) out.push({ mood: 'pensando', texto: `Si lo conseguís en <b>${cuotas} cuotas sin interés</b> al mismo precio que de contado, serían ~${money(monto / cuotas)} por mes. Con la inflación, las últimas cuotas te van a pesar menos. Eso sí: chequeá que no tengan recargo y que no se te junten muchas cuotas a la vez en la tarjeta.` });
    }
    const tope = cat && pasosActivos().find(x => x.tipo === 'tope' && x.categoria === cat && x.desde <= p.key);
    if (tope) {
      const v = (mt.porCat[cat] || 0) + monto;
      out.push({ mood: 'pensando', texto: `En ${esc(cat)} quedarías en ${money(v)} de tu techo de ${money(tope.meta)}${v > tope.meta ? '. Es solo una referencia, vos decidís.' : '. 👍'}` });
    }
    return out;
  },

  anotar(monto, cat, original) {
    const nota = ((original.match(/\ben\s+([^?.!]+)/i) || [])[1] || '').trim()
      .replace(/^(un|una|unos|unas|el|la|los|las)\s+/i, '').slice(0, 40);
    const categoria = cat || 'OTRO';
    return [{ mood: 'pensando', texto: `¿Anoto un gasto de <b>${money(monto)}</b> en <b>${esc(categoria)}</b>${nota ? ` (“${esc(nota)}”)` : ''} con fecha de hoy?${
      cat ? '' : '<br><small>Si va en otra categoría, cargalo con el botón +.</small>'}`,
      accion: { label: 'Sí, anotalo', queda: true, fn: () => {
        const item = { id: uid(), creado: Date.now(), mod: Date.now(), fecha: todayISO(), categoria, monto, nota, fijo: false };
        month(todayISO().slice(0, 7)).gastos.push(item);
        save();
        return [reaccionGasto(item)];
      } } }];
  },

  plan() {
    const act = pasosActivos();
    if (!act.length) {
      return [{ mood: 'pensando', texto: 'Todavía no tenés pasos en tu plan: lo armo cuando cierre el mes. ¿Querés ver qué te propondría hoy?',
        accion: { label: 'Ver adelanto', fn: () => abrirInforme(nowKey(), { preliminar: true }) } }];
    }
    const key = nowKey();
    const lista = act.map(p => {
      const pr = p.desde <= key ? progresoPaso(p, key) : null;
      return `• ${p.texto}${pr ? `<br><small>${pr.ok ? '✅' : '🔸'} ${pr.texto}</small>` : ''}`;
    }).join('<br>');
    return [{ mood: 'pensando', texto: `Tu plan de mejora:<br>${lista}`, accion: { label: 'Ver plan completo', fn: () => setView('resumen') } }];
  },

  informe() {
    const ks = Object.keys(data.informes).sort(), k = ks[ks.length - 1];
    if (k) return [{ mood: data.informes[k].mood, texto: `Tu último informe es el de <b>${mesCorto(k)}</b>: ${data.informes[k].titular}`, accion: { label: 'Abrir informe', fn: () => abrirInforme(k) } }];
    return [{ mood: 'pensando', texto: 'Todavía no hay informes: el primero se arma solo cuando termine el mes. Mientras tanto, te muestro cómo viene este.',
      accion: { label: 'Ver cómo viene', fn: () => abrirInforme(nowKey(), { preliminar: true }) } }];
  },

  hormiga() {
    const mt = metricas(nowKey());
    if (!mt.hormigaN) return [{ mood: 'feliz', texto: `Este mes no tenés gastitos chicos (de menos de ${money(mt.umbralHormiga)}). 👌` }];
    const peso = mt.ingresos ? (mt.hormigaTotal / mt.ingresos) * 100 : 0;
    return [{ mood: 'pensando', texto: `Este mes hiciste <b>${mt.hormigaN} ${mt.hormigaN === 1 ? 'compra chica' : 'compras chicas'}</b> (de menos de ${money(mt.umbralHormiga)}, sin contar transporte, salud ni servicios) que suman <b>${money(mt.hormigaTotal)}</b>${mt.ingresos ? ` (${pct(peso)} de lo que entra)` : ''}.<br>${
      peso >= 10 ? 'No hace falta cortarlos: elegí los que más disfrutás y dejá pasar los que hacés en automático.' : 'Es un monto razonable. Un gustito de vez en cuando también es parte de estar bien. ☕'}` }];
  },

  fijos() {
    const key = nowKey(), mt = metricas(key);
    const fijos = peekMonth(key).gastos.filter(g => g.fijo).sort((a, b) => b.monto - a.monto);
    if (!fijos.length) return [{ mood: 'pensando', texto: 'No tenés gastos marcados como fijos este mes. Cuando cargues el alquiler, las expensas o los servicios, tildá <b>"Gasto fijo"</b>: así separo lo que no podés tocar de lo que sí.' }];
    const lista = fijos.slice(0, 6).map(g => `• ${esc(g.nota || g.categoria)}: ${money(g.monto)}`).join('<br>');
    let txt = `Tus fijos de este mes suman <b>${money(mt.fijos)}</b>${mt.ingresos ? ` (${pct((mt.fijos / mt.ingresos) * 100)} de tus ingresos)` : ''}:<br>${lista}`;
    if (mt.ingresos && mt.fijos / mt.ingresos > 0.5) txt += '<br>Es más de la mitad de lo que entra, algo muy común hoy en Argentina. Si en algún momento querés aire, revisar uno solo (el plan del celu, una suscripción) ya ayuda.';
    return [{ mood: 'pensando', texto: txt }];
  },

  consejo() {
    const key = nowKey(), mt = metricas(key), prev = metricas(shiftMonth(key, -1));
    const base = prev.tieneDatos ? prev : mt;
    const activos = new Set(pasosActivos().map(p => p.clave));
    const deDatos = base.tieneDatos
      ? candidatosPasos(base, metricas(shiftMonth(base.key, -1)))
        .filter(c => !activos.has(c.tipo + '-' + (c.categoria || 'gral')))
        .map(c => `${c.texto}. ${c.porque}`)
      : [];
    const meta = cfg().metaAhorro;
    const fijosRef = base.fijos;
    // Consejos pensados para Argentina: prácticos, sin culpa y sin recomendar inversiones.
    const generales = [
      'Aprovechá los días de descuento de tu banco o billetera virtual para el súper y la farmacia. Anotate en el celu qué día conviene cada uno.',
      'Las compras grandes del súper (limpieza, almacén) suelen salir menos en mayoristas o comprando en cantidad con alguien más.',
      'Si algo sale lo mismo en cuotas sin interés que de contado, las cuotas te convienen: con inflación, las últimas pesan menos. Ojo con no acumular demasiadas en la tarjeta.',
      'Los fijos (prepaga, celu, internet, suscripciones) aumentan seguido. Cada tanto, mirá si alguno subió de más: muchas veces llamando te ofrecen un plan mejor.',
      'Si sos monotributista, revisá tu categoría en cada recategorización: si facturaste menos, capaz podés bajar y pagar menos.',
      `Un colchón para imprevistos se arma de a poco: empezá con una meta chiquita${fijosRef ? `, por ejemplo ${money(r1k(fijosRef * 0.5))} (medio mes de fijos)` : ''}. Con eso ya evitás ir a la tarjeta ante cualquier cosa.`,
      'Si una compra no estaba planeada, esperá un día. Si al otro día la seguís queriendo, adelante, sin culpa.',
      'Pagar el resumen de la tarjeta completo (no el mínimo) es de lo que más te protege: los intereses de financiar el saldo son muy altos.',
      meta > 0
        ? `Si podés, separá tu ${meta}% apenas cobres. Si un mes no da, no pasa nada: lo importante es el hábito, no la perfección.`
        : 'Por ahora no tenés meta de ahorro, y está bien. Cuando sientas que hay aire, poné un 3% o 5% para arrancar.',
      'Comparar meses en pesos engaña: con la inflación todo sube. Por eso yo comparo descontando la inflación que pusiste en Ajustes.',
    ];
    const todos = deDatos.concat(generales);
    const c = todos[consejoIdx % todos.length];
    consejoIdx++;
    return [{ mood: 'feliz', texto: '💡 ' + c }];
  },

  invertir() {
    return [{ mood: 'pensando', texto: 'Sobre inversiones (dólares, plazo fijo, cripto, acciones) no te puedo recomendar qué hacer: depende de tu situación y de cosas que no veo. Para eso lo mejor es un asesor financiero matriculado.<br>Lo que sí puedo hacer es ayudarte a saber <b>cuánto</b> podés separar cada mes sin descuidarte. Preguntame <i>"¿cuánto voy a ahorrar este mes?"</i>' }];
  },

  meta(n) {
    if (!(n >= 0 && n <= 80)) return [{ mood: 'pensando', texto: 'Decime un porcentaje entre 0 y 80. Por ejemplo: <i>"cambiá mi meta al 10%"</i>.' }];
    setCfg({ metaAhorro: n });
    const p = proyeccion();
    if (!n) return [{ mood: 'feliz', texto: 'Listo, por ahora sin meta de ahorro. Me enfoco en que cierres el mes tranqui. Cuando quieras, la retomamos.' }];
    return [{ mood: 'feliz', texto: `¡Listo! Tu nueva meta de ahorro es el <b>${n}%</b> de tus ingresos.${
      p.mt.ingresos && p.presupuestoDia > 0 ? ` Con eso, tenés ~${money(p.presupuestoDia)} por día para gastos variables.` : ''}${n > 20 ? ' Es una meta exigente: si te ajusta, bajala sin culpa.' : ''}` }];
  },

  metaActual() {
    const p = proyeccion();
    const meta = cfg().metaAhorro, ejemplo = meta < 75 ? meta + 5 : meta - 5;
    return [{ mood: 'feliz', texto: `Tu meta es ahorrar el <b>${meta}%</b> de tus ingresos${p.mt.ingresos ? ` (≈ ${money(r1k(p.metaMonto))} este mes)` : ''}. Si la querés cambiar, decime por ejemplo: <i>"cambiá mi meta al ${ejemplo}%"</i>.` }];
  },

  ayuda() {
    return [{ mood: 'feliz', texto: 'Te ayudo con tu plata usando lo que cargás en la app. Preguntame, por ejemplo:<br>• ¿Cuánto puedo gastar hoy?<br>• ¿Cuánto gasté en comida este mes?<br>• ¿Me alcanza para unas zapatillas de 80 lucas?<br>• ¿En qué gasto más?<br>• ¿Cómo vengo comparado con el mes pasado?<br>• ¿Cuánto voy a ahorrar?<br>• Gasté 5000 en café (y lo anoto)<br>• Cambiá mi meta al 20%<br>• Dame un consejo' }];
  },

  saludo() {
    return [{ mood: 'feliz', texto: pick(['¡Hola! 🦉 ¿En qué te ayudo?', '¡Hola, hola! ¿Qué querés saber de tu plata hoy?', '¡Buenas! Acá estoy. ¿Qué necesitás?']) }];
  },

  noEntendi() {
    return [{ mood: 'pensando', texto: pick(['Mmm, eso no lo entendí 🤔', 'Perdón, no te sigo 🦉', 'Eso no lo sé responder 🙈']) +
      ' Solo sé de tu plata y sigo aprendiendo. Probá con algo como <i>"¿cuánto puedo gastar hoy?"</i>, <i>"¿cuánto gasté en comida?"</i> o <i>"dame un consejo"</i>.' }];
  },
};

// ---------- Pantalla del chat ----------
function crearChat() {
  if ($('#chat')) return;
  const back = document.createElement('div');
  back.id = 'chatBackdrop'; back.className = 'chat-backdrop'; back.hidden = true;
  const box = document.createElement('section');
  box.id = 'chat'; box.className = 'chat'; box.hidden = true; box.setAttribute('aria-label', 'Chat con ' + ASESOR_NOMBRE);
  box.innerHTML = `
    <header class="chat-top">
      <div class="buho chat-buho" id="chatBuho" data-mood="feliz">${BUHO_SVG}</div>
      <div class="chat-titulo"><b>${ASESOR_NOMBRE}</b><span>tu estratega financiero</span></div>
      <button type="button" class="nav-btn" id="chatCerrar" aria-label="Cerrar chat">✕</button>
    </header>
    <div class="chat-msgs" id="chatMsgs" aria-live="polite"></div>
    <div class="chat-chips" id="chatChips">${SUGERENCIAS.map(s => `<button type="button" class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <form class="chat-form" id="chatForm" autocomplete="off">
      <input id="chatInput" type="text" placeholder="Preguntale a Benito…" enterkeyhint="send" aria-label="Tu mensaje">
      <button class="btn primary" type="submit" aria-label="Enviar">➤</button>
    </form>`;
  document.body.append(back, box);

  back.onclick = cerrarChat;
  $('#chatCerrar').onclick = cerrarChat;
  $('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatInput').value; $('#chatInput').value = ''; enviar(v); };
  $('#chatChips').onclick = e => { const b = e.target.closest('[data-sug]'); if (b) enviar(b.dataset.sug); };
  $('#chatMsgs').onclick = e => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const m = chatMsgs[Number(b.dataset.acc)];
    if (!m || m.usado) return;
    if (m.accion.queda) {
      m.usado = true;
      (m.accion.fn() || []).forEach(x => agregar(x));
      renderChat();
    } else { cerrarChat(); m.accion.fn(); }
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#chat').hidden) cerrarChat(); });
}

function agregar(m, de = 'benito') { chatMsgs.push({ de, texto: m.texto, mood: m.mood || 'feliz', accion: m.accion || null, usado: false }); }

function renderChat() {
  const box = $('#chatMsgs');
  box.innerHTML = chatMsgs.map((m, i) => m.de === 'yo'
    ? `<div class="msg yo">${esc(m.texto)}</div>`
    : `<div class="msg benito">${m.texto}${m.accion ? `<button type="button" class="btn secondary chico msg-acc" data-acc="${i}"${m.usado ? ' disabled' : ''}>${esc(m.accion.label)}</button>` : ''}</div>`
  ).join('') + (escribiendo ? '<div class="msg benito escribiendo" aria-label="Benito está escribiendo"><span></span><span></span><span></span></div>' : '');
  box.scrollTop = box.scrollHeight;
  const ultimo = [...chatMsgs].reverse().find(m => m.de === 'benito');
  $('#chatBuho').dataset.mood = ultimo ? ultimo.mood : 'feliz';
}

function enviar(texto) {
  texto = String(texto || '').trim();
  if (!texto || escribiendo) return;
  agregar({ texto }, 'yo');
  escribiendo = true; renderChat();
  setTimeout(() => {
    escribiendo = false;
    let resp;
    try { resp = responder(texto); } catch (e) { resp = [{ mood: 'pensando', texto: 'Uy, me trabé haciendo la cuenta 😅 ¿Me lo preguntás de otra forma?' }]; }
    resp.forEach(m => agregar(m));
    renderChat();
  }, 450 + Math.random() * 350);
}

function abrirChat() {
  crearChat();
  const ahora = Date.now();
  let conocido = true;
  try {
    conocido = !!localStorage.getItem('benito-conocido');
    localStorage.setItem('benito-conocido', '1');
    localStorage.setItem('benito-ultimo-dia', todayISO());
  } catch (e) { /* ignore */ }
  if (!chatMsgs.length || ahora - chatUltimaApertura > 30 * 60 * 1000) {
    const hora = new Date().getHours();
    const saludo = hora < 12 ? '¡Buen día!' : hora < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';
    agregar({ mood: 'feliz', texto: conocido
      ? `${saludo} Te cuento cómo venís:`
      : `${saludo} Soy <b>${ASESOR_NOMBRE}</b> 🦉, tu estratega financiero. Conozco los gastos que cargás, así que preguntame lo que quieras: cuánto podés gastar, si te alcanza para algo, en qué se te va la plata… o pedime un consejo. Primero, te cuento cómo venís:` });
    R.estado().forEach(m => agregar(m));
  }
  for (const m of chatPendientes) agregar({ ...m, texto: '🧾 ' + m.texto });
  chatPendientes = [];
  chatUltimaApertura = ahora;
  $('#chat').hidden = false; $('#chatBackdrop').hidden = false;
  document.body.classList.add('chat-abierto', 'sin-scroll');
  renderChat();
  actualizarAviso();
}

function cerrarChat() {
  if (!$('#chat')) return;
  $('#chat').hidden = true; $('#chatBackdrop').hidden = true;
  document.body.classList.remove('chat-abierto', 'sin-scroll');
  actualizarAviso();
}
