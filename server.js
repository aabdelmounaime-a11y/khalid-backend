require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MIDDLEWARE AUTH ───────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

// ── AUTH ─────────────────────────────────────────────────
// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password, role } = req.body;
  // Client : login sans mot de passe
  if (role === 'client') {
    const token = jwt.sign({ username, role: 'client' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { username, role: 'client' } });
  }
  // Barbier / Admin : vérification en base
  const { data: user, error } = await supabase
    .from('users').select('*')
    .eq('username', username).eq('role', role).single();
  if (error || !user) return res.status(401).json({ error: 'Utilisateur non trouvé' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET, { expiresIn: '7d' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// ── SERVICES ─────────────────────────────────────────────
app.get('/api/services', async (req, res) => {
  const { data, error } = await supabase.from('services').select('*').order('category');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── RDV ──────────────────────────────────────────────────
// Créneaux pris pour un barbier/date
app.get('/api/rdv/slots', async (req, res) => {
  const { date, barber } = req.query;
  const { data, error } = await supabase
    .from('rdv').select('slot')
    .eq('date', date).eq('barber_name', barber).eq('status', 'confirmed');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(r => r.slot));
});

// Tous les RDV (admin/barber)
app.get('/api/rdv', auth, async (req, res) => {
  let query = supabase.from('rdv')
    .select('*, services(name, price)').order('date').order('slot');
  if (req.user.role === 'barber') query = query.eq('barber_name', req.user.username);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Créer un RDV
app.post('/api/rdv', async (req, res) => {
  const { client_name, client_phone, service_id, barber_name, date, slot } = req.body;
  if (!client_name || !service_id || !barber_name || !date || !slot)
    return res.status(400).json({ error: 'Champs manquants' });

  // Créneau libre ?
  const { data: existing } = await supabase
    .from('rdv').select('id')
    .eq('date', date).eq('barber_name', barber_name)
    .eq('slot', slot).eq('status', 'confirmed');
  if (existing?.length > 0)
    return res.status(409).json({ error: 'Créneau déjà pris' });

  const { data, error } = await supabase.from('rdv')
    .insert([{ client_name, client_phone, service_id, barber_name, date, slot, status: 'confirmed' }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Notifications admin + barbier
  await supabase.from('notifications').insert([
    { title: `Nouveau RDV — ${barber_name}`, message: `${client_name} — ${slot} le ${date}`, type: 'rdv', target_role: 'admin', rdv_id: data.id },
    { title: 'Nouveau RDV', message: `${client_name} — ${slot} le ${date}`, type: 'rdv', target_role: 'barber', target_user: barber_name, rdv_id: data.id }
  ]);

  res.json({ success: true, rdv: data });
});

// Annuler un RDV
app.patch('/api/rdv/:id/cancel', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('rdv').update({ status: 'cancelled' })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('notifications').insert([{
    title: 'Annulation RDV',
    message: `${data.client_name} a annulé son RDV du ${data.date} à ${data.slot}`,
    type: 'cancel', target_role: 'admin'
  }]);
  res.json({ success: true });
});

// ── NOTIFICATIONS ────────────────────────────────────────
app.get('/api/notifications', auth, async (req, res) => {
  let query = supabase.from('notifications')
    .select('*').order('created_at', { ascending: false }).limit(30);
  if (req.user.role === 'barber')
    query = query.or(`target_role.eq.barber,target_user.eq.${req.user.username}`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/notifications/read-all', auth, async (req, res) => {
  await supabase.from('notifications').update({ read: true }).eq('read', false);
  res.json({ success: true });
});

// ── REVENUS (admin only) ──────────────────────────────────
app.get('/api/revenus', auth, adminOnly, async (req, res) => {
  const { period } = req.query;
  const since = new Date();
  if (period === 'week') since.setDate(since.getDate() - 7);
  else if (period === 'month') since.setMonth(since.getMonth() - 1);
  const { data, error } = await supabase
    .from('rdv').select('date, services(price, name)')
    .gte('date', since.toISOString().split('T')[0]).eq('status', 'confirmed');
  if (error) return res.status(500).json({ error: error.message });
  const total = data.reduce((s, r) => s + (r.services?.price || 0), 0);
  res.json({ total, count: data.length, details: data });
});

// ── BARBERS ───────────────────────────────────────────────
app.get('/api/barbers', async (req, res) => {
  const { data, error } = await supabase
    .from('users').select('id, username, role, is_active')
    .in('role', ['barber', 'admin']);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ KHALID Barbershop API → http://localhost:${PORT}`));
