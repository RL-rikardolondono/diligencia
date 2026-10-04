// DiligencIA – servidor (Render) + base de datos (Neon). SkyNet Genesis.
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cal = require('./calendario');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'cambie-esta-clave';
const SETUP_KEY = process.env.SETUP_KEY || '';
const CRON_KEY = process.env.CRON_KEY || '';
const BREVO_KEY = process.env.BREVO_KEY || '';
const REMITENTE = process.env.REMITENTE || 'contacto@skynetgenesis.com';
const APP_URL = process.env.APP_URL || 'https://diligencia.skynetgenesis.com';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 10000 });
const q = (sql, p) => pool.query(sql, p);

const COLECCIONES = ['clientes', 'procesos', 'terminos', 'agenda', 'tareas', 'cobros', 'pagos', 'gastos', 'plantillas'];
const ESCRIBE = {
  admin: COLECCIONES,
  abogado: ['clientes', 'procesos', 'terminos', 'agenda', 'tareas', 'plantillas'],
  dependiente: ['procesos', 'terminos', 'agenda', 'tareas'],
  contable: ['cobros', 'pagos', 'gastos'],
  cliente: [],
};
const BORRA = { admin: COLECCIONES, abogado: ['agenda', 'tareas', 'plantillas', 'terminos'], dependiente: ['agenda', 'tareas'], contable: ['pagos', 'gastos'], cliente: [] };
const PLANES = { ind: { n: 'Independiente', u: 1 }, ofi: { n: 'Oficina', u: 5 }, fir: { n: 'Firma', u: 15 }, cor: { n: 'Corporativo', u: 9999 } };
const ROLES = ['admin', 'abogado', 'dependiente', 'contable', 'cliente'];

async function migrar() {
  await q(`create table if not exists oficinas(id text primary key, datos jsonb not null default '{}', plan text not null default 'ind', estado text not null default 'activa', pagado_hasta date, creado timestamptz default now())`);
  await q(`create table if not exists usuarios(id text primary key, oficina_id text references oficinas(id) on delete cascade, email text unique not null, hash text not null, rol text not null, nombre text not null, tp text default '', cliente_id text, activo boolean default true, super boolean default false, debe_cambiar boolean default false, creado timestamptz default now())`);
  await q(`create table if not exists registros(oficina_id text not null references oficinas(id) on delete cascade, coleccion text not null, id text not null, datos jsonb not null, actualizado timestamptz default now(), primary key(oficina_id, coleccion, id))`);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const limpio = s => String(s || '').trim();
const err = (res, code, msg) => res.status(code).json({ error: msg });
const pub = u => ({ id: u.id, oficinaId: u.oficina_id, nombre: u.nombre, email: u.email, rol: u.rol, tp: u.tp || '', clienteId: u.cliente_id || null, activo: u.activo, super: u.super, debeCambiar: u.debe_cambiar });

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.u = jwt.verify(t, SECRET); next(); } catch (e) { err(res, 401, 'Su sesión terminó. Vuelva a iniciar sesión.'); }
}
async function usuarioActual(req, res, next) {
  const r = await q('select * from usuarios where id=$1', [req.u.id]);
  const u = r.rows[0];
  if (!u || !u.activo) return err(res, 401, 'Usuario inactivo');
  req.user = u;
  if (u.oficina_id) { const o = await q('select * from oficinas where id=$1', [u.oficina_id]); req.of = o.rows[0]; }
  next();
}
const soloAdmin = (req, res, next) => req.user.rol === 'admin' ? next() : err(res, 403, 'Solo el socio administrador puede hacer esto');
const soloSuper = (req, res, next) => req.user.super ? next() : err(res, 403, 'Solo SkyNet Genesis');
const envolver = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); err(res, 500, 'Error del servidor: ' + e.message); });

// -------- público --------
app.get('/', (req, res) => res.json({ app: 'DiligencIA', ok: true }));
app.get('/api/ping', (req, res) => res.json({ ok: true, hora: new Date().toISOString() })); // no toca la base: Neon puede dormir

app.post('/api/setup', envolver(async (req, res) => {
  const { clave, nombre, email, password } = req.body || {};
  if (!SETUP_KEY || clave !== SETUP_KEY) return err(res, 403, 'Clave de instalación incorrecta');
  const ya = await q('select 1 from usuarios where super=true limit 1');
  if (ya.rowCount) return err(res, 409, 'El administrador de SkyNet Genesis ya existe');
  if (!email || !password || password.length < 8) return err(res, 400, 'Correo y contraseña de al menos 8 caracteres');
  const id = uid();
  await q('insert into usuarios(id,email,hash,rol,nombre,super) values($1,$2,$3,$4,$5,true)', [id, limpio(email).toLowerCase(), await bcrypt.hash(password, 10), 'admin', limpio(nombre) || 'SkyNet Genesis']);
  res.json({ ok: true });
}));

app.post('/api/login', envolver(async (req, res) => {
  const email = limpio(req.body.email).toLowerCase();
  const r = await q('select * from usuarios where email=$1', [email]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.hash))) return err(res, 401, 'Correo o contraseña incorrectos');
  if (!u.activo) return err(res, 403, 'Su usuario está inactivo. Consulte al administrador de su oficina.');
  const token = jwt.sign({ id: u.id }, SECRET, { expiresIn: '12h' });
  res.json({ token, usuario: pub(u) });
}));

// -------- datos de la oficina --------
app.get('/api/datos', auth, usuarioActual, envolver(async (req, res) => {
  const u = req.user;
  if (!u.oficina_id) return res.json({ usuario: pub(u), oficina: null });
  const of = req.of;
  const regs = await q('select coleccion, datos from registros where oficina_id=$1', [of.id]);
  const db = {}; COLECCIONES.forEach(c => db[c] = []);
  regs.rows.forEach(r => { if (db[r.coleccion]) db[r.coleccion].push(r.datos); });
  const us = await q('select * from usuarios where oficina_id=$1 order by creado', [of.id]);
  db.users = us.rows.map(pub);
  if (u.rol === 'cliente') { // el portal solo ve lo propio
    const cid = u.cliente_id;
    db.procesos = db.procesos.filter(p => p.clienteId === cid).map(p => ({ ...p, honorarios: undefined, actuaciones: (p.actuaciones || []).filter(a => a.pub) }));
    const ps = db.procesos.map(p => p.id);
    db.clientes = db.clientes.filter(c => c.id === cid);
    db.cobros = db.cobros.filter(b => b.clienteId === cid);
    const bs = db.cobros.map(b => b.id);
    db.pagos = db.pagos.filter(p => bs.includes(p.cobroId));
    db.agenda = db.agenda.filter(a => ps.includes(a.procesoId) && a.tipo !== 'Reunión');
    db.terminos = []; db.tareas = []; db.gastos = db.gastos.filter(g => ps.includes(g.procesoId)); db.plantillas = [];
    db.users = db.users.filter(x => ['admin', 'abogado'].includes(x.rol)).map(x => ({ id: x.id, nombre: x.nombre, rol: x.rol, email: x.email, tp: x.tp, activo: x.activo }));
  }
  res.json({ usuario: pub(u), oficina: { id: of.id, ...of.datos, plan: of.plan, estado: of.estado, pagadoHasta: of.pagado_hasta }, db });
}));

app.post('/api/sync', auth, usuarioActual, envolver(async (req, res) => {
  const u = req.user, of = req.of;
  if (!of) return err(res, 400, 'Sin oficina');
  if (of.estado !== 'activa') return err(res, 402, 'La oficina está en modo solo consulta por mensualidad pendiente. Comuníquese con SkyNet Genesis.');
  const { cambios = [], borrar = [] } = req.body || {};
  for (const c of cambios) if (!(ESCRIBE[u.rol] || []).includes(c.col)) return err(res, 403, 'Su perfil no puede modificar ' + c.col);
  for (const b of borrar) if (!(BORRA[u.rol] || []).includes(b.col)) return err(res, 403, 'Su perfil no puede eliminar en ' + b.col);
  const cl = await pool.connect();
  try {
    await cl.query('begin');
    for (const c of cambios) {
      if (!c.id || !c.datos) continue;
      const datos = { ...c.datos, id: c.id, oficinaId: of.id };
      await cl.query(`insert into registros(oficina_id,coleccion,id,datos,actualizado) values($1,$2,$3,$4,now()) on conflict(oficina_id,coleccion,id) do update set datos=excluded.datos, actualizado=now()`, [of.id, c.col, String(c.id), datos]);
    }
    for (const b of borrar) await cl.query('delete from registros where oficina_id=$1 and coleccion=$2 and id=$3', [of.id, b.col, String(b.id)]);
    await cl.query('commit');
  } catch (e) { await cl.query('rollback'); throw e; } finally { cl.release(); }
  res.json({ ok: true, guardados: cambios.length, borrados: borrar.length });
}));

app.put('/api/oficina', auth, usuarioActual, soloAdmin, envolver(async (req, res) => {
  const of = req.of; if (!of) return err(res, 400, 'Sin oficina');
  const b = req.body || {};
  const datos = { ...of.datos };
  ['nombre', 'nit', 'ciudad', 'direccion', 'tel', 'email', 'logo'].forEach(k => { if (k in b) datos[k] = b[k]; });
  if (b.config) datos.config = { vacancia: !!b.config.vacancia, semanaSanta: !!b.config.semanaSanta, cierres: Array.isArray(b.config.cierres) ? b.config.cierres.slice(0, 200) : [] };
  if (datos.logo && datos.logo.length > 900000) return err(res, 400, 'El logo es demasiado pesado');
  await q('update oficinas set datos=$2 where id=$1', [of.id, datos]);
  res.json({ ok: true });
}));

// -------- usuarios --------
async function verificarCupo(of, rol, excluirId) {
  if (!['admin', 'abogado'].includes(rol)) return null;
  const r = await q(`select count(*)::int n from usuarios where oficina_id=$1 and activo and rol in ('admin','abogado') and id<>$2`, [of.id, excluirId || '']);
  const plan = PLANES[of.plan] || PLANES.ind;
  return r.rows[0].n >= plan.u ? 'El plan ' + plan.n + ' permite ' + plan.u + ' abogado(s) activo(s). Para ampliarlo comuníquese con SkyNet Genesis.' : null;
}
app.post('/api/usuarios', auth, usuarioActual, soloAdmin, envolver(async (req, res) => {
  const of = req.of; const b = req.body || {};
  const email = limpio(b.email).toLowerCase(); const rol = ROLES.includes(b.rol) ? b.rol : 'abogado';
  if (!email || !limpio(b.nombre)) return err(res, 400, 'Nombre y correo son obligatorios');
  if (!b.password || String(b.password).length < 8) return err(res, 400, 'La contraseña inicial debe tener al menos 8 caracteres');
  if (rol === 'cliente' && !b.clienteId) return err(res, 400, 'Falta el cliente del portal');
  const cupo = await verificarCupo(of, rol); if (cupo) return err(res, 400, cupo);
  const ex = await q('select 1 from usuarios where email=$1', [email]); if (ex.rowCount) return err(res, 409, 'Ya existe un usuario con ese correo');
  const id = uid();
  await q('insert into usuarios(id,oficina_id,email,hash,rol,nombre,tp,cliente_id,debe_cambiar) values($1,$2,$3,$4,$5,$6,$7,$8,true)', [id, of.id, email, await bcrypt.hash(String(b.password), 10), rol, limpio(b.nombre), limpio(b.tp), b.clienteId || null]);
  const r = await q('select * from usuarios where id=$1', [id]);
  res.json({ ok: true, usuario: pub(r.rows[0]) });
}));
app.put('/api/usuarios/:id', auth, usuarioActual, soloAdmin, envolver(async (req, res) => {
  const of = req.of; const b = req.body || {};
  const r = await q('select * from usuarios where id=$1 and oficina_id=$2', [req.params.id, of.id]); const u = r.rows[0];
  if (!u) return err(res, 404, 'Usuario no encontrado');
  const rol = ROLES.includes(b.rol) ? b.rol : u.rol; const activo = 'activo' in b ? !!b.activo : u.activo;
  if (u.id === req.user.id && (!activo || rol !== 'admin')) return err(res, 400, 'No puede desactivarse ni quitarse el perfil de administrador a sí mismo');
  if (activo) { const cupo = await verificarCupo(of, rol, u.id); if (cupo) return err(res, 400, cupo); }
  const email = b.email ? limpio(b.email).toLowerCase() : u.email;
  if (email !== u.email) { const ex = await q('select 1 from usuarios where email=$1', [email]); if (ex.rowCount) return err(res, 409, 'Ya existe un usuario con ese correo'); }
  await q('update usuarios set nombre=$2, email=$3, rol=$4, tp=$5, activo=$6 where id=$1', [u.id, limpio(b.nombre) || u.nombre, email, rol, 'tp' in b ? limpio(b.tp) : u.tp, activo]);
  if (b.password) { if (String(b.password).length < 8) return err(res, 400, 'La contraseña debe tener al menos 8 caracteres'); await q('update usuarios set hash=$2, debe_cambiar=true where id=$1', [u.id, await bcrypt.hash(String(b.password), 10)]); }
  const n = await q('select * from usuarios where id=$1', [u.id]);
  res.json({ ok: true, usuario: pub(n.rows[0]) });
}));
app.post('/api/cuenta/clave', auth, usuarioActual, envolver(async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!(await bcrypt.compare(String(actual || ''), req.user.hash))) return err(res, 400, 'La contraseña actual no es correcta');
  if (!nueva || String(nueva).length < 8) return err(res, 400, 'La nueva contraseña debe tener al menos 8 caracteres');
  await q('update usuarios set hash=$2, debe_cambiar=false where id=$1', [req.user.id, await bcrypt.hash(String(nueva), 10)]);
  res.json({ ok: true });
}));

// -------- panel SkyNet Genesis --------
app.get('/api/super/oficinas', auth, usuarioActual, soloSuper, envolver(async (req, res) => {
  const r = await q(`select o.*, (select count(*)::int from usuarios u where u.oficina_id=o.id and u.activo and u.rol in ('admin','abogado')) abogados,
    (select count(*)::int from registros g where g.oficina_id=o.id and g.coleccion='procesos') procesos,
    (select string_agg(email, ', ') from usuarios u where u.oficina_id=o.id and u.rol='admin') admins from oficinas o order by o.creado desc`);
  res.json(r.rows.map(o => ({ id: o.id, nombre: o.datos.nombre, ciudad: o.datos.ciudad, plan: o.plan, estado: o.estado, pagadoHasta: o.pagado_hasta, abogados: o.abogados, procesos: o.procesos, admins: o.admins, creado: o.creado })));
}));
app.post('/api/super/oficinas', auth, usuarioActual, soloSuper, envolver(async (req, res) => {
  const b = req.body || {}; const a = b.admin || {};
  if (!limpio(b.nombre) || !limpio(a.email) || !a.password || String(a.password).length < 8) return err(res, 400, 'Nombre de la oficina, correo del administrador y contraseña (8+ caracteres) son obligatorios');
  const email = limpio(a.email).toLowerCase();
  const ex = await q('select 1 from usuarios where email=$1', [email]); if (ex.rowCount) return err(res, 409, 'Ese correo ya tiene usuario');
  const id = uid();
  const datos = { nombre: limpio(b.nombre), nit: limpio(b.nit), ciudad: limpio(b.ciudad), direccion: limpio(b.direccion), tel: limpio(b.tel), email: limpio(b.email) || email, logo: '', config: { vacancia: true, semanaSanta: true, cierres: [] } };
  await q('insert into oficinas(id,datos,plan,estado,pagado_hasta) values($1,$2,$3,$4,$5)', [id, datos, PLANES[b.plan] ? b.plan : 'ind', 'activa', b.pagadoHasta || null]);
  await q('insert into usuarios(id,oficina_id,email,hash,rol,nombre,tp,debe_cambiar) values($1,$2,$3,$4,$5,$6,$7,true)', [uid(), id, email, await bcrypt.hash(String(a.password), 10), 'admin', limpio(a.nombre) || datos.nombre, limpio(a.tp)]);
  res.json({ ok: true, id });
}));
app.put('/api/super/oficinas/:id', auth, usuarioActual, soloSuper, envolver(async (req, res) => {
  const b = req.body || {};
  const r = await q('select * from oficinas where id=$1', [req.params.id]); if (!r.rowCount) return err(res, 404, 'No existe');
  const o = r.rows[0];
  await q('update oficinas set plan=$2, estado=$3, pagado_hasta=$4 where id=$1', [o.id, PLANES[b.plan] ? b.plan : o.plan, ['activa', 'solo_consulta'].includes(b.estado) ? b.estado : o.estado, b.pagadoHasta || o.pagado_hasta]);
  res.json({ ok: true });
}));

// -------- resumen diario por correo (cron-job.org, 1 vez al día) --------
async function enviarCorreo(para, asunto, html) {
  if (!BREVO_KEY) return false;
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ sender: { name: 'DiligencIA', email: REMITENTE }, to: para.map(e => ({ email: e })), subject: asunto, htmlContent: html }) });
  return r.ok;
}
app.get('/api/cron/resumen', envolver(async (req, res) => {
  if (!CRON_KEY || req.query.clave !== CRON_KEY) return err(res, 403, 'Clave incorrecta');
  const hoy = cal.HOY(); const resultado = [];
  const ofs = await q(`select * from oficinas where estado='activa'`);
  for (const of of ofs.rows) {
    const opt0 = of.datos.config || { vacancia: true, semanaSanta: true, cierres: [] };
    if (cal.motivoInhabil(hoy, { ...opt0, vacancia: false, semanaSanta: false })) { resultado.push({ oficina: of.datos.nombre, omitido: 'día no laboral' }); continue; }
    const regs = await q(`select coleccion, datos from registros where oficina_id=$1 and coleccion in ('terminos','agenda','tareas','procesos')`, [of.id]);
    const D = { terminos: [], agenda: [], tareas: [], procesos: [] }; regs.rows.forEach(r => D[r.coleccion].push(r.datos));
    const us = (await q(`select * from usuarios where oficina_id=$1 and activo and rol in ('admin','abogado','dependiente')`, [of.id])).rows;
    const proc = id => D.procesos.find(p => p.id === id) || {};
    const opt = p => ({ vacancia: opt0.vacancia && !p.sinVacancia, semanaSanta: opt0.semanaSanta && !p.sinVacancia, cierres: opt0.cierres || [] });
    const items = [];
    D.terminos.filter(t => t.estado !== 'Cumplido').forEach(t => { const p = proc(t.procesoId); const h = cal.habilesEntre(hoy, t.venc, opt(p)); if (t.venc < hoy || h <= 3) items.push({ u: [t.responsableId, p.abogadoId], txt: (t.venc < hoy ? '⛔ VENCIDO' : h === 0 ? '🔴 Vence HOY' : '🟠 Vence en ' + h + ' día(s) hábil(es)') + ' – ' + t.nombre + ' (' + t.norma + ') · ' + (p.alias || p.clase || '') + ' · ' + cal.fCorta(t.venc) }); });
    D.agenda.filter(a => a.fecha >= hoy && a.fecha <= cal.addD(hoy, 2)).forEach(a => items.push({ u: [a.userId, proc(a.procesoId).abogadoId], txt: '📅 ' + a.tipo + ' ' + cal.fDia(a.fecha) + ' ' + a.hora + ' – ' + a.titulo + ' · ' + (a.lugar || '') }));
    D.tareas.filter(k => !k.hecha && k.fecha <= hoy).forEach(k => items.push({ u: [k.userId], txt: (k.fecha < hoy ? '⚠️ Tarea atrasada: ' : '✅ Tarea para hoy: ') + k.titulo }));
    let enviados = 0;
    for (const u of us) {
      const mios = u.rol === 'admin' ? items : items.filter(i => i.u.includes(u.id));
      if (!mios.length) continue;
      const html = '<div style="font-family:Arial,sans-serif;color:#15232B"><div style="background:#1E3A4C;color:#fff;padding:14px 18px;font-size:18px"><b>DiligencIA</b> · ' + of.datos.nombre + '</div><p>Hola, ' + u.nombre.split(' ')[0] + '. Estos son sus pendientes de hoy, ' + cal.fLarga(hoy) + ':</p><ul>' + mios.map(i => '<li style="margin-bottom:6px">' + i.txt + '</li>').join('') + '</ul><p><a href="' + APP_URL + '" style="background:#E0A21A;color:#15232B;padding:8px 14px;text-decoration:none;border-radius:6px;font-weight:bold">Abrir DiligencIA</a></p><p style="font-size:11px;color:#5B6B72">SkyNet Genesis · contacto@skynetgenesis.com · WhatsApp 304 437 5758</p></div>';
      if (await enviarCorreo([u.email], 'DiligencIA: ' + mios.length + ' pendiente(s) para hoy', html)) enviados++;
    }
    resultado.push({ oficina: of.datos.nombre, alertas: items.length, correos: enviados });
  }
  res.json({ ok: true, hoy, brevo: !!BREVO_KEY, resultado });
}));

migrar().then(() => app.listen(PORT, () => console.log('DiligencIA API en puerto ' + PORT))).catch(e => { console.error('No se pudo preparar la base de datos', e); process.exit(1); });
