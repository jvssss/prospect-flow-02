
-- Unify data access: any authenticated user can see and manage all shared records
DROP POLICY IF EXISTS "Owner all leads" ON public.leads;
DROP POLICY IF EXISTS "Owner all call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Owner all metrics" ON public.daily_metrics;
DROP POLICY IF EXISTS "Owner all jobs" ON public.enrichment_jobs;
DROP POLICY IF EXISTS "Owner all goals" ON public.goals_math;

CREATE POLICY "Shared all leads" ON public.leads FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Shared all call_logs" ON public.call_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Shared all daily_metrics" ON public.daily_metrics FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Shared all enrichment_jobs" ON public.enrichment_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Shared all goals_math" ON public.goals_math FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Profiles also visible to all authenticated (so nomes aparecem em qualquer sessão)
CREATE POLICY "All authenticated read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
