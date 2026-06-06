-- ============================================
-- KHALID BARBER-SHOP — Supabase Schema SQL
-- Coller dans : Supabase > SQL Editor > Run
-- ============================================

-- 1. USERS (barbiers + admin)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'barber')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. SERVICES (tarifs réels du menu)
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  price INTEGER NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  icon TEXT
);

-- 3. RDV
CREATE TABLE rdv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  client_phone TEXT,
  service_id UUID REFERENCES services(id),
  barber_name TEXT NOT NULL,
  date DATE NOT NULL,
  slot TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'done')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. NOTIFICATIONS
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'rdv' CHECK (type IN ('rdv', 'cancel', 'info')),
  target_role TEXT NOT NULL CHECK (target_role IN ('admin', 'barber', 'all')),
  target_user TEXT,
  rdv_id UUID REFERENCES rdv(id),
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- DONNÉES INITIALES
-- ============================================

-- Admin et barbiers (mdp hashé = '1234', admin = 'admin123')
INSERT INTO users (username, password_hash, role) VALUES
  ('admin',   '$2a$10$9vKMoHnamdoiMXe.mUGlJuGT4d4Q4Q2X4Z.5bFHPWPlJyHSZ7JN2y', 'admin'),
  ('Khalid',  '$2a$10$9vKMoHnamdoiMXe.mUGlJuGT4d4Q4Q2X4Z.5bFHPWPlJyHSZ7JN2y', 'barber'),
  ('Youssef', '$2a$10$9vKMoHnamdoiMXe.mUGlJuGT4d4Q4Q2X4Z.5bFHPWPlJyHSZ7JN2y', 'barber'),
  ('Hamza',   '$2a$10$9vKMoHnamdoiMXe.mUGlJuGT4d4Q4Q2X4Z.5bFHPWPlJyHSZ7JN2y', 'barber'),
  ('Amine',   '$2a$10$9vKMoHnamdoiMXe.mUGlJuGT4d4Q4Q2X4Z.5bFHPWPlJyHSZ7JN2y', 'barber');

-- ATTENTION: Régénère les hash avec bcrypt avant déploiement réel !
-- Node.js: const bcrypt = require('bcryptjs'); console.log(await bcrypt.hash('1234', 10));

-- Services (tarifs du menu KHALID)
INSERT INTO services (category, name, name_ar, price, duration_minutes, icon) VALUES
  ('incontournables', 'Coupe & Barbe',       'حلاقة الشعر واللحية',     50, 40, '✂️'),
  ('incontournables', 'Coupe Homme',          'قصة الشعر Standard',      30, 25, '💈'),
  ('incontournables', 'Coupe Dégradée',       'قصة الشعر ديكرادي موس',   40, 30, '💈'),
  ('incontournables', 'Rasage Barbe',         'حلاقة الذقن',             20, 20, '🪒'),
  ('incontournables', 'Contour de Barbe',     'تحديد اللحية',            30, 20, '✂️'),
  ('incontournables', 'Coupe Enfant',         'قصة شعر الأطفال',         30, 20, '👦'),
  ('petits',          'Brushing',             'شوشوار',                  20, 15, '💨'),
  ('petits',          'Shampoing',            'غسل الشعر',               10, 10, '🧴'),
  ('capillaires',     'Soins Nourrissants',   'ترطيبة',                  80, 45, '🧪'),
  ('capillaires',     'Coloration Cheveux',   'صباغة الشعر',             80, 60, '🎨'),
  ('capillaires',     'Coloration Barbe',     'صباغة اللحية',            40, 30, '🎨'),
  ('capillaires',     'Traitement Kératine',  'كيراتين',                300, 90, '💎'),
  ('capillaires',     'Traitement Protéine',  'بروتين',                 300, 90, '💎'),
  ('visage',          'Nettoyage du Visage',  'تنظيف البشرة',            30, 30, '🧼'),
  ('visage',          'Soin Vapeur & Masque', 'تنظيف البشرة بخار + ماسك',60, 45, '♨️'),
  ('visage',          'Épilation à la Cire',  'إزالة الشعر بالشمع',      30, 20, '🕯️');

-- Index pour performances
CREATE INDEX idx_rdv_date ON rdv(date);
CREATE INDEX idx_rdv_barber ON rdv(barber_name);
CREATE INDEX idx_notif_role ON notifications(target_role);
CREATE INDEX idx_notif_read ON notifications(read);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE rdv ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Le backend service_key bypasse RLS automatiquement
-- Les politiques ci-dessous sont pour les appels directs depuis le frontend
CREATE POLICY "clients_insert_rdv" ON rdv FOR INSERT WITH CHECK (true);
CREATE POLICY "service_key_all_rdv" ON rdv USING (true);
CREATE POLICY "service_key_all_notif" ON notifications USING (true);
