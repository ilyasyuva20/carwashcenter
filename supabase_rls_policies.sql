-- ============================================================
-- Supabase Row Level Security (RLS) Policies for Car Wash App
-- ============================================================

-- 1. Enable RLS on all main tables
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE wash_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- 2. Public Read Policies (Allow anyone/anon to read public pricing & services)
CREATE POLICY "Public Read Wash Types" ON wash_types FOR SELECT USING (true);
CREATE POLICY "Public Read Pricing" ON pricing FOR SELECT USING (true);
CREATE POLICY "Public Read Workshops" ON workshops FOR SELECT USING (true);
CREATE POLICY "Public Read Workshop Pricing" ON workshop_pricing FOR SELECT USING (true);
CREATE POLICY "Public Read Vehicles" ON vehicles FOR SELECT USING (true);

-- 3. Authenticated-Only Write Policies (INSERT/UPDATE/DELETE require auth)
CREATE POLICY "Authenticated Insert Vehicles" ON vehicles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Update Vehicles" ON vehicles FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Delete Vehicles" ON vehicles FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated Read Jobs" ON jobs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Insert Jobs" ON jobs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Update Jobs" ON jobs FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Delete Jobs" ON jobs FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated Read Customers" ON customers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Insert Customers" ON customers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Update Customers" ON customers FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated Read Bills" ON bills FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Insert Bills" ON bills FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Update Bills" ON bills FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated Read Expenses" ON expenses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Insert Expenses" ON expenses FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated Update Expenses" ON expenses FOR UPDATE USING (auth.role() = 'authenticated');
