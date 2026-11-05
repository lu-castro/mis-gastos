'use strict';
// Benito, el búho estratega: analiza los gastos, arma el informe de fin de mes
// con un plan de mejora que se acumula mes a mes y te habla al abrir la app.
// Usa las funciones y datos de app.js (se carga antes, pero solo se llama después).

const ASESOR_NOMBRE = 'Benito';
const DEFAULT_CONFIG = { metaAhorro: 15, hablarAlAbrir: true };
const MAX_PASOS_ACTIVOS = 5;

function cfg() { return { ...DEFAULT_CONFIG, ...(data.config || {}) }; }
function setCfg(cambios) { data.config = { ...cfg(), ...cambios, configMod: Date.now() }; save(); }

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
  const hormiga = varList.filter(g => g.monto < umbralHormiga);
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

// Proyección del mes en curso
function proyeccion() {
  const key = nowKey();
  const dim = daysInMonth(key), dia = new Date().getDate(), quedan = dim - dia + 1;
  const mt = metricas(key);
  const prev = metricas(shiftMonth(key, -1));
  const fijosEsperados = Math.max(mt.fijos, prev.fijos);
  const varPorDia = dia ? mt.variables / dia : 0;
  const gastoProyectado = fijosEsperados + varPorDia * dim;
  const metaMonto = mt.ingresos * cfg().metaAhorro / 100;
  const disponibleVariable = mt.ingresos - metaMonto - fijosEsperados - mt.variables;
  return {
    key, dim, dia, quedan, mt, prev, fijosEsperados, varPorDia, metaMonto,
    ahorroProyectado: mt.ingresos - gastoProyectado,
    presupuestoDia: disponibleVariable / quedan,
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
      if (new Date().getDate() < 7) return { valor: 0, meta: p.meta, ok: true, texto: 'es temprano para medirlo; separá tu ahorro apenas cobres' };
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
  if (mt.ingresos && mt.tasa < meta) {
    c.push({
      tipo: 'ahorro', meta, prioridad: 100,
      texto: `Pagate primero: apenas cobres, separá el ${meta}% (≈ ${money(r1k(mt.ingresos * meta / 100))}) a tu ahorro`,
      porque: `Este mes ahorraste ${pct(Math.max(mt.tasa, 0))}. Lo que se separa al principio no se gasta.`,
    });
  }
  const cats = Object.entries(mt.porCat).sort((a, b) => b[1] - a[1]);
  for (const [cat, v] of cats.slice(0, 2)) {
    const share = mt.variables ? (v / mt.variables) * 100 : 0;
    const antes = prevMt.porCat[cat] || 0;
    const crecio = antes > 0 && v > antes * 1.2;
    if (share >= 25 || crecio) {
      const tope = r1k(v * 0.9);
      c.push({
        tipo: 'tope', categoria: cat, meta: tope, prioridad: crecio ? 90 : 80,
        texto: `Ponerle techo a ${fmtCat(cat)}: máximo ${money(tope)} en el mes`,
        porque: crecio
          ? `Subió de ${money(antes)} a ${money(v)} respecto al mes anterior.`
          : `Es el ${pct(share)} de tus gastos variables (${money(v)}). Un 10% menos ya se nota.`,
      });
    }
  }
  if (mt.hormigaN >= 8 || (mt.ingresos && mt.hormigaTotal >= mt.ingresos * 0.05)) {
    const metaN = Math.max(3, Math.floor(mt.hormigaN * 0.7));
    c.push({
      tipo: 'hormiga', meta: metaN, umbral: mt.umbralHormiga, prioridad: 70,
      texto: `Gastos hormiga: como máximo ${metaN} compras chicas (menos de ${money(mt.umbralHormiga)})`,
      porque: `Hiciste ${mt.hormigaN} que sumaron ${money(mt.hormigaTotal)}. De a poquito se van montones.`,
    });
  }
  if (mt.ingresos && mt.fijos / mt.ingresos > 0.5) {
    c.push({
      tipo: 'manual', categoria: 'fijos', prioridad: 60,
      texto: 'Revisar los gastos fijos: elegí una suscripción o servicio para bajar de plan o dar de baja',
      porque: `Tus fijos se llevan el ${pct((mt.fijos / mt.ingresos) * 100)} de lo que entra. Bajar un fijo te ahorra todos los meses.`,
    });
  }
  if (mt.findeShare > 45 && mt.variables > 0) {
    c.push({
      tipo: 'manual', categoria: 'finde', prioridad: 50,
      texto: 'Armar un presupuesto para los findes antes de que empiecen',
      porque: `El ${pct(mt.findeShare)} de tus gastos variables fue en fin de semana.`,
    });
  }
  if (!data.ahorros.some(a => a.monto > 0)) {
    c.push({
      tipo: 'manual', categoria: 'emergencia', prioridad: 40,
      texto: 'Empezar un fondo de emergencia, aunque sea con poco',
      porque: 'Tener un colchón evita endeudarte cuando aparece un imprevisto.',
    });
  }
  if (mt.ingresos && mt.tasa >= meta + 5) {
    c.push({
      tipo: 'manual', categoria: 'subir-meta', prioridad: 30,
      texto: `Subir tu meta de ahorro al ${meta + 2}% (en Ajustes)`,
      porque: `Ahorraste ${pct(mt.tasa)}, más que tu meta del ${meta}%. ¡Podés más!`,
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

  if (prevMt.gastado) {
    const d = ((mt.gastado - prevMt.gastado) / prevMt.gastado) * 100;
    hallazgos.push(Math.abs(d) < 3
      ? `Gastaste parecido al mes anterior (${money(mt.gastado)}).`
      : `Gastaste ${pct(Math.abs(d))} ${d > 0 ? 'más' : 'menos'} que en ${mesCorto(prevMt.key)} (${money(prevMt.gastado)} → ${money(mt.gastado)}).`);
  }
  const cats = Object.entries(mt.porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (cats.length) {
    hallazgos.push('Donde más se fue la plata (sin contar fijos): ' + cats.map(([c, v]) =>
      `<b>${esc(c)}</b> ${money(v)}`).join(', ') + '.');
  }
  if (mt.ingresos && mt.fijos) hallazgos.push(`Los gastos fijos fueron el ${pct((mt.fijos / mt.ingresos) * 100)} de tus ingresos.`);
  if (mt.hormigaN) hallazgos.push(`Hiciste ${mt.hormigaN} gastos chicos (menos de ${money(mt.umbralHormiga)}) que suman ${money(mt.hormigaTotal)}.`);
  if (mt.findeShare > 35) hallazgos.push(`El ${pct(mt.findeShare)} de los gastos variables fue en fines de semana.`);
  if (mt.mayor) hallazgos.push(`Tu gasto variable más grande: ${money(mt.mayor.monto)} en ${esc(mt.mayor.nota || mt.mayor.categoria)}.`);

  let titular, mood;
  if (!mt.ingresos) { titular = 'No cargaste ingresos este mes, así que no puedo medir cuánto ahorraste.'; mood = 'pensando'; }
  else if (mt.ahorro < 0) { titular = `Mes en rojo: gastaste ${money(-mt.ahorro)} más de lo que entró. Vamos a ajustar.`; mood = 'alerta'; }
  else if (mt.tasa < meta) { titular = `Ahorraste ${money(mt.ahorro)} (${pct(mt.tasa)}). Cerca de tu meta del ${meta}%: con un par de ajustes llegás.`; mood = 'atento'; }
  else { titular = `¡Muy bien! Ahorraste ${money(mt.ahorro)} (${pct(mt.tasa)}), por encima de tu meta del ${meta}%.`; mood = 'feliz'; }

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

  // Ritmo del mes
  if (p.dia <= 5) {
    msgs.push({ mood: 'feliz', texto: `${sinVer ? '' : saludo + ' '}Arranca el mes: el mejor momento para <b>pagarte primero</b>. Separá ${money(r1k(p.metaMonto))} (tu ${meta}%) a tu ahorro antes de gastar. Después, tenés ${money(Math.max(p.presupuestoDia, 0))} por día para tus gastos variables.` });
  } else if (p.ahorroProyectado < 0) {
    msgs.push({ mood: 'alerta', texto: `Ojo: a este ritmo (${money(p.varPorDia)} por día en variables) terminás el mes <b>${money(-p.ahorroProyectado)} en rojo</b>. Para cumplir tu meta, bajá a ${money(Math.max(p.presupuestoDia, 0))} por día en lo que queda.` });
  } else if (p.ahorroProyectado < p.metaMonto) {
    msgs.push({ mood: 'atento', texto: `Venís bien, pero todavía no llegás a tu meta: proyecto que ahorrás ${money(p.ahorroProyectado)} (${pct((p.ahorroProyectado / mt.ingresos) * 100)}) y tu meta es ${meta}%. Si bajás a <b>${money(Math.max(p.presupuestoDia, 0))} por día</b>, la cumplís.` });
  } else {
    msgs.push({ mood: 'feliz', texto: `${sinVer ? '' : saludo + ' '}¡Vas bárbaro! Si seguís así, ahorrás ${money(p.ahorroProyectado)} este mes (${pct((p.ahorroProyectado / mt.ingresos) * 100)}). Podés gastar hasta <b>${money(Math.max(p.presupuestoDia, 0))} por día</b> y seguís cumpliendo.` });
  }

  if (p.hoy > 0 && p.presupuestoDia > 0) {
    msgs.push(p.hoy > p.presupuestoDia
      ? { mood: 'atento', texto: `Hoy ya gastaste ${money(p.hoy)}, más que tu presupuesto diario (${money(p.presupuestoDia)}). Mañana intentá un día "sin gastos" para compensar.` }
      : { mood: 'feliz', texto: `Hoy llevás ${money(p.hoy)} de ${money(p.presupuestoDia)}. Te quedan ${money(p.presupuestoDia - p.hoy)} para hoy.` });
  }

  // Plan de mejora en curso
  for (const paso of pasosActivos()) {
    if (paso.desde > p.key) continue;
    const pr = progresoPaso(paso, p.key);
    if (!pr) continue;
    if (paso.tipo === 'tope') {
      const usado = paso.meta ? (pr.valor / paso.meta) * 100 : 0;
      const esperado = (p.dia / p.dim) * 100;
      if (usado > 100) msgs.push({ mood: 'alerta', texto: `Tu techo de <b>${esc(paso.categoria)}</b> era ${money(paso.meta)} y ya vas ${money(pr.valor)}. Lo que queda del mes, mejor nada más ahí.` });
      else if (usado > esperado + 15) msgs.push({ mood: 'atento', texto: `En <b>${esc(paso.categoria)}</b> ya usaste el ${pct(usado)} de tu techo y vamos por el ${pct(esperado)} del mes. Frená un poco.` });
      else if (p.dia > 10) msgs.push({ mood: 'feliz', texto: `Tu techo de <b>${esc(paso.categoria)}</b> viene bien: ${pr.texto}.` });
    }
    if (paso.tipo === 'hormiga' && pr.valor >= 3 && pr.valor > paso.meta * (p.dia / p.dim) * 1.5) {
      msgs.push({ mood: 'atento', texto: `Ya van ${pr.valor} gastos chicos este mes (tu límite es ${paso.meta}). ¿Alguno se podía evitar?` });
    }
  }

  // Comparación con el mes pasado a esta altura
  const prevHasta = metricas(shiftMonth(p.key, -1), p.dia);
  let peor = null;
  for (const [cat, v] of Object.entries(mt.porCat)) {
    const antes = prevHasta.porCat[cat] || 0;
    if (antes > 0 && v > antes * 1.3 && v - antes > 10000 && (!peor || v - antes > peor.dif)) peor = { cat, v, antes, dif: v - antes };
  }
  if (peor) msgs.push({ mood: 'pensando', texto: `En <b>${esc(peor.cat)}</b> llevás ${money(peor.v)}; a esta altura del mes pasado ibas ${money(peor.antes)}. ¿Pasó algo puntual?` });

  if (mt.hormigaN >= 6 && mt.hormigaTotal > mt.ingresos * 0.03) {
    msgs.push({ mood: 'pensando', texto: `Tenés ${mt.hormigaN} gastos chicos que ya suman ${money(mt.hormigaTotal)}. Los "gastos hormiga" son los más fáciles de recortar.` });
  }
  if (p.quedan <= 3 && p.ahorroProyectado > 0) {
    msgs.push({ mood: 'feliz', texto: `Faltan ${p.quedan} día${p.quedan > 1 ? 's' : ''} para cerrar el mes. Si aguantás, ahorrás ~${money(p.ahorroProyectado)}. Pasalo a tu cuenta de ahorro así no se mezcla.` });
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
  const tope = pasosActivos().find(x => x.tipo === 'tope' && x.categoria === g.categoria && x.desde <= p.key);
  if (tope) {
    const v = p.mt.porCat[g.categoria] || 0;
    if (v > tope.meta) return { mood: 'alerta', texto: `Con esto pasaste tu techo de ${esc(g.categoria)}: ${money(v)} de ${money(tope.meta)}.` };
    return { mood: v > tope.meta * 0.8 ? 'atento' : 'feliz', texto: `Anotado. En ${esc(g.categoria)} vas ${money(v)} de tu techo de ${money(tope.meta)}.` };
  }
  if (p.presupuestoDia <= 0) return { mood: 'alerta', texto: `Anotado. Ojo: ya no queda margen para tu meta de ahorro este mes. Lo que sigue, solo lo necesario.` };
  if (g.monto > p.presupuestoDia * 1.5) {
    return { mood: 'atento', texto: `Es un gasto grande para tu ritmo: equivale a ${(g.monto / p.presupuestoDia).toFixed(1).replace('.', ',')} días de presupuesto. Ahora tenés ${money(p.presupuestoDia)} por día.` };
  }
  if (p.hoy > p.presupuestoDia) return { mood: 'atento', texto: `Anotado. Hoy ya vas ${money(p.hoy)}, arriba de tu presupuesto diario de ${money(p.presupuestoDia)}.` };
  return { mood: 'feliz', texto: `Anotado. Te quedan ${money(p.presupuestoDia)} por día para cumplir tu meta.` };
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

let cola = [], idx = 0, cierreAuto = null;

function crearPersonaje() {
  const btn = document.createElement('button');
  btn.id = 'buho'; btn.className = 'buho'; btn.setAttribute('aria-label', 'Hablar con ' + ASESOR_NOMBRE);
  btn.innerHTML = BUHO_SVG;
  btn.dataset.mood = 'feliz';
  btn.onclick = () => ($('#burbuja').hidden ? hablar(mensajesAlAbrir()) : callar());
  const b = document.createElement('div');
  b.id = 'burbuja'; b.className = 'burbuja'; b.hidden = true; b.setAttribute('role', 'status');
  b.innerHTML = `<div class="burbuja-nombre">${ASESOR_NOMBRE} · tu estratega</div>
    <div class="burbuja-texto" id="burbujaTexto"></div>
    <div class="burbuja-pie">
      <span class="burbuja-cont" id="burbujaCont"></span>
      <button type="button" class="btn secondary" id="burbujaAccion" hidden></button>
      <button type="button" class="btn primary" id="burbujaSig">Siguiente</button>
    </div>`;
  document.body.append(b, btn);
  $('#burbujaSig').onclick = () => { idx++; idx < cola.length ? mostrar() : callar(); };
}

function hablar(msgs, { auto = false } = {}) {
  if (!msgs.length) return;
  cola = msgs; idx = 0;
  clearTimeout(cierreAuto);
  mostrar();
  if (auto) cierreAuto = setTimeout(callar, 7000);
}
function mostrar() {
  const m = cola[idx];
  $('#buho').dataset.mood = m.mood || 'feliz';
  $('#buho').classList.remove('saltito'); void $('#buho').offsetWidth; $('#buho').classList.add('saltito');
  $('#burbujaTexto').innerHTML = m.texto;
  $('#burbujaCont').textContent = cola.length > 1 ? `${idx + 1}/${cola.length}` : '';
  $('#burbujaSig').textContent = idx < cola.length - 1 ? 'Siguiente' : 'Listo';
  const acc = $('#burbujaAccion');
  acc.hidden = !m.accion;
  if (m.accion) { acc.textContent = m.accion.label; acc.onclick = () => { callar(); m.accion.fn(); }; }
  $('#burbuja').hidden = false;
}
function callar() { clearTimeout(cierreAuto); $('#burbuja').hidden = true; }

// ---------- Pantallas: plan, informes, ajustes ----------
function renderPlanInformes() {
  const key = nowKey();
  const activos = pasosActivos();
  const logrados = data.pasos.filter(p => p.estado === 'logrado');
  $('#planList').innerHTML = activos.length ? activos.map(p => {
    const pr = p.desde <= key ? progresoPaso(p, key) : null;
    const racha = Object.keys(p.historial || {}).sort().map(k => p.historial[k] ? '✅' : '❌').join('');
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
  $('#hablarAlAbrir').checked = c.hablarAlAbrir;
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
    return p ? `<li>${ev.ok ? '✅' : '❌'} ${p.texto}<div class="paso-s">${ev.detalle}</div></li>` : '';
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
    if (ok) hablar([{ mood: 'feliz', texto: '¡Eso! Un hábito más en tu cuenta. 🏅' }], { auto: true });
  };
  $('#metaAhorro').onchange = e => {
    const v = Math.round(Number(e.target.value));
    if (!(v >= 1 && v <= 80)) { toast('Poné un número entre 1 y 80'); return renderAjustesAsesor(); }
    setCfg({ metaAhorro: v }); toast('Meta de ahorro: ' + v + '%');
  };
  $('#hablarAlAbrir').onchange = e => setCfg({ hablarAlAbrir: e.target.checked });
}

let ultimaVezOculta = 0;
function saludarSiCorresponde() {
  if (!cfg().hablarAlAbrir) return;
  setTimeout(() => hablar(mensajesAlAbrir()), 700);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') ultimaVezOculta = Date.now();
  else if (ultimaVezOculta && Date.now() - ultimaVezOculta > 10 * 60 * 1000) { checkInformes(); saludarSiCorresponde(); }
});
