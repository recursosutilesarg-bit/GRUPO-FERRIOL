    // Iconos Lucide: no llamar createIcons() acá — si el CDN falla, el script entero dejaría de cargar y el login no funcionaría.

    // ——— Supabase: pegá tu Project URL y anon key acá ———
    // Si el panel Super no muestra usuarios: ejecutá supabase_rls_super_profiles.sql en SQL Editor.
    // Si ves 400 en products o caja: ejecutá supabase-fix-products-caja.sql en SQL Editor (columnas + índice único en caja).
    // Si usás "Transferir pendiente", agregá en caja: ALTER TABLE caja ADD COLUMN IF NOT EXISTS transferencia_pendiente numeric DEFAULT 0;
    // Para historial de ventas y clientes, creá en Supabase (SQL Editor) estas tablas:
    // CREATE TABLE ventas ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, fecha_hora timestamptz NOT NULL DEFAULT now(), total numeric NOT NULL DEFAULT 0, metodo_pago text, cliente_nombre text, items jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now() );
    // ALTER TABLE ventas ENABLE ROW LEVEL SECURITY; CREATE POLICY "ventas_policy" ON ventas FOR ALL USING (auth.uid() = user_id);
    // CREATE TABLE clientes ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, nombre text, telefono text, email text, direccion text, notas text, created_at timestamptz DEFAULT now() );
    // ALTER TABLE clientes ENABLE ROW LEVEL SECURITY; CREATE POLICY "clientes_policy" ON clientes FOR ALL USING (auth.uid() = user_id);
    // Saldos a cobrar (fiado / transf. pendiente) — para no perder datos al cambiar de dispositivo:
    // CREATE TABLE saldos_acobrar ( id text NOT NULL, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, client_name text, whatsapp text, items jsonb DEFAULT '[]'::jsonb, total numeric DEFAULT 0, method text, paid boolean DEFAULT false, created_at timestamptz DEFAULT now(), PRIMARY KEY (user_id, id) );
    // ALTER TABLE saldos_acobrar ENABLE ROW LEVEL SECURITY; CREATE POLICY "saldos_acobrar_policy" ON saldos_acobrar FOR ALL USING (auth.uid() = user_id);
    // Notificaciones del admin a los kiosqueros:
    // CREATE TABLE notifications ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), message text NOT NULL );
    // ALTER TABLE notifications ENABLE ROW LEVEL SECURITY; CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated USING (true); CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
    // Historial de cierres de caja (facturación y ganancia por día):
    // CREATE TABLE cierres_caja ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, fecha date NOT NULL, fecha_cierre timestamptz NOT NULL DEFAULT now(), total_facturado numeric NOT NULL DEFAULT 0, ganancia numeric NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now() );
    // ALTER TABLE cierres_caja ENABLE ROW LEVEL SECURITY; CREATE POLICY "cierres_caja_policy" ON cierres_caja FOR ALL USING (auth.uid() = user_id);
    // Para que el admin pueda EXPORTAR e IMPORTAR copia de todos los usuarios, agregá estas políticas (super puede leer, insertar y borrar):
    // SELECT (exportar):
    //   CREATE POLICY "super_select_products" ON products FOR SELECT USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    //   CREATE POLICY "super_select_clientes" ON clientes FOR SELECT USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    //   CREATE POLICY "super_select_saldos" ON saldos_acobrar FOR SELECT USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    // INSERT y DELETE (importar/restaurar):
    //   CREATE POLICY "super_all_products" ON products FOR ALL USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    //   CREATE POLICY "super_all_clientes" ON clientes FOR ALL USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    //   CREATE POLICY "super_all_saldos" ON saldos_acobrar FOR ALL USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    // (Si ya tenés "super_select_*", podés agregar solo las de ALL para no duplicar.)
    var _cfg = window.FERRIOL_CONFIG || {};
    const SUPABASE_URL = _cfg.SUPABASE_URL || '';
    const SUPABASE_ANON_KEY = _cfg.SUPABASE_ANON_KEY || '';
    const APP_URL = _cfg.APP_URL || '';
    const supabaseClient = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && typeof window.supabase.createClient === 'function')
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

    const DEFAULT_WHATSAPP = 'Hola {cliente}, te recordamos que tenés un saldo de ${monto} en nuestro kiosco. ¡Gracias!';

    function escapeCSV(str) {
      if (str == null) return '';
      var s = String(str);
      if (/[;,"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function stringToLatin1Bytes(str) {
      if (typeof str !== 'string') str = String(str);
      var map = { '\u00E1': 225, '\u00E9': 233, '\u00ED': 237, '\u00F3': 243, '\u00FA': 250, '\u00F1': 241, '\u00D1': 209, '\u00C1': 193, '\u00C9': 201, '\u00CD': 205, '\u00D3': 211, '\u00DA': 218, '\u00FC': 252, '\u00F6': 246 };
      var out = [], s = str.normalize('NFC');
      for (var i = 0; i < s.length; i++) {
        var c = s[i], code = c.charCodeAt(0);
        if (code <= 255) out.push(code);
        else if (map[c] !== undefined) out.push(map[c]);
        else out.push(0x3F);
      }
      return new Uint8Array(out);
    }
    function downloadCSV(filename, csvContent) {
      if (typeof csvContent !== 'string') csvContent = String(csvContent);
      var normalized = csvContent.normalize('NFC');
      var enc = stringToLatin1Bytes(normalized);
      var blob = new Blob([enc], { type: 'text/csv;charset=iso-8859-1' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    function exportDeudoresCSV() {
      var list = _dataCache.saldosACobrar || [];
      var header = 'Cliente;Estado;Fecha;Método;Total;WhatsApp;Productos';
      var rows = list.map(function (s) {
        var estado = s.paid ? 'Cobrado' : 'Pendiente';
        var fecha = (s.createdAt ? new Date(s.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
        var productos = (s.items || []).map(function (i) { return (i.nombre || '') + ' x' + (i.cant || 0) + ' $' + (i.precio || 0); }).join(' | ');
        return escapeCSV(s.clientName || '') + ';' + escapeCSV(estado) + ';' + escapeCSV(fecha) + ';' + escapeCSV(s.method === 'fiado' ? 'Fiado' : 'Transf. pendiente') + ';' + (s.total || 0) + ';' + escapeCSV(s.whatsapp || '') + ';' + escapeCSV(productos);
      });
      var csv = header + '\r\n' + rows.join('\r\n');
      downloadCSV('historial_deudores_' + new Date().toISOString().slice(0, 10) + '.csv', csv);
    }
    function exportProductosCSV() {
      var prods = getData().products || {};
      var header = 'Código;Nombre;Precio;Costo;Ganancia unitaria;Stock';
      var rows = Object.entries(prods).map(function (_ref) {
        var codigo = _ref[0];
        var p = _ref[1];
        var precio = Number(p.precio) || 0;
        var costo = Number(p.costo) || 0;
        var ganancia = precio - costo;
        return escapeCSV(codigo) + ';' + escapeCSV(p.nombre || '') + ';' + precio + ';' + costo + ';' + ganancia + ';' + (p.stock != null ? p.stock : '');
      });
      var csv = header + '\r\n' + rows.join('\r\n');
      downloadCSV('productos_precios_ganancias_' + new Date().toISOString().slice(0, 10) + '.csv', csv);
    }
    async function exportClientesCSV() {
      if (!supabaseClient || !currentUser?.id) {
        alert('Configurá Supabase para exportar clientes.');
        return;
      }
      var list = await loadClientes();
      var header = 'Nombre;Teléfono;Email;Dirección;Notas';
      var rows = (list || []).map(function (c) {
        return escapeCSV(c.nombre || '') + ';' + escapeCSV(c.telefono || '') + ';' + escapeCSV(c.email || '') + ';' + escapeCSV(c.direccion || '') + ';' + escapeCSV(c.notas || '');
      });
      var csv = header + '\r\n' + rows.join('\r\n');
      downloadCSV('clientes_' + new Date().toISOString().slice(0, 10) + '.csv', csv);
    }
    async function exportVentasCSV() {
      if (!supabaseClient || !currentUser?.id) {
        alert('Configurá Supabase para exportar el historial de ventas.');
        return;
      }
      var end = new Date();
      var start = new Date(end);
      start.setMonth(start.getMonth() - 2);
      start.setHours(0, 0, 0, 0);
      var rangeStart = start.toISOString();
      var rangeEnd = end.toISOString();
      var methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente' };
      var _r = await supabaseClient.from('ventas').select('id, fecha_hora, total, metodo_pago, cliente_nombre, items').eq('user_id', currentUser.id).gte('fecha_hora', rangeStart).lte('fecha_hora', rangeEnd).order('fecha_hora', { ascending: false });
      var list = _r.data || [];
      if (_r.error) {
        alert('No se pudo cargar el historial. Revisá la tabla ventas en Supabase.');
        return;
      }
      var header = 'Fecha y hora;Cliente;Método de pago;Total;Productos';
      var rows = list.map(function (v) {
        var fecha = v.fecha_hora ? new Date(v.fecha_hora).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
        var productos = (v.items || []).map(function (i) { return (i.nombre || '') + ' x' + (i.cant || 0) + ' $' + ((i.precio || 0) * (i.cant || 0)); }).join(' | ');
        return escapeCSV(fecha) + ';' + escapeCSV(v.cliente_nombre || '') + ';' + escapeCSV(methodLabels[v.metodo_pago] || v.metodo_pago) + ';' + (v.total || 0) + ';' + escapeCSV(productos);
      });
      var csv = header + '\r\n' + rows.join('\r\n');
      downloadCSV('historial_ventas_' + new Date().toISOString().slice(0, 10) + '.csv', csv);
    }

    let currentUser = null;
    let _dataCache = { products: {}, ventas: { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 }, transacciones: 0, deudores: [], saldosACobrar: [], lastCierreDate: null };

    const STORAGE_KEY_PREFIX = 'ferriol_data_';
    const COBRO_RAPIDO_PRODUCTOS_KEY = 'ferriol_cobro_rapido_productos';
    const LAST_QUICK_PAYMENT_KEY = 'ferriol_last_quick_payment';
    function getCobroRapidoProductosList() {
      try {
        var raw = localStorage.getItem(COBRO_RAPIDO_PRODUCTOS_KEY);
        if (raw) {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length >= 4) {
            return arr.slice(0, 4).map(function (x) {
              return typeof x === 'object' && x !== null ? { nombre: x.nombre || 'Producto', margen: Number(x.margen) || 0 } : { nombre: String(x || 'Producto'), margen: 0 };
            });
          }
        }
      } catch (_) {}
      return [{ nombre: 'Producto 1', margen: 0 }, { nombre: 'Producto 2', margen: 0 }, { nombre: 'Producto 3', margen: 0 }, { nombre: 'Producto 4', margen: 0 }];
    }
    function setCobroRapidoProductosList(arr) {
      try {
        var list = (arr || []).slice(0, 4).map(function (x) {
          return typeof x === 'object' && x !== null ? { nombre: String(x.nombre || ''), margen: Number(x.margen) || 0 } : { nombre: String(x || ''), margen: 0 };
        });
        localStorage.setItem(COBRO_RAPIDO_PRODUCTOS_KEY, JSON.stringify(list));
      } catch (_) {}
    }
    function getStorageKey() { return currentUser?.id ? STORAGE_KEY_PREFIX + currentUser.id : null; }
    function loadFromLocalStorage() {
      const key = getStorageKey();
      if (!key) return null;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && data.products) return data;
      } catch (e) { console.warn('Ferriol localStorage load:', e); }
      return null;
    }
    function saveToLocalStorage() {
      const key = getStorageKey();
      if (!key || !currentUser?.id) return;
      try {
        localStorage.setItem(key, JSON.stringify({
          products: _dataCache.products || {},
          ventas: _dataCache.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 },
          transacciones: _dataCache.transacciones || 0,
          deudores: _dataCache.deudores || [],
          saldosACobrar: _dataCache.saldosACobrar || [],
          lastCierreDate: _dataCache.lastCierreDate || null,
          transaccionesList: (typeof state !== 'undefined' && state.transaccionesList) ? state.transaccionesList : []
        }));
      } catch (e) { console.warn('Ferriol localStorage save:', e); }
    }

    async function loadDataFromSupabase() {
      const uid = currentUser?.id;
      if (!uid) return;
      if (supabaseClient) {
        try {
          var prevLocal = loadFromLocalStorage();
          const [prodsRes, cajaRes] = await Promise.all([
            supabaseClient.from('products').select('*').eq('user_id', uid),
            supabaseClient.from('caja').select('*').eq('user_id', uid).maybeSingle()
          ]);
          var saldosList = [];
          try {
            var saldosRes = await supabaseClient.from('saldos_acobrar').select('*').eq('user_id', uid).order('created_at', { ascending: false });
            if (saldosRes.data && Array.isArray(saldosRes.data)) {
              saldosList = saldosRes.data.map(s => ({
                id: s.id,
                clientName: s.client_name || '',
                whatsapp: s.whatsapp || '',
                items: s.items || [],
                total: Number(s.total) || 0,
                method: s.method || 'fiado',
                paid: !!s.paid,
                createdAt: s.created_at || null
              }));
            }
          } catch (_) {}
          if (saldosList.length === 0 && prevLocal && prevLocal.saldosACobrar && prevLocal.saldosACobrar.length > 0) saldosList = prevLocal.saldosACobrar;
          const products = {};
          (prodsRes.data || []).forEach(p => {
            products[p.codigo] = { nombre: p.nombre, codigo: p.codigo, precio: p.precio, stock: p.stock, stockInicial: p.stock_inicial || p.stock, costo: p.costo != null ? Number(p.costo) : 0 };
          });
          const caja = cajaRes.data;
          var productsFinal = products;
          if (Object.keys(productsFinal).length === 0 && prevLocal && prevLocal.products && Object.keys(prevLocal.products).length > 0) {
            productsFinal = prevLocal.products;
          }
          _dataCache = {
            products: productsFinal,
            ventas: caja ? { efectivo: Number(caja.efectivo), tarjeta: Number(caja.tarjeta), transferencia: Number(caja.transferencia), fiado: Number(caja.fiado), transferencia_pendiente: Number(caja.transferencia_pendiente || 0) } : { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 },
            transacciones: caja ? (caja.transacciones || 0) : 0,
            deudores: _dataCache.deudores || [],
            saldosACobrar: saldosList,
            lastCierreDate: (prevLocal && prevLocal.lastCierreDate) ? prevLocal.lastCierreDate : (_dataCache.lastCierreDate || null)
          };
          restoreTodayFromLocalStorage();
          saveToLocalStorage();
          return;
        } catch (e) { console.warn('Supabase load failed, using localStorage:', e); }
      }
      var local = loadFromLocalStorage();
      if (local) {
        _dataCache.products = local.products || {};
        _dataCache.ventas = local.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 };
        _dataCache.transacciones = local.transacciones || 0;
        _dataCache.deudores = local.deudores || [];
        _dataCache.saldosACobrar = local.saldosACobrar || [];
        _dataCache.lastCierreDate = local.lastCierreDate || null;
        var today = new Date().toISOString().slice(0, 10);
        if (local.transaccionesList && Array.isArray(local.transaccionesList) && local.lastCierreDate === today && state) state.transaccionesList = local.transaccionesList;
      } else {
        restoreTodayFromLocalStorage();
      }
    }

    function restoreTodayFromLocalStorage() {
      var local = loadFromLocalStorage();
      if (!local) return;
      var today = new Date().toISOString().slice(0, 10);
      if (local.lastCierreDate !== today) return;
      if (local.ventas && typeof local.ventas === 'object') _dataCache.ventas = local.ventas;
      if (local.transacciones !== undefined) _dataCache.transacciones = local.transacciones;
      if (state && local.transaccionesList && Array.isArray(local.transaccionesList)) state.transaccionesList = local.transaccionesList;
    }

    async function saveDataToSupabase(updates) {
      const uid = currentUser?.id;
      if (!uid) return;
      saveToLocalStorage();
      if (!supabaseClient) return;
      try {
        if (updates.products !== undefined) {
          var delP = await supabaseClient.from('products').delete().eq('user_id', uid);
          if (delP.error) console.warn('products (delete):', delP.error.message || delP.error, delP.error.details || '', delP.error.hint || '');
          const rows = Object.entries(updates.products)
            .map(function (ref) {
              var codigo = String(ref[0] || '').trim();
              var p = ref[1];
              if (!codigo) return null;
              return {
                user_id: uid,
                codigo: codigo.slice(0, 200),
                nombre: String((p && p.nombre) != null ? p.nombre : '').trim() || codigo.slice(0, 80),
                precio: Number(p.precio) || 0,
                stock: Math.max(0, parseInt(p.stock, 10) || 0),
                stock_inicial: Math.max(0, parseInt(p.stockInicial != null ? p.stockInicial : p.stock, 10) || 0),
                costo: (function () { var c = Number(p.costo); return Number.isFinite(c) ? c : 0; })()
              };
            })
            .filter(Boolean);
          if (rows.length) {
            var insP = await supabaseClient.from('products').insert(rows);
            if (insP.error) {
              console.warn('products (insert 400):', insP.error.message, insP.error.details || '', insP.error.hint || '', '— En Supabase ejecutá el archivo supabase-fix-products-caja.sql (columnas costo, stock_inicial) y revisá políticas RLS para DELETE/INSERT en products.');
            }
          }
        }
        if (updates.ventas !== undefined || updates.transacciones !== undefined) {
          const v = updates.ventas || _dataCache.ventas;
          const t = updates.transacciones !== undefined ? updates.transacciones : _dataCache.transacciones;
          const cajaRow = {
            user_id: uid,
            efectivo: Number(v.efectivo) || 0,
            tarjeta: Number(v.tarjeta) || 0,
            transferencia: Number(v.transferencia) || 0,
            fiado: Number(v.fiado) || 0,
            transferencia_pendiente: Number(v.transferencia_pendiente) || 0,
            transacciones: Number(t) || 0
          };
          var cajaEx = await supabaseClient.from('caja').select('user_id').eq('user_id', uid).maybeSingle();
          if (cajaEx.error && cajaEx.error.code !== 'PGRST116') console.warn('caja (lectura):', cajaEx.error.message || cajaEx.error);
          if (cajaEx.data) {
            var up = await supabaseClient.from('caja').update({
              efectivo: cajaRow.efectivo,
              tarjeta: cajaRow.tarjeta,
              transferencia: cajaRow.transferencia,
              fiado: cajaRow.fiado,
              transferencia_pendiente: cajaRow.transferencia_pendiente,
              transacciones: cajaRow.transacciones
            }).eq('user_id', uid);
            if (up.error) console.warn('caja (update):', up.error.message || up.error);
          } else {
            var ins = await supabaseClient.from('caja').insert(cajaRow);
            if (ins.error) console.warn('caja (insert):', ins.error.message || ins.error, '— Si falta una columna, en Supabase: ALTER TABLE caja ADD COLUMN IF NOT EXISTS transferencia_pendiente numeric DEFAULT 0;');
          }
        }
        if (updates.saldosACobrar !== undefined) {
          var list = updates.saldosACobrar || [];
          await supabaseClient.from('saldos_acobrar').delete().eq('user_id', uid);
          if (list.length > 0) {
            var rows = list.map(function (s) {
              return {
                user_id: uid,
                id: String(s.id || ''),
                client_name: s.clientName || '',
                whatsapp: s.whatsapp || '',
                items: s.items || [],
                total: Number(s.total) || 0,
                method: s.method || 'fiado',
                paid: !!s.paid,
                created_at: s.createdAt || new Date().toISOString()
              };
            });
            await supabaseClient.from('saldos_acobrar').insert(rows);
          }
        }
      } catch (e) { console.warn('Supabase save failed, data saved in this device (localStorage):', e); }
    }

    function getData() {
      if (!currentUser?.id) return { products: {}, ventas: { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 }, transacciones: 0, deudores: [], saldosACobrar: [], lastCierreDate: null };
      const d = _dataCache;
      d.ventas = d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 };
      d.deudores = d.deudores || [];
      d.saldosACobrar = d.saldosACobrar || [];
      return d;
    }

    function checkMidnightReset() {
      var today = new Date().toISOString().slice(0, 10);
      var last = _dataCache.lastCierreDate;
      if (last && last !== today) {
        _dataCache.ventas = { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 };
        _dataCache.transacciones = 0;
        state.transaccionesList = [];
        _dataCache.lastCierreDate = today;
        setData({ ventas: _dataCache.ventas, transacciones: 0, lastCierreDate: today });
      } else if (!last) {
        _dataCache.lastCierreDate = today;
      }
    }
    function setData(updates) {
      if (!currentUser?.id) return;
      Object.assign(_dataCache, updates);
      if (updates.ventas) _dataCache.ventas = { ..._dataCache.ventas, ...updates.ventas };
      saveDataToSupabase(updates);
    }

    // Estado en memoria (cart + lista de transacciones del día hasta cierre de caja)
    const state = {
      cart: [],
      cobroRapidoItems: [],  // [{ nombre, precio, costo }] para una sola venta con varios productos
      transaccionesList: [],  // { id, method, client, items: [{ nombre, codigo, precio, cant }], total }
      currentPanel: 'dashboard',
      _restoringFromHistory: false,
      historialTab: 'ventas',
      historialFilter: 'hoy',
      superSection: 'negocios'  // negocios | ajustes | notificaciones | mas
    };

    function roundToNearest100(x) {
      if (typeof x !== 'number' || isNaN(x)) return 0;
      return Math.round(x / 100) * 100;
    }
    const defaultProducts = {
      '123456': { nombre: 'Café Premium', precio: 850, stock: 50, codigo: '123456', stockInicial: 50, costo: 0 },
      '789012': { nombre: 'Alfajor Artesanal', precio: 450, stock: 3, codigo: '789012', stockInicial: 3, costo: 0 },
      '345678': { nombre: 'Agua Mineral', precio: 320, stock: 20, codigo: '345678', stockInicial: 20, costo: 0 }
    };

    async function initData() {
      await loadDataFromSupabase();
      checkMidnightReset();
      const d = getData();
      if (Object.keys(d.products).length === 0) {
        d.products = JSON.parse(JSON.stringify(defaultProducts));
        Object.values(d.products).forEach(p => { if (!p.stockInicial) p.stockInicial = p.stock; });
        setData(d);
      }
    }

    function getStockStatus(stock) {
      if (stock <= 0) return { label: 'Agotado', class: 'status-agotado' };
      if (stock <= 5) return { label: 'Crítico', class: 'status-critico' };
      return { label: 'Stock Alto', class: 'status-alto' };
    }

    let _beepCtx = null;
    function playBeep() {
      try {
        if (!_beepCtx || _beepCtx.state === 'closed') {
          _beepCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_beepCtx.state === 'suspended') _beepCtx.resume();
        const osc = _beepCtx.createOscillator();
        const gain = _beepCtx.createGain();
        osc.connect(gain);
        gain.connect(_beepCtx.destination);
        osc.frequency.value = 1200;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, _beepCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, _beepCtx.currentTime + 0.1);
        osc.start(_beepCtx.currentTime);
        osc.stop(_beepCtx.currentTime + 0.1);
      } catch (_) {}
    }

    function renderInventory() {
      const list = document.getElementById('inventoryList');
      const search = document.getElementById('searchInventory')?.value?.toLowerCase() || '';
      const data = getData();
      const items = Object.values(data.products || {}).filter(p => 
        p.nombre.toLowerCase().includes(search) || (p.codigo || '').includes(search)
      );
      list.innerHTML = items.map(p => {
        const quedan = Math.max(0, Number(p.stock) || 0);
        return `
          <div class="inventory-item glass rounded-xl p-3 sm:p-4 flex gap-3 items-center border border-white/10 touch-target cursor-pointer active:scale-[0.99] transition-transform" data-codigo="${p.codigo}" role="button" tabindex="0">
            <div class="flex-1 min-w-0" data-action="edit">
              <p class="font-semibold truncate text-base">${(p.nombre || '').replace(/</g, '&lt;')}</p>
              <p class="text-[#a78bfa] font-medium text-sm sm:text-base">$${(p.precio ?? 0).toLocaleString('es-AR')}</p>
              <p class="text-xs text-white/60 mt-1">quedan (${quedan})</p>
            </div>
            <button type="button" class="add-to-cart-btn btn-glow rounded-xl p-2.5 touch-target shrink-0" data-codigo="${p.codigo}" title="Agregar al carrito">
              <i data-lucide="plus" class="w-5 h-5"></i>
            </button>
          </div>
        `;
      }).join('');
      lucide.createIcons();
      list.querySelectorAll('.inventory-item').forEach(el => {
        el.addEventListener('click', function (e) {
          if (e.target.closest('.add-to-cart-btn')) return;
          openEditProduct(el.dataset.codigo);
        });
      });
      list.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); promptQuantityAndAdd(btn.dataset.codigo); };
      });
    }

    function promptQuantityAndAdd(codigo) {
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p) return;
      if (p.stock <= 0) {
        showScanToast('Sin stock: ' + (p.nombre || codigo), true);
        return;
      }

      const modal = document.getElementById('qtyModal');
      const input = document.getElementById('qtyModalInput');
      const stockEl = document.getElementById('qtyModalStock');
      const titleEl = document.getElementById('qtyModalTitle');

      titleEl.textContent = (p.nombre || '').replace(/</g, '&lt;');
      stockEl.textContent = `Stock disponible: ${p.stock} unidad${p.stock !== 1 ? 'es' : ''} · $${(p.precio ?? 0).toLocaleString('es-AR')} c/u`;
      input.value = 1;
      input.max = p.stock;

      modal.classList.remove('hidden');
      modal.classList.add('flex');

      // Empujamos un estado al historial para que "Atrás" cierre el modal
      history.pushState({ panel: state.currentPanel, qtyModal: true }, '', location.href);

      function closeModal() {
        window.removeEventListener('popstate', onBackPress);
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        cleanup();
        // Si el estado actual todavía tiene qtyModal, volvemos atrás para limpiarlo
        if (history.state && history.state.qtyModal) history.back();
      }

      // Cuando el usuario presiona "Atrás" en el celular
      function onBackPress() {
        window.removeEventListener('popstate', onBackPress);
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        cleanup();
      }
      window.addEventListener('popstate', onBackPress);

      function doConfirm() {
        const qty = parseInt(input.value, 10);
        if (!qty || qty < 1) { input.focus(); return; }
        closeModal();
        addToCart(codigo, qty);
      }

      function cleanup() {
        document.getElementById('qtyModalMinus').onclick = null;
        document.getElementById('qtyModalPlus').onclick = null;
        document.getElementById('qtyModalCancel').onclick = null;
        document.getElementById('qtyModalConfirm').onclick = null;
        document.getElementById('qtyModalOverlay').onclick = null;
        input.onkeydown = null;
      }

      document.getElementById('qtyModalMinus').onclick = () => {
        const v = Math.max(1, parseInt(input.value, 10) - 1);
        input.value = v;
      };
      document.getElementById('qtyModalPlus').onclick = () => {
        const v = Math.min(p.stock, parseInt(input.value, 10) + 1);
        input.value = v;
      };
      document.getElementById('qtyModalCancel').onclick = closeModal;
      document.getElementById('qtyModalOverlay').onclick = closeModal;
      document.getElementById('qtyModalConfirm').onclick = doConfirm;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') doConfirm();
        if (e.key === 'Escape') closeModal();
      };
    }

    function openEditProduct(codigo) {
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p) return;
      document.getElementById('productModalTitle').textContent = 'Configurar producto';
      document.getElementById('prodEditCodigo').value = codigo;
      document.getElementById('prodNombre').value = p.nombre || '';
      document.getElementById('prodCodigo').value = p.codigo || '';
      const costo = p.costo != null ? Number(p.costo) : '';
      document.getElementById('prodCosto').value = costo;
      const precioNum = p.precio != null ? Number(p.precio) : 0;
      const costoNum = p.costo != null ? Number(p.costo) : 0;
      const margen = costoNum > 0 && precioNum > 0 ? Math.round(((precioNum - costoNum) / costoNum) * 100) : '';
      document.getElementById('prodMargen').value = margen;
      document.getElementById('prodPrecio').value = p.precio ?? '';
      document.getElementById('prodStock').value = p.stock ?? '';
      document.getElementById('prodStockInicialWrap').classList.remove('hidden');
      const siEl = document.getElementById('prodStockInicial');
      siEl.value = p.stockInicial ?? p.stock ?? '';
      document.getElementById('deleteProductInModal').classList.remove('hidden');
      document.getElementById('productModal').classList.remove('hidden');
      document.getElementById('productModal').classList.add('flex');
      _userTouchedCost = true;
      if (typeof updateCostoCampoEstado === 'function') updateCostoCampoEstado();
      document.getElementById('prodMargenError').classList.add('hidden');
      lucide.createIcons();
    }

    function deleteProduct(codigo) {
      if (confirm('¿Eliminar este producto?')) {
        const d = getData();
        delete d.products[codigo];
        setData(d);
        renderInventory();
      }
    }

    function addToCart(codigo, cantidad) {
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p || p.stock <= 0) return;
      const qty = (cantidad && cantidad > 0) ? Math.min(Math.floor(cantidad), p.stock) : 1;
      const existing = state.cart.find(i => i.codigo === codigo);
      const costo = p.costo != null ? Number(p.costo) : 0;
      if (existing) existing.cant = Math.min(existing.cant + qty, p.stock);
      else state.cart.push({ ...p, cant: qty, costo });
      const cartQty = state.cart.find(i => i.codigo === codigo).cant;
      const stockInicial = p.stockInicial || p.stock || 1;
      const remaining = Math.max(0, p.stock - cartQty);
      const pct = stockInicial > 0 ? (remaining / stockInicial) : 0;
      if (pct <= 0.2 && pct > 0) {
        showStockWarning('¡Queda poco stock! ' + p.nombre + ' — menos del 20%');
      } else if (remaining === 0) {
        showStockWarning('¡Última unidad! ' + p.nombre);
      }
      playBeep();
      updateCartUI();
      document.getElementById('cartPanel').classList.add('translate-x-0');
      document.getElementById('cartDrawer').classList.remove('hidden');
      document.getElementById('cartDrawer').classList.add('flex');
    }

    function removeFromCart(idx) {
      state.cart.splice(idx, 1);
      updateCartUI();
    }

    function updateCartUI() {
      const count = state.cart.reduce((a, i) => a + i.cant, 0);
      document.getElementById('cartCount').textContent = count;
      const itemsEl = document.getElementById('cartItems');
      const total = state.cart.reduce((a, i) => a + i.precio * i.cant, 0);
      if (state.cart.length === 0) {
        itemsEl.innerHTML = `
          <div class="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div class="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mb-4">
              <i data-lucide="shopping-cart" class="w-8 h-8 text-white/50"></i>
            </div>
            <p class="font-medium text-white/80 mb-1">Tu carrito está vacío</p>
            <p class="text-sm text-white/50 mb-4">Agregá productos desde el escáner o la lista de productos.</p>
            <button type="button" id="cartEmptyAddBtn" class="btn-glow rounded-xl py-2.5 px-5 text-sm font-medium flex items-center gap-2 touch-target">
              <i data-lucide="package" class="w-4 h-4"></i> Ir a productos
            </button>
          </div>`;
        lucide.createIcons();
        document.getElementById('cartEmptyAddBtn').onclick = function () {
          closeCart();
          setTimeout(function () { goToPanel('inventory'); }, 320);
        };
      } else {
        itemsEl.innerHTML = state.cart.map((item, idx) => `
          <div class="flex items-center gap-3 glass rounded-xl p-3">
            <div class="w-10 h-10 rounded-lg bg-[#7c3aed]/30 flex items-center justify-center">
              <i data-lucide="package" class="w-5 h-5 text-[#a78bfa]"></i>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-medium truncate">${item.nombre}</p>
              <p class="text-sm text-white/60">$${item.precio} x ${item.cant}</p>
            </div>
            <p class="font-semibold">$${item.precio * item.cant}</p>
            <button class="remove-cart text-red-400 p-2 touch-target rounded-lg hover:bg-red-500/20" data-idx="${idx}">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        `).join('');
        lucide.createIcons();
        itemsEl.querySelectorAll('.remove-cart').forEach(btn => {
          btn.onclick = () => removeFromCart(parseInt(btn.dataset.idx));
        });
      }
      document.getElementById('cartTotal').textContent = `$${total.toLocaleString('es-AR')}`;
    }

    function openPaymentModal() {
      if (state.cart.length === 0) return;
      const cartClient = document.getElementById('cartClientName');
      const paymentClient = document.getElementById('paymentClientName');
      if (cartClient && paymentClient) paymentClient.value = cartClient.value.trim();
      document.getElementById('paymentWhatsappWrap').classList.remove('hidden');
      document.getElementById('paymentWhatsapp').value = '';
      var we = document.getElementById('paymentWhatsappErr'); if (we) we.classList.add('hidden');
      document.getElementById('paymentModal').classList.remove('hidden');
      document.getElementById('paymentModal').classList.add('flex');
      if (!state._restoringFromHistory) history.pushState({ panel: state.currentPanel, modal: 'payment' }, '', location.href);
      lucide.createIcons();
    }
    function closePaymentModal() {
      document.getElementById('paymentModal').classList.add('hidden');
      document.getElementById('paymentModal').classList.remove('flex');
    }
    async function completeSaleWithMethod(method, clientName, whatsapp) {
      const total = state.cart.reduce((a, i) => a + i.precio * i.cant, 0);
      const items = state.cart.map(i => ({ nombre: i.nombre, codigo: i.codigo, precio: i.precio, cant: i.cant, costo: i.costo != null ? i.costo : 0 }));
      const fechaHora = new Date().toISOString();
      state.transaccionesList.push({
        id: Date.now(),
        method,
        client: clientName || '—',
        items: [...items],
        total,
        fechaHora
      });
      if (method === 'fiado' || method === 'transferencia_pendiente') {
        var list = _dataCache.saldosACobrar || [];
        list.push({
          id: Date.now() + '_' + Math.random().toString(36).slice(2),
          clientName: (clientName || '').trim() || 'Cliente',
          whatsapp: (whatsapp || '').trim() || '',
          items: [...items],
          total: total,
          method: method,
          paid: false,
          createdAt: fechaHora
        });
        _dataCache.saldosACobrar = list;
      }
      if (supabaseClient && currentUser?.id) {
        try {
          var ventaRes = await supabaseClient.from('ventas').insert({
            user_id: currentUser.id,
            fecha_hora: fechaHora,
            total,
            metodo_pago: method,
            cliente_nombre: (clientName || '').trim() || null,
            items
          });
          if (ventaRes.error) throw ventaRes.error;
        } catch (err) {
          console.warn('No se guardó venta en la nube:', err && err.message);
          if (typeof showScanToast === 'function') showScanToast('Venta guardada en este dispositivo. Revisá la conexión para sincronizar.', false);
        }
      }
      const d = getData();
      d.ventas = d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 };
      d.ventas[method] = (d.ventas[method] || 0) + total;
      d.transacciones = (d.transacciones || 0) + 1;
      state.cart.forEach(item => {
        if (d.products[item.codigo]) d.products[item.codigo].stock -= item.cant;
      });
      state.cart = [];
      d.lastCierreDate = new Date().toISOString().slice(0, 10);
      setData(d);
      updateCartUI();
      updateDashboard();
      closePaymentModal();
      closeCart();
      showScanToast('¡Venta registrada! $' + total.toLocaleString('es-AR'), false);
    }
    function completeSale() {
      if (state.cart.length === 0) return;
      openPaymentModal();
    }

    function getTodayRange() {
      var now = new Date();
      var start = new Date(now); start.setHours(0, 0, 0, 0);
      var end = new Date(now); end.setHours(23, 59, 59, 999);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    async function getMetricasDelDia() {
      var range = getTodayRange();
      if (supabaseClient && currentUser && currentUser.id) {
        try {
          var res = await supabaseClient.from('ventas').select('id, fecha_hora, total, metodo_pago, items').eq('user_id', currentUser.id).gte('fecha_hora', range.start).lte('fecha_hora', range.end);
          if (!res.error && res.data && res.data.length > 0) {
            var efectivo = 0, tarjeta = 0, transferencia = 0, fiado = 0, transferencia_pendiente = 0, total = 0, ganancia = 0;
            res.data.forEach(function (v) {
              var t = Number(v.total) || 0;
              total += t;
              var metodo = (v.metodo_pago || '').toLowerCase().replace(/\s/g, '_');
              if (metodo === 'efectivo') efectivo += t;
              else if (metodo === 'tarjeta') tarjeta += t;
              else if (metodo === 'transferencia') transferencia += t;
              else if (metodo === 'fiado') fiado += t;
              else if (metodo === 'transferencia_pendiente') transferencia_pendiente += t;
              else efectivo += t;
              (v.items || []).forEach(function (i) {
                var costo = i.costo != null ? Number(i.costo) : 0;
                ganancia += ((Number(i.precio) || 0) - costo) * (i.cant || 0);
              });
            });
            return { total, efectivo, tarjeta, transferencia, fiado, transferencia_pendiente, ganancia, count: res.data.length };
          }
        } catch (_) {}
      }
      var d = getData();
      var ventas = d.ventas || {};
      var fiado = ventas.fiado || 0, transfPend = ventas.transferencia_pendiente || 0;
      var total = (ventas.efectivo || 0) + (ventas.tarjeta || 0) + (ventas.transferencia || 0) + fiado + transfPend;
      var ganancia = (state.transaccionesList || []).reduce(function (sum, t) {
        return sum + (t.items || []).reduce(function (s, i) {
          var costo = i.costo != null ? Number(i.costo) : 0;
          var precio = Number(i.precio) || 0;
          var cant = i.cant || 0;
          var g = (precio - costo) * cant;
          return s + (Number.isFinite(g) ? g : 0);
        }, 0);
      }, 0);
      return { total, efectivo: ventas.efectivo || 0, tarjeta: ventas.tarjeta || 0, transferencia: ventas.transferencia || 0, fiado, transferencia_pendiente: transfPend, ganancia, count: d.transacciones || 0 };
    }
    async function updateDashboard() {
      checkMidnightReset();
      var m = await getMetricasDelDia();
      document.getElementById('metricVentas').textContent = '$' + m.total.toLocaleString('es-AR');
      document.getElementById('metricTrans').textContent = '$' + Math.round(m.ganancia).toLocaleString('es-AR');
      document.getElementById('cajaEfectivo').textContent = '$' + m.efectivo.toLocaleString('es-AR');
      document.getElementById('cajaTarjeta').textContent = '$' + m.tarjeta.toLocaleString('es-AR');
      document.getElementById('cajaTransf').textContent = '$' + m.transferencia.toLocaleString('es-AR');
      document.getElementById('cajaFiado').textContent = '$' + m.fiado.toLocaleString('es-AR');
      var cajaTransfPendEl = document.getElementById('cajaTransfPend');
      if (cajaTransfPendEl) cajaTransfPendEl.textContent = '$' + m.transferencia_pendiente.toLocaleString('es-AR');
      document.getElementById('cajaTotal').textContent = '$' + m.total.toLocaleString('es-AR');
      var cajaUtilidadEl = document.getElementById('cajaUtilidad');
      if (cajaUtilidadEl) cajaUtilidadEl.textContent = '$' + Math.round(m.ganancia).toLocaleString('es-AR');
      var resumenEl = document.getElementById('resumenDiaTexto');
      var resumenVentasEl = document.getElementById('resumenDiaVentas');
      if (resumenEl) resumenEl.textContent = 'Entraron $' + m.total.toLocaleString('es-AR');
      if (resumenVentasEl) resumenVentasEl.textContent = m.count + ' ventas';
      var porMetodoEl = document.getElementById('resumenDiaPorMetodo');
      if (porMetodoEl) {
        var methods = [
          { key: 'efectivo', label: 'Efectivo', icon: 'banknote', color: 'text-green-400', bg: 'bg-green-500/20' },
          { key: 'tarjeta', label: 'Tarjeta', icon: 'credit-card', color: 'text-blue-400', bg: 'bg-blue-500/20' },
          { key: 'transferencia', label: 'Transf.', icon: 'smartphone', color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
          { key: 'fiado', label: 'Fiado', icon: 'user-check', color: 'text-amber-400', bg: 'bg-amber-500/20' },
          { key: 'transferencia_pendiente', label: 'Pend.', icon: 'clock', color: 'text-orange-400', bg: 'bg-orange-500/20' }
        ];
        porMetodoEl.innerHTML = methods.map(function (x) {
          var val = m[x.key] || 0;
          if (val === 0) return '';
          return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ' + x.bg + ' ' + x.color + '"><i data-lucide="' + x.icon + '" class="w-3 h-3"></i>' + x.label + ' $' + val.toLocaleString('es-AR') + '</span>';
        }).filter(Boolean).join('');
        try {
          if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
        } catch (_) {}
      }
      renderSaldosACobrar();
      renderFrequentProducts();
    }
    function renderSaldosACobrar() {
      var list = (_dataCache.saldosACobrar || []).filter(function (s) { return !s.paid; });
      var listEl = document.getElementById('saldosACobrarList');
      var emptyEl = document.getElementById('saldosACobrarEmpty');
      if (!listEl) return;
      if (list.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) { emptyEl.classList.remove('hidden'); }
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      var methodLabels = { fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente' };
      listEl.innerHTML = list.map(function (s) {
        var itemsText = (s.items || []).map(function (i) { return (i.nombre || '') + ' x' + (i.cant || 0) + ' $' + (i.precio || 0).toLocaleString('es-AR'); }).join(', ');
        var tel = (s.whatsapp || '').replace(/\D/g, '');
        var msg = (currentUser && currentUser.whatsappMessage) ? currentUser.whatsappMessage : DEFAULT_WHATSAPP;
        msg = msg.replace(/\{cliente\}/gi, s.clientName || 'Cliente').replace(/\{monto\}/gi, (s.total || 0));
        var waUrl = tel.length >= 8 ? ('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg)) : '#';
        return '<div class="glass rounded-xl p-4 border border-white/10" data-saldo-id="' + (s.id || '').replace(/"/g, '&quot;') + '">' +
          '<div class="flex justify-between items-start gap-2 flex-wrap">' +
          '<div class="min-w-0 flex-1">' +
          '<p class="font-medium truncate">' + (s.clientName || 'Cliente').replace(/</g, '&lt;') + '</p>' +
          '<p class="text-xs text-white/60 mt-0.5">' + (methodLabels[s.method] || s.method) + (s.whatsapp ? ' · ' + s.whatsapp.replace(/</g, '&lt;') : '') + '</p>' +
          '<p class="text-xs text-white/50 mt-1 truncate" title="' + itemsText.replace(/"/g, '&quot;') + '">' + itemsText.replace(/</g, '&lt;').slice(0, 60) + (itemsText.length > 60 ? '…' : '') + '</p>' +
          '<p class="font-semibold text-[#a78bfa] mt-1">$' + (s.total || 0).toLocaleString('es-AR') + '</p>' +
          '</div>' +
          '<div class="flex gap-2 shrink-0">' +
          (tel.length >= 8 ? '<a href="' + waUrl + '" target="_blank" rel="noopener" class="btn-neomorphic rounded-xl py-2 px-3 text-sm touch-target inline-flex items-center gap-1" title="Enviar WhatsApp"><i data-lucide="message-circle" class="w-4 h-4"></i></a>' : '') +
          '<button type="button" class="saldo-pagar-btn btn-glow rounded-xl py-2 px-3 text-sm font-medium touch-target" data-id="' + (s.id || '').replace(/"/g, '&quot;') + '">Pagado</button>' +
          '</div></div></div></div>';
      }).join('');
      listEl.querySelectorAll('.saldo-pagar-btn').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.dataset.id;
          var list = _dataCache.saldosACobrar || [];
          var idx = list.findIndex(function (x) { return x.id === id; });
          if (idx >= 0) { list[idx].paid = true; setData({ saldosACobrar: list }); renderSaldosACobrar(); updateDashboard(); if (document.getElementById('panel-historial') && !document.getElementById('panel-historial').classList.contains('hidden') && state.historialTab === 'deudores') renderDeudoresPanel(); }
        };
      });
      lucide.createIcons();
    }
    var methodLabelsDeudores = { fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente' };
    function renderDeudoresPanel() {
      var list = _dataCache.saldosACobrar || [];
      var pendientes = list.filter(function (s) { return !s.paid; });
      var cobrados = list.filter(function (s) { return s.paid; });
      var pendientesEl = document.getElementById('deudoresPendientesList');
      var cobradosEl = document.getElementById('deudoresCobradosList');
      var pendientesEmpty = document.getElementById('deudoresPendientesEmpty');
      var cobradosEmpty = document.getElementById('deudoresCobradosEmpty');
      if (pendientesEl) {
        if (pendientes.length === 0) {
          pendientesEl.innerHTML = '';
          if (pendientesEmpty) pendientesEmpty.classList.remove('hidden');
        } else {
          if (pendientesEmpty) pendientesEmpty.classList.add('hidden');
          var msg = (currentUser && currentUser.whatsappMessage) ? currentUser.whatsappMessage : DEFAULT_WHATSAPP;
          pendientesEl.innerHTML = pendientes.map(function (s) {
            var nombre = (s.clientName || '').trim() || 'Sin nombre';
            nombre = nombre.replace(/</g, '&lt;');
            var tel = (s.whatsapp || '').replace(/\D/g, '');
            var waMsg = msg.replace(/\{cliente\}/gi, s.clientName || 'Cliente').replace(/\{monto\}/gi, (s.total || 0));
            var waUrl = tel.length >= 8 ? ('https://wa.me/' + tel + '?text=' + encodeURIComponent(waMsg)) : '#';
            return '<div class="flex items-center justify-between gap-2 py-2 px-2 rounded-lg border border-white/10 hover:bg-white/5" data-saldo-id="' + (s.id || '').replace(/"/g, '&quot;') + '">' +
              '<div class="min-w-0 flex-1 flex items-center gap-2">' +
              '<span class="font-medium truncate">' + nombre + '</span>' +
              '<span class="font-semibold text-[#a78bfa] shrink-0">$' + (s.total || 0).toLocaleString('es-AR') + '</span>' +
              '</div>' +
              '<div class="flex gap-1 shrink-0">' +
              (tel.length >= 8 ? '<a href="' + waUrl + '" target="_blank" rel="noopener" class="btn-neomorphic rounded-lg p-1.5 touch-target inline-flex" title="WhatsApp"><i data-lucide="message-circle" class="w-4 h-4"></i></a>' : '') +
              '<button type="button" class="deudor-pagar-btn btn-glow rounded-lg py-1.5 px-2 text-xs font-medium touch-target" data-id="' + (s.id || '').replace(/"/g, '&quot;') + '">Pagado</button>' +
              '</div></div>';
          }).join('');
          pendientesEl.querySelectorAll('.deudor-pagar-btn').forEach(function (btn) {
            btn.onclick = function () {
              var id = btn.dataset.id;
              var arr = _dataCache.saldosACobrar || [];
              var idx = arr.findIndex(function (x) { return x.id === id; });
              if (idx >= 0) { arr[idx].paid = true; setData({ saldosACobrar: arr }); renderSaldosACobrar(); updateDashboard(); renderDeudoresPanel(); }
            };
          });
        }
      }
      if (cobradosEl) {
        if (cobrados.length === 0) {
          cobradosEl.innerHTML = '';
          if (cobradosEmpty) cobradosEmpty.classList.remove('hidden');
        } else {
          if (cobradosEmpty) cobradosEmpty.classList.add('hidden');
          cobradosEl.innerHTML = cobrados.map(function (s) {
            var nombre = (s.clientName || '').trim() || 'Sin nombre';
            nombre = nombre.replace(/</g, '&lt;');
            return '<button type="button" class="deudor-cobrado-card w-full text-left flex items-center justify-between gap-2 py-2 px-2 rounded-lg border border-white/10 hover:bg-white/5 active:bg-[#7c3aed]/20 touch-target transition-colors" data-saldo-id="' + (s.id || '').replace(/"/g, '&quot;') + '">' +
              '<span class="font-medium truncate">' + nombre + '</span>' +
              '<span class="font-semibold text-green-400 shrink-0">$' + (s.total || 0).toLocaleString('es-AR') + '</span>' +
              '</button>';
          }).join('');
          cobradosEl.querySelectorAll('.deudor-cobrado-card').forEach(function (btn) {
            btn.onclick = function () {
              var id = btn.dataset.saldoId;
              var saldo = (_dataCache.saldosACobrar || []).find(function (x) { return x.id === id; });
              if (saldo) openDetalleDeudorModal(saldo);
            };
          });
        }
      }
      lucide.createIcons();
    }
    function openDetalleDeudorModal(saldo) {
      var content = document.getElementById('detalleDeudorModalContent');
      if (!content) return;
      var fecha = (saldo.createdAt ? new Date(saldo.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
      var items = (saldo.items || []).map(function (i) {
        var subtotal = (i.precio || 0) * (i.cant || 0);
        return '<li class="flex justify-between py-1 border-b border-white/10">' +
          '<span>' + (i.nombre || '—').replace(/</g, '&lt;') + ' x ' + (i.cant || 0) + '</span>' +
          '<span>$' + subtotal.toLocaleString('es-AR') + '</span></li>';
      }).join('');
      content.innerHTML = '<p><span class="text-white/50">Cliente:</span> ' + (saldo.clientName || '—').replace(/</g, '&lt;') + '</p>' +
        '<p><span class="text-white/50">Fecha:</span> ' + fecha + '</p>' +
        '<p><span class="text-white/50">Método:</span> ' + (methodLabelsDeudores[saldo.method] || saldo.method) + '</p>' +
        '<p><span class="text-white/50">Total:</span> <strong class="text-[#a78bfa]">$' + (saldo.total || 0).toLocaleString('es-AR') + '</strong></p>' +
        '<div class="pt-2"><p class="text-white/70 mb-2">Productos:</p><ul class="space-y-0">' + items + '</ul></div>';
      document.getElementById('detalleDeudorModal').classList.remove('hidden');
      document.getElementById('detalleDeudorModal').classList.add('flex');
      lucide.createIcons();
    }
    function openDetalleVentaModal(v) {
      var content = document.getElementById('detalleVentaModalContent');
      if (!content || !v) return;
      var fmt = (s) => s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      var methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pend.' };
      var items = (v.items || []).map(function (i) {
        var subtotal = (i.precio || 0) * (i.cant || 0);
        return '<li class="flex justify-between py-1 border-b border-white/10">' +
          '<span>' + (i.nombre || '—').replace(/</g, '&lt;') + ' x ' + (i.cant || 0) + '</span>' +
          '<span>$' + subtotal.toLocaleString('es-AR') + '</span></li>';
      }).join('');
      content.innerHTML = '<p><span class="text-white/50">Fecha y hora:</span> ' + fmt(v.fecha_hora) + '</p>' +
        '<p><span class="text-white/50">Cliente:</span> ' + ((v.cliente_nombre || '').trim() || 'Sin nombre').replace(/</g, '&lt;') + '</p>' +
        '<p><span class="text-white/50">Método de pago:</span> ' + (methodLabels[v.metodo_pago] || v.metodo_pago) + '</p>' +
        '<p><span class="text-white/50">Total:</span> <strong class="text-[#a78bfa]">$' + Number(v.total).toLocaleString('es-AR') + '</strong></p>' +
        '<div class="pt-2"><p class="text-white/70 mb-2">Productos:</p><ul class="space-y-0">' + items + '</ul></div>';
      document.getElementById('detalleVentaModal').classList.remove('hidden');
      document.getElementById('detalleVentaModal').classList.add('flex');
      lucide.createIcons();
    }
    document.getElementById('detalleVentaModalClose').onclick = function () { document.getElementById('detalleVentaModal').classList.add('hidden'); document.getElementById('detalleVentaModal').classList.remove('flex'); };
    document.getElementById('detalleVentaModalCloseBtn').onclick = function () { document.getElementById('detalleVentaModal').classList.add('hidden'); document.getElementById('detalleVentaModal').classList.remove('flex'); };
    document.getElementById('detalleVentaModalOverlay').onclick = function () { document.getElementById('detalleVentaModal').classList.add('hidden'); document.getElementById('detalleVentaModal').classList.remove('flex'); };
    document.getElementById('detalleDeudorModalClose').onclick = function () { document.getElementById('detalleDeudorModal').classList.add('hidden'); document.getElementById('detalleDeudorModal').classList.remove('flex'); };
    document.getElementById('detalleDeudorModalCloseBtn').onclick = function () { document.getElementById('detalleDeudorModal').classList.add('hidden'); document.getElementById('detalleDeudorModal').classList.remove('flex'); };
    document.getElementById('detalleDeudorModalOverlay').onclick = function () { document.getElementById('detalleDeudorModal').classList.add('hidden'); document.getElementById('detalleDeudorModal').classList.remove('flex'); };
    function getFrequentProductsToday(maxItems) {
      var list = state.transaccionesList || [];
      var agg = {};
      list.forEach(function (t) {
        (t.items || []).forEach(function (it) {
          if (it.codigo === '_rapida') return;
          var k = it.codigo;
          if (!agg[k]) agg[k] = { nombre: it.nombre, codigo: it.codigo, cant: 0 };
          agg[k].cant += it.cant || 0;
        });
      });
      var prods = getData().products || {};
      return Object.values(agg)
        .filter(function (p) { return prods[p.codigo]; })
        .sort(function (a, b) { return b.cant - a.cant; })
        .slice(0, maxItems || 8);
    }
    function renderFrequentProducts() {
      var wrap = document.getElementById('dashboardFrecuentesWrap');
      var cont = document.getElementById('dashboardFrecuentes');
      if (!wrap || !cont) return;
      var frequent = getFrequentProductsToday(8);
      if (frequent.length === 0) {
        wrap.classList.add('hidden');
        return;
      }
      wrap.classList.remove('hidden');
      var prods = getData().products || {};
      cont.innerHTML = frequent.map(function (p) {
        var prod = prods[p.codigo];
        var nombre = (prod && prod.nombre) ? prod.nombre : p.nombre;
        var precio = prod ? prod.precio : 0;
        var stock = prod ? prod.stock : 0;
        var disabled = stock <= 0 ? ' opacity-50 pointer-events-none' : '';
        return '<button type="button" class="freq-product-btn flex-shrink-0 glass rounded-xl px-4 py-3 border border-white/10 hover:border-[#7c3aed]/50 active:scale-95 touch-target text-left min-w-0 max-w-[140px]' + disabled + '" data-codigo="' + (p.codigo || '').replace(/"/g, '&quot;') + '" title="Agregar al carrito"><p class="font-medium truncate text-sm">' + (nombre || '').replace(/</g, '&lt;') + '</p><p class="text-[#a78bfa] text-xs mt-0.5">$' + (precio || 0).toLocaleString('es-AR') + '</p></button>';
      }).join('');
      cont.querySelectorAll('.freq-product-btn').forEach(function (btn) {
        btn.onclick = function () {
          var codigo = btn.dataset.codigo;
          if (codigo) addToCart(codigo);
        };
      });
      lucide.createIcons();
    }

    function updateCobroRapidoLista() {
      var listEl = document.getElementById('cobroRapidoLista');
      var emptyEl = document.getElementById('cobroRapidoListaEmpty');
      var totalEl = document.getElementById('cobroRapidoTotal');
      if (!listEl) return;
      var items = state.cobroRapidoItems || [];
      if (items.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (totalEl) { totalEl.classList.add('hidden'); totalEl.textContent = 'Total: $0'; }
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      var atajoWrap = document.getElementById('cobroRapidoAtajoWrap');
      if (atajoWrap) atajoWrap.classList.add('hidden');
      var total = items.reduce(function (s, it) { return s + (it.precio || 0); }, 0);
      listEl.innerHTML = items.map(function (it, i) {
        var nombre = (it.nombre || 'Item').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        var precio = it.precio || 0;
        return '<div class="flex items-center justify-between gap-1.5 py-1 px-2 rounded-lg bg-white/10"><span class="text-xs text-white truncate flex-1">' + nombre + ' <span class="text-white/60">$' + precio + '</span></span><button type="button" class="cobro-rapido-quitar shrink-0 p-1 rounded text-red-300 hover:bg-red-500/20 touch-target text-sm" data-index="' + i + '" aria-label="Quitar">×</button></div>';
      }).join('');
      if (totalEl) { totalEl.classList.remove('hidden'); totalEl.textContent = 'Total: $' + total; }
      var atajoWrap = document.getElementById('cobroRapidoAtajoWrap');
      var atajoLabel = document.getElementById('cobroRapidoAtajoLabel');
      if (atajoWrap && atajoLabel) {
        atajoWrap.classList.remove('hidden');
        var lastMethod = '';
        try { lastMethod = localStorage.getItem(LAST_QUICK_PAYMENT_KEY) || 'efectivo'; } catch (_) { lastMethod = 'efectivo'; }
        var labels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente' };
        atajoLabel.textContent = 'Cobrar con ' + (labels[lastMethod] || 'Efectivo');
      }
      listEl.querySelectorAll('.cobro-rapido-quitar').forEach(function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.dataset.index, 10);
          state.cobroRapidoItems.splice(idx, 1);
          updateCobroRapidoLista();
        };
      });
      lucide.createIcons();
    }
    function openCobroRapidoModal() {
      state.cobroRapidoItems = [];
      document.getElementById('cobroRapidoMonto').value = '';
      var margenEl = document.getElementById('cobroRapidoMargen'); if (margenEl) margenEl.value = '';
      document.getElementById('cobroRapidoCliente').value = '';
      document.getElementById('cobroRapidoOtroNombre').value = '';
      document.getElementById('cobroRapidoOtroWrap').classList.add('hidden');
      var crw = document.getElementById('cobroRapidoWhatsappWrap'); if (crw) crw.classList.add('hidden');
      document.getElementById('cobroRapidoWhatsapp').value = '';
      var crwe = document.getElementById('cobroRapidoWhatsappErr'); if (crwe) crwe.classList.add('hidden');
      var list = getCobroRapidoProductosList();
      var wrap = document.getElementById('cobroRapidoProductosWrap');
      if (wrap) {
        var html = list.map(function (item) {
          var nombre = (item && item.nombre) ? item.nombre : 'Producto';
          var margen = (item && item.margen != null) ? Number(item.margen) : 0;
          return '<button type="button" class="cobro-rapido-producto px-2.5 py-1.5 rounded-lg text-xs font-medium border border-white/20 bg-white/5 hover:bg-[#7c3aed]/30 hover:border-[#7c3aed]/50 touch-target transition-all" data-producto="' + (nombre || '').replace(/"/g, '&quot;') + '" data-margen="' + margen + '">' + (nombre || '').replace(/</g, '&lt;') + '</button>';
        }).join('');
        html += '<button type="button" class="cobro-rapido-producto px-2.5 py-1.5 rounded-lg text-xs font-medium border border-white/20 bg-white/5 hover:bg-[#7c3aed]/30 hover:border-[#7c3aed]/50 touch-target transition-all" data-producto="Otro" data-margen="0" id="cobroRapidoProductoOtro">Otro</button>';
        wrap.innerHTML = html;
      }
      document.querySelectorAll('.cobro-rapido-producto').forEach(function (el) {
        el.classList.remove('ring-2', 'ring-[#7c3aed]', 'bg-[#7c3aed]/25');
      });
      document.querySelectorAll('.quick-payment-option').forEach(function (el) { el.classList.remove('ring-2', 'ring-[#7c3aed]'); });
      var lastMethod = '';
      try { lastMethod = localStorage.getItem(LAST_QUICK_PAYMENT_KEY) || ''; } catch (_) {}
      if (lastMethod) document.querySelectorAll('.quick-payment-option').forEach(function (el) { if (el.dataset.quickPayment === lastMethod) el.classList.add('ring-2', 'ring-[#7c3aed]'); });
      if (list.length === 1) {
        var firstBtn = wrap.querySelector('.cobro-rapido-producto');
        if (firstBtn) { firstBtn.classList.add('ring-2', 'ring-[#7c3aed]', 'bg-[#7c3aed]/25'); }
      }
      updateCobroRapidoLista();
      document.getElementById('cobroRapidoModal').classList.remove('hidden');
      document.getElementById('cobroRapidoModal').classList.add('flex');
      if (!state._restoringFromHistory) history.pushState({ panel: state.currentPanel, modal: 'cobroRapido' }, '', location.href);
      setTimeout(function () { document.getElementById('cobroRapidoMonto').focus(); }, 100);
      lucide.createIcons();
    }
    function getCobroRapidoProductoNombre() {
      var sel = document.querySelector('.cobro-rapido-producto.ring-2');
      if (!sel) return 'Venta rápida';
      var p = sel.dataset.producto;
      if (p === 'Otro') {
        var otro = document.getElementById('cobroRapidoOtroNombre').value.trim();
        return otro || 'Otro';
      }
      return p || 'Venta rápida';
    }
    function getCobroRapidoProductoMargen() {
      var inputEl = document.getElementById('cobroRapidoMargen');
      if (inputEl && inputEl.value !== '' && !isNaN(parseFloat(inputEl.value))) return parseFloat(inputEl.value) || 0;
      var sel = document.querySelector('.cobro-rapido-producto.ring-2');
      if (!sel || !sel.dataset.margen) return 0;
      return parseFloat(sel.dataset.margen) || 0;
    }
    function costoDesdeMargen(amount, margenPct) {
      var a = Number(amount);
      var m = Number(margenPct);
      if (!Number.isFinite(a) || a <= 0) return 0;
      if (!Number.isFinite(m) || m <= 0) return 0;
      var denom = 1 + m / 100;
      if (!Number.isFinite(denom) || denom <= 0) return 0;
      var c = Math.round(a / denom);
      return Number.isFinite(c) && c >= 0 ? c : 0;
    }
    function closeCobroRapidoModal() {
      document.getElementById('cobroRapidoModal').classList.add('hidden');
      document.getElementById('cobroRapidoModal').classList.remove('flex');
    }
    async function completeQuickSale(method, clientName, whatsapp) {
      var items;
      var total;
      if (state.cobroRapidoItems && state.cobroRapidoItems.length > 0) {
        items = state.cobroRapidoItems.map(function (it) {
          var nombre = it.nombre || 'Venta rápida';
          var codigoRapida = '_rapida_' + (nombre.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'venta') + '_' + Date.now();
          var pr = Number(it.precio) || 0;
          var co = it.costo != null ? Number(it.costo) : 0;
          if (!Number.isFinite(co) || co < 0) co = 0;
          return { nombre: nombre, codigo: codigoRapida, precio: pr, cant: 1, costo: co };
        });
        total = items.reduce(function (s, it) { return s + (Number(it.precio) || 0); }, 0);
      } else {
        var montoEl = document.getElementById('cobroRapidoMonto');
        var amount = parseInt((montoEl.value || '').replace(/\D/g, ''), 10) || 0;
        if (amount <= 0) { alert('Agregá al menos un producto (producto + monto → Agregar) o ingresá un monto.'); return; }
        var productName = getCobroRapidoProductoNombre();
        var margen = getCobroRapidoProductoMargen();
        var costo = costoDesdeMargen(amount, margen);
        var codigoRapida = '_rapida_' + (productName.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'venta');
        items = [{ nombre: productName, codigo: codigoRapida, precio: amount, cant: 1, costo: costo }];
        total = amount;
      }
      items = (items || []).map(function (it) {
        return {
          nombre: it.nombre,
          codigo: it.codigo,
          precio: Number(it.precio) || 0,
          cant: Number(it.cant) || 1,
          costo: (function (c) { return Number.isFinite(c) && c >= 0 ? c : 0; })(Number(it.costo))
        };
      });
      var fechaHora = new Date().toISOString();
      if (method === 'fiado' || method === 'transferencia_pendiente') {
        var list = _dataCache.saldosACobrar || [];
        list.push({
          id: Date.now() + '_' + Math.random().toString(36).slice(2),
          clientName: (clientName || '').trim() || 'Cliente',
          whatsapp: (whatsapp || '').trim() || '',
          items: items,
          total: total,
          method: method,
          paid: false,
          createdAt: fechaHora
        });
        _dataCache.saldosACobrar = list;
      }
      state.transaccionesList.push({
        id: Date.now(),
        method: method,
        client: (clientName || '').trim() || '—',
        items: items,
        total: total,
        fechaHora: fechaHora
      });
      if (supabaseClient && currentUser && currentUser.id) {
        try {
          var ventaRes = await supabaseClient.from('ventas').insert({
            user_id: currentUser.id,
            fecha_hora: fechaHora,
            total: total,
            metodo_pago: method,
            cliente_nombre: (clientName || '').trim() || null,
            items: items
          });
          if (ventaRes.error) throw ventaRes.error;
        } catch (err) {
          console.warn('Venta rápida no guardada en historial:', err && err.message);
          if (typeof showScanToast === 'function') showScanToast('Cobro guardado en este dispositivo. Revisá la conexión para sincronizar.', false);
        }
      }
      var d = getData();
      d.ventas = d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 };
      d.ventas[method] = (d.ventas[method] || 0) + total;
      d.transacciones = (d.transacciones || 0) + 1;
      d.lastCierreDate = new Date().toISOString().slice(0, 10);
      setData(d);
      try {
        await updateDashboard();
      } catch (e) {
        console.warn('No se pudo refrescar el panel tras cobro rápido:', e && e.message ? e.message : e);
      }
      state.cobroRapidoItems = [];
      try { localStorage.setItem(LAST_QUICK_PAYMENT_KEY, method); } catch (_) {}
      closeCobroRapidoModal();
      if (typeof playBeep === 'function') playBeep();
      if (typeof showScanToast === 'function') showScanToast('Cobro registrado', false);
    }

    function openCart() {
      document.getElementById('cartDrawer').classList.remove('hidden');
      document.getElementById('cartDrawer').classList.add('flex');
      if (!state._restoringFromHistory) history.pushState({ panel: state.currentPanel, modal: 'cart' }, '', location.href);
      setTimeout(() => document.getElementById('cartPanel').classList.add('translate-x-0'), 10);
    }

    function closeCart() {
      document.getElementById('cartPanel').classList.remove('translate-x-0');
      setTimeout(() => {
        document.getElementById('cartDrawer').classList.add('hidden');
        document.getElementById('cartDrawer').classList.remove('flex');
      }, 300);
    }

    // Navegación (barra inferior + panel Más)
    function showLoginScreenTrialEnded() {
      document.getElementById('appWrap').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      document.getElementById('signUpBox').classList.add('hidden');
      var errEl = document.getElementById('loginErr');
      errEl.textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá por WhatsApp para renovar.';
      errEl.classList.add('show');
      var wrap = document.getElementById('loginContactAdminWrap');
      if (wrap) {
        fillLoginContactLinks('Hola, mi período de prueba de Ferriol OS terminó y quiero renovar.');
        wrap.classList.remove('hidden');
      }
    }
    function updateTrialCountdown() {
      const banner = document.getElementById('trialCountdownBanner');
      const textEl = document.getElementById('trialCountdownText');
      const daysEl = document.getElementById('trialCountdownDays');
      if (!banner || !currentUser || currentUser.role !== 'kiosquero') return;
      const endsAt = currentUser.trialEndsAt;
      if (!endsAt) {
        banner.classList.add('hidden');
        var subEl = document.getElementById('headerSub');
        if (subEl && currentUser.role === 'kiosquero') subEl.textContent = 'Sistema Premium';
        return;
      }
      const end = new Date(endsAt);
      const now = new Date();
      const msLeft = end - now;
      if (msLeft <= 0) {
        banner.classList.add('hidden');
        if (supabaseClient && currentUser && currentUser.id && !currentUser._trialBlockTriggered) {
          currentUser._trialBlockTriggered = true;
          supabaseClient.from('profiles').update({ active: false }).eq('id', currentUser.id).then(function () {
            loadAdminContactForTrialEnded().then(function () {
              window._adminWhatsappForContact = adminContact.whatsapp;
              supabaseClient.auth.signOut().then(showLoginScreenTrialEnded);
            });
          });
        }
        return;
      }
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      banner.classList.remove('hidden');
      daysEl.textContent = daysLeft;
      textEl.textContent = daysLeft === 1 ? 'Último día de prueba' : (daysLeft + ' días de prueba restantes');
      var subEl = document.getElementById('headerSub');
      if (subEl) subEl.textContent = 'Sistema de prueba';
    }
    function loadAdminContactForTrialEnded() {
      return loadAdminContact();
    }
    document.getElementById('trialRenovarBtn') && document.getElementById('trialRenovarBtn').addEventListener('click', function () {
      loadAdminContact().then(function () {
        fillRenovarWhatsAppLinks();
        if (!adminContact.whatsappList || adminContact.whatsappList.length === 0) { alert('El administrador aún no configuró su WhatsApp.'); return; }
        document.getElementById('renovarModal').classList.remove('hidden');
        document.getElementById('renovarModal').classList.add('flex');
        if (!state._restoringFromHistory) history.pushState({ panel: state.currentPanel, modal: 'renovar' }, '', location.href);
        lucide.createIcons();
      });
    });
    document.getElementById('closeRenovarModal') && document.getElementById('closeRenovarModal').addEventListener('click', closeRenovarModal);
    document.getElementById('renovarModalOverlay') && document.getElementById('renovarModalOverlay').addEventListener('click', closeRenovarModal);
    function closeRenovarModal() {
      var m = document.getElementById('renovarModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    }
    function closeAllModals() {
      document.getElementById('ventasProductosModal') && (function () { var m = document.getElementById('ventasProductosModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('transaccionesModal') && (function () { var m = document.getElementById('transaccionesModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('paymentModal') && (function () { var m = document.getElementById('paymentModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('cobroRapidoModal') && (function () { var m = document.getElementById('cobroRapidoModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('renovarModal') && (function () { var m = document.getElementById('renovarModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('detalleVentaModal') && (function () { var m = document.getElementById('detalleVentaModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('detalleDeudorModal') && (function () { var m = document.getElementById('detalleDeudorModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      var cartPanel = document.getElementById('cartPanel');
      var cartDrawer = document.getElementById('cartDrawer');
      if (cartPanel) cartPanel.classList.remove('translate-x-0');
      if (cartDrawer) { cartDrawer.classList.add('hidden'); cartDrawer.classList.remove('flex'); }
    }
    function showPanel(name) {
      if (name !== 'scanner') window._scanForProductCode = false;
      state.currentPanel = name;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const navKey = (name === 'config' || name === 'historial' || name === 'clientes') ? 'mas' : name;
      const btn = document.querySelector('[data-nav="' + navKey + '"]');
      if (btn) btn.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
      const panel = document.getElementById('panel-' + name);
      if (panel) panel.classList.remove('hidden');
      if (name === 'config') fillConfigForm();
      if (name === 'super') {
        if (superListCountdownInterval) clearInterval(superListCountdownInterval);
        renderSuper();
        superListCountdownInterval = setInterval(updateSuperListCountdowns, 1000);
        var navSuperBottom = document.getElementById('navSuperBottom');
        if (navSuperBottom) navSuperBottom.classList.remove('hidden');
        switchSuperSection('negocios');
      } else {
        if (superListCountdownInterval) { clearInterval(superListCountdownInterval); superListCountdownInterval = null; }
        var navSuperBottom = document.getElementById('navSuperBottom');
        if (navSuperBottom) navSuperBottom.classList.add('hidden');
      }
      if (name === 'dashboard') {
        updateTrialCountdown();
        updateDashboard();
        if (currentUser && currentUser.role === 'kiosquero') { loadAdminContact(); loadNotifications(); }
      }
      if (name === 'scanner') {
        // Iniciar preview de cámara al entrar al panel (sin escanear). No hacer focus en manualCode: abre el teclado en móvil.
        if (typeof window._startScannerCamera === 'function') window._startScannerCamera();
      } else {
        if (typeof window._stopScannerCamera === 'function') window._stopScannerCamera();
      }
      if (name === 'inventory') renderInventory();
      if (name === 'caja') renderCierresCajaHistorial();
      if (name === 'historial') {
        switchHistorialTab('ventas');
        renderHistorial(state.historialFilter || 'hoy');
      }
      if (name === 'clientes') loadClientes().then(renderClientes);
      lucide.createIcons();
    }
    function goToPanel(name) {
      if (!state._restoringFromHistory) history.pushState({ panel: name }, '', location.href);
      showPanel(name);
    }
    window.addEventListener('popstate', function (e) {
      state._restoringFromHistory = true;
      closeAllModals();
      var s = e.state;
      if (s && s.panel) showPanel(s.panel);
      else showPanel('dashboard');
      state._restoringFromHistory = false;
    });
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => goToPanel(btn.dataset.nav);
    });
    function switchSuperSection(sectionName) {
      state.superSection = sectionName || 'negocios';
      document.querySelectorAll('#panel-super .super-section').forEach(function (el) {
        el.classList.add('hidden');
        el.style.display = 'none';
        el.style.zIndex = '0';
      });
      var section = document.getElementById('super-section-' + state.superSection);
      if (section) {
        section.classList.remove('hidden');
        section.style.display = 'block';
        section.style.zIndex = '1';
      }
      document.querySelectorAll('.super-nav-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.superSection === state.superSection);
      });
      var headerAjustesBtn = document.getElementById('headerSuperAjustesBtn');
      if (headerAjustesBtn) headerAjustesBtn.classList.toggle('active', state.superSection === 'ajustes');
      var headerNotifBtn = document.getElementById('headerSuperNotifBtn');
      if (headerNotifBtn) headerNotifBtn.classList.toggle('active', state.superSection === 'notificaciones');
      lucide.createIcons();
    }
    var headerAjustesBtnEl = document.getElementById('headerSuperAjustesBtn');
    if (headerAjustesBtnEl) headerAjustesBtnEl.addEventListener('click', function () { switchSuperSection('ajustes'); });
    var headerNotifBtnEl = document.getElementById('headerSuperNotifBtn');
    if (headerNotifBtnEl) headerNotifBtnEl.addEventListener('click', function () { switchSuperSection('notificaciones'); });
    document.querySelectorAll('.super-nav-btn').forEach(function (btn) {
      btn.onclick = function () {
        if (btn.dataset.superSection) switchSuperSection(btn.dataset.superSection);
      };
    });

    document.getElementById('notifBtn').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var dd = document.getElementById('notifDropdown');
      if (dd.classList.contains('hidden')) {
        dd.classList.remove('hidden');
        loadNotifications().then(function () {
          setNotifLastRead();
          var countEl = document.getElementById('notifCount');
          if (countEl) { countEl.classList.add('hidden'); countEl.textContent = '0'; }
        });
        if (typeof playBeep === 'function') playBeep();
      } else dd.classList.add('hidden');
      lucide.createIcons();
    });
    document.getElementById('notifBtn').addEventListener('touchend', function (e) {
      e.preventDefault();
      document.getElementById('notifBtn').click();
    }, { passive: false });
    document.getElementById('notifDropdownClose').onclick = function () { document.getElementById('notifDropdown').classList.add('hidden'); lucide.createIcons(); };
    document.addEventListener('click', function (e) {
      var dd = document.getElementById('notifDropdown');
      var btn = document.getElementById('notifBtn');
      if (dd && !dd.classList.contains('hidden') && btn && !dd.contains(e.target) && !btn.contains(e.target)) dd.classList.add('hidden');
    });
    // Carrito
    document.getElementById('cartBtn').onclick = openCart;
    document.getElementById('closeCart').onclick = closeCart;
    document.getElementById('cartOverlay').onclick = closeCart;
    document.getElementById('completeSale').onclick = completeSale;
    document.getElementById('closePaymentModal').onclick = closePaymentModal;
    document.getElementById('paymentModalOverlay').onclick = closePaymentModal;

    document.getElementById('btnCobroRapido').onclick = openCobroRapidoModal;
    document.getElementById('closeCobroRapido').onclick = closeCobroRapidoModal;
    document.getElementById('cobroRapidoOverlay').onclick = closeCobroRapidoModal;
    document.getElementById('cobroRapidoProductosWrap').addEventListener('click', function (e) {
      var btn = e.target.closest('.cobro-rapido-producto');
      if (!btn) return;
      document.querySelectorAll('.cobro-rapido-producto').forEach(function (el) {
        el.classList.remove('ring-2', 'ring-[#7c3aed]', 'bg-[#7c3aed]/25');
      });
      btn.classList.add('ring-2', 'ring-[#7c3aed]', 'bg-[#7c3aed]/25');
      var wrap = document.getElementById('cobroRapidoOtroWrap');
      if (btn.dataset.producto === 'Otro') wrap.classList.remove('hidden'); else wrap.classList.add('hidden');
    });
    document.getElementById('cobroRapidoAgregarBtn').onclick = function () {
      var amount = parseInt((document.getElementById('cobroRapidoMonto').value || '').replace(/\D/g, ''), 10) || 0;
      if (amount <= 0) { alert('Ingresá un monto mayor a 0.'); return; }
      var productName = getCobroRapidoProductoNombre();
      var margen = getCobroRapidoProductoMargen();
      var costo = costoDesdeMargen(amount, margen);
      state.cobroRapidoItems = state.cobroRapidoItems || [];
      state.cobroRapidoItems.push({ nombre: productName, precio: amount, costo: costo });
      document.getElementById('cobroRapidoMonto').value = '';
      updateCobroRapidoLista();
    };
    document.getElementById('cobroRapidoAtajoBtn').onclick = function () {
      var lastMethod = '';
      try { lastMethod = localStorage.getItem(LAST_QUICK_PAYMENT_KEY) || 'efectivo'; } catch (_) { lastMethod = 'efectivo'; }
      var clientName = (document.getElementById('cobroRapidoCliente') && document.getElementById('cobroRapidoCliente').value) ? document.getElementById('cobroRapidoCliente').value.trim() : '';
      var whatsappRaw = (document.getElementById('cobroRapidoWhatsapp') && document.getElementById('cobroRapidoWhatsapp').value) ? document.getElementById('cobroRapidoWhatsapp').value.trim() : '';
      var whatsappDigits = (whatsappRaw || '').replace(/\D/g, '');
      if (lastMethod === 'fiado' || lastMethod === 'transferencia_pendiente') {
        document.getElementById('cobroRapidoWhatsappWrap').classList.remove('hidden');
        if (whatsappDigits.length < 8) {
          document.getElementById('cobroRapidoWhatsappErr').textContent = 'Ingresá el número de WhatsApp (mín. 8 dígitos) para poder cobrar después.';
          document.getElementById('cobroRapidoWhatsappErr').classList.remove('hidden');
          return;
        }
      }
      document.getElementById('cobroRapidoWhatsappErr').classList.add('hidden');
      completeQuickSale(lastMethod, clientName, whatsappRaw || whatsappDigits).catch(function (err) {
        console.warn('Cobro rápido (atajo):', err && err.message ? err.message : err);
      });
    };
    document.querySelectorAll('.quick-payment-option').forEach(function (btn) {
      btn.onclick = function () {
        var method = btn.dataset.quickPayment;
        var clientName = document.getElementById('cobroRapidoCliente').value.trim();
        var whatsappRaw = (document.getElementById('cobroRapidoWhatsapp') && document.getElementById('cobroRapidoWhatsapp').value) ? document.getElementById('cobroRapidoWhatsapp').value.trim() : '';
        var whatsappDigits = (whatsappRaw || '').replace(/\D/g, '');
        if (method === 'fiado' || method === 'transferencia_pendiente') {
          document.getElementById('cobroRapidoWhatsappWrap').classList.remove('hidden');
          if (whatsappDigits.length < 8) {
            document.getElementById('cobroRapidoWhatsappErr').textContent = 'Ingresá el número de WhatsApp (mín. 8 dígitos) para poder cobrar después.';
            document.getElementById('cobroRapidoWhatsappErr').classList.remove('hidden');
            return;
          }
        }
        document.getElementById('cobroRapidoWhatsappErr').classList.add('hidden');
        completeQuickSale(method, clientName, whatsappRaw || whatsappDigits).catch(function (err) {
          console.warn('Cobro rápido:', err && err.message ? err.message : err);
        });
      };
    });

    function showScanToast(msg, isError) {
      const el = document.getElementById('scanToast');
      const text = document.getElementById('scanToastText');
      text.textContent = msg;
      text.className = 'glass-strong rounded-xl px-4 py-3 text-sm font-medium shadow-lg ' + (isError ? 'text-red-300' : 'text-green-300');
      el.classList.remove('hidden');
      el.classList.add('flex');
      lucide.createIcons();
      setTimeout(() => { el.classList.add('hidden'); el.classList.remove('flex'); }, 2200);
    }
    function showStockWarning(msg) {
      const el = document.getElementById('scanToast');
      const text = document.getElementById('scanToastText');
      text.textContent = msg;
      text.className = 'glass-strong rounded-xl px-4 py-3 text-sm font-medium shadow-lg text-amber-300';
      el.classList.remove('hidden');
      el.classList.add('flex');
      lucide.createIcons();
      setTimeout(() => { el.classList.add('hidden'); el.classList.remove('flex'); }, 2000);
    }

    function openVentasProductosModal() {
      const list = state.transaccionesList || [];
      const agg = {};
      list.forEach(t => t.items.forEach(it => {
        const k = it.codigo;
        if (!agg[k]) agg[k] = { nombre: it.nombre, codigo: it.codigo, cant: 0 };
        agg[k].cant += it.cant;
      }));
      const items = Object.values(agg).sort((a, b) => b.cant - a.cant);
      const el = document.getElementById('ventasProductosList');
      if (items.length === 0) {
        el.innerHTML = '<p class="text-white/60 py-4 text-center">Aún no hay productos vendidos hoy.</p>';
      } else {
        el.innerHTML = items.map(p => `
          <div class="glass rounded-xl p-3 flex justify-between items-center">
            <span class="font-medium truncate flex-1">${p.nombre}</span>
            <span class="text-[#a78bfa] font-semibold shrink-0 ml-2">${p.cant} un.</span>
          </div>
        `).join('');
      }
      document.getElementById('ventasProductosModal').classList.remove('hidden');
      document.getElementById('ventasProductosModal').classList.add('flex');
      if (!state._restoringFromHistory) history.pushState({ panel: state.currentPanel, modal: 'ventasProductos' }, '', location.href);
      lucide.createIcons();
    }
    function openTransaccionesModal() {
      const list = state.transaccionesList || [];
      const methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente' };
      const el = document.getElementById('transaccionesList');
      if (list.length === 0) {
        el.innerHTML = '<p class="text-white/60 py-4 text-center">Aún no hay transacciones hoy.</p>';
      } else {
        const fmt = (s) => s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
        el.innerHTML = list.slice().reverse().map(t => `
          <div class="glass rounded-xl p-4 border border-white/10">
            <div class="flex justify-between items-start mb-2">
              <span class="px-2 py-0.5 rounded text-xs bg-[#7c3aed]/30">${methodLabels[t.method] || t.method}</span>
              <span class="font-bold text-[#a78bfa]">$${t.total.toLocaleString('es-AR')}</span>
            </div>
            <p class="text-white/40 text-[10px] mb-1">${fmt(t.fechaHora)}</p>
            <p class="text-white/60 text-xs mb-2">Cliente: ${t.client || '—'}</p>
            <ul class="space-y-1 text-xs">
              ${t.items.map(i => `<li>${i.nombre} x ${i.cant} — $${(i.precio * i.cant).toLocaleString('es-AR')}</li>`).join('')}
            </ul>
          </div>
        `).join('');
      }
      document.getElementById('transaccionesModal').classList.remove('hidden');
      document.getElementById('transaccionesModal').classList.add('flex');
      if (!state._restoringFromHistory) history.pushState({ panel: state.currentPanel, modal: 'transacciones' }, '', location.href);
      lucide.createIcons();
    }
    document.getElementById('btnVentasCard').onclick = openVentasProductosModal;
    document.getElementById('btnTransCard').onclick = openTransaccionesModal;
    document.getElementById('closeVentasProductos').onclick = () => {
      document.getElementById('ventasProductosModal').classList.add('hidden');
      document.getElementById('ventasProductosModal').classList.remove('flex');
    };
    document.getElementById('ventasProductosOverlay').onclick = () => document.getElementById('closeVentasProductos').click();
    document.getElementById('closeTransacciones').onclick = () => {
      document.getElementById('transaccionesModal').classList.add('hidden');
      document.getElementById('transaccionesModal').classList.remove('flex');
    };
    document.getElementById('transaccionesOverlay').onclick = () => document.getElementById('closeTransacciones').click();

    const methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pend.' };
    function getHistorialRange(filter) {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      if (filter === 'hoy') return { start: start.toISOString(), end: end.toISOString() };
      if (filter === 'ayer') {
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (filter === 'semana') {
        const day = start.getDay();
        const diff = day === 0 ? 6 : day - 1;
        start.setDate(start.getDate() - diff);
        start.setHours(0, 0, 0, 0);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (filter === 'semana_pasada') {
        const day = start.getDay();
        const diff = day === 0 ? 6 : day - 1;
        start.setDate(start.getDate() - diff - 7);
        start.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() - diff - 1);
        end.setHours(23, 59, 59, 999);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (filter === 'mes') {
        start.setMonth(start.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      start.setMonth(start.getMonth() - 2);
      start.setHours(0, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    async function renderHistorial(filter) {
      const listEl = document.getElementById('historialList');
      if (!listEl) return;
      if (typeof applyHistorialFilterUI === 'function') applyHistorialFilterUI(filter);
      const range = getHistorialRange(filter);
      if (!supabaseClient || !currentUser?.id) {
        listEl.innerHTML = '<p class="text-white/60 py-4">Configurá Supabase para ver el historial.</p>';
        lucide.createIcons();
        return;
      }
      const { data: rows, error } = await supabaseClient.from('ventas').select('id, fecha_hora, total, metodo_pago, cliente_nombre, items').eq('user_id', currentUser.id).gte('fecha_hora', range.start).lte('fecha_hora', range.end).order('fecha_hora', { ascending: false });
      if (error) {
        listEl.innerHTML = '<p class="text-white/60 py-4">No existe la tabla ventas. Creala en Supabase (ver comentarios en el código).</p>';
        lucide.createIcons();
        return;
      }
      const list = rows || [];
      if (list.length === 0) {
        listEl.innerHTML = '<p class="text-white/60 py-4 text-center">No hay ventas en este período.</p>';
        lucide.createIcons();
        return;
      }
      state.historialRows = list;
      listEl.innerHTML = list.map((v, idx) => {
        var cliente = (v.cliente_nombre || '').trim();
        if (!cliente) cliente = 'Sin nombre';
        cliente = cliente.replace(/</g, '&lt;');
        return '<button type="button" class="historial-venta-row w-full flex items-center justify-between gap-3 py-3 px-3 rounded-xl border-b border-white/10 hover:bg-white/5 active:bg-[#7c3aed]/20 text-left touch-target transition-colors" data-index="' + idx + '"><span class="font-medium truncate min-w-0">' + cliente + '</span><span class="font-bold text-[#a78bfa] shrink-0">$' + Number(v.total).toLocaleString('es-AR') + '</span></button>';
      }).join('');
      listEl.querySelectorAll('.historial-venta-row').forEach(btn => {
        btn.onclick = function () {
          var idx = parseInt(btn.dataset.index, 10);
          if (state.historialRows && state.historialRows[idx]) openDetalleVentaModal(state.historialRows[idx]);
        };
      });
      lucide.createIcons();
    }
    document.getElementById('historialFiltroBtn').onclick = function () {
      var dd = document.getElementById('historialFiltroDropdown');
      if (dd) dd.classList.toggle('hidden');
      lucide.createIcons();
    };
    document.querySelectorAll('.historial-filter').forEach(btn => {
      btn.onclick = function () {
        state.historialFilter = btn.dataset.filter;
        var dd = document.getElementById('historialFiltroDropdown');
        if (dd) dd.classList.add('hidden');
        applyHistorialFilterUI(btn.dataset.filter);
        renderHistorial(btn.dataset.filter);
        lucide.createIcons();
      };
    });
    function applyHistorialFilterUI(filter) {
      var filterLabels = { hoy: 'Hoy', ayer: 'Ayer', semana: 'Esta semana', semana_pasada: 'Semana pasada', mes: 'Último mes', '2meses': 'Últimos 2 meses' };
      var filtroBtn = document.getElementById('historialFiltroBtn');
      var filtroLabel = filtroBtn && filtroBtn.querySelector('.historial-filtro-label');
      if (filtroBtn) filtroBtn.dataset.filter = filter;
      if (filtroLabel) filtroLabel.textContent = filterLabels[filter] || filter;
      document.querySelectorAll('.historial-chip').forEach(function (chip) {
        var active = chip.dataset.filter === filter;
        chip.className = 'historial-chip px-2.5 py-1.5 rounded-xl text-xs font-medium touch-target transition-all border ' + (active ? 'bg-[#7c3aed]/30 border-[#7c3aed]/50' : 'border-white/20');
      });
    }
    document.querySelectorAll('.historial-chip').forEach(function (btn) {
      btn.onclick = function () {
        state.historialFilter = btn.dataset.filter;
        document.getElementById('historialFiltroDropdown').classList.add('hidden');
        applyHistorialFilterUI(btn.dataset.filter);
        renderHistorial(btn.dataset.filter);
        lucide.createIcons();
      };
    });
    document.addEventListener('click', function (e) {
      var dd = document.getElementById('historialFiltroDropdown');
      var btn = document.getElementById('historialFiltroBtn');
      if (dd && !dd.classList.contains('hidden') && btn && !dd.contains(e.target) && !btn.contains(e.target)) dd.classList.add('hidden');
    });
    function switchHistorialTab(tabName) {
      state.historialTab = tabName;
      var ventasWrap = document.getElementById('historialVentasWrap');
      var deudoresWrap = document.getElementById('historialDeudoresWrap');
      document.querySelectorAll('.historial-tab-btn').forEach(function (btn) {
        var isActive = btn.dataset.tab === tabName;
        btn.className = 'historial-tab-btn px-3 py-1.5 rounded-xl text-sm font-medium transition-all touch-target ' + (isActive ? 'bg-[#7c3aed]/30 border border-[#7c3aed]/50' : 'glass border border-white/10');
      });
      if (ventasWrap) ventasWrap.classList.toggle('hidden', tabName !== 'ventas');
      if (deudoresWrap) deudoresWrap.classList.toggle('hidden', tabName !== 'deudores');
      if (tabName === 'ventas') renderHistorial(state.historialFilter || 'hoy');
      if (tabName === 'deudores') renderDeudoresPanel();
      lucide.createIcons();
    }
    document.querySelectorAll('.historial-tab-btn').forEach(function (btn) {
      btn.onclick = function () { switchHistorialTab(btn.dataset.tab); };
    });

    let clientesCache = [];
    async function loadClientes() {
      if (!supabaseClient || !currentUser?.id) return [];
      const { data } = await supabaseClient.from('clientes').select('*').eq('user_id', currentUser.id).order('nombre');
      clientesCache = data || [];
      return clientesCache;
    }
    function renderClientes() {
      const listEl = document.getElementById('clientesList');
      const searchEl = document.getElementById('clientesSearch');
      if (!listEl) return;
      const q = (searchEl?.value || '').toLowerCase().trim();
      const list = q ? clientesCache.filter(c => (c.nombre || '').toLowerCase().includes(q) || (c.telefono || '').includes(q) || (c.email || '').toLowerCase().includes(q)) : clientesCache;
      if (clientesCache.length === 0) {
        listEl.innerHTML = '<p class="text-white/60 py-4 text-center">No hay clientes. Agregá uno con el botón.</p>';
      } else if (list.length === 0) {
        listEl.innerHTML = '<p class="text-white/60 py-4 text-center">Ningún cliente coincide con la búsqueda.</p>';
      } else {
        listEl.innerHTML = list.map(c => `
          <div class="glass rounded-xl p-3 border border-white/10 flex flex-col sm:flex-row sm:items-center gap-2">
            <div class="flex-1 min-w-0">
              <p class="font-medium">${(c.nombre || '—').replace(/</g, '&lt;')}</p>
              <p class="text-xs text-white/60">${(c.telefono || '—').replace(/</g, '&lt;')}</p>
              ${c.email ? `<p class="text-xs text-white/50">${(c.email || '').replace(/</g, '&lt;')}</p>` : ''}
              ${c.direccion ? `<p class="text-xs text-white/50 truncate">${(c.direccion || '').replace(/</g, '&lt;')}</p>` : ''}
            </div>
            <div class="flex gap-1 shrink-0">
              <button type="button" class="edit-cliente-btn px-2 py-1 rounded-lg text-xs bg-white/10 border border-white/20" data-id="${c.id}">Editar</button>
              <button type="button" class="delete-cliente-btn px-2 py-1 rounded-lg text-xs bg-red-500/20 text-red-300 border border-red-500/40" data-id="${c.id}">Eliminar</button>
            </div>
          </div>
        `).join('');
        listEl.querySelectorAll('.edit-cliente-btn').forEach(b => { b.onclick = () => openClienteModal(b.dataset.id); });
        listEl.querySelectorAll('.delete-cliente-btn').forEach(b => { b.onclick = () => deleteCliente(b.dataset.id); });
      }
      lucide.createIcons();
    }
    function openClienteModal(id) {
      document.getElementById('clienteModalTitle').textContent = id ? 'Editar cliente' : 'Nuevo cliente';
      document.getElementById('clienteId').value = id || '';
      if (id) {
        const c = clientesCache.find(x => x.id === id);
        if (c) {
          document.getElementById('clienteNombre').value = c.nombre || '';
          document.getElementById('clienteTelefono').value = c.telefono || '';
          document.getElementById('clienteEmail').value = c.email || '';
          document.getElementById('clienteDireccion').value = c.direccion || '';
          document.getElementById('clienteNotas').value = c.notas || '';
        }
      } else {
        document.getElementById('clienteNombre').value = '';
        document.getElementById('clienteTelefono').value = '';
        document.getElementById('clienteEmail').value = '';
        document.getElementById('clienteDireccion').value = '';
        document.getElementById('clienteNotas').value = '';
      }
      document.getElementById('clienteModal').classList.remove('hidden');
      document.getElementById('clienteModal').classList.add('flex');
    }
    async function saveCliente() {
      const id = document.getElementById('clienteId').value.trim();
      const nombre = document.getElementById('clienteNombre').value.trim();
      const telefono = document.getElementById('clienteTelefono').value.trim();
      const email = document.getElementById('clienteEmail').value.trim();
      const direccion = document.getElementById('clienteDireccion').value.trim();
      const notas = document.getElementById('clienteNotas').value.trim();
      if (!nombre && !telefono) { alert('Nombre o teléfono es obligatorio.'); return; }
      if (!supabaseClient || !currentUser?.id) return;
      const row = { user_id: currentUser.id, nombre: nombre || null, telefono: telefono || null, email: email || null, direccion: direccion || null, notas: notas || null };
      if (id) {
        await supabaseClient.from('clientes').update(row).eq('id', id).eq('user_id', currentUser.id);
      } else {
        await supabaseClient.from('clientes').insert(row);
      }
      await loadClientes();
      renderClientes();
      document.getElementById('clienteModal').classList.add('hidden');
      document.getElementById('clienteModal').classList.remove('flex');
    }
    async function deleteCliente(id) {
      if (!confirm('¿Eliminar este cliente?')) return;
      if (!supabaseClient || !currentUser?.id) return;
      await supabaseClient.from('clientes').delete().eq('id', id).eq('user_id', currentUser.id);
      await loadClientes();
      renderClientes();
    }
    document.getElementById('btnAddCliente').onclick = () => openClienteModal();
    document.getElementById('saveCliente').onclick = saveCliente;
    document.getElementById('clienteModalOverlay').onclick = () => { document.getElementById('clienteModal').classList.add('hidden'); document.getElementById('clienteModal').classList.remove('flex'); };
    document.getElementById('clientesSearch').addEventListener('input', () => renderClientes());

    document.querySelectorAll('[data-payment]').forEach(btn => {
      btn.onclick = () => {
        const method = btn.dataset.payment;
        const client = document.getElementById('paymentClientName')?.value?.trim() || '';
        const whatsappRaw = document.getElementById('paymentWhatsapp')?.value?.trim() || '';
        const whatsappDigits = (whatsappRaw || '').replace(/\D/g, '');
        if (method === 'fiado' || method === 'transferencia_pendiente') {
          document.getElementById('paymentWhatsappWrap').classList.remove('hidden');
          if (whatsappDigits.length < 8) {
            var errEl = document.getElementById('paymentWhatsappErr');
            if (errEl) { errEl.textContent = 'Ingresá el número de WhatsApp (mín. 8 dígitos) para poder cobrar después.'; errEl.classList.remove('hidden'); }
            document.getElementById('paymentWhatsapp').focus();
            return;
          }
        }
        document.getElementById('paymentWhatsappErr').classList.add('hidden');
        completeSaleWithMethod(method, client, whatsappRaw || whatsappDigits);
        document.getElementById('paymentClientName').value = '';
        document.getElementById('paymentWhatsapp').value = '';
        document.getElementById('cartClientName').value = '';
      };
    });

    // Manual add (usa misma búsqueda que escáner para códigos con/sin ceros)
    const doManualAdd = () => {
      const code = document.getElementById('manualCode').value.trim();
      if (!code) return;
      const data = getData();
      const found = findProductByCode(data.products, code);
      if (found && found.product.stock > 0) {
        addToCart(found.codigo);
        playBeep();
        showScanToast('Agregado: ' + found.product.nombre, false);
      } else if (found && found.product.stock <= 0) {
        showScanToast('Sin stock: ' + found.product.nombre, true);
      } else {
        showScanToast('Producto no encontrado', true);
      }
      document.getElementById('manualCode').value = '';
    };
    document.getElementById('manualAdd').onclick = doManualAdd;
    document.getElementById('manualCode').addEventListener('keydown', e => { if (e.key === 'Enter') doManualAdd(); });

    // Escáner con BarcodeDetector — normaliza código para mejorar detección
    let scannerStream = null;
    let scanInterval = null;
    let scanFrameRunning = false;
    let barcodeDetector = null;
    let lastScannedCode = '';
    let lastScanTime = 0;
    const SCAN_COOLDOWN_MS = 2500;
    const video = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');
    const ctx = canvas.getContext('2d');

    function getBarcodeDetector() {
      if (!barcodeDetector && typeof BarcodeDetector !== 'undefined') {
        barcodeDetector = new BarcodeDetector();
      }
      return barcodeDetector;
    }

    function normalizeBarcode(raw) {
      return String(raw || '').trim().replace(/\s/g, '');
    }
    function findProductByCode(products, code) {
      if (!products || !code) return null;
      const n = normalizeBarcode(code);
      if (products[n]) return { codigo: n, product: products[n] };
      const stripZeros = s => String(s).replace(/^0+/, '') || s;
      const nStripped = stripZeros(n);
      for (const [k, p] of Object.entries(products)) {
        if (k === n || stripZeros(k) === nStripped) return { codigo: k, product: p };
      }
      if (n.length >= 3) {
        const match = Object.keys(products).find(k => k.endsWith(n) || n.endsWith(k) || k.includes(n) || n.includes(k));
        if (match) return { codigo: match, product: products[match] };
      }
      return null;
    }

    async function scanFrame() {
      if (!scanFrameRunning) return;
      if (!scannerStream || video.readyState !== 4) { scheduleNextFrame(); return; }
      const detector = getBarcodeDetector();
      if (!detector) { scheduleNextFrame(); return; }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const codes = await detector.detect(canvas);
        if (codes.length) {
          const rawCode = codes[0].rawValue;
          const now = Date.now();
          if (rawCode === lastScannedCode && now - lastScanTime < SCAN_COOLDOWN_MS) {
            scheduleNextFrame(); return;
          }
          if (window._scanForProductCode) {
            lastScannedCode = rawCode;
            lastScanTime = now;
            var prodCodigoEl = document.getElementById('prodCodigo');
            if (prodCodigoEl) prodCodigoEl.value = rawCode;
            window._scanForProductCode = false;
            goToPanel('inventory');
            document.getElementById('productModal').classList.remove('hidden');
            document.getElementById('productModal').classList.add('flex');
            lucide.createIcons();
            scheduleNextFrame(); return;
          }
          const data = getData();
          const found = findProductByCode(data.products, rawCode);
          if (found && found.product.stock > 0) {
            lastScannedCode = rawCode;
            lastScanTime = now;
            addToCart(found.codigo);
            playBeep();
            showScanToast('Agregado: ' + found.product.nombre, false);
          } else if (found && found.product.stock <= 0) {
            lastScannedCode = rawCode;
            lastScanTime = now;
            showScanToast('Sin stock: ' + found.product.nombre, true);
          } else {
            lastScannedCode = rawCode;
            lastScanTime = now;
            showScanToast('Producto no encontrado (código: ' + normalizeBarcode(rawCode) + ')', true);
          }
        }
      } catch (_) {}
      scheduleNextFrame();
    }

    function scheduleNextFrame() {
      if (!scanFrameRunning) return;
      scanInterval = setTimeout(scanFrame, 400);
    }

    function stopScanInterval() {
      scanFrameRunning = false;
      if (scanInterval) { clearTimeout(scanInterval); scanInterval = null; }
    }

    function stopScannerCamera() {
      stopScanInterval();
      if (scannerStream) {
        scannerStream.getTracks().forEach(t => t.stop());
        scannerStream = null;
        video.srcObject = null;
      }
    }

    window._stopScannerInterval = stopScanInterval;
    window._stopScannerCamera = stopScannerCamera;

    let cameraPermissionDenied = false;
    async function startScannerCamera() {
      if (scannerStream) return;
      if (cameraPermissionDenied) return;
      try {
        scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = scannerStream;
        await video.play();
      } catch (e) {
        cameraPermissionDenied = true;
        showScanToast('Sin acceso a la cámara. Habilitá el permiso en la configuración del celular.', true);
      }
    }
    window._startScannerCamera = startScannerCamera;
    var scanHoldBtn = document.getElementById('scanHoldBtn');
    if (scanHoldBtn) {
      scanHoldBtn.addEventListener('pointerdown', async function (e) {
        e.preventDefault();
        await startScannerCamera();
        if (scannerStream && getBarcodeDetector() && !scanFrameRunning) {
          scanFrameRunning = true;
          scanFrame();
        }
      });
      scanHoldBtn.addEventListener('pointerup', stopScanInterval);
      scanHoldBtn.addEventListener('pointerleave', stopScanInterval);
      scanHoldBtn.addEventListener('pointercancel', stopScanInterval);
    }

    window.addEventListener('visibilitychange', () => {
      if (document.hidden) stopScannerCamera();
    });

    // Generar ticket digital
    document.getElementById('generateTicket').onclick = async () => {
      const d = getData();
      const v = d.ventas || {};
      const fiado = v.fiado || 0;
      const transfPend = v.transferencia_pendiente || 0;
      const total = (v.efectivo || 0) + (v.tarjeta || 0) + (v.transferencia || 0) + fiado + transfPend;
      var utilidadDiaTicket = (state.transaccionesList || []).reduce(function (sum, t) {
        return sum + (t.items || []).reduce(function (s, i) {
          var costo = i.costo != null ? Number(i.costo) : 0;
          return s + (i.precio - costo) * (i.cant || 0);
        }, 0);
      }, 0);
      const t = document.getElementById('ticketContent');
      t.classList.remove('hidden');
      document.getElementById('ticketFecha').textContent = new Date().toLocaleString('es-AR');
      document.getElementById('ticketBody').innerHTML = `
        <p>Efectivo: $${(v.efectivo || 0).toLocaleString('es-AR')}</p>
        <p>Tarjeta: $${(v.tarjeta || 0).toLocaleString('es-AR')}</p>
        <p>Transferencia: $${(v.transferencia || 0).toLocaleString('es-AR')}</p>
        <p>Fiado: $${fiado.toLocaleString('es-AR')}</p>
        <p>Transf. pendiente: $${transfPend.toLocaleString('es-AR')}</p>
        <p>Cant. ventas: ${d.transacciones || 0}</p>
        <p class="text-green-400">Ganancia del día (precio − costo): $${Math.round(utilidadDiaTicket).toLocaleString('es-AR')}</p>
      `;
      document.getElementById('ticketTotal').textContent = `TOTAL facturado: $${total.toLocaleString('es-AR')}`;
      const texto = `FERRIOL OS - Cierre de Caja\n${new Date().toLocaleString('es-AR')}\n\nEfectivo: $${(v.efectivo || 0).toLocaleString('es-AR')}\nTarjeta: $${(v.tarjeta || 0).toLocaleString('es-AR')}\nTransferencia: $${(v.transferencia || 0).toLocaleString('es-AR')}\nFiado: $${fiado.toLocaleString('es-AR')}\nTransf. pendiente: $${transfPend.toLocaleString('es-AR')}\nCant. ventas: ${d.transacciones || 0}\nGanancia del día (precio − costo): $${Math.round(utilidadDiaTicket).toLocaleString('es-AR')}\n\nTOTAL facturado: $${total.toLocaleString('es-AR')}`;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Cierre de Caja - Ferriol OS',
            text: texto
          });
        } catch (e) { if (e.name !== 'AbortError') navigator.clipboard?.writeText(texto); }
      } else {
        navigator.clipboard?.writeText(texto);
      }
      t.classList.add('hidden');
    };

    async function renderCierresCajaHistorial() {
      var listEl = document.getElementById('cierresCajaList');
      if (!listEl) return;
      if (!supabaseClient || !currentUser?.id) {
        listEl.innerHTML = '<p class="text-white/50 text-center py-4">Configurá Supabase para ver el historial.</p>';
        lucide.createIcons();
        return;
      }
      try {
        var res = await supabaseClient.from('cierres_caja').select('id, fecha, fecha_cierre, total_facturado, ganancia').eq('user_id', currentUser.id).order('fecha_cierre', { ascending: false }).limit(50);
        if (res.error) throw res.error;
        var rows = res.data || [];
        if (rows.length === 0) {
          listEl.innerHTML = '<p class="text-white/50 text-center py-4">Aún no hay cierres guardados.</p>';
        } else {
          listEl.innerHTML = rows.map(function (r) {
            var fecha = (r.fecha || r.fecha_cierre || '').toString().slice(0, 10);
            var total = Number(r.total_facturado || 0);
            var gan = Number(r.ganancia || 0);
            return '<div class="glass rounded-xl p-3 border border-white/10 flex justify-between items-center gap-2"><div><span class="text-white/70">' + fecha + '</span></div><div class="text-right"><span class="font-semibold text-[#a78bfa]">$' + total.toLocaleString('es-AR') + '</span><span class="text-green-400/90 text-xs ml-2">$' + Math.round(gan).toLocaleString('es-AR') + ' gan.</span></div></div>';
          }).join('');
        }
      } catch (e) {
        listEl.innerHTML = '<p class="text-white/50 text-center py-4">Creá la tabla cierres_caja en Supabase (ver comentarios en el código).</p>';
      }
      lucide.createIcons();
    }
    document.getElementById('cerrarCaja').onclick = async () => {
      if (!confirm('¿Reiniciar caja? Se mantendrá el inventario y los productos vendidos volverán a cero para el nuevo día.')) return;
      var m = await getMetricasDelDia();
      if (supabaseClient && currentUser?.id) {
        try {
          var hoy = new Date().toISOString().slice(0, 10);
          await supabaseClient.from('cierres_caja').insert({ user_id: currentUser.id, fecha: hoy, fecha_cierre: new Date().toISOString(), total_facturado: m.total, ganancia: Math.round(m.ganancia) });
        } catch (_) {}
      }
      var d = getData();
      d.ventas = { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 };
      d.transacciones = 0;
      d.lastCierreDate = new Date().toISOString().slice(0, 10);
      state.transaccionesList = [];
      Object.keys(d.products || {}).forEach(function (codigo) {
        var p = d.products[codigo];
        if (p) p.stockInicial = p.stock;
      });
      setData(d);
      updateDashboard();
      renderCierresCajaHistorial();
    };

    document.getElementById('exportDeudoresCSVBtn').onclick = function () { exportDeudoresCSV(); lucide.createIcons(); };
    document.getElementById('exportProductosCSVBtn').onclick = function () { exportProductosCSV(); lucide.createIcons(); };
    document.getElementById('exportVentasCSVBtn').onclick = function () { exportVentasCSV().then(function () { lucide.createIcons(); }); };
    document.getElementById('exportClientesCSVBtn').onclick = function () { exportClientesCSV().then(function () { lucide.createIcons(); }); };

    // WhatsApp Deudores (manual) — solo si existe el botón (bloque opcional)
    var sendWhatsAppEl = document.getElementById('sendWhatsApp');
    if (sendWhatsAppEl) {
      sendWhatsAppEl.onclick = function () {
        var tel = (document.getElementById('deudorTel') && document.getElementById('deudorTel').value || '').replace(/\D/g, '');
        var nombre = (document.getElementById('deudorNombre') && document.getElementById('deudorNombre').value) || 'Cliente';
        var monto = (document.getElementById('deudorMonto') && document.getElementById('deudorMonto').value) || '0';
        var template = (currentUser && currentUser.whatsappMessage) ? currentUser.whatsappMessage : DEFAULT_WHATSAPP;
        var msg = template.replace(/\{cliente\}/gi, nombre).replace(/\{monto\}/gi, monto);
        window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank');
      };
    }

    // Modal producto
    document.getElementById('addProduct').onclick = () => {
      const d = getData();
      if (Object.keys(d.products || {}).length >= 100) {
        alert('Llegaste al límite de 100 productos. Eliminá alguno para agregar uno nuevo.');
        return;
      }
      document.getElementById('productModalTitle').textContent = 'Nuevo producto';
      document.getElementById('prodEditCodigo').value = '';
      document.getElementById('prodNombre').value = '';
      document.getElementById('prodCodigo').value = '';
      document.getElementById('prodPrecio').value = '';
      document.getElementById('prodCosto').value = '';
      document.getElementById('prodMargen').value = '';
      document.getElementById('prodStock').value = '10';
      document.getElementById('prodStockInicial').value = '';
      document.getElementById('prodStockInicialWrap').classList.add('hidden');
      document.getElementById('deleteProductInModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('hidden');
      document.getElementById('productModal').classList.add('flex');
      _userTouchedCost = false;
      if (typeof updateCostoCampoEstado === 'function') updateCostoCampoEstado();
      document.getElementById('prodMargenError').classList.add('hidden');
      lucide.createIcons();
    };
    document.getElementById('deleteProductInModal').onclick = () => {
      const codigo = document.getElementById('prodEditCodigo').value;
      if (!codigo) return;
      if (confirm('¿Eliminar este producto?')) {
        deleteProduct(codigo);
        document.getElementById('productModal').classList.add('hidden');
        document.getElementById('productModal').classList.remove('flex');
      }
    };
    function closeProductModal() {
      window._scanForProductCode = false;
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
    }
    document.getElementById('modalOverlay').onclick = closeProductModal;
    document.getElementById('productModalBack').onclick = closeProductModal;
    document.getElementById('prodEscanearCodigo').onclick = () => {
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
      window._scanForProductCode = true;
      goToPanel('scanner');
    };
    document.getElementById('addAnotherProduct').onclick = () => {
      closeCart();
    };
    var _updatingPrecioFromCosto = false;
    var _updatingCostoFromPrecio = false;
    var _userTouchedCost = false;
    function updatePrecioFromCostoMargen() {
      if (_updatingCostoFromPrecio) return;
      var costo = parseFloat(document.getElementById('prodCosto').value) || 0;
      var margen = parseFloat(document.getElementById('prodMargen').value) || 0;
      if (costo > 0 && margen >= 0) {
        _updatingPrecioFromCosto = true;
        document.getElementById('prodPrecio').value = roundToNearest100(costo * (1 + margen / 100));
        _updatingPrecioFromCosto = false;
      }
    }
    function updateCostoFromPrecioMargen() {
      if (_updatingPrecioFromCosto) return;
      var costoActual = parseFloat(document.getElementById('prodCosto').value) || 0;
      if (costoActual > 0 && _userTouchedCost) return;
      var precio = parseFloat(document.getElementById('prodPrecio').value) || 0;
      var margen = parseFloat(document.getElementById('prodMargen').value) || 0;
      if (precio > 0 && margen >= 0) {
        var costoCalc = Math.round(precio / (1 + margen / 100));
        _updatingCostoFromPrecio = true;
        document.getElementById('prodCosto').value = costoCalc;
        _updatingCostoFromPrecio = false;
      }
    }
    function updateCostoCampoEstado() {
      var costo = parseFloat(document.getElementById('prodCosto').value) || 0;
      var precioFocused = document.activeElement === document.getElementById('prodPrecio');
      var costoEl = document.getElementById('prodCosto');
      var hintEl = document.getElementById('prodCostoHint');
      var mostrarConflicto = costo > 0 && precioFocused;
      if (mostrarConflicto) {
        costoEl.classList.add('border-red-500/80');
        costoEl.classList.remove('border-white/20');
        if (hintEl) { hintEl.classList.remove('hidden'); }
      } else {
        costoEl.classList.remove('border-red-500/80');
        costoEl.classList.add('border-white/20');
        if (hintEl) { hintEl.classList.add('hidden'); }
      }
    }
    document.getElementById('prodCosto').addEventListener('focus', function () { _userTouchedCost = true; updateCostoCampoEstado(); });
    document.getElementById('prodCosto').addEventListener('input', function () { _userTouchedCost = true; updatePrecioFromCostoMargen(); updateCostoCampoEstado(); });
    document.getElementById('prodMargen').addEventListener('input', function () { updatePrecioFromCostoMargen(); updateCostoFromPrecioMargen(); updateCostoCampoEstado(); });
    document.getElementById('prodPrecio').addEventListener('input', function () { updateCostoFromPrecioMargen(); updateCostoCampoEstado(); });
    document.getElementById('prodPrecio').addEventListener('focus', updateCostoCampoEstado);
    document.getElementById('prodPrecio').addEventListener('blur', updateCostoCampoEstado);
    document.getElementById('saveProduct').onclick = () => {
      var margenErr = document.getElementById('prodMargenError');
      var margenVal = document.getElementById('prodMargen').value.trim();
      if (margenVal === '' || isNaN(parseFloat(margenVal))) {
        margenErr.classList.remove('hidden');
        return;
      }
      margenErr.classList.add('hidden');
      const nombre = document.getElementById('prodNombre').value.trim();
      const codigoNuevo = document.getElementById('prodCodigo').value.trim() || Date.now().toString();
      const precio = parseInt(document.getElementById('prodPrecio').value) || 0;
      const costo = parseFloat(document.getElementById('prodCosto').value) || 0;
      const stock = parseInt(document.getElementById('prodStock').value) || 0;
      const stockInicialWrap = document.getElementById('prodStockInicialWrap');
      const stockInicialEl = document.getElementById('prodStockInicial');
      const stockInicial = stockInicialWrap.classList.contains('hidden') ? stock : (parseInt(stockInicialEl.value) || stock);
      const editCodigo = document.getElementById('prodEditCodigo').value.trim();
      const d = getData();
      d.products = d.products || {};
      const isNew = !editCodigo;
      if (isNew && Object.keys(d.products).length >= 100) {
        alert('Límite de 100 productos alcanzado.');
        return;
      }
      if (!nombre || precio <= 0) return;
      if (editCodigo) {
        const oldProduct = d.products[editCodigo];
        const stockInicialFinal = oldProduct && (stockInicialEl.value !== '' && !stockInicialWrap.classList.contains('hidden')) ? (parseInt(stockInicialEl.value) || oldProduct.stockInicial) : (oldProduct?.stockInicial ?? stock);
        if (editCodigo !== codigoNuevo) {
          delete d.products[editCodigo];
        }
        d.products[codigoNuevo] = { nombre, codigo: codigoNuevo, precio, stock, stockInicial: stockInicialFinal, costo };
        state.cart.forEach(item => {
          if (item.codigo === editCodigo || item.codigo === codigoNuevo) {
            item.codigo = codigoNuevo;
            item.nombre = nombre;
            item.precio = precio;
            item.costo = costo;
          }
        });
      } else {
        d.products[codigoNuevo] = { nombre, codigo: codigoNuevo, precio, stock, stockInicial: stockInicial || stock, costo };
      }
      setData(d);
      renderInventory();
      updateCartUI();
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
    };

  
    document.getElementById('searchInventory').addEventListener('input', renderInventory);

   // --- Login / Logout / SaaS ---
async function showApp() {
    const isSuper = currentUser && currentUser.role === 'super';
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appWrap').classList.remove('hidden');
    document.querySelectorAll('.kiosquero-only').forEach(el => el.style.display = isSuper ? 'none' : '');
    document.querySelectorAll('.super-only').forEach(el => {
      el.style.display = isSuper ? (el.tagName === 'BUTTON' ? 'inline-flex' : 'block') : 'none';
    });
    document.getElementById('navKiosquero').classList.toggle('hidden', isSuper);
    var navSuperBottom = document.getElementById('navSuperBottom');
    if (navSuperBottom) navSuperBottom.classList.toggle('hidden', !isSuper);
    document.getElementById('headerTitle').textContent = (!isSuper && currentUser.kioscoName) ? currentUser.kioscoName : 'FERRIOL OS';
    var subEl = document.getElementById('headerSub');
    if (subEl) {
      if (isSuper) subEl.textContent = 'Administración';
      else if (currentUser.trialEndsAt && new Date(currentUser.trialEndsAt) > new Date()) subEl.textContent = 'Sistema de prueba';
      else subEl.textContent = 'Sistema Premium';
    }

    if (isSuper) {
        goToPanel('super');
        lucide.createIcons();
    } else {
        if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
        window._trialCountdownInterval = setInterval(updateTrialCountdown, 1000);
        await initData(); // <--- AHORA EL 'await' SÍ FUNCIONA
        renderInventory();
        updateCartUI();
        updateDashboard();
        state._restoringFromHistory = true;
        showPanel('dashboard');
        state._restoringFromHistory = false;
        history.replaceState({ panel: 'dashboard' }, '', location.href);
        lucide.createIcons();
    }
} // <--- ASEGURATE DE QUE ESTA LLAVE CIERRE TODO EL BLOQUE

    async function doLogin() {
      const email = document.getElementById('loginEmail').value.trim();
      const pass = document.getElementById('loginPassword').value;
      const errEl = document.getElementById('loginErr');
      errEl.classList.remove('show');
      document.getElementById('loginContactAdminWrap').classList.add('hidden');
      errEl.style.color = '#fca5a5';
      if (!supabaseClient) {
        errEl.textContent = (!window.supabase || typeof window.supabase.createClient !== 'function')
          ? 'No se cargó la librería de Supabase. Revisá la conexión o bloqueos del navegador (extensiones, firewall) y recargá la página.'
          : 'Configurá SUPABASE_URL y SUPABASE_ANON_KEY en kiosco-config.js.';
        errEl.classList.add('show');
        return;
      }
      if (!email) {
        errEl.textContent = 'Ingresá tu email.';
        errEl.classList.add('show');
        return;
      }
      if (!pass || pass.length === 0) {
        errEl.textContent = 'Ingresá tu contraseña.';
        errEl.classList.add('show');
        return;
      }
      try {
        const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
        if (authErr) {
          let msg = authErr.message || authErr.error_description || 'Error de autenticación';
          const invalidCreds = (msg === 'Invalid login credentials') || (authErr.status === 400 && typeof msg === 'string' && msg.toLowerCase().includes('invalid'));
          if (invalidCreds) {
            msg = 'Email o contraseña incorrectos. Revisá los datos o usá "¿Olvidaste tu contraseña?" para restablecerla.';
          } else if (msg && (msg.includes('Email not confirmed') || msg.includes('email not confirmed'))) {
            msg = 'Confirmá tu email primero. Revisá tu bandeja (y spam) por el correo de Supabase.';
          } else if (authErr.status === 400) {
            msg = 'Error al iniciar sesión. Verificá en Supabase: Authentication → Providers → Email habilitado.';
          }
          if (!invalidCreds) console.error('Supabase auth error:', authErr);
          errEl.textContent = msg;
          errEl.classList.add('show');
          return;
        }
        const uid = authData.user.id;
        let { data: profile, error: profileErr } = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
        if (profileErr && profileErr.code !== 'PGRST116') {
          errEl.textContent = 'Error al leer perfil: ' + (profileErr.message || 'verificá RLS en la tabla profiles');
          errEl.classList.add('show');
          return;
        }
        if (!profile) {
          const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
          const { error: insertErr } = await supabaseClient.from('profiles').insert({ id: uid, email: authData.user.email, role: 'kiosquero', active: true, trial_ends_at: trialEndsAt });
          if (insertErr) {
            errEl.textContent = 'Error al crear perfil: ' + (insertErr.message || 'creá la tabla profiles y sus políticas RLS');
            errEl.classList.add('show');
            return;
          }
          const r = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
          profile = r.data;
          if (!profile) {
            errEl.textContent = 'No se pudo obtener el perfil. Revisá RLS en Supabase (profiles).';
            errEl.classList.add('show');
            return;
          }
        }
        if (profile.role === 'kiosquero' && !profile.active) {
          try {
            const { data: setData } = await supabaseClient.from('app_settings').select('value').eq('key', 'admin_whatsapp').maybeSingle();
            window._adminWhatsappForContact = (setData && setData.value) ? setData.value : '';
          } catch (_) { window._adminWhatsappForContact = ''; }
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = 'Tu cuenta está desactivada. Contactá al administrador por WhatsApp para darte de alta.';
          errEl.classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            await loadAdminContact();
            fillLoginContactLinks('Hola, mi cuenta de Ferriol OS está desactivada y quiero darme de alta.');
            wrap.classList.remove('hidden');
          }
          return;
        }
        const trialEndsAt = profile.trial_ends_at || null;
        if (profile.role === 'kiosquero' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', uid);
            await loadAdminContact();
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá por WhatsApp para renovar.';
          errEl.classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi período de prueba de Ferriol OS terminó y quiero renovar.');
            wrap.classList.remove('hidden');
          }
          return;
        }
        var userCreatedAt = (authData && authData.user && authData.user.created_at) ? authData.user.created_at : null;
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt };
        await showApp();
      } catch (err) {
        console.error('Error en login:', err);
        const msg = 'Error inesperado: ' + (err.message || String(err));
        errEl.textContent = msg;
        errEl.classList.add('show');
        alert(msg);
      }
    }
    document.getElementById('loginBtn').onclick = doLogin;
    document.getElementById('loginForm').onsubmit = (e) => { e.preventDefault(); doLogin(); };

    function setupPasswordToggle(checkboxId, inputId) {
      const checkbox = document.getElementById(checkboxId);
      const input = document.getElementById(inputId);
      const label = checkbox ? checkbox.closest('label') : null;
      const labelSpan = label ? label.querySelector('.pwd-label') : null;
      if (!checkbox || !input) return;
      function sync() {
        const show = checkbox.checked;
        input.type = show ? 'text' : 'password';
        if (labelSpan) labelSpan.textContent = show ? 'Ocultar' : 'Ver';
        if (label) label.title = show ? 'Ocultar contraseña' : 'Ver contraseña';
      }
      checkbox.addEventListener('change', sync);
    }
    setupPasswordToggle('showLoginPwd', 'loginPassword');
    setupPasswordToggle('showSignUpPwd', 'signUpPassword');
    setupPasswordToggle('showNewPwd', 'newPwdInput');

    document.getElementById('doSetNewPwd').onclick = async () => {
      const newPwd = document.getElementById('newPwdInput').value.trim();
      const errEl = document.getElementById('loginErr');
      errEl.classList.remove('show');
      errEl.style.color = '#fca5a5';
      if (!newPwd || newPwd.length < 6) {
        errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
        errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.updateUser({ password: newPwd });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        return;
      }
      errEl.textContent = 'Contraseña actualizada. Ya podés iniciar sesión con la nueva contraseña.';
      errEl.style.color = '#86efac';
      errEl.classList.add('show');
      document.getElementById('setNewPwdBox').classList.add('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      history.replaceState(null, '', location.pathname + location.search);
    };

    document.getElementById('showSignUp').onclick = (e) => {
      e.preventDefault();
      document.getElementById('loginFormWrap').classList.add('hidden');
      document.getElementById('resetPwdBox').classList.add('hidden');
      document.getElementById('signUpBox').classList.remove('hidden');
      document.getElementById('signUpSuccessBox').classList.add('hidden');
      document.getElementById('signUpErr').classList.remove('show');
    };
    document.getElementById('backToLogin').onclick = (e) => {
      e.preventDefault();
      document.getElementById('signUpBox').classList.add('hidden');
      document.getElementById('signUpSuccessBox').classList.add('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
    };
    document.getElementById('goToLoginBtn').onclick = () => {
      document.getElementById('signUpSuccessBox').classList.add('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      if (window._lastSignUpEmail) {
        document.getElementById('loginEmail').value = window._lastSignUpEmail;
        window._lastSignUpEmail = '';
      }
    };
    document.getElementById('forgotPwd').onclick = (e) => {
      e.preventDefault();
      document.getElementById('signUpBox').classList.add('hidden');
      document.getElementById('resetPwdBox').classList.toggle('hidden');
      document.getElementById('resetPwdEmail').value = document.getElementById('loginEmail').value;
    };
    document.getElementById('doResetPwd').onclick = async () => {
      const email = document.getElementById('resetPwdEmail').value.trim();
      const errEl = document.getElementById('loginErr');
      errEl.classList.remove('show');
      errEl.style.color = '#fca5a5';
      if (!email) {
        errEl.textContent = 'Ingresá tu email.';
        errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) {
        errEl.textContent = 'Supabase no está configurado.';
        errEl.classList.add('show');
        return;
      }
      const redirectUrl = (APP_URL && !APP_URL.includes('TU-USUARIO')) ? APP_URL : window.location.href;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        return;
      }
      errEl.textContent = 'Revisá tu email. Te enviamos un enlace para restablecer la contraseña.';
      errEl.style.color = '#86efac';
      errEl.classList.add('show');
      document.getElementById('resetPwdBox').classList.add('hidden');
    };
    (function () {
      var termsHtml = '<p><strong>1. ACEPTACIÓN.</strong> Al crear una cuenta en Ferriol OS (“el Servicio”) aceptás estos Términos y Condiciones y el Contrato de Servicio. Si no aceptás, no podés usar el Servicio.</p>' +
        '<p><strong>2. DESCRIPCIÓN DEL SERVICIO.</strong> Ferriol OS es un sistema de gestión para kioscos y comercios ofrecido “tal cual” (as is). No garantizamos disponibilidad ininterrumpida ni ausencia de errores.</p>' +
        '<p><strong>3. PÉRDIDA DE DATOS — EXENCIÓN DE RESPONSABILIDAD.</strong> Ferriol OS y sus titulares <strong>no se hacen responsables</strong> por ninguna pérdida, corrupción o indisponibilidad de datos (productos, ventas, deudores, configuraciones o cualquier otro dato cargado en el Servicio). El usuario es responsable de realizar copias de seguridad periódicas utilizando las herramientas que ofrece la aplicación. El Servicio no sustituye el respaldo propio de la información crítica del negocio.</p>' +
        '<p><strong>4. DATOS Y PROPIEDAD.</strong> Los datos que el usuario ingresa en el Servicio son de su negocio. Ferriol OS actúa como proveedor del software y de la plataforma. El usuario otorga a Ferriol OS la licencia necesaria para almacenar, procesar y mostrar dichos datos con el fin de prestar el Servicio. Ferriol OS no vende los datos personales o de negocio del usuario a terceros. Los datos generados o alojados en la plataforma están sujetos a la política de uso del Servicio y a la legislación aplicable.</p>' +
        '<p><strong>5. USO ACEPTABLE.</strong> El usuario se compromete a usar el Servicio de forma lícita. Queda prohibido usarlo para actividades ilegales, fraudulentas o que vulneren derechos de terceros. Ferriol OS se reserva el derecho de suspender o dar de baja cuentas que incumplan estos términos.</p>' +
        '<p><strong>6. LIMITACIÓN DE RESPONSABILIDAD.</strong> En la máxima medida permitida por la ley aplicable, Ferriol OS y sus titulares no serán responsables por daños indirectos, incidentales, especiales, consecuentes o punitivos (incluyendo pérdida de beneficios, datos, clientes o buena voluntad). La responsabilidad total no excederá el monto abonado por el usuario en los últimos 12 meses por el Servicio, o cero si el Servicio fue gratuito.</p>' +
        '<p><strong>7. EXENCIÓN DE GARANTÍAS.</strong> El Servicio se presta “tal cual” y “según disponibilidad”. No ofrecemos garantías de ningún tipo, expresas o implícitas (incluyendo comerciabilidad o idoneidad para un fin determinado).</p>' +
        '<p><strong>8. SUSCRIPCIÓN Y CANCELACIÓN.</strong> La suscripción o período de prueba pueden estar sujetos a condiciones adicionales. Ferriol OS puede modificar, suspender o discontinuar el Servicio o estas condiciones, notificando cuando sea razonable. El usuario puede cerrar su cuenta en cualquier momento.</p>' +
        '<p><strong>9. JURISDICCIÓN.</strong> Estos términos se rigen por las leyes de la República Argentina. Cualquier controversia será sometida a los tribunales competentes en la República Argentina.</p>' +
        '<p><strong>10. CONTACTO.</strong> Para consultas sobre estos términos: contactar a Ferriol OS por los canales oficiales indicados en la aplicación.</p>' +
        '<p class="text-white/60 text-xs mt-4">Última actualización: 2025. Ferriol OS.</p>';
      document.getElementById('openTermsModal').onclick = function () {
        document.getElementById('termsContent').innerHTML = termsHtml;
        document.getElementById('termsModal').classList.remove('hidden');
        document.getElementById('termsModal').classList.add('flex');
      };
      document.getElementById('closeTermsModal').onclick = function () {
        document.getElementById('termsModal').classList.add('hidden');
        document.getElementById('termsModal').classList.remove('flex');
      };
      document.getElementById('termsModal').onclick = function (e) {
        if (e.target === document.getElementById('termsModal')) {
          document.getElementById('termsModal').classList.add('hidden');
          document.getElementById('termsModal').classList.remove('flex');
        }
      };
    })();

    document.getElementById('doSignUp').onclick = async () => {
      const email = document.getElementById('signUpEmail').value.trim();
      const password = document.getElementById('signUpPassword').value;
      const kioscoName = document.getElementById('signUpKioscoName').value.trim();
      const phone = document.getElementById('signUpPhone').value.trim();
      const errEl = document.getElementById('signUpErr');
      errEl.classList.remove('show');
      if (!document.getElementById('signUpAcceptTerms').checked) {
        errEl.textContent = 'Debés aceptar los Términos y Condiciones para crear la cuenta.';
        errEl.classList.add('show');
        return;
      }
      if (!email || !password || password.length < 6) {
        errEl.textContent = 'Email y contraseña (mín. 6 caracteres) son obligatorios.';
        errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) {
        errEl.textContent = 'Configurá Supabase en el código.';
        errEl.classList.add('show');
        return;
      }
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        return;
      }
      const newId = data?.user?.id;
      const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
      if (!newId) {
        errEl.textContent = 'Registro recibido. Si tu proyecto pide confirmar el email, abrí el enlace del correo (y spam) antes de iniciar sesión. Después usá el mismo email y contraseña.';
        errEl.classList.add('show');
        return;
      }
      var upProf = await supabaseClient.from('profiles').upsert({
        id: newId,
        email: email,
        role: 'kiosquero',
        active: true,
        kiosco_name: kioscoName || null,
        trial_ends_at: trialEndsAt,
        phone: phone || null
      }, { onConflict: 'id' });
      if (upProf.error) {
        errEl.textContent = 'Usuario registrado, pero el perfil no se guardó: ' + (upProf.error.message || '') + ' Usá «Volver al inicio de sesión» e intentá entrar con el mismo email y contraseña. Si no entrás, revisá en Supabase la tabla profiles (columna phone, políticas RLS).';
        errEl.classList.add('show');
        return;
      }
      document.getElementById('signUpBox').classList.add('hidden');
      document.getElementById('signUpSuccessBox').classList.remove('hidden');
      window._lastSignUpEmail = email;
    };

    function doLogout() {
      if (supabaseClient) supabaseClient.auth.signOut();
      currentUser = null;
      state.cart = [];
      state.transaccionesList = [];
      _dataCache = { products: {}, ventas: { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 }, transacciones: 0, deudores: [] };
      document.getElementById('appWrap').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('loginPassword').value = '';
    }
    document.getElementById('logoutBtn').onclick = doLogout;
    var logoutConfigEl = document.getElementById('logoutBtnConfig');
    if (logoutConfigEl) logoutConfigEl.onclick = doLogout;

    function fillConfigForm() {
      if (!currentUser || currentUser.role === 'super') return;
      document.getElementById('configKioscoName').value = currentUser.kioscoName || '';
      document.getElementById('configWhatsappMsg').value = currentUser.whatsappMessage || DEFAULT_WHATSAPP;
      var list = getCobroRapidoProductosList();
      for (var i = 1; i <= 4; i++) {
        var item = list[i - 1];
        var nom = (item && item.nombre) ? item.nombre : ('Producto ' + i);
        var marg = (item && item.margen != null) ? item.margen : 0;
        var el = document.getElementById('configCobroRapido' + i);
        var mel = document.getElementById('configCobroRapidoMargen' + i);
        if (el) el.value = nom;
        if (mel) mel.value = marg;
      }
    }
    async function saveConfig() {
      if (!currentUser || currentUser.role === 'super') return;
      const kioscoName = document.getElementById('configKioscoName').value.trim();
      const whatsappMessage = document.getElementById('configWhatsappMsg').value.trim() || DEFAULT_WHATSAPP;
      var cr = [];
      for (var i = 1; i <= 4; i++) {
        var el = document.getElementById('configCobroRapido' + i);
        var mel = document.getElementById('configCobroRapidoMargen' + i);
        var nombre = el ? ((el.value || '').trim() || 'Producto ' + i) : 'Producto ' + i;
        var margen = mel ? (parseFloat(mel.value) || 0) : 0;
        cr.push({ nombre: nombre, margen: margen });
      }
      setCobroRapidoProductosList(cr);
      if (supabaseClient) {
        await supabaseClient.from('profiles').update({ kiosco_name: kioscoName, whatsapp_message: whatsappMessage }).eq('id', currentUser.id);
      }
      currentUser.kioscoName = kioscoName;
      currentUser.whatsappMessage = whatsappMessage;
      document.getElementById('headerTitle').textContent = kioscoName || 'Ferriol OS';
    }
    document.getElementById('saveConfig').onclick = () => saveConfig();

    async function exportBackup() {
      if (!currentUser?.id) return;
      var d = getData();
      var clientesExport = [];
      if (supabaseClient && currentUser.id) {
        try {
          var res = await supabaseClient.from('clientes').select('id, nombre, telefono, email, direccion, notas').eq('user_id', currentUser.id);
          if (!res.error && res.data) clientesExport = res.data;
        } catch (_) {}
      }
      var backup = {
        version: 2,
        exportedAt: new Date().toISOString(),
        userId: currentUser.id,
        kioscoName: currentUser.kioscoName || '',
        products: d.products || {},
        ventas: d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0 },
        transacciones: d.transacciones || 0,
        saldosACobrar: d.saldosACobrar || [],
        clientes: clientesExport,
        lastCierreDate: d.lastCierreDate || null,
        transaccionesList: (state && state.transaccionesList) ? state.transaccionesList : []
      };
      var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ferriol-respaldo-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      var msg = document.getElementById('backupMessage');
      if (msg) { msg.textContent = 'Copia exportada (productos, clientes, deudas). Guardá el archivo en un lugar seguro.'; msg.classList.remove('hidden'); msg.className = 'text-sm mt-2 text-green-400'; setTimeout(function () { msg.classList.add('hidden'); }, 4000); }
      lucide.createIcons();
    }
    function importBackup(file) {
      if (!file || !currentUser?.id) return;
      var msgEl = document.getElementById('backupMessage');
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          var backup = JSON.parse(reader.result);
          if (!backup || typeof backup !== 'object') throw new Error('Archivo no válido');
          if (backup.products && typeof backup.products === 'object') _dataCache.products = backup.products;
          if (backup.ventas && typeof backup.ventas === 'object') _dataCache.ventas = backup.ventas;
          if (backup.transacciones !== undefined) _dataCache.transacciones = backup.transacciones;
          if (backup.saldosACobrar && Array.isArray(backup.saldosACobrar)) _dataCache.saldosACobrar = backup.saldosACobrar;
          if (backup.lastCierreDate !== undefined) _dataCache.lastCierreDate = backup.lastCierreDate;
          if (backup.transaccionesList && Array.isArray(backup.transaccionesList) && state) state.transaccionesList = backup.transaccionesList;
          if (backup.clientes && Array.isArray(backup.clientes) && supabaseClient && currentUser.id) {
            await supabaseClient.from('clientes').delete().eq('user_id', currentUser.id);
            var rows = backup.clientes.map(function (c) {
              return { user_id: currentUser.id, nombre: c.nombre || null, telefono: c.telefono || null, email: c.email || null, direccion: c.direccion || null, notas: c.notas || null };
            });
            if (rows.length) await supabaseClient.from('clientes').insert(rows);
            clientesCache = backup.clientes.map(function (c, i) { return { id: c.id || '', nombre: c.nombre, telefono: c.telefono, email: c.email, direccion: c.direccion, notas: c.notas }; });
          }
          saveToLocalStorage();
          setData({ products: _dataCache.products, ventas: _dataCache.ventas, transacciones: _dataCache.transacciones, saldosACobrar: _dataCache.saldosACobrar, lastCierreDate: _dataCache.lastCierreDate });
          if (msgEl) { msgEl.textContent = 'Datos restaurados (productos, clientes, deudas). Recargá la página si no ves los cambios.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-sm mt-2 text-green-400'; setTimeout(function () { msgEl.classList.add('hidden'); }, 5000); }
          renderInventory();
          updateDashboard();
          renderSaldosACobrar();
          if (typeof loadClientes === 'function') loadClientes().then(function () { if (typeof renderClientes === 'function') renderClientes(); });
        } catch (e) {
          if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'archivo no válido'); msgEl.classList.remove('hidden'); msgEl.className = 'text-sm mt-2 text-red-400'; }
        }
      };
      reader.readAsText(file);
    }
    document.getElementById('btnExportBackup').onclick = exportBackup;
    document.getElementById('inputImportBackup').onchange = function (e) { var f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };

    var adminContact = { whatsapp: '', whatsappList: [] };
    function getWhatsAppUrl(num, text) {
      var digits = (num || '').replace(/\D/g, '');
      if (!digits) return '';
      var url = 'https://wa.me/' + digits;
      if (text) url += '?text=' + encodeURIComponent(text);
      return url;
    }
    async function loadAdminContact() {
      if (!supabaseClient) return;
      try {
        var res = await supabaseClient.from('app_settings').select('key, value').in('key', ['admin_whatsapp', 'admin_whatsapp_2', 'admin_whatsapp_3', 'admin_whatsapp_4']);
        var list = [];
        if (res.data && res.data.length) {
          var order = { admin_whatsapp: 0, admin_whatsapp_2: 1, admin_whatsapp_3: 2, admin_whatsapp_4: 3 };
          res.data.sort(function (a, b) { return (order[a.key] || 9) - (order[b.key] || 9); });
          res.data.forEach(function (r) {
            var v = (r.value || '').trim().replace(/\D/g, '');
            if (v) list.push(v);
          });
        }
        adminContact.whatsappList = list;
        adminContact.whatsapp = list[0] || '';
      } catch (_) {}
    }
    function fillRenovarWhatsAppLinks() {
      var container = document.getElementById('renovarWhatsAppLinks');
      if (!container) return;
      var list = adminContact.whatsappList && adminContact.whatsappList.length ? adminContact.whatsappList : (adminContact.whatsapp ? [adminContact.whatsapp] : []);
      var msg = 'Hola, necesito ayuda con mi cuenta de Ferriol OS.';
      if (list.length === 0) {
        container.innerHTML = '<p class="text-white/60 text-sm">El administrador aún no configuró su WhatsApp.</p>';
      } else {
        container.innerHTML = list.map(function (num, i) {
          var label = list.length > 1 ? 'Contactar por WhatsApp (' + (i + 1) + ')' : 'Contactar por WhatsApp';
          return '<a href="' + getWhatsAppUrl(num, msg) + '" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-medium touch-target"><i data-lucide="message-circle" class="w-5 h-5"></i> ' + label + '</a>';
        }).join('');
      }
      lucide.createIcons();
    }
    function fillLoginContactLinks(message) {
      var container = document.getElementById('loginContactWhatsAppLinks');
      if (!container) return;
      var list = adminContact.whatsappList && adminContact.whatsappList.length ? adminContact.whatsappList : (adminContact.whatsapp ? [adminContact.whatsapp] : []);
      var msg = message || 'Hola, necesito ayuda con mi cuenta de Ferriol OS.';
      if (list.length === 0) {
        container.innerHTML = '<a href="#" class="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-medium text-sm touch-target"><i data-lucide="message-circle" class="w-5 h-5"></i> Contactar por WhatsApp</a>';
      } else {
        container.innerHTML = list.map(function (num, i) {
          var label = list.length > 1 ? 'Contactar por WhatsApp (' + (i + 1) + ')' : 'Contactar por WhatsApp';
          return '<a href="' + getWhatsAppUrl(num, msg) + '" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-medium text-sm touch-target"><i data-lucide="message-circle" class="w-5 h-5"></i> ' + label + '</a>';
        }).join('');
      }
      lucide.createIcons();
    }
    var superUserListCache = [];
    function trialLabel(endsAt) {
      if (!endsAt) return { text: '—', days: 0 };
      const end = new Date(endsAt);
      const now = new Date();
      const days = Math.ceil((end - now) / (24 * 60 * 60 * 1000));
      if (days <= 0) return { text: 'Vencida', days: 0 };
      return { text: days + ' días', days };
    }
    /** Cuenta regresiva completa: días, horas, minutos, segundos (para panel admin) */
    function trialLabelFull(endsAt) {
      if (!endsAt) return { text: '—', d: 0, h: 0, m: 0, s: 0, expired: true };
      const end = new Date(endsAt);
      const now = new Date();
      let ms = end - now;
      if (isNaN(ms) || ms <= 0) return { text: 'Vencida', d: 0, h: 0, m: 0, s: 0, expired: true };
      const s = Math.floor((ms / 1000) % 60);
      const m = Math.floor((ms / (1000 * 60)) % 60);
      const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
      const d = Math.floor(ms / (1000 * 60 * 60 * 24));
      const text = d + 'd ' + h + 'h ' + m + 'm ' + s + 's';
      return { text, d, h, m, s, expired: false };
    }
    var superDetailCountdownInterval = null;
    var superListCountdownInterval = null;
    function updateSuperListCountdowns() {
      document.querySelectorAll('#panel-super .super-list-countdown').forEach(function (span) {
        var card = span.closest('.super-user-card');
        var endsAt = card && card.getAttribute('data-trial-ends-at');
        var t = trialLabelFull(endsAt);
        span.textContent = t.expired ? 'Vencida' : t.text;
        span.className = 'super-list-countdown px-2 py-1 rounded-lg text-xs ' + (t.expired ? 'bg-red-500/20 text-red-300' : 'bg-[#7c3aed]/30 text-[#a78bfa]');
      });
    }
    function openSuperUserDetail(user) {
      if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval);
      superDetailCountdownInterval = null;
      const modal = document.getElementById('superUserDetailModal');
      const title = document.getElementById('superUserDetailTitle');
      const content = document.getElementById('superUserDetailContent');
      const name = (user.kiosco_name || user.email || 'Sin nombre').replace(/</g, '&lt;');
      const email = (user.email || '').replace(/</g, '&lt;');
      const trialFull = trialLabelFull(user.trial_ends_at);
      title.textContent = name;
      content.innerHTML = `
        <div class="space-y-1 text-sm text-white/80">
          <p><span class="text-white/50">Email:</span> ${email || '—'}</p>
          <p><span class="text-white/50">Rol:</span> ${(user.role || 'kiosquero').replace(/</g, '&lt;')}</p>
          <p><span class="text-white/50">Estado:</span> <span class="${user.active ? 'text-green-300' : 'text-red-300'}">${user.active ? 'Activo' : 'Inactivo'}</span></p>
          <p><span class="text-white/50">Membresía:</span> <span id="superDetailCountdown" class="${trialFull.expired ? 'text-red-300' : 'text-[#a78bfa]'}">${trialFull.text}</span></p>
        </div>
        <div class="border-t border-white/10 pt-4 space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm text-white/70">Activar/Desactivar:</span>
            <button type="button" class="super-detail-toggle toggle-switch ${user.active ? 'active' : ''}" title="${user.active ? 'Desactivar' : 'Activar'}"></button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-white/70 w-full">Días de membresía:</span>
            <input type="number" min="1" max="365" value="30" class="super-detail-days-input w-16 px-2 py-2 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">
            <button type="button" class="super-detail-add-days px-3 py-2 rounded-lg text-sm bg-green-500/20 text-green-300 border border-green-500/40 touch-target">+ Agregar</button>
            <button type="button" class="super-detail-remove-days px-3 py-2 rounded-lg text-sm bg-red-500/20 text-red-300 border border-red-500/40 touch-target">− Quitar</button>
          </div>
          <div class="flex flex-col gap-2 pt-2">
            <button type="button" class="super-detail-reset w-full py-2.5 rounded-xl text-sm bg-amber-500/20 text-amber-300 border border-amber-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="key" class="w-4 h-4"></i> Enviar enlace para restablecer contraseña
            </button>
            <button type="button" class="super-detail-email w-full py-2.5 rounded-xl text-sm bg-[#7c3aed]/30 text-[#a78bfa] border border-[#7c3aed]/50 touch-target flex items-center justify-center gap-2">
              <i data-lucide="mail" class="w-4 h-4"></i> Cómo cambiar el email (Supabase)
            </button>
            <button type="button" class="super-detail-quitar w-full py-2.5 rounded-xl text-sm bg-red-500/20 text-red-300 border border-red-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="user-minus" class="w-4 h-4"></i> Quitar negocio (pide contraseña admin)
            </button>
          </div>
        </div>
      `;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      lucide.createIcons();
      var u = user;
      content.querySelector('.super-detail-toggle').onclick = async () => {
        if (!supabaseClient) return;
        const newActive = !u.active;
        await supabaseClient.from('profiles').update({ active: newActive }).eq('id', u.id);
        u.active = newActive;
        openSuperUserDetail(u);
      };
      content.querySelector('.super-detail-add-days').onclick = async () => {
        if (!supabaseClient) return;
        const input = content.querySelector('.super-detail-days-input');
        const days = Math.max(1, Math.min(365, parseInt(input.value || 30, 10) || 30));
        const now = new Date();
        const currentEnd = u.trial_ends_at ? new Date(u.trial_ends_at) : null;
        const from = (currentEnd && currentEnd > now) ? currentEnd : now;
        const newEnd = new Date(from);
        newEnd.setDate(newEnd.getDate() + days);
        u.trial_ends_at = newEnd.toISOString().slice(0, 19) + 'Z';
        const { error } = await supabaseClient.from('profiles').update({ trial_ends_at: u.trial_ends_at, active: true }).eq('id', u.id);
        if (error) { alert('Error: ' + error.message); return; }
        u.active = true;
        openSuperUserDetail(u);
      };
      content.querySelector('.super-detail-remove-days').onclick = async () => {
        if (!supabaseClient) return;
        const input = content.querySelector('.super-detail-days-input');
        const days = Math.max(1, Math.min(365, parseInt(input.value || 30, 10) || 30));
        const currentEnd = u.trial_ends_at ? new Date(u.trial_ends_at) : new Date();
        const newEnd = new Date(currentEnd);
        newEnd.setDate(newEnd.getDate() - days);
        u.trial_ends_at = newEnd.toISOString().slice(0, 19) + 'Z';
        const { error } = await supabaseClient.from('profiles').update({ trial_ends_at: u.trial_ends_at }).eq('id', u.id);
        if (error) { alert('Error: ' + error.message); return; }
        openSuperUserDetail(u);
      };
      content.querySelector('.super-detail-reset').onclick = async () => {
        const email = u.email;
        if (!email) return;
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: (typeof APP_URL !== 'undefined' && APP_URL) ? APP_URL : window.location.href });
        if (error) alert('Error: ' + error.message);
        else alert('Se envió un correo a ' + email + ' para restablecer la contraseña.');
      };
      content.querySelector('.super-detail-email').onclick = () => {
        const m = (SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/);
        const projectRef = m ? m[1] : null;
        const supabaseAuthUrl = projectRef ? 'https://supabase.com/dashboard/project/' + projectRef + '/auth/users' : null;
        const msg = 'Para cambiar el email:\n\n1. Supabase → Authentication → Users\n2. Buscá: ' + u.email + '\n3. Edit → cambiá el email.\n\n¿Abrir Supabase?';
        if (supabaseAuthUrl && confirm(msg)) window.open(supabaseAuthUrl, '_blank');
        else alert(msg);
      };
      content.querySelector('.super-detail-quitar').onclick = async () => {
        var pwdInput = document.getElementById('adminDeletePassword');
        var storedPwd = (pwdInput && pwdInput.value) ? pwdInput.value : '';
        if (!storedPwd) { alert('Configurá primero la contraseña para quitar usuarios en Ajustes.'); return; }
        var entered = prompt('Ingresá la contraseña de admin para quitar este negocio:');
        if (entered === null) return;
        if (entered !== storedPwd) { alert('Contraseña incorrecta.'); return; }
        if (!confirm('¿Desactivar este negocio? Ya no podrá iniciar sesión.')) return;
        if (!supabaseClient) return;
        const { error } = await supabaseClient.from('profiles').update({ active: false }).eq('id', u.id);
        if (error) { alert('Error: ' + error.message); return; }
        document.getElementById('superUserDetailClose').click();
        renderSuper();
      };
      const countdownEl = content.querySelector('#superDetailCountdown');
      if (countdownEl) {
        superDetailCountdownInterval = setInterval(function () {
          const t = trialLabelFull(u.trial_ends_at);
          countdownEl.textContent = t.text;
          countdownEl.className = t.expired ? 'text-red-300' : 'text-[#a78bfa]';
        }, 1000);
      }
    }
    document.getElementById('superUserDetailClose').onclick = () => {
      if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval);
      superDetailCountdownInterval = null;
      document.getElementById('superUserDetailModal').classList.add('hidden');
      document.getElementById('superUserDetailModal').classList.remove('flex');
      renderSuper();
    };
    document.getElementById('superUserDetailOverlay').onclick = () => { if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval); superDetailCountdownInterval = null; document.getElementById('superUserDetailClose').click(); };

    var superFilterState = 'todos';
    async function renderSuper() {
      if (!supabaseClient) return;
      try {
        const { data: settingsRows } = await supabaseClient.from('app_settings').select('key, value').in('key', ['admin_whatsapp', 'admin_whatsapp_2', 'admin_whatsapp_3', 'admin_whatsapp_4', 'admin_delete_password']);
        var whatsappInput = document.getElementById('adminContactWhatsapp');
        var whatsapp2Input = document.getElementById('adminContactWhatsapp2');
        var whatsapp3Input = document.getElementById('adminContactWhatsapp3');
        var whatsapp4Input = document.getElementById('adminContactWhatsapp4');
        var deletePwdInput = document.getElementById('adminDeletePassword');
        if (settingsRows) {
          settingsRows.forEach(function (r) {
            if (r.key === 'admin_whatsapp' && whatsappInput) whatsappInput.value = r.value || '';
            if (r.key === 'admin_whatsapp_2' && whatsapp2Input) whatsapp2Input.value = r.value || '';
            if (r.key === 'admin_whatsapp_3' && whatsapp3Input) whatsapp3Input.value = r.value || '';
            if (r.key === 'admin_whatsapp_4' && whatsapp4Input) whatsapp4Input.value = r.value || '';
            if (r.key === 'admin_delete_password' && deletePwdInput) deletePwdInput.value = r.value || '';
          });
        }
        if (superFilterState !== 'todos') {
          document.querySelectorAll('.super-filter-btn').forEach(function (b) {
            b.className = 'super-filter-btn px-3 py-1.5 rounded-lg text-sm font-medium border touch-target ' + (b.dataset.filter === superFilterState ? 'border-[#7c3aed]/50 bg-[#7c3aed]/30' : 'border-white/20 glass');
          });
        }
      } catch (_) {}
      const { data: allProfiles, error: errProfiles } = await supabaseClient.from('profiles').select('id, email, role, active, kiosco_name, trial_ends_at');
      var list = (allProfiles || []).filter(u => u.id !== currentUser?.id);
      if (superFilterState === 'activos') list = list.filter(u => u.active);
      if (superFilterState === 'inactivos') list = list.filter(u => !u.active);
      superUserListCache = list.slice();
      var searchEl = document.getElementById('superSearchEmail');
      var searchTerm = (searchEl && searchEl.value) ? searchEl.value.trim().toLowerCase() : '';
      if (searchTerm) list = list.filter(function (u) {
        var email = (u.email || '').toLowerCase();
        var name = (u.kiosco_name || '').toLowerCase();
        return email.indexOf(searchTerm) !== -1 || name.indexOf(searchTerm) !== -1;
      });
      list.sort((a, b) => {
        const na = (a.kiosco_name || '').toLowerCase().trim() || 'zzz';
        const nb = (b.kiosco_name || '').toLowerCase().trim() || 'zzz';
        return na.localeCompare(nb);
      });
      const listEl = document.getElementById('superUsersList');
      if (errProfiles) {
        listEl.innerHTML = '<p class="py-4 text-center text-red-300 text-sm">Error al cargar. Revisá las políticas RLS de la tabla profiles.</p>';
        lucide.createIcons();
        return;
      }
      if (list.length === 0 && currentUser?.role === 'super') {
        var msg = searchTerm ? 'Ningún usuario coincide con la búsqueda.' : (superFilterState === 'activos' ? 'No hay negocios activos.' : superFilterState === 'inactivos' ? 'No hay negocios inactivos.' : 'No hay otros negocios. Agregá uno con el botón de arriba.');
        listEl.innerHTML = '<p class="py-6 text-center text-white/70 text-sm">' + msg + '</p>';
        lucide.createIcons();
        return;
      }
      listEl.innerHTML = list.map(u => {
        const name = (u.kiosco_name || u.email || 'Sin nombre').replace(/</g, '&lt;');
        const trialFull = trialLabelFull(u.trial_ends_at);
        const badge = trialFull.expired ? 'Vencida' : trialFull.text;
        const badgeClass = trialFull.expired ? 'bg-red-500/20 text-red-300' : 'bg-[#7c3aed]/30 text-[#a78bfa]';
        const endIso = (u.trial_ends_at || '').replace(/"/g, '&quot;');
        return `
          <button type="button" class="super-user-card w-full text-left glass rounded-xl p-4 flex items-center justify-between gap-3 border border-white/10 hover:border-[#7c3aed]/40 active:scale-[0.99] transition-all touch-target" data-id="${u.id}" data-trial-ends-at="${endIso}">
            <div class="flex-1 min-w-0">
              <p class="font-semibold truncate">${name}</p>
              <p class="text-xs text-white/50 truncate mt-0.5">${(u.email || '').replace(/</g, '&lt;')}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="super-list-countdown px-2 py-1 rounded-lg text-xs ${badgeClass}">${badge}</span>
              <i data-lucide="chevron-right" class="w-5 h-5 text-white/40"></i>
            </div>
          </button>
        `;
      }).join('');
      listEl.querySelectorAll('.super-user-card').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          const user = list.find(u => u.id === id);
          if (user) openSuperUserDetail(user);
        };
      });
      lucide.createIcons();
    }
    function renderSuperListFromSearch() {
      var listEl = document.getElementById('superUsersList');
      if (!listEl || !superUserListCache.length) return;
      var searchEl = document.getElementById('superSearchEmail');
      var searchTerm = (searchEl && searchEl.value) ? searchEl.value.trim().toLowerCase() : '';
      var list = superUserListCache.slice();
      if (superFilterState === 'activos') list = list.filter(function (u) { return u.active; });
      if (superFilterState === 'inactivos') list = list.filter(function (u) { return !u.active; });
      if (searchTerm) list = list.filter(function (u) {
        var email = (u.email || '').toLowerCase();
        var name = (u.kiosco_name || '').toLowerCase();
        return email.indexOf(searchTerm) !== -1 || name.indexOf(searchTerm) !== -1;
      });
      list.sort((a, b) => {
        const na = (a.kiosco_name || '').toLowerCase().trim() || 'zzz';
        const nb = (b.kiosco_name || '').toLowerCase().trim() || 'zzz';
        return na.localeCompare(nb);
      });
      if (list.length === 0) {
        listEl.innerHTML = '<p class="py-6 text-center text-white/70 text-sm">Ningún usuario coincide con la búsqueda.</p>';
        lucide.createIcons();
        return;
      }
      listEl.innerHTML = list.map(function (u) {
        var name = (u.kiosco_name || u.email || 'Sin nombre').replace(/</g, '&lt;');
        var trialFull = trialLabelFull(u.trial_ends_at);
        var badge = trialFull.expired ? 'Vencida' : trialFull.text;
        var badgeClass = trialFull.expired ? 'bg-red-500/20 text-red-300' : 'bg-[#7c3aed]/30 text-[#a78bfa]';
        var endIso = (u.trial_ends_at || '').replace(/"/g, '&quot;');
        return '<button type="button" class="super-user-card w-full text-left glass rounded-xl p-4 flex items-center justify-between gap-3 border border-white/10 hover:border-[#7c3aed]/40 active:scale-[0.99] transition-all touch-target" data-id="' + u.id + '" data-trial-ends-at="' + endIso + '"><div class="flex-1 min-w-0"><p class="font-semibold truncate">' + name + '</p><p class="text-xs text-white/50 truncate mt-0.5">' + (u.email || '').replace(/</g, '&lt;') + '</p></div><div class="flex items-center gap-2 shrink-0"><span class="super-list-countdown px-2 py-1 rounded-lg text-xs ' + badgeClass + '">' + badge + '</span><i data-lucide="chevron-right" class="w-5 h-5 text-white/40"></i></div></button>';
      }).join('');
      listEl.querySelectorAll('.super-user-card').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.dataset.id;
          var user = list.find(function (u) { return u.id === id; });
          if (user) openSuperUserDetail(user);
        };
      });
      lucide.createIcons();
    }
    var superSearchInput = document.getElementById('superSearchEmail');
    if (superSearchInput) superSearchInput.addEventListener('input', renderSuperListFromSearch);
    if (superSearchInput) superSearchInput.addEventListener('search', renderSuperListFromSearch);
    document.getElementById('saveAdminContact').onclick = async () => {
      const whatsapp = (document.getElementById('adminContactWhatsapp').value || '').trim().replace(/\D/g, '');
      const whatsapp2 = (document.getElementById('adminContactWhatsapp2').value || '').trim().replace(/\D/g, '');
      const whatsapp3 = (document.getElementById('adminContactWhatsapp3').value || '').trim().replace(/\D/g, '');
      const whatsapp4 = (document.getElementById('adminContactWhatsapp4').value || '').trim().replace(/\D/g, '');
      const deletePwd = (document.getElementById('adminDeletePassword').value || '').trim();
      const msgEl = document.getElementById('adminContactMsg');
      if (!supabaseClient) return;
      try {
        await supabaseClient.from('app_settings').upsert([
          { key: 'admin_whatsapp', value: whatsapp },
          { key: 'admin_whatsapp_2', value: whatsapp2 },
          { key: 'admin_whatsapp_3', value: whatsapp3 },
          { key: 'admin_whatsapp_4', value: whatsapp4 },
          { key: 'admin_delete_password', value: deletePwd }
        ], { onConflict: 'key' });
        adminContact.whatsapp = whatsapp;
        adminContact.whatsappList = [whatsapp, whatsapp2, whatsapp3, whatsapp4].filter(Boolean);
        msgEl.textContent = 'Ajustes guardados.';
        msgEl.classList.remove('hidden');
        setTimeout(() => msgEl.classList.add('hidden'), 3000);
      } catch (e) {
        msgEl.textContent = 'Error: ' + (e.message || 'Revisá que exista la tabla app_settings.');
        msgEl.classList.remove('hidden');
      }
      lucide.createIcons();
    };
    async function exportAllUsersBackup() {
      if (!currentUser || currentUser.role !== 'super' || !supabaseClient) return;
      var msgEl = document.getElementById('adminBackupAllMsg');
      var btn = document.getElementById('btnExportAllUsersBackup');
      if (msgEl) { msgEl.textContent = 'Exportando...'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-white/70'; }
      if (btn) btn.disabled = true;
      try {
        var profilesRes = await supabaseClient.from('profiles').select('id, email, kiosco_name').neq('id', currentUser.id);
        if (profilesRes.error) throw profilesRes.error;
        var users = (profilesRes.data || []).filter(function (p) { return p.id; });
        var backup = { version: 1, type: 'admin_full_backup', exportedAt: new Date().toISOString(), exportedBy: currentUser.id, users: [] };
        for (var i = 0; i < users.length; i++) {
          var u = users[i];
          var uid = u.id;
          var products = {};
          var clientes = [];
          var saldosACobrar = [];
          try {
            var pRes = await supabaseClient.from('products').select('*').eq('user_id', uid);
            if (!pRes.error && pRes.data) pRes.data.forEach(function (p) { products[p.codigo] = { nombre: p.nombre, codigo: p.codigo, precio: p.precio, stock: p.stock, stockInicial: p.stock_inicial || p.stock, costo: p.costo != null ? Number(p.costo) : 0 }; });
          } catch (_) {}
          try {
            var cRes = await supabaseClient.from('clientes').select('id, nombre, telefono, email, direccion, notas').eq('user_id', uid);
            if (!cRes.error && cRes.data) clientes = cRes.data;
          } catch (_) {}
          try {
            var sRes = await supabaseClient.from('saldos_acobrar').select('*').eq('user_id', uid);
            if (!sRes.error && sRes.data) saldosACobrar = sRes.data.map(function (s) { return { id: s.id, clientName: s.client_name || '', whatsapp: s.whatsapp || '', items: s.items || [], total: Number(s.total) || 0, method: s.method || 'fiado', paid: !!s.paid, createdAt: s.created_at }; });
          } catch (_) {}
          backup.users.push({ userId: uid, email: u.email || '', kioscoName: u.kiosco_name || '', products: products, clientes: clientes, saldosACobrar: saldosACobrar });
        }
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ferriol-respaldo-todos-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        if (msgEl) { msgEl.textContent = 'Copia exportada: ' + backup.users.length + ' usuario(s). Guardá el archivo en un lugar seguro.'; msgEl.className = 'text-xs mt-2 text-green-400'; setTimeout(function () { msgEl.classList.add('hidden'); }, 6000); }
      } catch (e) {
        if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'No se pudo exportar. Revisá que las políticas RLS permitan al admin leer productos, clientes y saldos_acobrar de otros usuarios.'); msgEl.className = 'text-xs mt-2 text-amber-300'; }
      }
      if (btn) btn.disabled = false;
      lucide.createIcons();
    }
    async function importAllUsersBackup(file) {
      if (!file || !currentUser || currentUser.role !== 'super' || !supabaseClient) return;
      var msgEl = document.getElementById('adminBackupAllMsg');
      var btn = document.getElementById('inputImportAllUsersBackup');
      if (msgEl) { msgEl.textContent = 'Importando (complementando datos)...'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-white/70'; }
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          var backup = JSON.parse(reader.result);
          if (!backup || backup.type !== 'admin_full_backup' || !Array.isArray(backup.users)) throw new Error('Archivo no válido. Tenés que usar el archivo que exportaste desde "Exportar copia".');
          var ok = 0, err = 0;
          for (var i = 0; i < backup.users.length; i++) {
            var u = backup.users[i];
            var uid = u.userId;
            if (!uid) continue;
            try {
              if (u.products && typeof u.products === 'object') {
                var existingP = await supabaseClient.from('products').select('codigo').eq('user_id', uid);
                var existingCodigos = (existingP.data || []).map(function (r) { return r.codigo; });
                var toInsert = Object.entries(u.products).filter(function (e) { return existingCodigos.indexOf(e[1].codigo || e[0]) === -1; }).map(function (e) {
                  var p = e[1];
                  var cod = p.codigo || e[0];
                  return { user_id: uid, codigo: cod, nombre: p.nombre, precio: p.precio || 0, stock: p.stock || 0, stock_inicial: p.stockInicial ?? p.stock ?? 0, costo: p.costo != null ? Number(p.costo) : 0 };
                });
                if (toInsert.length) await supabaseClient.from('products').insert(toInsert);
              }
              if (u.clientes && u.clientes.length) {
                var existingC = await supabaseClient.from('clientes').select('nombre, telefono').eq('user_id', uid);
                var existingPairs = (existingC.data || []).map(function (r) { return (r.nombre || '').toLowerCase().trim() + '|' + (r.telefono || '').trim(); });
                var cToInsert = u.clientes.filter(function (c) {
                  var key = (c.nombre || '').toLowerCase().trim() + '|' + (c.telefono || '').trim();
                  return existingPairs.indexOf(key) === -1;
                }).map(function (c) { return { user_id: uid, nombre: c.nombre || null, telefono: c.telefono || null, email: c.email || null, direccion: c.direccion || null, notas: c.notas || null }; });
                if (cToInsert.length) await supabaseClient.from('clientes').insert(cToInsert);
              }
              if (u.saldosACobrar && u.saldosACobrar.length) {
                var existingS = await supabaseClient.from('saldos_acobrar').select('id').eq('user_id', uid);
                var existingIds = (existingS.data || []).map(function (r) { return r.id; });
                var sToInsert = u.saldosACobrar.filter(function (s) { return existingIds.indexOf(String(s.id || '')) === -1; }).map(function (s) {
                  return { user_id: uid, id: String(s.id || ''), client_name: s.clientName || '', whatsapp: s.whatsapp || '', items: s.items || [], total: Number(s.total) || 0, method: s.method || 'fiado', paid: !!s.paid, created_at: s.createdAt || new Date().toISOString() };
                });
                if (sToInsert.length) await supabaseClient.from('saldos_acobrar').insert(sToInsert);
              }
              ok++;
            } catch (e) {
              err++;
              console.warn('Error complementando usuario ' + (u.email || uid) + ':', e);
            }
          }
          if (msgEl) {
            if (err > 0) msgEl.textContent = 'Complementados: ' + ok + ' usuario(s). Fallaron: ' + err + '.';
            else msgEl.textContent = 'Importación lista: se sumaron los datos del archivo a los existentes en ' + ok + ' usuario(s). No se reemplazó nada.';
            msgEl.className = 'text-xs mt-2 ' + (err > 0 ? 'text-amber-300' : 'text-green-400');
            setTimeout(function () { msgEl.classList.add('hidden'); }, 8000);
          }
        } catch (e) {
          if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'Archivo no válido'); msgEl.className = 'text-xs mt-2 text-red-400'; }
        }
        if (btn) btn.value = '';
        lucide.createIcons();
      };
      reader.readAsText(file);
    }
    document.getElementById('btnExportAllUsersBackup').onclick = exportAllUsersBackup;
    document.getElementById('inputImportAllUsersBackup').onchange = function (e) {
      var f = e.target.files[0];
      if (f) {
        if (!confirm('¿Importar y complementar datos? Se sumarán los productos, clientes y deudas del archivo a lo que ya tiene cada usuario (no se borra nada existente). Los usuarios pueden recargar la app para ver los cambios.')) { e.target.value = ''; return; }
        importAllUsersBackup(f);
      }
      e.target.value = '';
    };

    document.querySelectorAll('.super-filter-btn').forEach(function (btn) {
      btn.onclick = function () {
        superFilterState = btn.dataset.filter || 'todos';
        document.querySelectorAll('.super-filter-btn').forEach(function (b) {
          b.className = 'super-filter-btn px-3 py-1.5 rounded-lg text-sm font-medium border touch-target ' + (b.dataset.filter === superFilterState ? 'border-[#7c3aed]/50 bg-[#7c3aed]/30' : 'border-white/20 glass');
        });
        renderSuper();
      };
    });

    var notificationsCache = [];
    var NOTIF_LAST_READ_KEY = 'ferriol_notif_last_read';
    function getNotifLastRead() {
      try {
        var key = (currentUser && currentUser.id) ? NOTIF_LAST_READ_KEY + '_' + currentUser.id : NOTIF_LAST_READ_KEY;
        var s = localStorage.getItem(key);
        return s ? new Date(s).getTime() : 0;
      } catch (_) { return 0; }
    }
    function setNotifLastRead() {
      try {
        var key = (currentUser && currentUser.id) ? NOTIF_LAST_READ_KEY + '_' + currentUser.id : NOTIF_LAST_READ_KEY;
        var latest = 0;
        (notificationsCache || []).forEach(function (n) {
          if (n.created_at) {
            var t = new Date(n.created_at).getTime();
            if (t > latest) latest = t;
          }
        });
        localStorage.setItem(key, latest ? new Date(latest).toISOString() : new Date().toISOString());
      } catch (_) {}
    }
    async function loadNotifications() {
      if (!supabaseClient) return;
      try {
        var res = await supabaseClient.from('notifications').select('id, created_at, message').order('created_at', { ascending: false }).limit(50);
        notificationsCache = (res.data || []);
        var notifSince = (currentUser && currentUser.created_at) ? new Date(currentUser.created_at).getTime() : 0;
        var visible = notificationsCache.filter(function (n) { return n.created_at && new Date(n.created_at).getTime() >= notifSince; });
        var lastRead = getNotifLastRead();
        var unread = visible.filter(function (n) { return new Date(n.created_at).getTime() > lastRead; });
        var listEl = document.getElementById('notifList');
        var emptyEl = document.getElementById('notifEmpty');
        var countEl = document.getElementById('notifCount');
        if (listEl) {
          if (visible.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
          } else {
            if (emptyEl) emptyEl.classList.add('hidden');
            listEl.innerHTML = visible.map(function (n) {
              var fecha = n.created_at ? new Date(n.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
              var msg = (n.message || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
              return '<div class="glass rounded-xl p-3 border border-white/10"><p class="text-white/90 text-sm">' + msg + '</p><p class="text-white/50 text-xs mt-1">' + fecha + '</p></div>';
            }).join('');
          }
        }
        if (countEl) {
          if (unread.length > 0) { countEl.textContent = unread.length > 99 ? '99+' : unread.length; countEl.classList.remove('hidden'); }
          else countEl.classList.add('hidden');
        }
        lucide.createIcons();
      } catch (_) {}
    }
    document.getElementById('sendNotificationBtn').onclick = async function () {
      var textarea = document.getElementById('adminNotificationMessage');
      var msgEl = document.getElementById('adminNotificationMsg');
      var msg = (textarea && textarea.value) ? textarea.value.trim() : '';
      if (!msg) { if (msgEl) { msgEl.textContent = 'Escribí un mensaje.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-amber-300'; } return; }
      if (!supabaseClient || currentUser?.role !== 'super') return;
      try {
        var err = (await supabaseClient.from('notifications').insert({ message: msg })).error;
        if (err) throw err;
        if (textarea) textarea.value = '';
        if (msgEl) { msgEl.textContent = 'Enviado a todos los negocios.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-green-300'; setTimeout(function () { msgEl.classList.add('hidden'); }, 4000); }
      } catch (e) {
        if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'Creá la tabla notifications en Supabase (ver comentarios en el código).'); msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-red-300'; }
      }
      lucide.createIcons();
    };

    function openNewKiosqueroModal() {
      document.getElementById('newKiosqueroErr').classList.add('hidden');
      document.getElementById('createUserMsgModal').classList.add('hidden');
      document.getElementById('newKiosqueroEmail').value = '';
      document.getElementById('newKiosqueroPhone').value = '';
      document.getElementById('newKiosqueroPassword').value = '';
      document.getElementById('newKiosqueroKioscoName').value = '';
      document.getElementById('newKiosqueroModal').classList.remove('hidden');
      document.getElementById('newKiosqueroModal').classList.add('flex');
      lucide.createIcons();
    }
    function closeNewKiosqueroModal() {
      document.getElementById('newKiosqueroModal').classList.add('hidden');
      document.getElementById('newKiosqueroModal').classList.remove('flex');
      renderSuper();
      lucide.createIcons();
    }
    document.getElementById('btnOpenNewKiosqueroModal').onclick = openNewKiosqueroModal;
    document.getElementById('newKiosqueroModalClose').onclick = closeNewKiosqueroModal;
    document.getElementById('newKiosqueroModalOverlay').onclick = closeNewKiosqueroModal;
    setupPasswordToggle('showNewKiosqueroPwd', 'newKiosqueroPassword');
    try {
      if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    } catch (_) {}
    document.getElementById('btnCreateUserInModal').onclick = async () => {
      const email = document.getElementById('newKiosqueroEmail').value.trim();
      const password = document.getElementById('newKiosqueroPassword').value;
      const kioscoName = document.getElementById('newKiosqueroKioscoName').value.trim();
      const errEl = document.getElementById('newKiosqueroErr');
      const msgEl = document.getElementById('createUserMsgModal');
      errEl.classList.add('hidden');
      msgEl.classList.add('hidden');
      if (!email) {
        errEl.textContent = 'El email es obligatorio.';
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      if (!password || password.length < 6) {
        errEl.textContent = 'La contraseña es obligatoria y debe tener al menos 6 caracteres.';
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) {
        errEl.textContent = 'Supabase no está configurado.';
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      const { data: signUpData, error: signUpErr } = await supabaseClient.auth.signUp({ email, password });
      if (signUpErr) {
        errEl.textContent = signUpErr.message.includes('already registered') ? 'Ya existe un usuario con ese email.' : signUpErr.message;
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      const newId = signUpData.user?.id;
      if (newId) {
        await supabaseClient.from('profiles').update({ kiosco_name: kioscoName || '' }).eq('id', newId);
      }
      msgEl.textContent = 'Kiosquero creado. Ya puede iniciar sesión con ese email y contraseña.';
      msgEl.classList.remove('hidden');
      document.getElementById('newKiosqueroEmail').value = '';
      document.getElementById('newKiosqueroPhone').value = '';
      document.getElementById('newKiosqueroPassword').value = '';
      document.getElementById('newKiosqueroKioscoName').value = '';
      renderSuper();
      lucide.createIcons();
      setTimeout(closeNewKiosqueroModal, 2000);
    };

    (async function init() {
      if (!supabaseClient) return;
      try {
        const hash = location.hash || '';
        const isRecovery = hash.includes('type=recovery');
        if (isRecovery) {
          document.getElementById('loginFormWrap').classList.add('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          document.getElementById('resetPwdBox').classList.add('hidden');
          document.getElementById('setNewPwdBox').classList.remove('hidden');
          document.getElementById('loginErr').classList.remove('show');
          return;
        }
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session?.user) return;
        const uid = session.user.id;
        let { data: profile, error: profileErr } = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
        if (profileErr && profileErr.code !== 'PGRST116') {
          console.error('Error al leer profiles:', profileErr);
          var loginErrInit = document.getElementById('loginErr');
          if (loginErrInit) {
            loginErrInit.textContent = 'Error al leer tu perfil. Revisá conexión o políticas RLS en Supabase (tabla profiles).';
            loginErrInit.classList.add('show');
          }
          return;
        }
        if (!profile) {
          var trialEndsInit = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
          var insProf = await supabaseClient.from('profiles').insert({
            id: uid,
            email: session.user.email,
            role: 'kiosquero',
            active: true,
            trial_ends_at: trialEndsInit
          });
          if (insProf.error) {
            console.error('Perfil ausente y no se pudo crear:', insProf.error);
            var loginErrIns = document.getElementById('loginErr');
            if (loginErrIns) {
              loginErrIns.textContent = 'Tu usuario existe pero falta el perfil. Revisá en Supabase la tabla profiles (RLS: permitir INSERT/SELECT propio id) o contactá al administrador.';
              loginErrIns.classList.add('show');
            }
            return;
          }
          var rProf = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
          profile = rProf.data;
          if (!profile) return;
        }
        if (profile.role === 'kiosquero' && !profile.active) {
          try {
            await loadAdminContact();
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = 'Tu cuenta está desactivada. Contactá por WhatsApp para darte de alta.';
          document.getElementById('loginErr').classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi cuenta de Ferriol OS está desactivada y quiero darme de alta.');
            wrap.classList.remove('hidden');
          }
          document.getElementById('appWrap').classList.add('hidden');
          document.getElementById('loginScreen').classList.remove('hidden');
          return;
        }
        const trialEndsAt = profile.trial_ends_at || null;
        if (profile.role === 'kiosquero' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', profile.id);
            await loadAdminContact();
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá por WhatsApp para renovar.';
          document.getElementById('loginErr').classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi período de prueba de Ferriol OS terminó y quiero renovar.');
            wrap.classList.remove('hidden');
          }
          document.getElementById('appWrap').classList.add('hidden');
          document.getElementById('loginScreen').classList.remove('hidden');
          return;
        }
        var userCreatedAt = (session && session.user && session.user.created_at) ? session.user.created_at : null;
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt };
        await showApp();
      } catch (e) {
        console.error('Error en init:', e);
      }
    })();
