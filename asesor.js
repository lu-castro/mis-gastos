'use strict';
// Benito, el búho estratega: analiza los gastos, arma el informe de fin de mes
// con un plan de mejora que se acumula mes a mes y te habla al abrir la app.
// Usa las funciones y datos de app.js (se carga antes, pero solo se llama después).

const ASESOR_NOMBRE = 'Benito';
// Pensado para Argentina: meta de ahorro modesta, inflación en las comparaciones y tono tranqui.
const DEFAULT_CONFIG = { metaAhorro: 10, abrirChatAlInicio: false, inflacion: 2 };
const MAX_PASOS_ACTIVOS = 3;
// Gastos chicos que no son "hormiga": son necesarios (colectivo, farmacia, servicios…)
const ESENCIALES = ['MONOTRIBUTO', 'SALUD', 'TRANSPORTE', 'SERVICIO', 'HOGAR'];

function cfg() { return { ...DEFAULT_CONFIG, ...(data.config || {}) }; }
function setCfg(cambios) { data.config = { ...cfg(), ...cambios, configMod: Date.now() }; save(); }

// Inflación mensual estimada (ej. 0.02). Sirve para comparar meses sin culparte por los aumentos.
const infl = () => Math.max(0, Number(cfg().inflacion) || 0) / 100;
// Lo que gastaste el mes pasado, llevado a precios de hoy
const ajustado = v => v * (1 + infl());
const sum = list => list.reduce((a, g) => a + g.monto, 0);
const r1k = n => Math.max(0, Math.round(n / 1000) * 1000);
const pct = n => Math.round(n) + '%';
const nowKey = () => monthKey(new Date());
const mesCorto = key => monthName(key).replace(/ de \d+$/, '');

// ---------- Métricas ----------
function metricas(key, hastaDia) {
  const m = peekMonth(key);
  const t = totals(key);
  const gastos = hastaDia ? m.gastos.filter(g => Number(g.fecha.slice(8, 10)) <= hastaDia) : m.gastos;
  const ingresos = t.ingresosARS;
  const fijosList = gastos.filter(g => g.fijo);
  const varList = gastos.filter(g => !g.fijo);
  const fijos = sum(fijosList), variables = sum(varList), gastado = fijos + variables;
  const porCat = {};
  for (const g of varList) porCat[g.categoria] = (porCat[g.categoria] || 0) + g.monto;
  const umbralHormiga = Math.max(5000, r1k(ingresos * 0.01));
  const hormiga = varList.filter(g => g.monto < umbralHormiga && !ESENCIALES.includes(g.categoria));
  const finde = varList.filter(g => { const d = new Date(g.fecha + 'T12:00').getDay(); return d === 0 || d === 6; });
  const mayor = varList.slice().sort((a, b) => b.monto - a.monto)[0] || null;
  return {
    key, ingresos, fijos, variables, gastado, porCat, mayor,
    ahorro: ingresos - gastado,
    tasa: ingresos ? ((ingresos - gastado) / ingresos) * 100 : 0,
    umbralHormiga, hormigaN: hormiga.length, hormigaTotal: sum(hormiga),
    findeShare: variables ? (sum(finde) / variables) * 100 : 0,
    hayFijosMarcados: m.gastos.some(g => g.fijo),
    cantidad: gastos.length,
    tieneDatos: m.gastos.length > 0 || m.ingresos.length > 0,
  };
}

// Compara dos montos de meses distintos descontando la inflación.
function compararConInflacion(ahora, antes, mesAntes) {
  const nominal = ((ahora - antes) / antes) * 100;
  const real = ((ahora - ajustado(antes)) / ajustado(antes)) * 100;
  const base = `Gastaste ${money(ahora)}; en ${mesAntes} fueron ${money(antes)}`;
  if (!infl()) return `${base} (${nominal >= 0 ? '+' : ''}${pct(nominal)}).`;
  if (Math.abs(real) < 3) return `${base}. Descontando la inflación (~${cfg().inflacion}%), gastaste prácticamente lo mismo.`;
  return `${base}. Descontando la inflación (~${cfg().inflacion}%), eso es un ${pct(Math.abs(real))} ${real > 0 ? 'más' : 'menos'} de verdad.`;
}

// El número "por día" que conviene mostrar. Si apartar el ahorro deja un monto ridículo,
// muestro el realista (sin ahorro) y menciono el otro como opción, sin presionar.
function numeroDelDia(p) {
  const meta = cfg().metaAhorro;
  if (meta > 0 && p.presupuestoDia > 0 && p.presupuestoDia >= p.presupuestoDiaLibre * 0.5) {
    return { monto: p.presupuestoDia, conAhorro: true, extra: '' };
  }
  return {
    monto: Math.max(p.presupuestoDiaLibre, 0), conAhorro: false,
    extra: meta > 0 && p.presupuestoDiaLibre > 0
      ? (p.presupuestoDia > 0
        ? `Para llegar a tu ${meta}% de ahorro serían ~${money(p.presupuestoDia)} por día: si este mes no da, priorizá cerrar tranqui.`
        : `Este mes el ${meta}% de ahorro no entra, y está bien: con los aumentos pasa. Lo que sobre, suma.`)
      : '',
  };
}

// Proyección del mes en curso
function proyeccion() {
  const key = nowKey();
  const dim = daysInMonth(key), dia = new Date().getDate(), quedan = dim - dia + 1;
  const mt = metricas(key);
  const prev = metricas(shiftMonth(key, -1));
  // Los fijos suelen aumentar: espero al menos lo del mes pasado más la inflación
  const fijosEsperados = Math.max(mt.fijos, prev.fijos ? ajustado(prev.fijos) : 0);
  const varPorDia = dia ? mt.variables / dia : 0;
  const gastoProyectado = fijosEsperados + varPorDia * dim;
  const metaMonto = mt.ingresos * cfg().metaAhorro / 100;
  const disponibleVariable = mt.ingresos - metaMonto - fijosEsperados - mt.variables;
  return {
    key, dim, dia, quedan, mt, prev, fijosEsperados, varPorDia, metaMonto,
    ahorroProyectado: mt.ingresos - gastoProyectado,
    presupuestoDia: disponibleVariable / quedan,
    // Sin apartar ahorro: lo que hay por día para no terminar en negativo
    presupuestoDiaLibre: (disponibleVariable + metaMonto) / quedan,
    hoy: sum(peekMonth(key).gastos.filter(g => g.fecha === todayISO() && !g.fijo)),
  };
}

// ---------- Plan de mejora (pasos acumulables) ----------
function pasosActivos() { return data.pasos.filter(p => p.estado === 'activo'); }

// Progreso de un paso medible en un mes. Devuelve { valor, meta, ok, texto }.
function progresoPaso(p, key) {
  const mt = metricas(key);
  if (p.tipo === 'tope') {
    const v = mt.porCat[p.categoria] || 0;
    return { valor: v, meta: p.meta, ok: v <= p.meta, texto: `${money(v)} de ${money(p.meta)}` };
  }
  if (p.tipo === 'hormiga') {
    const n = peekMonth(key).gastos.filter(g => !g.fijo && g.monto < p.umbral).length;
    return { valor: n, meta: p.meta, ok: n <= p.meta, texto: `${n} de ${p.meta} gastos chicos` };
  }
  if (p.tipo === 'ahorro') {
    if (!mt.ingresos) return null;
    if (key === nowKey()) {
      if (new Date().getDate() < 7) return { valor: 0, meta: p.meta, ok: true, texto: 'es temprano para medirlo; si podés, separá algo apenas cobres' };
      const proy = (proyeccion().ahorroProyectado / mt.ingresos) * 100;
      return { valor: proy, meta: p.meta, ok: proy >= p.meta, texto: `vas camino a ahorrar ${pct(proy)} (meta ${p.meta}%)` };
    }
    return { valor: mt.tasa, meta: p.meta, ok: mt.tasa >= p.meta, texto: `ahorro ${pct(mt.tasa)} (meta ${p.meta}%)` };
  }
  return null; // los pasos "manuales" los marca la persona
}

// Evalúa los pasos activos para un mes cerrado (sin modificar nada)
function evaluarPasos(key) {
  const out = [];
  for (const p of pasosActivos()) {
    if (p.desde > key || p.tipo === 'manual') continue;
    const pr = progresoPaso(p, key);
    if (pr) out.push({ id: p.id, ok: pr.ok, detalle: pr.texto });
  }
  return out;
}

function candidatosPasos(mt, prevMt) {
  const meta = cfg().metaAhorro;
  const c = [];
  const fmtCat = s => esc(s);
  // Meta realista: si este mes no se pudo, propongo un escalón alcanzable, no el ideal.
  if (meta > 0 && mt.ingresos && mt.tasa < meta) {
    const escalon = mt.tasa <= 0 ? Math.min(meta, 3) : Math.min(meta, Math.max(3, Math.round(mt.tasa) + 2));
    c.push({
      tipo: 'ahorro', meta: escalon, prioridad: 100,
      texto: escalon < meta
        ? `Separar un ${escalon}% apenas cobres (≈ ${money(r1k(mt.ingresos * escalon / 100))}), aunque sea poquito`
        : `Pagate primero: apenas cobres, separá el ${meta}% (≈ ${money(r1k(mt.ingresos * meta / 100))})`,
      porque: mt.tasa <= 0
        ? 'Con los precios como están, cerrar el mes ya es un logro. Empezamos por algo chico y subimos de a poco.'
        : `Este mes ahorraste ${pct(mt.tasa)}. Subir de a poquito es más sostenible que un salto grande.`,
    });
  }
  const cats = Object.entries(mt.porCat).filter(([cat]) => !ESENCIALES.includes(cat)).sort((a, b) => b[1] - a[1]);
  for (const [cat, v] of cats.slice(0, 1)) {
    const share = mt.variables ? (v / mt.variables) * 100 : 0;
    const antes = prevMt.porCat[cat] || 0;
    // "Creció" en serio: más que la inflación y un 20% extra
    const crecio = antes > 0 && v > ajustado(antes) * 1.2;
    if (share >= 30 || crecio) {
      // El techo acompaña la inflación: no es gastar menos pesos, es no gastar más de verdad
      const tope = r1k(ajustado(v) * 0.95);
      c.push({
        tipo: 'tope', categoria: cat, meta: tope, prioridad: crecio ? 90 : 80,
        texto: `Un techo para ${fmtCat(cat)}: hasta ${money(tope)} en el mes`,
        porque: crecio
          ? `Subió de ${money(antes)} a ${money(v)}, bastante más que la inflación. El techo ya contempla los aumentos.`
          : `Es el ${pct(share)} de tus gastos variables (${money(v)}). El techo ya incluye la inflación, así que es un ajuste suave.`,
      });
    }
  }
  if (mt.ingresos && mt.hormigaTotal >= mt.ingresos * 0.1) {
    const metaN = Math.max(5, Math.floor(mt.hormigaN * 0.8));
    c.push({
      tipo: 'hormiga', meta: metaN, umbral: mt.umbralHormiga, prioridad: 70,
      texto: `Gustitos chicos: hasta ${metaN} en el mes (de menos de ${money(mt.umbralHormiga)})`,
      porque: `Sumaron ${money(mt.hormigaTotal)}, un ${pct((mt.hormigaTotal / mt.ingresos) * 100)} de lo que entra. No hace falta eliminarlos, solo elegirlos.`,
    });
  }
  if (mt.ingresos && mt.fijos / mt.ingresos > 0.65) {
    c.push({
      tipo: 'manual', categoria: 'fijos', prioridad: 60,
      texto: 'Revisar un solo gasto fijo: una suscripción, el plan del celu o la prepaga',
      porque: `Tus fijos son el ${pct((mt.fijos / mt.ingresos) * 100)} de lo que entra. Es muy común en Argentina con los aumentos; bajar uno solo ya te da aire todos los meses.`,
    });
  }
  if (!data.ahorros.some(a => a.monto > 0)) {
    c.push({
      tipo: 'manual', categoria: 'emergencia', prioridad: 40,
      texto: 'Empezar un colchón para imprevistos, aunque sea con muy poco',
      porque: 'No importa el monto: tener algo guardado evita recurrir a la tarjeta cuando aparece un imprevisto.',
    });
  }
  if (mt.ingresos && meta > 0 && mt.tasa >= meta + 5) {
    c.push({
      tipo: 'manual', categoria: 'subir-meta', prioridad: 30,
      texto: `Si te queda cómodo, subir la meta al ${meta + 2}% (en Ajustes)`,
      porque: `Ahorraste ${pct(mt.tasa)}, más que tu meta del ${meta}%. Solo si no te ajusta.`,
    });
  }
  if (!mt.hayFijosMarcados && mt.cantidad >= 3) {
    c.push({
      tipo: 'manual', categoria: 'marcar-fijos', prioridad: 20,
      texto: 'Marcar como "fijo" el alquiler, expensas y servicios al cargarlos',
      porque: 'Así separo lo que no podés tocar de lo que sí, y mis cuentas son más precisas.',
    });
  }
  return c.sort((a, b) => b.prioridad - a.prioridad);
}

// ---------- Informe mensual ----------
function armarInforme(key) {
  const mt = metricas(key);
  const prevMt = metricas(shiftMonth(key, -1));
  const meta = cfg().metaAhorro;
  const hallazgos = [];

  if (prevMt.gastado) hallazgos.push(compararConInflacion(mt.gastado, prevMt.gastado, mesCorto(prevMt.key)));
  const cats = Object.entries(mt.porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (cats.length) {
    hallazgos.push('Donde más se fue la plata (sin contar fijos): ' + cats.map(([c, v]) =>
      `<b>${esc(c)}</b> ${money(v)}`).join(', ') + '.');
  }
  if (mt.ingresos && mt.fijos) hallazgos.push(`Los gastos fijos fueron el ${pct((mt.fijos / mt.ingresos) * 100)} de tus ingresos${mt.fijos / mt.ingresos > 0.5 ? ' (alquiler, servicios y demás pesan mucho hoy en día, no es solo tuyo)' : ''}.`);
  if (mt.ingresos && mt.hormigaTotal >= mt.ingresos * 0.05) hallazgos.push(`Los gustitos chicos (menos de ${money(mt.umbralHormiga)}, sin contar transporte, salud ni servicios) sumaron ${money(mt.hormigaTotal)}.`);
  if (mt.mayor) hallazgos.push(`Tu gasto variable más grande: ${money(mt.mayor.monto)} en ${esc(mt.mayor.nota || mt.mayor.categoria)}.`);

  let titular, mood;
  if (!mt.ingresos) { titular = 'No cargaste ingresos este mes, así que no puedo medir cuánto ahorraste.'; mood = 'pensando'; }
  else if (mt.ahorro < 0) { titular = `Este mes salieron ${money(-mt.ahorro)} más de lo que entró. Con los precios como están, le pasa a mucha gente: no es para culparse, lo vamos acomodando de a poco.`; mood = 'atento'; }
  else if (meta > 0 && mt.tasa < meta) { titular = `Cerraste el mes con ${money(mt.ahorro)} a favor (${pct(mt.tasa)}). No llegaste al ${meta}%, pero terminar en positivo ya vale. 👏`; mood = 'feliz'; }
  else { titular = `¡Muy bien! Te sobraron ${money(mt.ahorro)} (${pct(mt.tasa)})${meta > 0 ? `, por encima de tu meta del ${meta}%` : ''}.`; mood = 'feliz'; }

  return {
    mes: key, mood, titular, hallazgos,
    kpis: { ingresos: mt.ingresos, gastado: mt.gastado, ahorro: mt.ahorro, tasa: mt.tasa, meta, fijos: mt.fijos, variables: mt.variables },
    evaluacion: evaluarPasos(key),
    candidatos: candidatosPasos(mt, prevMt),
  };
}

// Cierra un mes: guarda el informe, actualiza el historial de los pasos y suma pasos nuevos.
function cerrarMes(key) {
  const inf = armarInforme(key);
  const ahora = Date.now();
  const desde = shiftMonth(key, 1);

  for (const ev of inf.evaluacion) {
    const p = data.pasos.find(x => x.id === ev.id);
    p.historial = { ...p.historial, [key]: ev.ok };
    const meses = Object.keys(p.historial).sort();
    const ultimos = meses.slice(-2).map(k => p.historial[k]);
    if (ultimos.length === 2 && ultimos.every(Boolean)) p.estado = 'logrado';
    p.mod = ahora;
  }

  const nuevos = [];
  for (const cand of inf.candidatos) {
    if (pasosActivos().length >= MAX_PASOS_ACTIVOS) break;
    const clave = cand.tipo + '-' + (cand.categoria || 'gral');
    if (pasosActivos().some(p => p.clave === clave)) continue;
    // Recién logrado este mes: le doy un respiro antes de volver a proponerlo
    if (data.pasos.some(p => p.clave === clave && p.estado === 'logrado' && p.mod === ahora)) continue;
    // Si ya lo lograste antes, no lo repito (salvo el de ahorro, que se mide de nuevo)
    if (cand.tipo === 'manual' && data.pasos.some(p => p.clave === clave && p.estado !== 'activo')) continue;
    const id = 'paso-' + desde + '-' + clave;
    const existente = data.pasos.find(p => p.id === id);
    const paso = { ...existente, id, clave, desde, estado: 'activo', historial: existente?.historial || {}, mod: ahora,
      tipo: cand.tipo, categoria: cand.categoria || null, meta: cand.meta ?? null, umbral: cand.umbral ?? null,
      texto: cand.texto, porque: cand.porque };
    if (existente) Object.assign(existente, paso); else data.pasos.push(paso);
    nuevos.push(id);
  }

  const { candidatos, ...guardar } = inf;
  data.informes[key] = { ...guardar, nuevos, creado: ahora, mod: ahora, visto: false };
  return data.informes[key];
}

// Genera los informes de los meses terminados que todavía no tienen.
function checkInformes() {
  const hoyKey = nowKey();
  const pendientes = Object.keys(data.meses)
    .filter(k => k < hoyKey && !data.informes[k] && metricas(k).tieneDatos).sort();
  if (!pendientes.length) return;
  for (const k of pendientes) cerrarMes(k);
  save();
}

// ---------- Lo que dice Benito al abrir la app ----------
function mensajesAlAbrir() {
  const msgs = [];
  const p = proyeccion();
  const { mt } = p;
  const meta = cfg().metaAhorro;
  const hora = new Date().getHours();
  const saludo = hora < 12 ? '¡Buen día!' : hora < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';

  const sinVer = Object.values(data.informes).filter(i => !i.visto).sort((a, b) => b.mes.localeCompare(a.mes))[0];
  if (sinVer) {
    msgs.push({ mood: sinVer.mood, texto: `${saludo} Cerré tu informe de <b>${mesCorto(sinVer.mes)}</b>. ${sinVer.titular}`,
      accion: { label: 'Ver informe', fn: () => abrirInforme(sinVer.mes) } });
  }

  if (!mt.ingresos && !mt.cantidad) {
    msgs.push({ mood: 'feliz', texto: `${sinVer ? '' : saludo + ' '}Soy ${ASESOR_NOMBRE}, tu estratega. Cargá tus ingresos de ${mesCorto(p.key)} en la pestaña <b>Ingresos</b> y empiezo a hacer números con vos.`,
      accion: { label: 'Ir a Ingresos', fn: () => setView('ingresos') } });
    return msgs;
  }
  if (!mt.ingresos) {
    msgs.push({ mood: 'pensando', texto: `Veo gastos pero no ingresos en ${mesCorto(p.key)}. Cargalos así te digo cuánto podés gastar por día.`,
      accion: { label: 'Cargar ingresos', fn: () => setView('ingresos') } });
    return msgs;
  }

  // Ritmo del mes: siempre con un número para hoy, nunca con reto
  const hola = sinVer ? '' : saludo + ' ';
  const nd = numeroDelDia(p);
  if (nd.monto > 0 && p.dia <= 5 && meta > 0) {
    msgs.push({ mood: 'feliz', texto: `${hola}Arranca el mes. Si podés, separá ${money(r1k(p.metaMonto))} (tu ${meta}%) apenas cobres; si este mes no da, no pasa nada. Para el día a día tenés ~<b>${money(nd.monto)} por día</b>.` });
  } else if (nd.conAhorro) {
    msgs.push({ mood: 'feliz', texto: `${hola}Venís bien. Para lo que queda del mes tenés ~<b>${money(nd.monto)} por día</b> para gastos variables, ya contando tu ahorro.` });
  } else if (nd.monto > 0) {
    msgs.push({ mood: meta > 0 ? 'pensando' : 'feliz', texto: `${hola}${meta > 0 ? 'El mes viene un poco justo (pasa mucho con los aumentos). ' : ''}Para cerrar el mes sin quedar en negativo tenés ~<b>${money(nd.monto)} por día</b>.${nd.extra ? ' ' + nd.extra : ''}` });
  } else {
    msgs.push({ mood: 'pensando', texto: `${hola}Este mes los gastos ya alcanzaron a lo que entró. Tranqui: priorizá lo esencial (comida, transporte, salud) y el mes que viene lo encaramos juntos. Si entra alguna plata extra, cargala en <b>Ingresos</b>.` });
  }

  // Plan de mejora en curso: solo comento lo que viene bien o un aviso amable
  for (const paso of pasosActivos()) {
    if (paso.desde > p.key) continue;
    const pr = progresoPaso(paso, p.key);
    if (!pr || paso.tipo !== 'tope') continue;
    const usado = paso.meta ? (pr.valor / paso.meta) * 100 : 0;
    const esperado = (p.dia / p.dim) * 100;
    if (usado > 100) msgs.push({ mood: 'pensando', texto: `En <b>${esc(paso.categoria)}</b> ya pasaste el techo que nos habíamos puesto (${pr.texto}). No pasa nada: el mes que viene lo ajustamos a algo más realista si hace falta.` });
    else if (usado > esperado + 25) msgs.push({ mood: 'pensando', texto: `En <b>${esc(paso.categoria)}</b> vas ${pr.texto}. Solo para que lo tengas en cuenta.` });
    else if (p.dia > 10) msgs.push({ mood: 'feliz', texto: `Tu techo de <b>${esc(paso.categoria)}</b> viene bien: ${pr.texto}. 👌` });
  }

  if (p.quedan <= 3 && p.ahorroProyectado > 0) {
    msgs.push({ mood: 'feliz', texto: `Faltan ${p.quedan} día${p.quedan > 1 ? 's' : ''} para cerrar el mes y vas a terminar con algo a favor (~${money(p.ahorroProyectado)}). ¡Bien ahí!` });
  }
  if (!mt.hayFijosMarcados && mt.cantidad >= 3) {
    msgs.push({ mood: 'pensando', texto: 'Tip: marcá como <b>fijo</b> el alquiler, las expensas y los servicios al cargarlos. Así separo lo que no podés tocar de lo que sí.' });
  }
  const nota = peekMonth(p.key).nota;
  if (nota) msgs.push({ mood: 'pensando', texto: `Te dejaste esta nota: <i>“${esc(nota)}”</i>. La tengo en cuenta 😉` });

  return msgs.slice(0, 5);
}

// Comentario rápido después de cargar un gasto
function reaccionGasto(g) {
  if (monthKey(new Date()) !== g.fecha.slice(0, 7) || g.fijo) {
    return { mood: 'feliz', texto: 'Anotado 👍' };
  }
  const p = proyeccion();
  if (!p.mt.ingresos) return { mood: 'pensando', texto: 'Anotado. Cargá tus ingresos así te digo cómo venís.' };
  // Sin retos: confirmo y, si sirve, doy el número actualizado
  const nd = numeroDelDia(p);
  if (nd.monto > 0) return { mood: 'feliz', texto: `Anotado ✅ Para lo que queda del mes tenés ~${money(nd.monto)} por día.` };
  return { mood: 'feliz', texto: 'Anotado ✅' };
}

// ---------- Personaje ----------
const BUHO_SVG = `
<svg viewBox="0 0 120 120" class="buho-svg" aria-hidden="true">
  <g class="buho-cuerpo">
    <path d="M30 34 L36 12 L48 28 Z" fill="#6f4a2f"/><path d="M90 34 L84 12 L72 28 Z" fill="#6f4a2f"/>
    <ellipse cx="60" cy="68" rx="40" ry="44" fill="#8b5e3c"/>
    <ellipse cx="24" cy="78" rx="10" ry="22" fill="#6f4a2f" transform="rotate(12 24 78)"/>
    <ellipse cx="96" cy="78" rx="10" ry="22" fill="#6f4a2f" transform="rotate(-12 96 78)"/>
    <ellipse cx="60" cy="88" rx="26" ry="22" fill="#ecd9b8"/>
    <path d="M50 84 q4 4 8 0 M62 84 q4 4 8 0 M56 94 q4 4 8 0" stroke="#c9ad85" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M52 110 v4 M56 110 v4 M64 110 v4 M68 110 v4" stroke="#e08a1e" stroke-width="3" stroke-linecap="round"/>
    <circle cx="44" cy="54" r="17" fill="#f6ead6"/><circle cx="76" cy="54" r="17" fill="#f6ead6"/>
    <g class="pupilas">
      <circle cx="44" cy="55" r="7" fill="#1d1d1d"/><circle cx="76" cy="55" r="7" fill="#1d1d1d"/>
      <circle cx="46.5" cy="52.5" r="2.2" fill="#fff"/><circle cx="78.5" cy="52.5" r="2.2" fill="#fff"/>
    </g>
    <g class="parpados" fill="#8b5e3c">
      <rect x="27" y="37" width="34" height="34" rx="17"/><rect x="59" y="37" width="34" height="34" rx="17"/>
    </g>
    <g fill="none" stroke="#2b2b2b" stroke-width="3">
      <circle cx="44" cy="54" r="18"/><circle cx="76" cy="54" r="18"/><path d="M62 52 q-2 -3 -4 0"/>
    </g>
    <path class="ceja ceja-feliz" d="M30 33 q14 -8 28 0 M62 33 q14 -8 28 0" stroke="#4a2f1c" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path class="ceja ceja-atento" d="M30 34 q14 -4 28 2 M62 28 q14 -6 28 4" stroke="#4a2f1c" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path class="ceja ceja-alerta" d="M30 28 L56 36 M90 28 L64 36" stroke="#4a2f1c" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path class="ceja ceja-pensando" d="M30 32 q14 -4 28 0 M62 26 q14 -8 28 2" stroke="#4a2f1c" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M55 66 L65 66 L60 76 Z" fill="#f0a030"/>
    <circle class="mejillas" cx="30" cy="70" r="5" fill="#f2a0a0" opacity=".7"/><circle class="mejillas" cx="90" cy="70" r="5" fill="#f2a0a0" opacity=".7"/>
    <path d="M48 104 l12 -6 l12 6 l-12 6 z" fill="#2f6fb5"/><circle cx="60" cy="104" r="3" fill="#24578f"/>
  </g>
</svg>`;

// Benito no aparece solo: cuando tiene algo para decir, muestra un puntito y espera a que lo toques.
function crearPersonaje() {
  const btn = document.createElement('button');
  btn.id = 'buho'; btn.className = 'buho'; btn.setAttribute('aria-label', 'Hablar con ' + ASESOR_NOMBRE);
  btn.innerHTML = BUHO_SVG + '<span class="buho-aviso" id="buhoAviso" hidden></span>';
  btn.dataset.mood = 'feliz';
  btn.onclick = () => abrirChat();
  document.body.append(btn);
}

// Benito siempre con cara amable: nada de cejas de enojo
function moodActual() {
  return mensajesAlAbrir().some(x => x.mood === 'pensando') ? 'pensando' : 'feliz';
}

// Puntito: solo cuando hay algo nuevo de verdad (un informe sin ver). Nada de avisos diarios.
function actualizarAviso() {
  const aviso = $('#buhoAviso');
  if (!aviso) return;
  const n = Object.values(data.informes).filter(i => !i.visto).length;
  aviso.hidden = !n;
  aviso.textContent = n ? String(n) : '';
  $('#buho').dataset.mood = moodActual();
}

// ---------- Pantallas: plan, informes, ajustes ----------
function renderPlanInformes() {
  const key = nowKey();
  const activos = pasosActivos();
  const logrados = data.pasos.filter(p => p.estado === 'logrado');
  $('#planList').innerHTML = activos.length ? activos.map(p => {
    const pr = p.desde <= key ? progresoPaso(p, key) : null;
    const racha = Object.keys(p.historial || {}).sort().map(k => p.historial[k] ? '✅' : '🔸').join('');
    let barra = '';
    if (pr && p.tipo !== 'ahorro') {
      const w = Math.min(100, p.meta ? (pr.valor / p.meta) * 100 : 0);
      barra = `<div class="bar"><div class="bar-fill ${w >= 100 ? 'over' : w >= 80 ? 'warn' : ''}" style="width:${w}%"></div></div>`;
    }
    return `<div class="paso">
      <div class="paso-t">${p.texto}</div>
      <div class="paso-s">${p.porque}</div>
      ${pr ? `<div class="paso-s"><b>Este mes:</b> ${pr.texto}</div>${barra}` : p.desde > key ? `<div class="paso-s">Empieza en ${mesCorto(p.desde)}</div>` : ''}
      <div class="paso-pie">
        <span class="paso-racha">${racha}</span>
        <span>
          ${p.tipo === 'manual' ? `<button class="btn secondary chico" data-paso-ok="${p.id}">¡Lo hice!</button>` : ''}
          <button class="btn ghost chico" data-paso-no="${p.id}">Descartar</button>
        </span>
      </div>
    </div>`;
  }).join('') : '<p class="muted">Cuando termine el mes, armo tu primer plan de mejora con pasos concretos. Se van sumando mes a mes.</p>';
  $('#planLogrados').innerHTML = logrados.length
    ? `<details><summary>Hábitos logrados (${logrados.length})</summary>${logrados.map(p => `<div class="paso-s">🏅 ${p.texto}</div>`).join('')}</details>` : '';

  const meses = Object.keys(data.informes).sort().reverse();
  $('#informesList').innerHTML = (meses.length ? meses.map(k => {
    const i = data.informes[k];
    return `<div class="line-item" data-informe="${k}"><span>${monthName(k)}${i.visto ? '' : ' <span class="badge">nuevo</span>'}</span><b>${i.kpis.ingresos ? pct(i.kpis.tasa) + ' ahorrado' : '—'}</b></div>`;
  }).join('') : '<p class="muted">Todavía no hay informes. Se generan solos cuando termina cada mes.</p>');
}

function renderAjustesAsesor() {
  const c = cfg();
  if (document.activeElement !== $('#metaAhorro')) $('#metaAhorro').value = c.metaAhorro;
  if (document.activeElement !== $('#inflacion')) $('#inflacion').value = String(c.inflacion).replace('.', ',');
  $('#hablarAlAbrir').checked = c.abrirChatAlInicio;
}

function abrirInforme(key, { preliminar = false } = {}) {
  let inf = data.informes[key];
  if (preliminar) {
    const a = armarInforme(key);
    inf = { ...a, nuevos: [], preliminar: true };
  }
  if (!inf) return;
  const k = inf.kpis;
  const evals = inf.evaluacion.map(ev => {
    const p = data.pasos.find(x => x.id === ev.id);
    return p ? `<li>${ev.ok ? '✅' : '🔸 Esta vez no:'} ${p.texto}<div class="paso-s">${ev.detalle}</div></li>` : '';
  }).join('');
  const pasosLista = preliminar
    ? armarInforme(key).candidatos.slice(0, 3).map(c => `<li>${c.texto}<div class="paso-s">${c.porque}</div></li>`).join('')
    : inf.nuevos.map(id => data.pasos.find(x => x.id === id)).filter(Boolean)
      .map(p => `<li>${p.texto}<div class="paso-s">${p.porque}</div></li>`).join('');
  const activos = pasosActivos().filter(p => !inf.nuevos.includes(p.id));

  $('#informeBody').innerHTML = `
    <div class="informe-head" data-mood="${inf.mood}">
      <div class="buho mini" data-mood="${inf.mood}">${BUHO_SVG}</div>
      <div><div class="label">${preliminar ? 'Informe preliminar · ' : 'Informe de '}${monthName(key)}</div><p class="informe-titular">${inf.titular}</p></div>
    </div>
    <div class="sum-grid card">
      <div><span class="label">Ingresos</span><b>${money(k.ingresos)}</b></div>
      <div><span class="label">Gastado</span><b>${money(k.gastado)}</b></div>
      <div><span class="label">Ahorrado</span><b class="${k.ahorro < 0 ? 'neg' : ''}">${money(k.ahorro)}</b></div>
      <div><span class="label">Tasa de ahorro</span><b>${k.ingresos ? pct(k.tasa) : '—'} <small class="muted">(meta ${k.meta}%)</small></b></div>
    </div>
    ${inf.hallazgos.length ? `<h3>Lo que vi</h3><ul class="informe-lista">${inf.hallazgos.map(h => `<li>${h}</li>`).join('')}</ul>` : ''}
    ${evals ? `<h3>Cómo te fue con tu plan</h3><ul class="informe-lista">${evals}</ul>` : ''}
    ${pasosLista ? `<h3>${preliminar ? 'Lo que te propondría' : 'Próximos pasos'}</h3><ol class="informe-lista">${pasosLista}</ol>` : ''}
    ${!preliminar && activos.length ? `<h3>Siguen en tu plan</h3><ul class="informe-lista">${activos.map(p => `<li>${p.texto}</li>`).join('')}</ul>` : ''}
    <p class="muted small">Son sugerencias para organizar tu presupuesto, armadas a partir de lo que cargaste. No reemplazan el consejo de un asesor financiero profesional.</p>
    ${!preliminar ? `<button class="btn ghost full" id="regenerarInforme">Rehacer informe (si cargaste algo tarde)</button>` : ''}`;
  $('#informePanel').hidden = false;
  document.body.classList.add('sin-scroll');
  const reg = $('#regenerarInforme');
  if (reg) reg.onclick = () => { cerrarMes(key); save(); abrirInforme(key); toast('Informe actualizado'); };
  if (!preliminar && !inf.visto) { inf.visto = true; inf.mod = Date.now(); save(); }
}
function cerrarInforme() { $('#informePanel').hidden = true; document.body.classList.remove('sin-scroll'); }

function initAsesor() {
  crearPersonaje();
  $('#informeCerrar').onclick = cerrarInforme;
  $('#informesList').onclick = e => { const el = e.target.closest('[data-informe]'); if (el) abrirInforme(el.dataset.informe); };
  $('#informePreliminar').onclick = () => abrirInforme(nowKey(), { preliminar: true });
  $('#planList').onclick = e => {
    const ok = e.target.closest('[data-paso-ok]'), no = e.target.closest('[data-paso-no]');
    const id = (ok || no)?.dataset.pasoOk || (ok || no)?.dataset.pasoNo;
    const p = id && data.pasos.find(x => x.id === id);
    if (!p) return;
    if (no && !confirm('¿Sacar este paso de tu plan?')) return;
    p.estado = ok ? 'logrado' : 'descartado';
    if (ok) p.historial = { ...p.historial, [nowKey()]: true };
    p.mod = Date.now(); save();
    if (ok) toast('¡Eso! Un hábito más en tu cuenta 🏅');
  };
  $('#metaAhorro').onchange = e => {
    const v = Math.round(Number(e.target.value));
    if (!(v >= 0 && v <= 80)) { toast('Poné un número entre 0 y 80'); return renderAjustesAsesor(); }
    setCfg({ metaAhorro: v }); toast(v ? 'Meta de ahorro: ' + v + '%' : 'Sin meta de ahorro por ahora');
  };
  $('#inflacion').onchange = e => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (!(v >= 0 && v <= 30)) { toast('Poné un número entre 0 y 30'); return renderAjustesAsesor(); }
    setCfg({ inflacion: Math.round(v * 10) / 10 }); toast('Inflación mensual: ' + String(v).replace('.', ',') + '%');
  };
  // La meta vieja por defecto (15%) era exigente: la paso una sola vez al 10% nuevo.
  if (data.config && !data.config.ajusteArg) {
    setCfg(data.config.metaAhorro === 15 ? { metaAhorro: 10, ajusteArg: true } : { ajusteArg: true });
  }
  $('#hablarAlAbrir').onchange = e => setCfg({ abrirChatAlInicio: e.target.checked });
}

let ultimaVezOculta = 0;
// Por defecto Benito solo avisa con el puntito; se abre solo únicamente si lo pediste en Ajustes.
function saludarSiCorresponde() {
  actualizarAviso();
  if (cfg().abrirChatAlInicio) setTimeout(abrirChat, 700);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') ultimaVezOculta = Date.now();
  else if (ultimaVezOculta && Date.now() - ultimaVezOculta > 10 * 60 * 1000) { checkInformes(); saludarSiCorresponde(); }
});
