-- Ferriol OS — ejecutar en Supabase → SQL Editor (una sola vez por proyecto)
-- Corrige errores 400 al guardar productos o caja: columnas faltantes o índice único en caja.

-- 1) Columnas que la app envía y a veces no existen en tablas creadas a mano
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS costo numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_inicial integer NOT NULL DEFAULT 0;

ALTER TABLE public.caja
  ADD COLUMN IF NOT EXISTS transferencia_pendiente numeric NOT NULL DEFAULT 0;

-- 2) Un solo registro de caja por usuario (evita duplicados y ayuda a ON CONFLICT si usás código viejo)
-- Si falla: en Table Editor revisá si hay más de una fila caja por el mismo user_id y unificá/borrá duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS caja_one_row_per_user ON public.caja (user_id);

-- 3) RLS: el kiosquero debe poder borrar e insertar sus productos (la app hace delete + insert al guardar)
-- Si ya tenés políticas, no dupliques; si falla DELETE o INSERT, revisá esto:
-- DROP POLICY IF EXISTS "products_own_all" ON public.products;
-- CREATE POLICY "products_own_all" ON public.products FOR ALL TO authenticated
--   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- DROP POLICY IF EXISTS "caja_own_all" ON public.caja;
-- CREATE POLICY "caja_own_all" ON public.caja FOR ALL TO authenticated
--   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
