# ==============================================================
#  MÓDULO PyMEs — v5 (DASHBOARD ÚNICO, MODO SIMULACIÓN, sin base de datos)
#
#  Dashboard con 4 módulos, cada uno accesible con su botón (render_nav_pyme):
#
#     KPIs (arriba)  Caja chica · Bancos/Digital · Stock crítico · Resultado neto del mes
#     A) Registradora exprés   Venta · Compra · Gasto · Cobro · Pago · Devolución · Inversión/Financ.
#     B) Inventario + Receta y costo del producto + Calculadora de precios
#     C) Historial de transacciones (buscar, filtrar, exportar, anular / editar)
#     D) Estados financieros: Estado de Resultados y Flujo de Caja (Ene–Dic + Total)
#
#  Novedades v5:
#     - Calculadora de precios (pasarelas, plataformas, impuestos, cuotas)
#     - Estado de Resultados y Flujo de Caja mensuales, como la planilla
#     - Devoluciones, descuentos, inversión y financiamiento
#     - Historial con buscador y filtros; exportar a CSV / Excel / PDF de cierre del día
#     - Alerta ⚠️ en stock bajo
#
#  requirements.txt:  openpyxl  pdfplumber  reportlab
#
#  Todo el estado vive en st.session_state (prefijo "pyme_sim_" para los
#  datos y "pw_" para los widgets). Nada se persiste entre sesiones.
#
#  Atajos de teclado: Enter confirma (formularios y buscador),
#  F2 salta al buscador de productos.
# ==============================================================

import io
import math
import re
from html import escape as _esc
from datetime import date, datetime, timedelta

import altair as alt
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

SIM_PREFIX = 'pyme_sim_'      # datos simulados
WIDGET_PREFIX = 'pw_'         # keys de widgets (se limpian al reiniciar)
NEGOCIO_KEY = 'pyme_negocio_nombre'   # sin prefijo: "Reiniciar datos" no lo borra

TIPOS_MOV = {
    'SALE':            ('🛒', 'Venta'),
    'PURCHASE':        ('📥', 'Compra'),
    'EXPENSE':         ('💸', 'Gasto'),
    'COLLECTION':      ('💰', 'Cobro'),
    'PAYMENT':         ('🏦', 'Pago'),
    'SALE_RETURN':     ('↩️', 'Devolución de venta'),
    'PURCHASE_RETURN': ('📤', 'Devolución de compra'),
    'INV_IN':          ('🏗️', 'Entrada de inversión'),
    'INV_OUT':         ('🛠️', 'Salida de inversión'),
    'FIN_IN':          ('🏛️', 'Entrada de financiamiento'),
    'FIN_OUT':         ('📉', 'Salida de financiamiento'),
}
INGRESOS = ('SALE', 'COLLECTION', 'PURCHASE_RETURN', 'INV_IN', 'FIN_IN')   # suman al "monto" visual

OPC_REGISTRO = {
    'SALE': '🛒 Venta', 'PURCHASE': '📥 Compra', 'EXPENSE': '💸 Gasto',
    'COLLECTION': '💰 Cobro', 'PAYMENT': '🏦 Pago',
    'RETURN': '↩️ Devolución', 'INVFIN': '🏗️ Inversión / Financ.',
}
OPC_INVFIN = {
    'INV_IN':  '🏗️ Entrada de inversión (venta de equipos, rescate de inversiones)',
    'INV_OUT': '🛠️ Salida de inversión (compra de maquinaria, equipos, mejoras)',
    'FIN_IN':  '🏛️ Entrada de financiamiento (préstamo recibido, aporte de socios)',
    'FIN_OUT': '📉 Salida de financiamiento (cuota de préstamo, retiro de socios)',
}
MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

C_VERDE, C_ROJO, C_AZUL, C_AMARILLO, C_NARANJA, C_VIOLETA, C_GRIS = (
    '#3fb950', '#f85149', '#3a7bd5', '#e3b341', '#f0883e', '#bc8cff', '#6b7d9a')


def _key(nombre):
    return f'{SIM_PREFIX}{nombre}'


def _s(nombre):
    return st.session_state[_key(nombre)]


def get_nombre_negocio():
    """Nombre del negocio configurado ('' si no hay). Se puede importar desde app.py."""
    return st.session_state.get(NEGOCIO_KEY, '')


# ==============================================================
#  ESTADO SIMULADO — datos de ejemplo
# ==============================================================

def _siguiente_id(nombre):
    k = _key(f'seq_{nombre}')
    st.session_state[k] = st.session_state.get(k, 0) + 1
    return st.session_state[k]


def _seed_inicial():
    """Carga datos de ejemplo (una cafetería/kiosco) para poder probar todo
    sin cargar nada a mano. Se puede reiniciar desde el pie de la pantalla."""
    ss = st.session_state
    ss[_key('medios')] = [
        {'id': 1, 'name': 'Efectivo',               'tipo': 'caja',    'is_active': True},
        {'id': 2, 'name': 'Mercado Pago',           'tipo': 'banco',   'is_active': True},
        {'id': 3, 'name': 'Transferencia Bancaria', 'tipo': 'banco',   'is_active': True},
        {'id': 4, 'name': 'Fiado / Cta Corriente',  'tipo': 'credito', 'is_active': True},
    ]
    ss[_key('seq_medios')] = 4

    ss[_key('insumos')] = [
        {'id': 1, 'name': 'Café molido',    'cost_per_unit': 28000, 'unit_measure': 'kg'},
        {'id': 2, 'name': 'Leche',          'cost_per_unit': 1400,  'unit_measure': 'lt'},
        {'id': 3, 'name': 'Harina 000',     'cost_per_unit': 1100,  'unit_measure': 'kg'},
        {'id': 4, 'name': 'Manteca',        'cost_per_unit': 9000,  'unit_measure': 'kg'},
        {'id': 5, 'name': 'Jamón cocido',   'cost_per_unit': 12000, 'unit_measure': 'kg'},
        {'id': 6, 'name': 'Queso',          'cost_per_unit': 11000, 'unit_measure': 'kg'},
        {'id': 7, 'name': 'Pan de miga',    'cost_per_unit': 300,   'unit_measure': 'unidad'},
    ]
    ss[_key('seq_insumos')] = 7

    def _p(id_, name, stock, minimo, costo, precio, barcode='', receta=None, mo=0.0, margen=40.0):
        return {'id': id_, 'barcode': barcode, 'name': name, 'current_stock': stock,
                'min_stock': minimo, 'unit_cost': float(costo), 'sale_price': float(precio),
                'receta': receta or [], 'mano_obra': float(mo), 'margen': float(margen)}

    productos = [
        _p(1, 'Medialuna', 36, 12, 0, 900,
           receta=[{'insumo_id': 3, 'qty': 0.03}, {'insumo_id': 4, 'qty': 0.01}], mo=120),
        _p(2, 'Tostado J&Q', 15, 6, 0, 4200,
           receta=[{'insumo_id': 7, 'qty': 2}, {'insumo_id': 5, 'qty': 0.05}, {'insumo_id': 6, 'qty': 0.06}], mo=300),
        _p(3, 'Café con leche', 50, 15, 0, 2800,
           receta=[{'insumo_id': 1, 'qty': 0.02}, {'insumo_id': 2, 'qty': 0.15}], mo=150),
        _p(4, 'Alfajor', 30, 10, 700, 1300, barcode='7790001000011'),
        _p(5, 'Gaseosa 500ml', 10, 12, 1100, 2000, barcode='7790001000028'),
        _p(6, 'Agua mineral 500ml', 24, 12, 600, 1400, barcode='7790001000035'),
    ]
    for p in productos:
        _recalcular_costo(p)
    ss[_key('productos')] = productos
    ss[_key('seq_productos')] = 6

    ss[_key('transacciones')] = []
    ss[_key('seq_transacciones')] = 0
    ss[_key('carrito')] = {}
    ss[_key('carrito_compra')] = []
    ss[_key('saldo_caja')] = 60000.0
    ss[_key('saldo_banco')] = 600000.0
    ss[_key('init')] = True

    ahora = datetime.now()
    hoy = date.today()
    # Movimientos de ejemplo (pasan por las mismas funciones que usa la UI)
    _reg_gasto('Alquiler', 'Alquiler del local', 350000, 'Transferencia Bancaria', 'PAID', None, ahora - timedelta(days=2))
    _reg_compra(4, 24, 700, 'Fiado / Cta Corriente', 'PENDING', hoy + timedelta(days=10), ahora - timedelta(days=1))
    _reg_venta({2: 5, 3: 5}, 'Fiado / Cta Corriente', 'PENDING', hoy - timedelta(days=1), 'Oficina García', ahora - timedelta(days=3))
    _reg_venta({3: 2, 1: 4}, 'Efectivo', 'PAID', None, '', ahora - timedelta(days=1, hours=2))
    _reg_venta({3: 1, 1: 2}, 'Efectivo', 'PAID', None, '', ahora - timedelta(hours=5))
    _reg_venta({2: 2, 6: 2}, 'Mercado Pago', 'PAID', None, '', ahora - timedelta(hours=4))
    _reg_venta({5: 3, 4: 3}, 'Efectivo', 'PAID', None, '', ahora - timedelta(hours=3))
    _reg_venta({3: 4, 1: 6}, 'Fiado / Cta Corriente', 'PENDING', hoy + timedelta(days=7), 'Estudio Pérez', ahora - timedelta(hours=2))
    _reg_gasto('Servicios', 'Luz y gas', 18500, 'Efectivo', 'PAID', None, ahora - timedelta(hours=1))
    _reg_inv_fin('INV_OUT', 'Máquina de café', 120000, 'Transferencia Bancaria', ahora - timedelta(days=2))
    _reg_inv_fin('FIN_IN', 'Préstamo de socio', 200000, 'Transferencia Bancaria', ahora - timedelta(days=2))
    _reg_devolucion('SALE_RETURN', 4, 1, 1300, 'Efectivo', 'Cliente', ahora - timedelta(hours=2))


def _init_sim():
    if not st.session_state.get(_key('init')):
        _seed_inicial()


# ==============================================================
#  LECTURA DE ENTIDADES
# ==============================================================

def _producto(pid):
    return next((p for p in _s('productos') if p['id'] == pid), None)


def _buscar_producto(nombre):
    n = (nombre or '').strip().lower()
    return next((p for p in _s('productos') if p['name'].strip().lower() == n), None)


def _insumo(iid):
    return next((i for i in _s('insumos') if i['id'] == iid), None)


def _tx(tx_id):
    return next((t for t in _s('transacciones') if t['id'] == tx_id), None)


def _tipo_medio(nombre):
    m = next((m for m in _s('medios') if m['name'] == nombre), None)
    return m['tipo'] if m else 'banco'


def _medios_activos(incluir_credito=True):
    return [m['name'] for m in _s('medios')
            if m['is_active'] and (incluir_credito or m['tipo'] != 'credito')]


def _costo_receta(prod):
    total = 0.0
    for l in prod.get('receta', []):
        ins = _insumo(l['insumo_id'])
        if ins:
            total += ins['cost_per_unit'] * l['qty']
    return total + float(prod.get('mano_obra') or 0)


def _recalcular_costo(prod):
    """Si el producto tiene receta o mano de obra, su costo es el de la receta."""
    if prod.get('receta') or prod.get('mano_obra'):
        prod['unit_cost'] = round(_costo_receta(prod), 2)


def _crear_producto(nombre, precio=0.0, costo=0.0, barcode='', minimo=5):
    """Crea un producto con stock 0 (la compra le suma el stock). Si ya existe uno
    con el mismo nombre, devuelve ese. Si el precio es 0, sugiere uno con 40% de margen."""
    existente = _buscar_producto(nombre)
    if existente:
        return existente
    costo, precio = float(costo or 0), float(precio or 0)
    if precio <= 0 and costo > 0:
        precio = float(math.ceil(costo / 0.6 / 10) * 10)
    p = {'id': _siguiente_id('productos'), 'barcode': (barcode or '').strip(), 'name': nombre.strip(),
         'current_stock': 0, 'min_stock': int(minimo), 'unit_cost': costo, 'sale_price': precio,
         'receta': [], 'mano_obra': 0.0, 'margen': 40.0}
    _s('productos').append(p)
    return p


# ==============================================================
#  OPERACIONES (cada una es el equivalente de un insert/update futuro)
# ==============================================================

def _nueva_tx(tipo, descripcion, monto, medio, estado, vence=None, costo=0.0,
              items=None, cuando=None, liquida_a=None, discount=0.0, iva=0.0):
    tx = {
        'id': _siguiente_id('transacciones'), 'type': tipo, 'description': descripcion,
        'amount': float(monto), 'cost_amount': float(costo), 'payment_method': medio,
        'status': estado, 'due_date': vence if estado == 'PENDING' else None,
        'created_at': cuando or datetime.now(), 'items': items or [],
        'anulada': False, 'liquidado_por': None, 'liquida_a': liquida_a,
        'discount': float(discount), 'iva': float(iva),
    }
    _s('transacciones').append(tx)
    return tx


def _estado_efectivo(medio, estado):
    """Un medio tipo 'crédito' (fiado) siempre deja el movimiento pendiente."""
    return 'PENDING' if _tipo_medio(medio) == 'credito' else estado


def _reg_venta(carrito, medio, estado, vence, nota='', cuando=None, descuento_pct=0.0,
               iva_pct=0.0, iva_incluido=False):
    if not carrito:
        return False, 'El ticket está vacío.'
    for pid, qty in carrito.items():
        p = _producto(pid)
        if p is None:
            return False, 'Un producto del ticket ya no existe.'
        if p['current_stock'] < qty:
            return False, f"Stock insuficiente de {p['name']} (hay {p['current_stock']})."
    items, bruto, costo = [], 0.0, 0.0
    for pid, qty in carrito.items():
        p = _producto(pid)
        items.append({'product_id': pid, 'name': p['name'], 'quantity': int(qty),
                      'unit_price': p['sale_price'], 'unit_cost': p['unit_cost']})
        bruto += qty * p['sale_price']
        costo += qty * p['unit_cost']
        p['current_stock'] -= int(qty)
    descuento = round(bruto * min(max(float(descuento_pct or 0), 0.0), 100.0) / 100, 2)
    total, iva = _calc_iva(bruto - descuento, iva_pct, iva_incluido)
    desc = ', '.join(f"{i['quantity']}× {i['name']}" for i in items)
    if descuento:
        desc += f' (desc. {float(descuento_pct):g}%)'
    desc += _desc_iva(iva_pct, iva, iva_incluido)
    if nota:
        desc += f' — {nota}'
    estado = _estado_efectivo(medio, estado)
    _nueva_tx('SALE', desc, total, medio, estado, vence, costo, items, cuando,
              discount=descuento, iva=iva)
    return True, f'Venta registrada por {_fmt_money(total)}.'


def _reg_compra(pid, cantidad, costo_unit, medio, estado, vence, cuando=None):
    """Compra de UN producto (la usan los datos de ejemplo y el importador)."""
    p = _producto(pid)
    if p is None:
        return False, 'Producto inexistente.'
    stock_prev = p['current_stock']
    if not p.get('receta') and not p.get('mano_obra'):
        # costo promedio ponderado (los productos con receta mantienen su costo de receta)
        total_u = stock_prev + cantidad
        p['unit_cost'] = round((stock_prev * p['unit_cost'] + cantidad * costo_unit) / total_u, 2) if total_u else costo_unit
    p['current_stock'] = stock_prev + int(cantidad)
    items = [{'product_id': pid, 'name': p['name'], 'quantity': int(cantidad),
              'unit_price': 0.0, 'unit_cost': float(costo_unit)}]
    estado = _estado_efectivo(medio, estado)
    _nueva_tx('PURCHASE', f"{int(cantidad)}× {p['name']} (compra)", cantidad * costo_unit,
              medio, estado, vence, 0.0, items, cuando)
    return True, f'Compra registrada por {_fmt_money(cantidad * costo_unit)}.'


def _reg_compra_multiple(lineas, medio, estado, vence, nota='', cuando=None, descuento_pct=0.0,
                         iva_pct=0.0, iva_incluido=False):
    """Una sola transacción PURCHASE con productos y/o insumos.
    Línea de producto: {'pid': id o None, 'nombre', 'qty', 'costo', 'precio', 'barcode', 'minimo'}.
    Línea de insumo:   {'tipo': 'insumo', 'iid': id o None, 'nombre', 'unidad', 'qty', 'costo'}.
    Lo nuevo (producto o insumo) se crea recién acá, al confirmar.
    Si el importe ya incluye IVA, el costo que se guarda es neto de IVA."""
    if not lineas:
        return False, 'El detalle de la compra está vacío.'
    factor = 1 / (1 + float(iva_pct) / 100) if (iva_incluido and iva_pct) else 1.0
    items, total = [], 0.0
    for l in lineas:
        if l.get('tipo') == 'insumo':
            ins = _insumo(l['iid']) if l.get('iid') else _buscar_insumo(l['nombre'])
            if ins is None:
                ins = {'id': _siguiente_id('insumos'), 'name': l['nombre'].strip(), 'cost_per_unit': 0.0,
                       'unit_measure': l.get('unidad', 'kg'), 'stock': 0.0}
                _s('insumos').append(ins)
            qty, costo = float(l['qty']), float(l['costo'])
            ins['cost_per_unit'] = round(costo * factor, 2)          # último costo de compra
            ins['stock'] = round(float(ins.get('stock', 0)) + qty, 3)
            for pr in _s('productos'):                                # recalcula recetas que lo usan
                if any(r['insumo_id'] == ins['id'] for r in pr['receta']):
                    _recalcular_costo(pr)
            items.append({'product_id': None, 'insumo_id': ins['id'], 'name': ins['name'],
                          'quantity': qty, 'unit_price': 0.0, 'unit_cost': round(costo * factor, 2)})
            total += qty * costo
            continue

        p = _producto(l['pid']) if l.get('pid') else None
        if p is None:
            p = _crear_producto(l['nombre'], l.get('precio', 0), float(l['costo']) * factor,
                                l.get('barcode', ''), l.get('minimo', 5))
        qty, costo = int(l['qty']), float(l['costo'])
        costo_n = costo * factor
        stock_prev = p['current_stock']
        if not p.get('receta') and not p.get('mano_obra'):
            total_u = stock_prev + qty
            p['unit_cost'] = round((stock_prev * p['unit_cost'] + qty * costo_n) / total_u, 2) if total_u else round(costo_n, 2)
        p['current_stock'] = stock_prev + qty
        items.append({'product_id': p['id'], 'name': p['name'], 'quantity': qty,
                      'unit_price': 0.0, 'unit_cost': round(costo_n, 2)})
        total += qty * costo

    descuento = round(total * min(max(float(descuento_pct or 0), 0.0), 100.0) / 100, 2)
    importe, iva = _calc_iva(total - descuento, iva_pct, iva_incluido)
    desc = ', '.join(f"{i['quantity']:g}× {i['name']}" for i in items) + ' (compra)'
    if descuento:
        desc += f' (desc. {float(descuento_pct):g}%)'
    desc += _desc_iva(iva_pct, iva, iva_incluido)
    if nota:
        desc += f' — {nota}'
    estado = _estado_efectivo(medio, estado)
    # el descuento se guarda neto de IVA para que el Estado de Resultados no lo arrastre
    _nueva_tx('PURCHASE', desc, importe, medio, estado, vence, 0.0, items, cuando,
              discount=round(descuento * factor, 2), iva=iva)
    return True, f'Compra registrada por {_fmt_money(importe)} ({len(items)} ítem(s)).'


def _reg_gasto(categoria, descripcion, monto, medio, estado, vence, cuando=None,
               iva_pct=0.0, iva_incluido=False):
    total, iva = _calc_iva(monto, iva_pct, iva_incluido)
    desc = f'{categoria}: {descripcion}' if descripcion else categoria
    desc += _desc_iva(iva_pct, iva, iva_incluido)
    estado = _estado_efectivo(medio, estado)
    _nueva_tx('EXPENSE', desc, total, medio, estado, vence, 0.0, None, cuando, iva=iva)
    return True, f'Gasto registrado por {_fmt_money(total)}.'


def _reg_devolucion(tipo, pid, qty, unit, medio, nota='', cuando=None):
    """SALE_RETURN: un cliente te devuelve mercadería (vuelve al stock y sale plata).
    PURCHASE_RETURN: devolvés mercadería a un proveedor (sale del stock y recuperás plata)."""
    p = _producto(pid)
    if p is None:
        return False, 'Producto inexistente.'
    qty, unit = int(qty), float(unit)
    if qty <= 0 or unit <= 0:
        return False, 'La cantidad y el importe deben ser mayores a 0.'
    items = [{'product_id': pid, 'name': p['name'], 'quantity': qty,
              'unit_price': unit if tipo == 'SALE_RETURN' else 0.0, 'unit_cost': p['unit_cost']}]
    if tipo == 'SALE_RETURN':
        p['current_stock'] += qty
        costo = qty * p['unit_cost']
        desc = f"{qty}× {p['name']} (devolución de cliente)"
    else:
        if p['current_stock'] < qty:
            return False, f"No hay stock suficiente de {p['name']} para devolver (hay {p['current_stock']})."
        p['current_stock'] -= qty
        costo = 0.0
        desc = f"{qty}× {p['name']} (devolución a proveedor)"
    if nota:
        desc += f' — {nota}'
    _nueva_tx(tipo, desc, qty * unit, medio, 'PAID', None, costo, items, cuando)
    return True, f'Devolución registrada por {_fmt_money(qty * unit)}.'


def _reg_inv_fin(tipo, descripcion, monto, medio, cuando=None):
    _nueva_tx(tipo, descripcion or TIPOS_MOV[tipo][1], monto, medio, 'PAID', None, 0.0, None, cuando)
    return True, f'{TIPOS_MOV[tipo][1]} registrada por {_fmt_money(monto)}.'


def _reg_liquidacion(tx_id, medio, cuando=None):
    orig = _tx(tx_id)
    if orig is None or orig['anulada'] or orig['status'] != 'PENDING':
        return False, 'Esa cuenta ya no está pendiente.'
    es_cobro = orig['type'] == 'SALE'
    tipo = 'COLLECTION' if es_cobro else 'PAYMENT'
    nueva = _nueva_tx(tipo, f"{'Cobro' if es_cobro else 'Pago'} de #{orig['id']} · {orig['description']}",
                      orig['amount'], medio, 'PAID', None, 0.0, None, cuando, liquida_a=orig['id'])
    orig['status'] = 'PAID'
    orig['liquidado_por'] = nueva['id']
    return True, f"{'Cobro' if es_cobro else 'Pago'} registrado por {_fmt_money(orig['amount'])}."


def _anular(tx_id):
    t = _tx(tx_id)
    if t is None or t['anulada']:
        return False, 'La operación no existe o ya está anulada.'
    if t['liquidado_por']:
        return False, f"Primero anulá el cobro/pago #{t['liquidado_por']} que la liquidó."
    if t['type'] == 'SALE':
        for it in t['items']:
            p = _producto(it['product_id'])
            if p:
                p['current_stock'] += it['quantity']
    elif t['type'] == 'PURCHASE':
        for it in t['items']:
            p = _producto(it['product_id'])
            if p:
                p['current_stock'] = max(0, p['current_stock'] - it['quantity'])
    elif t['type'] == 'SALE_RETURN':
        for it in t['items']:
            p = _producto(it['product_id'])
            if p:
                p['current_stock'] = max(0, p['current_stock'] - it['quantity'])
    elif t['type'] == 'PURCHASE_RETURN':
        for it in t['items']:
            p = _producto(it['product_id'])
            if p:
                p['current_stock'] += it['quantity']
    elif t['type'] in ('COLLECTION', 'PAYMENT'):
        orig = _tx(t['liquida_a'])
        if orig:
            orig['status'] = 'PENDING'
            orig['liquidado_por'] = None
    t['anulada'] = True
    return True, f"Operación #{tx_id} anulada. El stock y la caja se ajustaron."


# ==============================================================
#  CÁLCULOS: caja, cuentas, resultados
# ==============================================================

SIGNO_FLUJO = {'cobros': 1, 'compras': -1, 'gastos': -1,
               'inv_in': 1, 'inv_out': -1, 'fin_in': 1, 'fin_out': -1}


def _flujo_movs():
    """[(fecha, categoría, monto, medio)] de todo lo que realmente movió plata.
    Las devoluciones vienen con monto negativo dentro de su categoría (netean cobros / pagos)."""
    out = []
    for t in _s('transacciones'):
        if t['anulada']:
            continue
        tp, pagado, liq = t['type'], t['status'] == 'PAID', t['liquidado_por']
        f, a, m = t['created_at'].date(), t['amount'], t['payment_method']
        if tp == 'COLLECTION' or (tp == 'SALE' and pagado and not liq):
            out.append((f, 'cobros', a, m))
        elif tp == 'SALE_RETURN':
            out.append((f, 'cobros', -a, m))
        elif tp == 'PAYMENT':
            orig = _tx(t['liquida_a'])
            out.append((f, 'compras' if orig and orig['type'] == 'PURCHASE' else 'gastos', a, m))
        elif tp == 'PURCHASE' and pagado and not liq:
            out.append((f, 'compras', a, m))
        elif tp == 'EXPENSE' and pagado and not liq:
            out.append((f, 'gastos', a, m))
        elif tp == 'PURCHASE_RETURN':
            out.append((f, 'compras', -a, m))
        elif tp in ('INV_IN', 'INV_OUT', 'FIN_IN', 'FIN_OUT'):
            out.append((f, tp.lower(), a, m))
    return out


def _movimientos_caja():
    """[(medio, monto con signo)] — lo usa _saldos()."""
    return [(m, SIGNO_FLUJO[c] * a) for _f, c, a, m in _flujo_movs()]


def _saldos():
    caja, banco = _s('saldo_caja'), _s('saldo_banco')
    for medio, monto in _movimientos_caja():
        tipo = _tipo_medio(medio)
        if tipo == 'caja':
            caja += monto
        elif tipo == 'banco':
            banco += monto
    return caja, banco


def _flujo_mensual(anio):
    """({categoría: [12 montos]}, saldo movido en años anteriores)."""
    res = {c: [0.0] * 12 for c in SIGNO_FLUJO}
    previo = 0.0
    for f, c, a, _m in _flujo_movs():
        if f.year == anio:
            res[c][f.month - 1] += a
        elif f.year < anio:
            previo += SIGNO_FLUJO[c] * a
    return res, previo


def _mes_rangos(anio):
    out = []
    for m in range(1, 13):
        ini = date(anio, m, 1)
        fin = date(anio + 1, 1, 1) - timedelta(days=1) if m == 12 else date(anio, m + 1, 1) - timedelta(days=1)
        out.append((ini, fin))
    return out


def _por_cobrar():
    return [t for t in _s('transacciones') if t['type'] == 'SALE' and t['status'] == 'PENDING' and not t['anulada']]


def _por_pagar():
    return [t for t in _s('transacciones') if t['type'] in ('PURCHASE', 'EXPENSE') and t['status'] == 'PENDING' and not t['anulada']]


def _vencida(t):
    return bool(t['due_date']) and t['due_date'] < date.today()


def _en_periodo(t, desde, hasta):
    d = t['created_at'].date()
    return (desde is None or d >= desde) and (hasta is None or d <= hasta)


def _pyl_detalle(desde, hasta):
    """Estado de resultados completo (criterio devengado), igual a las filas de la planilla."""
    d = dict.fromkeys(['ventas', 'devol', 'desc', 'cogs', 'dev_compras', 'desc_compras', 'gastos'], 0.0)
    for t in _s('transacciones'):
        if t['anulada'] or not _en_periodo(t, desde, hasta):
            continue
        tp, dto = t['type'], t.get('discount', 0.0)
        if tp == 'SALE':
            d['ventas'] += t['amount'] + dto      # ventas a precio de lista
            d['desc'] += dto
            d['cogs'] += t['cost_amount']
        elif tp == 'SALE_RETURN':
            d['devol'] += t['amount']
            d['cogs'] -= t['cost_amount']         # la mercadería vuelve al stock
        elif tp == 'PURCHASE':
            d['desc_compras'] += dto
        elif tp == 'PURCHASE_RETURN':
            d['dev_compras'] += t['amount']
        elif tp == 'EXPENSE':
            d['gastos'] += t['amount']
    d['ventas_netas'] = d['ventas'] - d['devol'] - d['desc']
    d['bruta'] = d['ventas_netas'] - d['cogs'] + d['dev_compras'] + d['desc_compras']
    d['neta'] = d['bruta'] - d['gastos']
    return d


def _pyl(desde, hasta):
    """(ventas netas, costo neto, gastos) — lo usan los KPIs y el PDF de cierre."""
    d = _pyl_detalle(desde, hasta)
    return d['ventas_netas'], d['cogs'] - d['dev_compras'] - d['desc_compras'], d['gastos']


def _top_vendidos(n=8):
    unidades = {}
    for t in _s('transacciones'):
        if t['type'] == 'SALE' and not t['anulada']:
            for it in t['items']:
                unidades[it['product_id']] = unidades.get(it['product_id'], 0) + it['quantity']
    prods = sorted(_s('productos'), key=lambda p: (-unidades.get(p['id'], 0), p['name']))
    return prods[:n]


# ==============================================================
#  HELPERS DE UI
# ==============================================================

def _fmt_money(v):
    try:
        v = float(v)
    except Exception:
        return '$0'
    signo = '-' if v < 0 else ''
    return f'{signo}${abs(v):,.0f}'.replace(',', '.')


def _fmt_fecha(dt):
    return dt.strftime('%d/%m %H:%M')


def _kpi_row(items):
    cols = st.columns(len(items))
    for col, (label, value, sub, color) in zip(cols, items):
        with col:
            st.markdown(
                f'<div class="kpi-card"><div class="kpi-accent" style="background:{color}"></div>'
                f'<div class="kpi-label">{label}</div>'
                f'<div class="kpi-value">{value}</div>'
                f'<div class="kpi-sub">{sub}</div></div>',
                unsafe_allow_html=True,
            )
    st.markdown('<div style="height:8px"></div>', unsafe_allow_html=True)


def _titulo(texto):
    st.markdown(f'<div class="sec-title">{texto}</div>', unsafe_allow_html=True)


def _flash(msg, kind='success'):
    st.session_state['pw_flash'] = (kind, msg)


def _mostrar_flash():
    f = st.session_state.pop('pw_flash', None)
    if not f:
        return
    kind, msg = f
    if kind == 'success':
        st.toast(msg, icon='✅')
    elif kind == 'warning':
        st.warning(msg)
    else:
        st.error(msg)


def _fila_html(label, valor, color='#e6edf3', fuerte=False, tenue=False, linea=False):
    peso = 700 if fuerte else 500
    col_label = C_GRIS if tenue else '#c9d1d9'
    borde = 'border-top:1px solid #21262d;margin-top:4px;padding-top:8px;' if linea else ''
    return (f'<div style="display:flex;justify-content:space-between;padding:4px 2px;{borde}">'
            f'<span style="color:{col_label};font-size:13px;font-weight:{peso}">{label}</span>'
            f'<span style="color:{color};font-size:{15 if fuerte else 13}px;font-weight:{peso}">{valor}</span></div>')


def _etiqueta_pendiente(t):
    venc = ''
    if t['due_date']:
        venc = f" · vence {t['due_date'].strftime('%d/%m')}" + (' ⚠️ VENCIDA' if _vencida(t) else '')
    return f"#{t['id']} · {t['description'][:45]} · {_fmt_money(t['amount'])}{venc}"


# ==============================================================
#  CALLBACKS (se ejecutan antes del rerun)
# ==============================================================

def _cart_add(pid, n=1):
    carrito = _s('carrito')
    p = _producto(pid)
    if not p:
        return
    if carrito.get(pid, 0) + n > p['current_stock']:
        st.toast(f"Sin stock suficiente de {p['name']} (hay {p['current_stock']}).", icon='⚠️')
        return
    carrito[pid] = carrito.get(pid, 0) + n
    if carrito[pid] <= 0:
        carrito.pop(pid, None)


def _cart_quitar(pid):
    _s('carrito').pop(pid, None)


def _cart_vaciar():
    st.session_state[_key('carrito')] = {}


def _on_busqueda():
    """Enter en el buscador: código de barras exacto o única coincidencia → agrega al ticket."""
    q = (st.session_state.get('pw_busq') or '').strip()
    if not q:
        return
    prods = _s('productos')
    hit = [p for p in prods if p['barcode'] and p['barcode'] == q]
    if not hit:
        coinc = [p for p in prods if q.lower() in p['name'].lower()]
        if len(coinc) == 1:
            hit = coinc
    if hit:
        _cart_add(hit[0]['id'])
        st.session_state['pw_busq'] = ''


def _bom_quitar(pid, idx):
    p = _producto(pid)
    if p and 0 <= idx < len(p['receta']):
        p['receta'].pop(idx)
        _recalcular_costo(p)


def _bom_agregar(pid, key_ins, key_qty):
    p = _producto(pid)
    iid = st.session_state.get(key_ins)
    qty = float(st.session_state.get(key_qty) or 0)
    if not p or iid is None:
        return
    if qty <= 0:
        st.toast('Ingresá una cantidad mayor a 0.', icon='⚠️')
        return
    for l in p['receta']:
        if l['insumo_id'] == iid:
            l['qty'] += qty
            break
    else:
        p['receta'].append({'insumo_id': iid, 'qty': qty})
    _recalcular_costo(p)


def _compra_lineas():
    return st.session_state.setdefault(_key('carrito_compra'), [])


def _compra_quitar(idx):
    l = _compra_lineas()
    if 0 <= idx < len(l):
        l.pop(idx)


def _compra_vaciar():
    st.session_state[_key('carrito_compra')] = []


# ==============================================================
#  HEADER — KPIs
# ==============================================================

def _kpis_header():
    caja, banco = _saldos()
    productos = _s('productos')
    bajos = [p for p in productos if p['current_stock'] < p['min_stock']]
    sin_stock = [p for p in productos if p['current_stock'] <= 0]
    hoy = date.today()
    v, c, g = _pyl(hoy.replace(day=1), hoy)
    neto = v - c - g

    _kpi_row([
        ('💵 Caja chica', _fmt_money(caja), 'Efectivo disponible', C_VERDE if caja >= 0 else C_ROJO),
        ('🏦 Bancos / Digital', _fmt_money(banco), 'Mercado Pago + transferencias', C_AZUL if banco >= 0 else C_ROJO),
        ('📦 Stock crítico', str(len(bajos)), f'{len(sin_stock)} sin stock' if bajos else 'Todo en orden',
         C_ROJO if bajos else C_GRIS),
        ('📊 Resultado neto del mes', _fmt_money(neto), f"Ventas {_fmt_money(v)}", C_VERDE if neto >= 0 else C_ROJO),
    ])


# ==============================================================
#  MÓDULO A — REGISTRADORA EXPRÉS
# ==============================================================

def _form_venta():
    izq, der = st.columns([1, 1], gap='medium')
    with izq:
        _venta_busqueda()
    with der:
        _venta_ticket()


def _venta_busqueda():
    productos = _s('productos')

    st.text_input('Buscar producto o código de barras (F2)', key='pw_busq',
                  placeholder='Escaneá o escribí y presioná Enter', on_change=_on_busqueda)
    q = (st.session_state.get('pw_busq') or '').strip().lower()
    if q:
        res = [p for p in productos if q in p['name'].lower() or (p['barcode'] and q in p['barcode'])][:6]
        if res:
            cols = st.columns(min(3, len(res)))
            for i, p in enumerate(res):
                with cols[i % len(cols)]:
                    st.button(f"{p['name']} · {_fmt_money(p['sale_price'])}", key=f"pw_r_{p['id']}",
                              use_container_width=True, disabled=p['current_stock'] <= 0,
                              on_click=_cart_add, args=(p['id'],))
        else:
            st.caption('Sin coincidencias.')

    st.caption('⚡ Venta rápida — 1 toque = 1 unidad')
    top = _top_vendidos(9)
    with st.container(key='pw_quick'):
        cols = st.columns(3)
        for i, p in enumerate(top):
            with cols[i % 3]:
                st.button(f"{p['name']} · {_fmt_money(p['sale_price'])}", key=f"pw_q_{p['id']}",
                          use_container_width=True, disabled=p['current_stock'] <= 0,
                          on_click=_cart_add, args=(p['id'],),
                          help=f"Stock: {p['current_stock']}")


def _venta_ticket():
    carrito = _s('carrito')

    _titulo('🧾 Ticket actual')
    if not carrito:
        st.caption('Tocá un producto para agregarlo al ticket.')
        total = 0.0
    else:
        total = 0.0
        for pid, qty in list(carrito.items()):
            p = _producto(pid)
            if p is None:
                continue
            sub = qty * p['sale_price']
            total += sub
            c1, c2, c3, c4 = st.columns([5, 1, 1, 1])
            with c1:
                st.markdown(f"**{qty}×** {_esc(p['name'])} "
                            f"<span style='color:{C_GRIS};float:right'>{_fmt_money(sub)}</span>",
                            unsafe_allow_html=True)
            with c2:
                st.button('➖', key=f'pw_m_{pid}', on_click=_cart_add, args=(pid, -1))
            with c3:
                st.button('➕', key=f'pw_p_{pid}', on_click=_cart_add, args=(pid, 1))
            with c4:
                st.button('✕', key=f'pw_x_{pid}', on_click=_cart_quitar, args=(pid,))
        st.markdown(
            f'<div style="display:flex;justify-content:space-between;align-items:center;'
            f'border-top:1px solid #21262d;margin-top:6px;padding-top:8px">'
            f'<span style="color:{C_GRIS};font-size:12px;text-transform:uppercase;letter-spacing:.6px">Total</span>'
            f'<span style="font-size:26px;font-weight:800;color:#e6edf3">{_fmt_money(total)}</span></div>',
            unsafe_allow_html=True)
        st.button('🗑️ Vaciar ticket', key='pw_vaciar', on_click=_cart_vaciar)

    with st.form('pw_form_venta', clear_on_submit=True):
        c1, c2 = st.columns(2)
        with c1:
            medio = st.selectbox('Medio de pago', _medios_activos(), key='pw_v_medio')
        with c2:
            estado = st.radio('Estado', ['Pagado', 'Pendiente'], horizontal=True, key='pw_v_estado')
        c3, c4 = st.columns(2)
        with c3:
            nota = st.text_input('Cliente / nota (opcional)', key='pw_v_nota')
        with c4:
            vence = st.date_input('Vence (si queda pendiente)', value=date.today() + timedelta(days=15), key='pw_v_vence')
        descuento = st.number_input('Descuento %', min_value=0.0, max_value=100.0, step=1.0, key='pw_v_desc')
        enviar = st.form_submit_button(
            f'✅ Confirmar venta · {_fmt_money(total)}' if carrito else '✅ Confirmar venta',
            type='primary', use_container_width=True, disabled=not carrito)

    if enviar:
        ok, msg = _reg_venta(dict(carrito), medio, 'PAID' if estado == 'Pagado' else 'PENDING', vence,
                             nota.strip(), descuento_pct=descuento)
        if ok:
            st.session_state[_key('carrito')] = {}
            if _tipo_medio(medio) == 'credito' or estado == 'Pendiente':
                msg += ' Quedó pendiente de cobro.'
            _flash(msg)
            st.rerun()
        else:
            st.error(msg)


# ---------- Importador de CSV / Excel / PDF (Compras y Gastos) ----------

NINGUNA = '— ninguna —'
CATEGORIAS_GASTO = ['Alquiler', 'Sueldos', 'Servicios', 'Impuestos', 'Marketing', 'Mantenimiento', 'Otros']


def _a_numero(v):
    """Convierte '$ 1.234,50', '1,234.50', 1500, etc. a float. None si no se puede."""
    if v is None:
        return None
    if not isinstance(v, str):
        try:
            f = float(v)
            return None if f != f else f
        except (TypeError, ValueError):
            pass
    s = re.sub(r'[^\d,.\-]', '', str(v))
    if not re.search(r'\d', s):
        return None
    if ',' in s and '.' in s:
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '').replace(',', '.')
        else:
            s = s.replace(',', '')
    elif ',' in s:
        s = s.replace(',', '.')
    elif '.' in s and re.fullmatch(r'-?\d{1,3}(\.\d{3})+', s):
        s = s.replace('.', '')
    try:
        return float(s)
    except ValueError:
        return None


def _adivinar(cols, claves):
    for c in cols:
        if any(k in str(c).lower() for k in claves):
            return c
    return None


def _sel_col(label, cols, claves, key, obligatoria=True):
    opts = cols if obligatoria else [NINGUNA] + cols
    g = _adivinar(cols, claves)
    return st.selectbox(label, opts, index=opts.index(g) if g in opts else 0, key=key)


def _leer_pdf(buf):
    try:
        import pdfplumber
    except ImportError:
        raise ImportError('falta instalar pdfplumber (agregalo a requirements.txt)')
    filas, texto = [], []
    with pdfplumber.open(buf) as pdf:
        for page in pdf.pages:
            for tabla in page.extract_tables():
                for r in tabla:
                    if r and any((c or '').strip() for c in r):
                        filas.append([(c or '').replace('\n', ' ').strip() for c in r])
            texto.extend((page.extract_text() or '').splitlines())
    if filas:
        ancho = max(len(r) for r in filas)
        filas = [r + [''] * (ancho - len(r)) for r in filas]
        cols, vistos = [], {}
        for i, c in enumerate(filas[0]):
            c = c or f'col{i + 1}'
            vistos[c] = vistos.get(c, 0) + 1
            cols.append(c if vistos[c] == 1 else f'{c}_{vistos[c]}')
        return pd.DataFrame(filas[1:], columns=cols)
    # Sin tablas: busca líneas "descripción ... monto"
    out = []
    for l in texto:
        m = re.match(r'^(.*?\D)\s+\$?\s*(-?[\d.,]+)$', l.strip())
        if m and _a_numero(m.group(2)) is not None:
            out.append({'Descripción': m.group(1).strip(' .:-'), 'Monto': m.group(2)})
    if not out:
        raise ValueError('no encontré tablas ni líneas con montos (el PDF debe tener texto seleccionable, no ser un escaneo)')
    return pd.DataFrame(out)


def _leer_archivo(f):
    nombre, raw = f.name.lower(), f.getvalue()
    if nombre.endswith(('.csv', '.txt')):
        for enc in ('utf-8-sig', 'latin-1'):
            try:
                return pd.read_csv(io.BytesIO(raw), sep=None, engine='python', encoding=enc)
            except UnicodeDecodeError:
                continue
    elif nombre.endswith(('.xlsx', '.xlsm', '.xls')):
        return pd.read_excel(io.BytesIO(raw))
    elif nombre.endswith('.pdf'):
        return _leer_pdf(io.BytesIO(raw))
    raise ValueError('formato no soportado')


def _importador(tipo):
    """tipo: 'compra' o 'gasto'. Lee CSV/Excel/PDF, deja mapear columnas, muestra
    vista previa y registra una operación por fila."""
    es_compra = tipo == 'compra'
    n = st.session_state.get(f'pw_imp_n_{tipo}', 0)
    with st.expander('📎 Importar desde CSV, Excel o PDF'):
        archivo = st.file_uploader('Archivo', type=['csv', 'txt', 'xlsx', 'xlsm', 'xls', 'pdf'],
                                   key=f'pw_imp_{tipo}_f{n}', label_visibility='collapsed')
        if archivo is None:
            st.caption('Compras: producto, cantidad y costo. Gastos: descripción y monto (y categoría si la tiene). '
                       'Después elegís qué columna es cada dato.')
            return
        try:
            df = _leer_archivo(archivo).dropna(how='all')
            df.columns = [str(c) for c in df.columns]
        except Exception as e:
            st.error(f'No pude leer el archivo: {e}')
            return
        if df.empty:
            st.warning('El archivo no tiene filas.')
            return
        cols = list(df.columns)
        k = f'pw_imp_{tipo}_{archivo.name}_{archivo.size}'
        st.caption(f'{len(df)} filas leídas. Indicá qué columna es cada dato:')
        filas = []

        if es_compra:
            m1, m2, m3 = st.columns(3)
            with m1:
                c_prod = _sel_col('Producto', cols, ['producto', 'artículo', 'articulo', 'descrip', 'detalle', 'nombre', 'item'], k + '_p')
            with m2:
                c_qty = _sel_col('Cantidad', cols, ['cant', 'unid', 'qty'], k + '_q', False)
            with m3:
                c_cos = _sel_col('Costo unitario', cols, ['costo', 'precio', 'unitario', 'importe'], k + '_c', False)
            for _, r in df.iterrows():
                nombre = str(r[c_prod]).strip()
                if not nombre or nombre.lower() == 'nan':
                    continue
                qty = _a_numero(r[c_qty]) if c_qty != NINGUNA else 1
                costo = _a_numero(r[c_cos]) if c_cos != NINGUNA else None
                if not qty or int(round(qty)) <= 0:
                    continue
                filas.append({'Producto': nombre, 'Cantidad': int(round(qty)), 'Costo unitario': costo,
                              'Situación': 'Existe' if _buscar_producto(nombre) else 'Nuevo'})
        else:
            m1, m2, m3 = st.columns(3)
            with m1:
                c_desc = _sel_col('Descripción', cols, ['descrip', 'detalle', 'concepto', 'nombre'], k + '_d')
            with m2:
                c_monto = _sel_col('Monto', cols, ['monto', 'importe', 'total', 'valor'], k + '_m')
            with m3:
                c_cat = _sel_col('Categoría', cols, ['categ', 'rubro', 'tipo'], k + '_k', False)
            cat_fija = st.selectbox('Categoría por defecto (si no hay columna o viene vacía)', CATEGORIAS_GASTO,
                                    index=len(CATEGORIAS_GASTO) - 1, key=k + '_cf')
            for _, r in df.iterrows():
                monto = _a_numero(r[c_monto])
                if not monto or monto <= 0:
                    continue
                desc = str(r[c_desc]).strip()
                desc = '' if desc.lower() == 'nan' else desc
                cat = str(r[c_cat]).strip() if c_cat != NINGUNA else ''
                cat = cat if cat and cat.lower() != 'nan' else cat_fija
                filas.append({'Categoría': cat, 'Descripción': desc, 'Monto': monto})

        if not filas:
            st.warning('No quedó ninguna fila válida con esas columnas. Revisá la selección.')
            return
        st.dataframe(pd.DataFrame(filas), use_container_width=True, hide_index=True,
                     height=min(260, len(filas) * 36 + 42))

        o1, o2, o3 = st.columns(3)
        with o1:
            medio = st.selectbox('Medio de pago', _medios_activos(), key=k + '_med')
        with o2:
            estado = st.radio('Estado', ['Pagado', 'Pendiente'], horizontal=True, key=k + '_est')
        with o3:
            vence = st.date_input('Vence (si queda pendiente)', value=date.today() + timedelta(days=15), key=k + '_ven')
        crear = True
        if es_compra:
            crear = st.checkbox('Crear los productos que no existan', value=True, key=k + '_crear')

        if st.button(f'📥 Importar {len(filas)} filas', key=k + '_go', type='primary', use_container_width=True):
            est = 'PAID' if estado == 'Pagado' else 'PENDING'
            hechas = salteadas = 0
            for f in filas:
                if es_compra:
                    p = _buscar_producto(f['Producto'])
                    if p is None:
                        if not crear:
                            salteadas += 1
                            continue
                        p = _crear_producto(f['Producto'], costo=f['Costo unitario'] or 0)
                    costo = f['Costo unitario'] if f['Costo unitario'] is not None else p['unit_cost']
                    ok, _m = _reg_compra(p['id'], f['Cantidad'], float(costo), medio, est, vence)
                else:
                    ok, _m = _reg_gasto(f['Categoría'], f['Descripción'], f['Monto'], medio, est, vence)
                hechas += 1 if ok else 0
            st.session_state[f'pw_imp_n_{tipo}'] = n + 1   # limpia el uploader
            msg = f'Se importaron {hechas} {"compras" if es_compra else "gastos"}.'
            if salteadas:
                msg += f' {salteadas} saltadas (producto inexistente).'
            _flash(msg)
            st.rerun()


# ---------- Compras (varios productos por operación) ----------

def _form_compra():
    productos = _s('productos')
    lineas = _compra_lineas()
    NUEVO = '➕ Producto nuevo…'
    opciones = {f"{p['name']} (stock {p['current_stock']})": p['id'] for p in productos}

    # ---------- 1) Agregar productos al detalle ----------
    _titulo('➕ Agregar producto al detalle')
    sel = st.selectbox('Producto', [NUEVO] + list(opciones), index=1 if opciones else 0, key='pw_c_prod')
    es_nuevo = sel == NUEVO
    p = None if es_nuevo else _producto(opciones[sel])
    pid = None if es_nuevo else p['id']

    with st.form('pw_form_compra_item', clear_on_submit=True):
        nombre_nuevo, precio_nuevo, barcode_nuevo, minimo_nuevo = '', 0.0, '', 5
        if es_nuevo:
            n1, n2 = st.columns([3, 2])
            with n1:
                nombre_nuevo = st.text_input('Nombre del producto nuevo', key='pw_c_nuevo_nombre')
            with n2:
                precio_nuevo = st.number_input('Precio de venta (0 = sugerido)', min_value=0.0, step=100.0,
                                               key='pw_c_nuevo_precio')
            with st.expander('Más datos del producto (opcional)'):
                o1, o2 = st.columns(2)
                with o1:
                    barcode_nuevo = st.text_input('Código de barras', key='pw_c_nuevo_barcode')
                with o2:
                    minimo_nuevo = st.number_input('Stock mínimo', min_value=0, step=1, value=5, key='pw_c_nuevo_min')
        c1, c2 = st.columns(2)
        with c1:
            cantidad = st.number_input('Cantidad', min_value=1, step=1, value=1, key='pw_c_qty')
        with c2:
            costo = st.number_input('Costo unitario', min_value=0.0, step=10.0,
                                    value=0.0 if es_nuevo else float(p['unit_cost']),
                                    key=f'pw_c_costo_{pid or "nuevo"}')
        agregar = st.form_submit_button('➕ Agregar al detalle', use_container_width=True)

    if agregar:
        if es_nuevo:
            nombre = nombre_nuevo.strip()
            bc = barcode_nuevo.strip()
            existente = _buscar_producto(nombre) if nombre else None
            if not nombre:
                st.warning('Escribí el nombre del producto nuevo.')
            elif existente:
                # ya existe con ese nombre: se usa el existente
                lineas.append({'pid': existente['id'], 'nombre': existente['name'],
                               'qty': int(cantidad), 'costo': float(costo)})
                st.rerun()
            elif bc and any(x['barcode'] == bc for x in productos):
                st.warning('Ya existe un producto con ese código de barras.')
            else:
                lineas.append({'pid': None, 'nombre': nombre, 'qty': int(cantidad), 'costo': float(costo),
                               'precio': float(precio_nuevo), 'barcode': bc, 'minimo': int(minimo_nuevo)})
                st.rerun()
        else:
            lineas.append({'pid': pid, 'nombre': p['name'], 'qty': int(cantidad), 'costo': float(costo)})
            st.rerun()

    # ---------- 2) Detalle de la compra ----------
    _titulo('🧾 Detalle de la compra')
    total = 0.0
    if not lineas:
        st.caption('Todavía no agregaste productos. Podés sumar todos los que quieras antes de confirmar.')
    for i, l in enumerate(lineas):
        sub = l['qty'] * l['costo']
        total += sub
        d1, d2 = st.columns([8, 1])
        with d1:
            tag = (f" <span style='color:{C_AMARILLO};font-size:11px;font-weight:700'>NUEVO</span>"
                   if l['pid'] is None else '')
            st.markdown(f"**{l['qty']}×** {_esc(l['nombre'])}{tag} "
                        f"<span style='color:{C_GRIS};float:right'>{_fmt_money(sub)}</span>",
                        unsafe_allow_html=True)
        with d2:
            st.button('✕', key=f'pw_cx_{i}', on_click=_compra_quitar, args=(i,))
    if lineas:
        st.markdown(
            f'<div style="display:flex;justify-content:space-between;align-items:center;'
            f'border-top:1px solid #21262d;margin-top:6px;padding-top:8px">'
            f'<span style="color:{C_GRIS};font-size:12px;text-transform:uppercase;letter-spacing:.6px">Total</span>'
            f'<span style="font-size:26px;font-weight:800;color:#e6edf3">{_fmt_money(total)}</span></div>',
            unsafe_allow_html=True)
        st.button('🗑️ Vaciar detalle', key='pw_c_vaciar', on_click=_compra_vaciar)

    # ---------- 3) Confirmar ----------
    with st.form('pw_form_compra', clear_on_submit=True):
        c3, c4, c5 = st.columns(3)
        with c3:
            medio = st.selectbox('Medio de pago', _medios_activos(), key='pw_c_medio')
        with c4:
            estado = st.radio('Estado', ['Pagado', 'Pendiente'], horizontal=True, key='pw_c_estado')
        with c5:
            vence = st.date_input('Vence (si queda pendiente)', value=date.today() + timedelta(days=15), key='pw_c_vence')
        nota = st.text_input('Proveedor / nota (opcional)', key='pw_c_nota')
        descuento = st.number_input('Descuento del proveedor %', min_value=0.0, max_value=100.0, step=1.0,
                                    key='pw_c_desc')
        enviar = st.form_submit_button(
            f'📥 Registrar compra · {_fmt_money(total)}' if lineas else '📥 Registrar compra',
            type='primary', use_container_width=True, disabled=not lineas)
    st.caption('Suma stock de cada producto y recalcula su costo (promedio ponderado). '
               'Los productos nuevos se crean al confirmar.')

    if enviar:
        ok, msg = _reg_compra_multiple(list(lineas), medio, 'PAID' if estado == 'Pagado' else 'PENDING',
                                       vence, nota.strip(), descuento_pct=descuento)
        if ok:
            _compra_vaciar()
        _flash(msg, 'success' if ok else 'warning')
        st.rerun()

    _importador('compra')


def _form_gasto():
    categorias = CATEGORIAS_GASTO
    with st.form('pw_form_gasto', clear_on_submit=True):
        c1, c2 = st.columns(2)
        with c1:
            categoria = st.selectbox('Categoría', categorias, key='pw_g_cat')
        with c2:
            monto = st.number_input('Monto', min_value=0.0, step=100.0, key='pw_g_monto')
        descripcion = st.text_input('Descripción', key='pw_g_desc', placeholder='Ej: Factura de luz')
        c3, c4, c5 = st.columns(3)
        with c3:
            medio = st.selectbox('Medio de pago', _medios_activos(), key='pw_g_medio')
        with c4:
            estado = st.radio('Estado', ['Pagado', 'Pendiente'], horizontal=True, key='pw_g_estado')
        with c5:
            vence = st.date_input('Vence (si queda pendiente)', value=date.today() + timedelta(days=15), key='pw_g_vence')
        enviar = st.form_submit_button('💸 Registrar gasto', type='primary', use_container_width=True)

    if enviar:
        if monto <= 0:
            st.warning('El monto debe ser mayor a 0.')
        else:
            ok, msg = _reg_gasto(categoria, descripcion.strip(), float(monto), medio,
                                 'PAID' if estado == 'Pagado' else 'PENDING', vence)
            _flash(msg)
            st.rerun()

    _importador('gasto')


def _form_liquidacion(es_cobro):
    pend = _por_cobrar() if es_cobro else _por_pagar()
    sufijo = 'cobro' if es_cobro else 'pago'
    if not pend:
        st.info('No hay cuentas por cobrar pendientes. 🎉' if es_cobro else 'No hay cuentas por pagar pendientes. 🎉')
        return
    pend = sorted(pend, key=lambda t: (t['due_date'] is None, t['due_date'] or date.max))
    opciones = {_etiqueta_pendiente(t): t['id'] for t in pend}
    sel = st.selectbox('Cuenta por cobrar' if es_cobro else 'Cuenta por pagar', list(opciones), key=f'pw_l_sel_{sufijo}')
    tx_id = opciones[sel]
    with st.form(f'pw_form_liq_{sufijo}', clear_on_submit=True):
        medio = st.selectbox('Medio de cobro' if es_cobro else 'Medio de pago',
                             _medios_activos(incluir_credito=False), key=f'pw_l_medio_{sufijo}')
        enviar = st.form_submit_button('💰 Registrar cobro' if es_cobro else '🏦 Registrar pago',
                                       type='primary', use_container_width=True)
    if enviar:
        ok, msg = _reg_liquidacion(tx_id, medio)
        _flash(msg, 'success' if ok else 'warning')
        st.rerun()


def _form_devolucion():
    productos = _s('productos')
    if not productos:
        st.info('Primero cargá productos.')
        return
    tipo = st.radio('Tipo de devolución', ['SALE_RETURN', 'PURCHASE_RETURN'], horizontal=True, key='pw_dv_tipo',
                    format_func={'SALE_RETURN': '↩️ Un cliente me devuelve (venta)',
                                 'PURCHASE_RETURN': '📤 Yo devuelvo a un proveedor (compra)'}.get)
    es_venta = tipo == 'SALE_RETURN'
    opciones = {f"{p['name']} (stock {p['current_stock']})": p['id'] for p in productos}
    sel = st.selectbox('Producto', list(opciones), key='pw_dv_prod')
    p = _producto(opciones[sel])
    with st.form('pw_form_devolucion', clear_on_submit=True):
        c1, c2 = st.columns(2)
        with c1:
            cantidad = st.number_input('Cantidad', min_value=1, step=1, value=1, key='pw_dv_qty')
        with c2:
            unit = st.number_input('Importe unitario devuelto al cliente' if es_venta else 'Importe unitario que te devuelven',
                                   min_value=0.0, step=10.0,
                                   value=float(p['sale_price'] if es_venta else p['unit_cost']),
                                   key=f"pw_dv_unit_{tipo}_{p['id']}")
        c3, c4 = st.columns(2)
        with c3:
            medio = st.selectbox('Medio por el que se devuelve la plata', _medios_activos(incluir_credito=False),
                                 key='pw_dv_medio')
        with c4:
            nota = st.text_input('Motivo / cliente / proveedor (opcional)', key='pw_dv_nota')
        enviar = st.form_submit_button('↩️ Registrar devolución', type='primary', use_container_width=True)
    st.caption('Ajusta el stock y la caja al instante. Aparece en el Estado de Resultados como '
               + ('«(−) Devoluciones».' if es_venta else '«(+) Devoluciones por Compras».'))
    if enviar:
        ok, msg = _reg_devolucion(tipo, p['id'], cantidad, unit, medio, nota.strip())
        _flash(msg, 'success' if ok else 'warning')
        st.rerun()


def _form_inv_fin():
    with st.form('pw_form_invfin', clear_on_submit=True):
        tipo = st.selectbox('Tipo', list(OPC_INVFIN), format_func=OPC_INVFIN.get, key='pw_if_tipo')
        c1, c2 = st.columns(2)
        with c1:
            monto = st.number_input('Monto', min_value=0.0, step=1000.0, key='pw_if_monto')
        with c2:
            medio = st.selectbox('Medio', _medios_activos(incluir_credito=False), key='pw_if_medio')
        descripcion = st.text_input('Descripción', key='pw_if_desc', placeholder='Ej: Heladera nueva / Cuota préstamo')
        enviar = st.form_submit_button('🏗️ Registrar', type='primary', use_container_width=True)
    st.caption('Mueve la caja pero NO afecta el Estado de Resultados: solo aparece en el Flujo de Caja.')
    if enviar:
        if monto <= 0:
            st.warning('El monto debe ser mayor a 0.')
        else:
            ok, msg = _reg_inv_fin(tipo, descripcion.strip(), float(monto), medio)
            _flash(msg)
            st.rerun()


def _modulo_a():
    with st.container(border=True):
        _titulo('⚡ A · Registradora exprés')
        tipo = st.radio('Tipo de movimiento', list(OPC_REGISTRO), key='pw_tipo_mov', horizontal=True,
                        format_func=OPC_REGISTRO.get, label_visibility='collapsed')
        if tipo == 'SALE':
            _form_venta()
        elif tipo == 'PURCHASE':
            _form_compra()
        elif tipo == 'EXPENSE':
            _form_gasto()
        elif tipo == 'COLLECTION':
            _form_liquidacion(True)
        elif tipo == 'PAYMENT':
            _form_liquidacion(False)
        elif tipo == 'RETURN':
            _form_devolucion()
        else:
            _form_inv_fin()


# ==============================================================
#  CALCULADORA DE PRECIOS (pasarelas, plataformas, impuestos, cuotas)
#  Margen calculado sobre el PRECIO FINAL:
#     precio = (costo + gastos fijos) / (1 − margen% − suma de % que se lleva el precio)
# ==============================================================

CUOTAS_OPC = [2, 3, 6, 12]
REDONDEOS = ['Ninguno', 'Múltiplo', 'Psicológico (990/999)']


def _cfg_default():
    return {
        'packaging': 100.0, 'envio': 200.0, 'comision': 5.0, 'iibb': 3.0, 'retenciones': 2.0,
        'redondeo_tipo': REDONDEOS[2], 'redondeo_mult': 10.0,
        'pasarelas': [{'name': 'Mercado Pago', 'pct': 7.0}, {'name': 'PayU', 'pct': 3.5},
                      {'name': 'Stripe', 'pct': 2.9}],
        'plataformas': [{'name': 'MercadoLibre', 'pct': 4.0}, {'name': 'Tienda Nube', 'pct': 3.0},
                        {'name': 'Shopify', 'pct': 2.0}],
        'cuotas': {2: [11.0, 7.0, 9.0], 3: [15.0, 12.0, 16.0], 6: [30.0, 27.0, 32.0], 12: [70.0, 60.0, 68.0]},
        'margen_venta': 30.0, 'margen_mayorista': 15.0, 'descuento': 0.0,
    }


def _cfg_precios():
    return st.session_state.setdefault(_key('precios_cfg'), _cfg_default())


def _redondear(p, cfg):
    tipo, m = cfg['redondeo_tipo'], max(float(cfg['redondeo_mult']), 1.0)
    if tipo == 'Múltiplo':
        return float(math.ceil(p / m) * m)
    if tipo.startswith('Psicol'):
        if p < 1000:
            return float(math.ceil(p / m) * m)
        return float(math.ceil((p + m) / 1000) * 1000 - m)   # 4.213 → 4.990 (múltiplo 10) o 4.999 (múltiplo 1)
    return round(p, 2)


def _sel_actual():
    """Opciones tildadas hoy en la calculadora (con valores por defecto si no se dibujó)."""
    g = st.session_state.get
    return {'pack': g('pw_pc_pack', False), 'envio': g('pw_pc_envio', False),
            'com': g('pw_pc_com', False), 'iibb': g('pw_pc_iibb', True), 'ret': g('pw_pc_ret', True),
            'pasarela': g('pw_pc_pas', 0), 'plataforma': g('pw_pc_plat', 0), 'descuento': 0.0}


def _calc_precio(costo, margen, cfg, sel, cuotas=1, pasarela=None):
    """Devuelve el detalle del precio o None si los porcentajes no cierran (suman 100% o más)."""
    pas = sel['pasarela'] if pasarela is None else pasarela
    plat = sel['plataforma']
    fijos_det = []
    if sel['pack']:
        fijos_det.append(('Packaging', cfg['packaging']))
    if sel['envio']:
        fijos_det.append(('Envío', cfg['envio']))
    fijos = sum(v for _, v in fijos_det)
    pcts = [
        ('Comisión vendedor', cfg['comision'] if sel['com'] else 0.0),
        ('Ingresos Brutos', cfg['iibb'] if sel['iibb'] else 0.0),
        ('Retenciones', cfg['retenciones'] if sel['ret'] else 0.0),
        (f"Pasarela ({cfg['pasarelas'][pas - 1]['name']})" if pas else 'Pasarela', cfg['pasarelas'][pas - 1]['pct'] if pas else 0.0),
        ('Recargo por cuotas', cfg['cuotas'][cuotas][pas - 1] if (pas and cuotas > 1) else 0.0),
        (f"Plataforma ({cfg['plataformas'][plat - 1]['name']})" if plat else 'Plataforma', cfg['plataformas'][plat - 1]['pct'] if plat else 0.0),
    ]
    den = 1 - (margen + sum(p for _, p in pcts)) / 100
    if den <= 0.01:
        return None
    base = costo + fijos
    desc = min(float(sel.get('descuento') or 0), 99.0)
    lista = _redondear(base / den / (1 - desc / 100), cfg)
    final = lista * (1 - desc / 100)
    deducciones = [(n, final * p / 100, p) for n, p in pcts if p]
    ganancia = final - base - sum(v for _, v, _ in deducciones)
    return {'costo': costo, 'fijos_det': fijos_det, 'base': base, 'lista': lista, 'final': final,
            'desc_pct': desc, 'desc_monto': lista - final, 'deducciones': deducciones,
            'ganancia': ganancia, 'margen_real': ganancia / final * 100 if final else 0.0}

def _bloque_calculadora_precios():
    cfg = _cfg_precios()
    productos = _s('productos')
    with st.expander('💲 Calculadora de precios'):
        t_calc, t_des = st.tabs(['🧮 Calculadora', '📋 Desglose'])

        # ---------------- Pestaña 1: Calculadora ----------------
        with t_calc:
            st.markdown('**Producto**')
            ids = [None] + [p['id'] for p in productos]
            etiq = {None: '— Manual (sin producto) —', **{p['id']: p['name'] for p in productos}}
            pid = st.selectbox('Producto', ids, format_func=etiq.get, key='pw_pc_prod')
            p = _producto(pid) if pid else None
            costo = st.number_input('Costo base $', min_value=0.0, step=10.0,
                                    value=float(p['unit_cost']) if p else 0.0,
                                    key=f"pw_pc_costo_{pid}_{p['unit_cost'] if p else 0}")

            st.markdown('**Márgenes**')
            m1, m2, m3 = st.columns(3)
            with m1:
                mv = st.number_input('Margen venta %', min_value=0.0, max_value=95.0, step=1.0,
                                     value=float(cfg['margen_venta']), key=f"pw_pc_mv_{cfg['margen_venta']}")
            with m2:
                mm = st.number_input('Margen mayorista %', min_value=0.0, max_value=95.0, step=1.0,
                                     value=float(cfg['margen_mayorista']), key=f"pw_pc_mm_{cfg['margen_mayorista']}")
            with m3:
                desc = st.number_input('Descuento %', min_value=0.0, max_value=90.0, step=1.0,
                                       value=float(cfg['descuento']), key=f"pw_pc_desc_{cfg['descuento']}")

            st.markdown('**Gastos fijos por unidad**')
            f1, f2 = st.columns(2)
            with f1:
                st.checkbox(f"Packaging ({_fmt_money(cfg['packaging'])})", key='pw_pc_pack')
            with f2:
                st.checkbox(f"Envío ({_fmt_money(cfg['envio'])})", key='pw_pc_envio')

            st.markdown('**Impuestos y vendedor**')
            i1, i2, i3 = st.columns(3)
            with i1:
                st.checkbox(f"Comisión ({cfg['comision']:g}%)", key='pw_pc_com')
            with i2:
                st.checkbox(f"Ing. Brutos ({cfg['iibb']:g}%)", value=True, key='pw_pc_iibb')
            with i3:
                st.checkbox(f"Retenciones ({cfg['retenciones']:g}%)", value=True, key='pw_pc_ret')

            st.markdown('**Pasarela y plataforma**')
            s1, s2 = st.columns(2)
            with s1:
                st.selectbox('Pasarela de pagos', [0, 1, 2, 3], key='pw_pc_pas',
                             format_func=lambda i: 'Ninguna' if i == 0 else
                             f"{cfg['pasarelas'][i - 1]['name']} · {cfg['pasarelas'][i - 1]['pct']:g}%")
            with s2:
                st.selectbox('Plataforma', [0, 1, 2, 3], key='pw_pc_plat',
                             format_func=lambda i: 'Ninguna' if i == 0 else
                             f"{cfg['plataformas'][i - 1]['name']} · {cfg['plataformas'][i - 1]['pct']:g}%")

            sel = _sel_actual()
            sel['descuento'] = desc
            st.session_state[_key('sel_calc')] = dict(sel)
            r_min = _calc_precio(costo, mv, cfg, sel)
            r_may = _calc_precio(costo, mm, cfg, sel)

            st.divider()
            if costo <= 0:
                st.info('Elegí un producto o ingresá un costo base para calcular.')
            elif r_min is None or r_may is None:
                st.error('Los porcentajes (margen + comisiones + impuestos) suman 100% o más. Bajá el margen o sacá algún cargo.')
            else:
                sub_min = (f"Cliente paga {_fmt_money(r_min['final'])} con {desc:g}% off" if desc else 'Precio de lista')
                _kpi_row([
                    ('Precio minorista', _fmt_money(r_min['lista']), sub_min, C_VERDE),
                    ('Precio mayorista', _fmt_money(r_may['lista']), f'Margen {mm:g}%', C_AZUL),
                ])
                _kpi_row([
                    ('Ganancia por unidad', _fmt_money(r_min['ganancia']), 'Minorista, neta de cargos', C_AMARILLO),
                    ('Margen real', f"{r_min['margen_real']:.1f}%", 'Sobre lo que paga el cliente',
                     C_VERDE if r_min['margen_real'] >= mv - 0.05 else C_NARANJA),
                ])
                if p is not None:
                    if st.button(f"💲 Aplicar minorista a «{p['name']}»", key='pw_pc_aplicar',
                                 use_container_width=True):
                        p['sale_price'] = float(r_min['lista'])
                        _flash(f"Precio de «{p['name']}» actualizado a {_fmt_money(r_min['lista'])}.")
                        st.rerun()
                st.caption('El cálculo es en vivo: cambiás cualquier dato y se recalcula solo.')

        # ---------------- Pestaña 2: Desglose ----------------
        with t_des:
            if costo <= 0:
                st.info('Primero elegí un producto o ingresá un costo en la pestaña Calculadora.')
            else:
                precio_de = st.radio('Desglosar precio', ['Minorista', 'Mayorista'], horizontal=True, key='pw_pc_des_tipo')
                margen = mv if precio_de == 'Minorista' else mm
                r = _calc_precio(costo, margen, cfg, sel)
                if r is None:
                    st.error('Los porcentajes suman 100% o más.')
                else:
                    html = _fila_html('Precio de lista', _fmt_money(r['lista']), '#e6edf3', fuerte=True)
                    if r['desc_pct']:
                        html += _fila_html(f"(−) Descuento {r['desc_pct']:g}%", _fmt_money(r['desc_monto']), C_ROJO, tenue=True)
                        html += _fila_html('= Precio final al cliente', _fmt_money(r['final']), C_VERDE, fuerte=True, linea=True)
                    html += _fila_html('(−) Costo base', _fmt_money(r['costo']), C_ROJO, tenue=True)
                    for n, v in r['fijos_det']:
                        html += _fila_html(f'(−) {n}', _fmt_money(v), C_ROJO, tenue=True)
                    for n, v, pc in r['deducciones']:
                        html += _fila_html(f'(−) {n} {pc:g}%', _fmt_money(v), C_ROJO, tenue=True)
                    html += _fila_html('= Ganancia neta por unidad', _fmt_money(r['ganancia']),
                                       C_VERDE if r['ganancia'] >= 0 else C_ROJO, fuerte=True, linea=True)
                    html += _fila_html('Margen real', f"{r['margen_real']:.1f}%", C_GRIS, tenue=True)
                    st.markdown(html, unsafe_allow_html=True)

                    st.markdown('<div style="height:10px"></div>**Precio según cuotas y pasarela**',
                                unsafe_allow_html=True)
                    filas = []
                    for n in [1] + CUOTAS_OPC:
                        fila = {'Cuotas': '1 pago' if n == 1 else f'{n} cuotas'}
                        for i, pz in enumerate(cfg['pasarelas'], 1):
                            rr = _calc_precio(costo, margen, cfg, sel, n, pasarela=i)
                            fila[pz['name']] = _fmt_money(rr['lista']) if rr else 'n/d'
                        filas.append(fila)
                    st.dataframe(pd.DataFrame(filas), use_container_width=True, hide_index=True)
                    st.caption('Mantiene el margen elegido: el recargo de cada cuota se suma a los cargos que se lleva el precio.')

def _bloque_config_precios():
    cfg = _cfg_precios()
    productos = _s('productos')

    with st.form('pw_form_cfg_precios'):
        c1, c2 = st.columns(2, gap='medium')
        with c1:
            st.markdown('**Gastos operacionales**')
            a1, a2 = st.columns(2)
            with a1:
                packaging = st.number_input('Packaging $ / unidad', min_value=0.0, step=10.0,
                                            value=float(cfg['packaging']), key='pw_cfgp_pack')
            with a2:
                envio = st.number_input('Envío $ / unidad', min_value=0.0, step=10.0,
                                        value=float(cfg['envio']), key='pw_cfgp_envio')
            st.markdown('**Comisión vendedor e impuestos**')
            b1, b2, b3 = st.columns(3)
            with b1:
                comision = st.number_input('Comisión %', min_value=0.0, max_value=100.0, step=0.5,
                                           value=float(cfg['comision']), key='pw_cfgp_com')
            with b2:
                iibb = st.number_input('Ingresos Brutos %', min_value=0.0, max_value=100.0, step=0.5,
                                       value=float(cfg['iibb']), key='pw_cfgp_iibb')
            with b3:
                ret = st.number_input('Retenciones %', min_value=0.0, max_value=100.0, step=0.5,
                                      value=float(cfg['retenciones']), key='pw_cfgp_ret')
            st.markdown('**Redondeo**')
            r1, r2 = st.columns(2)
            with r1:
                r_tipo = st.selectbox('Tipo', REDONDEOS, index=REDONDEOS.index(cfg['redondeo_tipo']),
                                      key='pw_cfgp_rtipo')
            with r2:
                r_mult = st.number_input('Múltiplo $', min_value=1.0, step=1.0,
                                         value=float(cfg['redondeo_mult']), key='pw_cfgp_rmult')
            st.markdown('**Márgenes y descuento por defecto**')
            d1, d2, d3 = st.columns(3)
            with d1:
                n_mv = st.number_input('Margen venta %', min_value=0.0, max_value=95.0, step=1.0,
                                       value=float(cfg['margen_venta']), key='pw_cfgp_mv')
            with d2:
                n_mm = st.number_input('Margen mayorista %', min_value=0.0, max_value=95.0, step=1.0,
                                       value=float(cfg['margen_mayorista']), key='pw_cfgp_mm')
            with d3:
                n_desc = st.number_input('Descuento %', min_value=0.0, max_value=90.0, step=1.0,
                                         value=float(cfg['descuento']), key='pw_cfgp_desc')
        with c2:
            st.markdown('**Pasarelas de pago**')
            pas_new = []
            for i, pz in enumerate(cfg['pasarelas']):
                n1, n2 = st.columns([3, 1])
                with n1:
                    nm = st.text_input(f'Pasarela {i + 1}', value=pz['name'], key=f'pw_cfgp_pn{i}')
                with n2:
                    pc = st.number_input('%', min_value=0.0, max_value=100.0, step=0.1,
                                         value=float(pz['pct']), key=f'pw_cfgp_pp{i}')
                pas_new.append({'name': nm.strip(), 'pct': float(pc)})
            st.markdown('**Plataformas**')
            plat_new = []
            for i, pz in enumerate(cfg['plataformas']):
                n1, n2 = st.columns([3, 1])
                with n1:
                    nm = st.text_input(f'Plataforma {i + 1}', value=pz['name'], key=f'pw_cfgp_ln{i}')
                with n2:
                    pc = st.number_input('%', min_value=0.0, max_value=100.0, step=0.1,
                                         value=float(pz['pct']), key=f'pw_cfgp_lp{i}')
                plat_new.append({'name': nm.strip(), 'pct': float(pc)})

        st.markdown('**Recargos por cuotas, por pasarela (%)**')
        df_c = pd.DataFrame(
            {pz['name']: [cfg['cuotas'][n][i] for n in CUOTAS_OPC] for i, pz in enumerate(cfg['pasarelas'])},
            index=[f'{n} cuotas %' for n in CUOTAS_OPC])
        editado = st.data_editor(df_c, use_container_width=True, key='pw_cfgp_cuotas')
        guardar = st.form_submit_button('💾 Guardar configuración', type='primary', use_container_width=True)

    if guardar:
        if any(not x['name'] for x in pas_new + plat_new):
            st.warning('Todas las pasarelas y plataformas necesitan un nombre.')
        else:
            def _f(v):
                return float(v) if v == v else 0.0
            cfg.update({'packaging': float(packaging), 'envio': float(envio), 'comision': float(comision),
                        'iibb': float(iibb), 'retenciones': float(ret), 'redondeo_tipo': r_tipo,
                        'redondeo_mult': float(r_mult), 'margen_venta': float(n_mv),
                        'margen_mayorista': float(n_mm), 'descuento': float(n_desc),
                        'pasarelas': pas_new, 'plataformas': plat_new})
            for fila, n in enumerate(CUOTAS_OPC):
                cfg['cuotas'][n] = [_f(editado.iloc[fila, c]) for c in range(3)]
            _flash('Configuración de precios guardada.')
            st.rerun()

    if st.button('🔁 Recalcular todos los productos', key='pw_cfgp_recalc', use_container_width=True):
        sel_r = st.session_state.get(_key('sel_calc')) or _sel_actual()
        n_ok = 0
        for pr in productos:
            if pr['unit_cost'] > 0:
                r = _calc_precio(pr['unit_cost'], cfg['margen_venta'], cfg, sel_r)
                if r:
                    pr['sale_price'] = float(r['lista'])
                    n_ok += 1
        _flash(f'Se recalculó el precio de {n_ok} producto(s).')
        st.rerun()
    st.caption('«Recalcular todos» usa el margen de venta de arriba y las últimas opciones que tildaste en la '
               'Calculadora (gastos, impuestos, pasarela, plataforma). Salta los productos sin costo.')
    
# ==============================================================
#  MÓDULO B — INVENTARIO + RECETA Y COSTO + CALCULADORA DE PRECIOS
# ==============================================================

def _bloque_catalogo():
    productos = _s('productos')
    filtro = st.text_input('Filtrar catálogo', key='pw_inv_filtro', placeholder='Nombre o código…',
                           label_visibility='collapsed')
    f = filtro.strip().lower()
    vistos = [p for p in productos if not f or f in p['name'].lower() or (p['barcode'] and f in p['barcode'])]
    if not vistos:
        st.info('Todavía no hay productos.' if not productos else 'Sin resultados para ese filtro.')
        return
    filas, bajos = [], []
    for p in vistos:
        margen = (p['sale_price'] - p['unit_cost']) / p['sale_price'] * 100 if p['sale_price'] else 0
        bajo = p['current_stock'] < p['min_stock']
        bajos.append(bajo)
        filas.append({'Código': p['barcode'] or '—', 'Producto': p['name'],
                      'Stock': f"⚠️ {p['current_stock']}" if bajo else str(p['current_stock']),
                      'Mínimo': p['min_stock'], 'Costo': p['unit_cost'], 'Precio': p['sale_price'],
                      'Margen': margen})
    df = pd.DataFrame(filas)

    def _rojo(row):
        if bajos[row.name]:
            return ['background-color:#2a0a0a;color:#f85149;font-weight:600'] * len(row)
        return [''] * len(row)

    styled = (df.style.apply(_rojo, axis=1)
              .format({'Costo': _fmt_money, 'Precio': _fmt_money, 'Margen': '{:.0f}%'}))
    st.dataframe(styled, use_container_width=True, hide_index=True, height=min(320, len(df) * 36 + 42))
    n = sum(1 for p in productos if p['current_stock'] < p['min_stock'])
    if n:
        st.caption(f'🔴 {n} producto(s) por debajo del stock mínimo.')


def _bloque_nuevo_producto():
    with st.form('pw_form_prod', clear_on_submit=True):
        c1, c2 = st.columns([3, 2])
        with c1:
            nombre = st.text_input('Nombre del producto', key='pw_p_nombre')
        with c2:
            precio = st.number_input('Precio de venta', min_value=0.0, step=100.0, key='pw_p_precio')
        with st.expander('Más datos (opcional)'):
            o1, o2 = st.columns(2)
            with o1:
                barcode = st.text_input('Código de barras', key='pw_p_barcode')
                stock = st.number_input('Stock inicial', min_value=0, step=1, key='pw_p_stock')
            with o2:
                minimo = st.number_input('Stock mínimo', min_value=0, step=1, value=5, key='pw_p_min')
                costo = st.number_input('Costo (si no usás receta)', min_value=0.0, step=10.0, key='pw_p_costo')
        enviar = st.form_submit_button('➕ Crear producto', type='primary', use_container_width=True)
    st.caption('Solo pide nombre y precio. El costo se calcula solo con la receta o con las compras.')

    if enviar:
        barcode = barcode.strip()
        if not nombre.strip() or precio <= 0:
            st.warning('Completá el nombre y un precio de venta mayor a 0.')
        elif barcode and any(p['barcode'] == barcode for p in _s('productos')):
            st.warning('Ya existe un producto con ese código de barras.')
        else:
            _s('productos').append({
                'id': _siguiente_id('productos'), 'barcode': barcode, 'name': nombre.strip(),
                'current_stock': int(stock), 'min_stock': int(minimo), 'unit_cost': float(costo),
                'sale_price': float(precio), 'receta': [], 'mano_obra': 0.0, 'margen': 40.0,
            })
            _flash(f'Producto «{nombre.strip()}» creado.')
            st.rerun()


def _bloque_ajustes():
    productos = _s('productos')
    if not productos:
        return
    with st.expander('✏️ Ajustar stock / precio / eliminar'):
        opciones = {p['name']: p['id'] for p in productos}
        sel = st.selectbox('Producto', list(opciones), key='pw_adj_sel')
        pid = opciones[sel]
        p = _producto(pid)
        a1, a2 = st.columns(2)
        with a1:
            st.markdown('##### 📦 Stock')
            st.caption(f"Actual: {p['current_stock']} · no mueve la caja")
            mov = st.radio('Movimiento', ['Entrada', 'Salida'], horizontal=True, key='pw_adj_tipo')
            cant = st.number_input('Cantidad', min_value=1, step=1, value=1, key='pw_adj_cant')
            if st.button('Aplicar stock', key='pw_adj_stock_btn'):
                delta = cant if mov == 'Entrada' else -cant
                p['current_stock'] = max(0, p['current_stock'] + int(delta))
                _flash('Stock actualizado.')
                st.rerun()
        with a2:
            st.markdown('##### 💲 Precio y mínimo')
            nuevo_precio = st.number_input('Precio de venta', min_value=0.0, step=100.0,
                                           value=float(p['sale_price']), key=f'pw_adj_precio_{pid}')
            nuevo_min = st.number_input('Stock mínimo', min_value=0, step=1,
                                        value=int(p['min_stock']), key=f'pw_adj_min_{pid}')
            if st.button('Guardar', key='pw_adj_precio_btn'):
                p['sale_price'] = float(nuevo_precio)
                p['min_stock'] = int(nuevo_min)
                _flash('Producto actualizado.')
                st.rerun()
        if st.button('🗑️ Eliminar este producto', key='pw_adj_del_btn'):
            st.session_state[_key('productos')] = [x for x in productos if x['id'] != pid]
            _s('carrito').pop(pid, None)
            _flash('Producto eliminado (el historial conserva su nombre).')
            st.rerun()


def _bloque_receta():
    """Receta y costo del producto (insumos + mano de obra)."""
    productos = _s('productos')
    insumos = _s('insumos')
    with st.expander('🧮 Receta y costo del producto'):
        if not productos:
            st.info('Creá un producto primero.')
            return
        opciones = {p['name']: p['id'] for p in productos}
        sel = st.selectbox('Producto', list(opciones), key='pw_bom_prod')
        pid = opciones[sel]
        p = _producto(pid)

        st.markdown('**Insumos de la receta**')
        if p['receta']:
            for i, l in enumerate(list(p['receta'])):
                ins = _insumo(l['insumo_id'])
                if not ins:
                    continue
                c1, c2 = st.columns([8, 1])
                with c1:
                    st.markdown(f"{l['qty']:g} {ins['unit_measure']} de **{_esc(ins['name'])}** "
                                f"<span style='color:{C_GRIS};float:right'>{_fmt_money(ins['cost_per_unit'] * l['qty'])}</span>",
                                unsafe_allow_html=True)
                with c2:
                    st.button('✕', key=f'pw_bom_del_{pid}_{i}', on_click=_bom_quitar, args=(pid, i))
        else:
            st.caption('Este producto todavía no tiene insumos cargados.')

        if insumos:
            k_ins, k_qty = f'pw_bom_ins_{pid}', f'pw_bom_qty_{pid}'
            a1, a2, a3 = st.columns([3, 2, 1])
            with a1:
                etiq_ins = {i['id']: f"{i['name']} ({i['unit_measure']})" for i in insumos}
                st.selectbox('Insumo', list(etiq_ins), key=k_ins, format_func=etiq_ins.get)
            with a2:
                st.number_input('Cantidad por unidad', min_value=0.0, step=0.01, format='%.3f', key=k_qty)
            with a3:
                st.markdown('<div style="height:28px"></div>', unsafe_allow_html=True)
                st.button('➕', key=f'pw_bom_add_{pid}', on_click=_bom_agregar, args=(pid, k_ins, k_qty))
        else:
            st.caption('Cargá insumos en el bloque «Insumos» de más abajo.')

        m1, m2 = st.columns(2)
        with m1:
            mo = st.number_input('Mano de obra por unidad ($)', min_value=0.0, step=10.0,
                                 value=float(p['mano_obra']), key=f'pw_bom_mo_{pid}')
        with m2:
            mg = st.number_input('Margen deseado sobre el precio (%)', min_value=0.0, max_value=95.0, step=1.0,
                                 value=float(p['margen']), key=f'pw_bom_mg_{pid}')

        suma_insumos = sum((_insumo(l['insumo_id'])['cost_per_unit'] * l['qty'])
                           for l in p['receta'] if _insumo(l['insumo_id']))
        usa_bom = bool(p['receta']) or mo > 0
        costo = suma_insumos + mo if usa_bom else p['unit_cost']
        sugerido = math.ceil(costo / (1 - mg / 100) / 10) * 10 if costo > 0 else 0
        margen_actual = (p['sale_price'] - costo) / p['sale_price'] * 100 if p['sale_price'] else 0

        _kpi_row([
            ('Costo unitario', _fmt_money(costo), 'Insumos + mano de obra' if usa_bom else 'Costo actual', C_AMARILLO),
            ('Precio sugerido', _fmt_money(sugerido), f'Para {mg:.0f}% de margen', C_VERDE),
            ('Precio actual', _fmt_money(p['sale_price']), f'Margen actual {margen_actual:.0f}%',
             C_AZUL if margen_actual >= mg else C_NARANJA),
        ])
        b1, b2 = st.columns(2)
        with b1:
            if st.button('💾 Guardar costo y receta', key=f'pw_bom_save_{pid}', use_container_width=True):
                p['mano_obra'], p['margen'] = float(mo), float(mg)
                _recalcular_costo(p)
                _flash('Costo del producto actualizado.')
                st.rerun()
        with b2:
            if st.button('💲 Usar precio sugerido', key=f'pw_bom_price_{pid}', use_container_width=True,
                         disabled=sugerido <= 0):
                p['mano_obra'], p['margen'] = float(mo), float(mg)
                _recalcular_costo(p)
                p['sale_price'] = float(sugerido)
                _flash(f'Precio de venta actualizado a {_fmt_money(sugerido)}.')
                st.rerun()
        st.caption('Margen calculado sobre el precio de venta: precio = costo ÷ (1 − margen).')


def _bloque_insumos():
    insumos = _s('insumos')
    with st.expander('🥣 Insumos (materias primas)'):
        if insumos:
            df = pd.DataFrame([{'Insumo': i['name'], 'Unidad': i['unit_measure'],
                                'Costo por unidad': _fmt_money(i['cost_per_unit'])} for i in insumos])
            st.dataframe(df, use_container_width=True, hide_index=True, height=min(260, len(df) * 36 + 42))

            st.markdown('**Actualizar costo de un insumo**')
            u1, u2, u3 = st.columns([3, 2, 2])
            with u1:
                etiq_upd = {i['id']: i['name'] for i in insumos}
                iid = st.selectbox('Insumo', list(etiq_upd), key='pw_ins_upd_sel',
                                   format_func=etiq_upd.get, label_visibility='collapsed')
            with u2:
                nuevo = st.number_input('Nuevo costo', min_value=0.0, step=50.0,
                                        value=float(_insumo(iid)['cost_per_unit']), key=f'pw_ins_upd_{iid}',
                                        label_visibility='collapsed')
            with u3:
                if st.button('Actualizar', key='pw_ins_upd_btn', use_container_width=True):
                    _insumo(iid)['cost_per_unit'] = float(nuevo)
                    for p in _s('productos'):
                        if any(l['insumo_id'] == iid for l in p['receta']):
                            _recalcular_costo(p)
                    _flash('Costo actualizado. Se recalcularon los productos que lo usan.')
                    st.rerun()

        with st.form('pw_form_insumo', clear_on_submit=True):
            n1, n2, n3 = st.columns([3, 2, 2])
            with n1:
                nombre = st.text_input('Nuevo insumo', key='pw_ins_nombre')
            with n2:
                unidad = st.selectbox('Unidad', ['kg', 'gr', 'lt', 'ml', 'unidad'], key='pw_ins_unidad')
            with n3:
                costo = st.number_input('Costo por unidad', min_value=0.0, step=50.0, key='pw_ins_costo')
            if st.form_submit_button('➕ Agregar insumo', use_container_width=True):
                if nombre.strip() and costo > 0:
                    insumos.append({'id': _siguiente_id('insumos'), 'name': nombre.strip(),
                                    'cost_per_unit': float(costo), 'unit_measure': unidad})
                    _flash('Insumo agregado.')
                    st.rerun()
                else:
                    st.warning('Completá el nombre y un costo mayor a 0.')


def _modulo_b():
    with st.container(border=True):
        _titulo('📦 B · Inventario y costos')
        izq, der = st.columns([1, 1], gap='medium')
        with izq:
            _bloque_catalogo()
            _bloque_nuevo_producto()
        with der:
            _bloque_ajustes()
            _bloque_receta()
            _bloque_insumos()
            _bloque_calculadora_precios()


# ==============================================================
#  MÓDULO C — HISTORIAL DE TRANSACCIONES
# ==============================================================

def _estado_txt(t):
    if t['anulada']:
        return '❌ Anulada'
    if t['status'] == 'PAID':
        return '✅ Pagado'
    return '⚠️ Pendiente (vencida)' if _vencida(t) else '⏳ Pendiente'


# ---------- Filtros y exportación del historial ----------

def _filtrar_historial(lista, texto, medios, tipos, m_min, m_max, estado):
    q = (texto or '').strip().lower().lstrip('#')
    out = []
    for t in lista:
        if q and not (q in t['description'].lower() or q in t['payment_method'].lower() or q == str(t['id'])):
            continue
        if medios and t['payment_method'] not in medios:
            continue
        if tipos and t['type'] not in tipos:
            continue
        if t['amount'] < m_min or (m_max > 0 and t['amount'] > m_max):
            continue
        if estado == 'Pagado' and (t['anulada'] or t['status'] != 'PAID'):
            continue
        if estado == 'Pendiente' and (t['anulada'] or t['status'] != 'PENDING'):
            continue
        if estado == 'Anulada' and not t['anulada']:
            continue
        out.append(t)
    return out


def _estado_plano(t):
    return 'Anulada' if t['anulada'] else ('Pagado' if t['status'] == 'PAID' else 'Pendiente')


def _df_export(lista):
    filas = []
    for t in sorted(lista, key=lambda t: (t['created_at'], t['id'])):
        signo = 1 if t['type'] in INGRESOS else -1
        filas.append({'N°': t['id'], 'Fecha': t['created_at'].strftime('%Y-%m-%d %H:%M'),
                      'Tipo': TIPOS_MOV[t['type']][1], 'Detalle': t['description'],
                      'Medio': t['payment_method'], 'Estado': _estado_plano(t),
                      'Vence': t['due_date'].isoformat() if t['due_date'] else '',
                      'Monto': signo * t['amount'], 'Costo': t['cost_amount']})
    return pd.DataFrame(filas)


def _df_inventario():
    return pd.DataFrame([{'Código': p['barcode'], 'Producto': p['name'], 'Stock': p['current_stock'],
                          'Mínimo': p['min_stock'], 'Costo': p['unit_cost'], 'Precio': p['sale_price']}
                         for p in _s('productos')])


def _excel_bytes(lista):
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine='openpyxl') as w:
        _df_export(lista).to_excel(w, sheet_name='Transacciones', index=False)
        _df_inventario().to_excel(w, sheet_name='Inventario', index=False)
    return buf.getvalue()


def _pdf_txt(s):
    """El PDF base solo soporta caracteres latinos: saco emojis y símbolos raros."""
    s = str(s).replace('−', '-').replace('×', 'x')
    return s.encode('cp1252', 'ignore').decode('cp1252')


def _pdf_cierre(dia):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    def P(txt, st_):
        return Paragraph(_esc(_pdf_txt(txt)), st_)

    estilos = getSampleStyleSheet()
    chico = ParagraphStyle('chico', parent=estilos['BodyText'], fontSize=8, leading=10)
    txs = sorted([t for t in _s('transacciones') if not t['anulada'] and t['created_at'].date() == dia],
                 key=lambda t: (t['created_at'], t['id']))
    ventas, cogs, gastos = _pyl(dia, dia)
    caja, banco = _saldos()
    por_cobrar = sum(t['amount'] for t in _por_cobrar())
    por_pagar = sum(t['amount'] for t in _por_pagar())

    por_medio, unidades = {}, {}
    for t in txs:
        if t['type'] == 'SALE':
            por_medio[t['payment_method']] = por_medio.get(t['payment_method'], 0) + t['amount']
            for it in t['items']:
                unidades[it['name']] = unidades.get(it['name'], 0) + it['quantity']

    def tabla(filas, anchos, header=True):
        tb = Table(filas, colWidths=anchos)
        est = [('FONTSIZE', (0, 0), (-1, -1), 9), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
               ('LINEBELOW', (0, 0), (-1, -1), 0.25, colors.lightgrey)]
        if header:
            est += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0d1520')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white)]
        tb.setStyle(TableStyle(est))
        return tb

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm)
    el = [P(f"Cierre del día · {get_nombre_negocio() or 'Mi negocio'}", estilos['Title']),
          P(f"Fecha: {dia.strftime('%d/%m/%Y')}", estilos['Normal']), Spacer(1, 8)]

    el.append(P('Resultado del día', estilos['Heading3']))
    el.append(tabla([['Ventas', _fmt_money(ventas)], ['(-) Costo de ventas', _fmt_money(cogs)],
                     ['= Utilidad bruta', _fmt_money(ventas - cogs)], ['(-) Gastos', _fmt_money(gastos)],
                     ['= Resultado neto', _fmt_money(ventas - cogs - gastos)]], [90 * mm, 40 * mm], False))

    el.append(P('Situación financiera (a hoy)', estilos['Heading3']))
    el.append(tabla([['Caja chica', _fmt_money(caja)], ['Bancos / Digital', _fmt_money(banco)],
                     ['Por cobrar', _fmt_money(por_cobrar)], ['Por pagar', _fmt_money(por_pagar)]],
                    [90 * mm, 40 * mm], False))

    if por_medio:
        el.append(P('Ventas por medio de pago', estilos['Heading3']))
        el.append(tabla([['Medio', 'Monto']] + [[_pdf_txt(m), _fmt_money(v)] for m, v in por_medio.items()],
                        [90 * mm, 40 * mm]))
    if unidades:
        el.append(P('Productos vendidos', estilos['Heading3']))
        el.append(tabla([['Producto', 'Unidades']] + [[_pdf_txt(n), str(u)] for n, u in
                                                      sorted(unidades.items(), key=lambda x: -x[1])],
                        [90 * mm, 40 * mm]))

    el.append(P('Operaciones del día', estilos['Heading3']))
    if txs:
        filas = [['Hora', 'Tipo', 'Detalle', 'Medio', 'Estado', 'Monto']]
        for t in txs:
            filas.append([t['created_at'].strftime('%H:%M'), P(TIPOS_MOV[t['type']][1], chico),
                          P(t['description'], chico), P(t['payment_method'], chico),
                          _estado_plano(t), _fmt_money(t['amount'])])
        el.append(tabla(filas, [14 * mm, 20 * mm, 62 * mm, 30 * mm, 22 * mm, 26 * mm]))
    else:
        el.append(P('Sin operaciones en la fecha.', estilos['Normal']))
    doc.build(el)
    return buf.getvalue()


def _bloque_exportar(lista):
    with st.expander('📤 Exportar / cierre del día'):
        st.caption(f'CSV y Excel exportan las {len(lista)} operaciones que se ven con los filtros actuales.')
        e1, e2 = st.columns(2)
        stamp = date.today().strftime('%Y%m%d')
        with e1:
            csv = _df_export(lista).to_csv(index=False, sep=';', decimal=',').encode('utf-8-sig')
            st.download_button('⬇️ CSV', csv, file_name=f'transacciones_{stamp}.csv', mime='text/csv',
                               use_container_width=True, key='pw_dl_csv')
        with e2:
            try:
                st.download_button('⬇️ Excel', _excel_bytes(lista), file_name=f'transacciones_{stamp}.xlsx',
                                   mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                   use_container_width=True, key='pw_dl_xlsx')
            except Exception:
                st.caption('Para exportar a Excel agregá `openpyxl` a requirements.txt.')

        st.markdown('**Resumen del día en PDF**')
        p1, p2 = st.columns([2, 3])
        with p1:
            dia = st.date_input('Día', value=date.today(), key='pw_dl_dia', label_visibility='collapsed')
        with p2:
            try:
                st.download_button('📄 Descargar cierre del día (PDF)', _pdf_cierre(dia),
                                   file_name=f'cierre_{dia.strftime("%Y%m%d")}.pdf', mime='application/pdf',
                                   use_container_width=True, key='pw_dl_pdf')
            except ImportError:
                st.caption('Para generar el PDF agregá `reportlab` a requirements.txt.')


def _modulo_c():
    with st.container(border=True):
        _titulo('🧾 C · Historial de transacciones')
        alcance = st.radio('Mostrar', ['Hoy', 'Últimas 50', 'Todo'], horizontal=True, key='pw_hist_alcance',
                           label_visibility='collapsed')
        todas = sorted(_s('transacciones'), key=lambda t: (t['created_at'], t['id']), reverse=True)
        if alcance == 'Hoy':
            hoy = date.today()
            base = [t for t in todas if t['created_at'].date() == hoy]
        elif alcance == 'Últimas 50':
            base = todas[:50]
        else:
            base = todas

        texto = st.text_input('Buscar', key='pw_hist_q', label_visibility='collapsed',
                              placeholder='🔎 Buscar por cliente, detalle, medio de pago o #número')
        with st.expander('Filtros avanzados (tipo, medio, monto, estado)'):
            f1, f2 = st.columns(2)
            with f1:
                tipos_sel = st.multiselect('Tipo', list(TIPOS_MOV), key='pw_hist_tipos',
                                           format_func=lambda k: f'{TIPOS_MOV[k][0]} {TIPOS_MOV[k][1]}')
            with f2:
                medios_sel = st.multiselect('Medio de pago', [m['name'] for m in _s('medios')], key='pw_hist_medios')
            g1, g2, g3 = st.columns(3)
            with g1:
                m_min = st.number_input('Monto desde', min_value=0.0, step=1000.0, key='pw_hist_min')
            with g2:
                m_max = st.number_input('Monto hasta (0 = sin tope)', min_value=0.0, step=1000.0, key='pw_hist_max')
            with g3:
                estado_f = st.selectbox('Estado', ['Todos', 'Pagado', 'Pendiente', 'Anulada'], key='pw_hist_estado')

        lista = _filtrar_historial(base, texto, medios_sel, tipos_sel, m_min, m_max, estado_f)
        st.caption(f'Mostrando {len(lista)} de {len(base)} operaciones.')

        if not lista:
            st.info('No hay operaciones para mostrar.')
            return

        filas = []
        for t in lista:
            signo = '+' if t['type'] in INGRESOS else '−'
            emoji, nombre = TIPOS_MOV[t['type']]
            filas.append({'#': t['id'], 'Fecha': _fmt_fecha(t['created_at']), 'Tipo': f'{emoji} {nombre}',
                          'Detalle': t['description'], 'Medio': t['payment_method'],
                          'Estado': _estado_txt(t), 'Monto': f"{signo}{_fmt_money(t['amount'])}"})
        st.dataframe(pd.DataFrame(filas), use_container_width=True, hide_index=True,
                     height=min(360, len(filas) * 36 + 42))

        _bloque_exportar(lista)

        activas = [t for t in lista if not t['anulada']]
        with st.expander('✏️ Editar o anular una operación'):
            if not activas:
                st.caption('No hay operaciones activas en esta vista.')
                return
            opciones = {f"#{t['id']} · {TIPOS_MOV[t['type']][0]} {t['description'][:40]} · {_fmt_money(t['amount'])}": t['id']
                        for t in activas}
            sel = st.selectbox('Operación', list(opciones), key='pw_hist_sel')
            tx_id = opciones[sel]
            t = _tx(tx_id)

            solo_no_credito = t['status'] == 'PAID' and not t['liquidado_por'] or t['type'] in ('COLLECTION', 'PAYMENT')
            medios = _medios_activos(incluir_credito=not solo_no_credito)
            if t['payment_method'] not in medios:
                medios = [t['payment_method']] + medios

            with st.form('pw_form_edit_tx'):
                desc = st.text_input('Descripción', value=t['description'], key=f'pw_e_desc_{tx_id}')
                e1, e2 = st.columns(2)
                with e1:
                    medio = st.selectbox('Medio', medios, index=medios.index(t['payment_method']), key=f'pw_e_medio_{tx_id}')
                with e2:
                    if t['status'] == 'PENDING':
                        vence = st.date_input('Vencimiento', value=t['due_date'] or date.today(), key=f'pw_e_vence_{tx_id}')
                    else:
                        vence = t['due_date']
                        st.caption('Sin vencimiento (ya está pagado).')
                guardar = st.form_submit_button('💾 Guardar cambios', use_container_width=True)
            if guardar:
                t['description'] = desc.strip() or t['description']
                t['payment_method'] = medio
                if t['status'] == 'PENDING':
                    t['due_date'] = vence
                _flash('Operación actualizada.')
                st.rerun()
            st.caption('El monto y los productos no se editan: anulá la operación y volvé a registrarla.')

            if st.button('❌ Anular esta operación', key='pw_hist_anular'):
                ok, msg = _anular(tx_id)
                _flash(msg, 'success' if ok else 'warning')
                st.rerun()


# ==============================================================
#  MÓDULO D — ESTADOS FINANCIEROS (Ene–Dic + Total)
# ==============================================================

_TBL_CSS = ('<style>'
            '.pw-tbl{border-collapse:collapse;width:100%;min-width:980px;font-size:12px}'
            '.pw-tbl th{padding:8px;color:#fff;text-align:right;font-weight:700}'
            '.pw-tbl th:first-child,.pw-tbl td:first-child{text-align:left;position:sticky;left:0;'
            'background:#0d1117;min-width:200px;color:#c9d1d9}'
            '.pw-tbl td{padding:6px 8px;text-align:right;border-bottom:1px solid #21262d;white-space:nowrap}'
            '.pw-tbl tr.sub td{background:#10243b;font-weight:700}'
            '.pw-tbl tr.tot td{background:#12351f;font-weight:800;font-size:13px}'
            '.pw-tbl tr.sec td{background:#161b22;color:#58a6ff;font-weight:700;text-align:left}'
            '</style>')


def _celda(v, color, neg_rojo=True):
    if abs(v) < 0.005:
        return f'<td style="color:{C_GRIS}">–</td>'
    c = C_ROJO if (v < 0 and neg_rojo) else color
    return f'<td style="color:{c}">{_fmt_money(v)}</td>'


def _tabla_mensual(titulo, color, filas):
    """filas: (etiqueta, [12 valores], tipo[, total]) con tipo: n | ded | add | sub | tot | sec."""
    estilos = {'n': ('', '#c9d1d9', True), 'ded': ('', C_ROJO, False), 'add': ('', C_VERDE, False),
               'sub': ('sub', '#e6edf3', True), 'tot': ('tot', '#ffffff', True)}
    th = f'<th style="background:{color}">'
    h = [_TBL_CSS, '<div style="overflow-x:auto"><table class="pw-tbl"><thead><tr>', f'{th}{_esc(titulo)}</th>']
    h += [f'{th}{m}</th>' for m in MESES]
    h.append(f'{th}Total</th></tr></thead><tbody>')
    for fila in filas:
        etiqueta, vals, tipo = fila[0], fila[1], fila[2]
        if tipo == 'sec':
            h.append(f'<tr class="sec"><td colspan="14">{_esc(etiqueta)}</td></tr>')
            continue
        total = fila[3] if len(fila) > 3 else sum(vals)
        clase, c, neg = estilos[tipo]
        h.append(f'<tr class="{clase}"><td>{_esc(etiqueta)}</td>'
                 + ''.join(_celda(v, c, neg) for v in vals) + _celda(total, c, neg) + '</tr>')
    h.append('</tbody></table></div>')
    st.markdown(''.join(h), unsafe_allow_html=True)


def _modulo_d():
    with st.container(border=True):
        _titulo('📊 D · Estados financieros')
        anios = sorted({t['created_at'].year for t in _s('transacciones')} | {date.today().year}, reverse=True)
        a1, _a2 = st.columns([1, 3])
        with a1:
            anio = st.selectbox('Año', anios, key='pw_anio')
        t_er, t_fc, t_res = st.tabs(['📈 Estado de resultados', '💵 Flujo de caja', '🧭 Resumen y vencimientos'])

        det = [_pyl_detalle(i, f) for i, f in _mes_rangos(anio)]

        def col(k):
            return [d[k] for d in det]

        # ---------------- Estado de resultados ----------------
        with t_er:
            vn, ub, un = sum(col('ventas_netas')), sum(col('bruta')), sum(col('neta'))
            _kpi_row([
                ('Ventas netas', _fmt_money(vn), f'Año {anio}', C_VERDE),
                ('Utilidad bruta', _fmt_money(ub), f'{ub / vn * 100:.0f}% de las ventas netas' if vn else '—', C_AZUL),
                ('Utilidad neta', _fmt_money(un), 'Después de gastos', C_VERDE if un >= 0 else C_ROJO),
                ('Margen neto', f'{un / vn * 100:.1f}%' if vn else '0.0%', 'Sobre ventas netas', C_AMARILLO),
            ])
            _tabla_mensual('Estado de resultados', '#2f6fd0', [
                ('Ventas', col('ventas'), 'n'),
                ('(−) Devoluciones', col('devol'), 'ded'),
                ('(−) Descuentos por Ventas', col('desc'), 'ded'),
                ('Ventas Netas', col('ventas_netas'), 'sub'),
                ('(−) Costo de Ventas', col('cogs'), 'ded'),
                ('(+) Devoluciones por Compras', col('dev_compras'), 'add'),
                ('(+) Descuentos por Compras', col('desc_compras'), 'add'),
                ('Utilidad Bruta', col('bruta'), 'sub'),
                ('(−) Gastos', col('gastos'), 'ded'),
                ('Utilidad Neta', col('neta'), 'tot'),
            ])
            st.caption('Criterio devengado: la venta o el gasto cuenta el día que se registra, aunque se cobre o pague después. '
                       'El costo de ventas sale del costo de los productos vendidos.')

        # ---------------- Flujo de caja ----------------
        with t_fc:
            fl, previo = _flujo_mensual(anio)
            rng = range(12)
            op = [fl['cobros'][i] - fl['compras'][i] - fl['gastos'][i] for i in rng]
            inv = [fl['inv_in'][i] - fl['inv_out'][i] for i in rng]
            fin = [fl['fin_in'][i] - fl['fin_out'][i] for i in rng]
            total = [op[i] + inv[i] + fin[i] for i in rng]
            ini, cierre, acum = [], [], _s('saldo_caja') + _s('saldo_banco') + previo
            for v in total:
                ini.append(acum)
                acum += v
                cierre.append(acum)

            _kpi_row([
                ('Flujo operativo', _fmt_money(sum(op)), f'Año {anio}', C_VERDE if sum(op) >= 0 else C_ROJO),
                ('Flujo de inversión', _fmt_money(sum(inv)), 'Neto', C_AZUL if sum(inv) >= 0 else C_NARANJA),
                ('Flujo de financiamiento', _fmt_money(sum(fin)), 'Neto', C_VIOLETA),
                ('Flujo total', _fmt_money(sum(total)), f'Saldo final {_fmt_money(cierre[-1])}',
                 C_VERDE if sum(total) >= 0 else C_ROJO),
            ])
            _tabla_mensual('Flujo de caja', '#17a2b8', [
                ('Actividades operativas', [], 'sec'),
                ('Ventas (Cobros)', fl['cobros'], 'n'),
                ('(−) Compras (Pagos)', fl['compras'], 'ded'),
                ('(−) Gastos (Pagos)', fl['gastos'], 'ded'),
                ('Flujo Operativo', op, 'sub'),
                ('Actividades de inversión', [], 'sec'),
                ('Entradas de Inversión', fl['inv_in'], 'n'),
                ('(−) Salidas de Inversión', fl['inv_out'], 'ded'),
                ('Flujo de Inversión Neto', inv, 'sub'),
                ('Actividades de financiamiento', [], 'sec'),
                ('Entradas de Financiamiento', fl['fin_in'], 'n'),
                ('(−) Salidas de Financiamiento', fl['fin_out'], 'ded'),
                ('Flujo de Financiamiento Neto', fin, 'sub'),
                ('Flujo Total del Período', total, 'tot'),
                ('Saldo inicial (caja + bancos)', ini, 'n', ini[0]),
                ('Saldo final (caja + bancos)', cierre, 'sub', cierre[-1]),
            ])
            st.caption('Solo cuenta plata que realmente entró o salió (el fiado pendiente no cuenta hasta que se cobra o paga). '
                       'Las devoluciones restan de cobros o de pagos según corresponda.')

        # ---------------- Resumen y vencimientos ----------------
        with t_res:
            caja, banco = _saldos()
            cobrar, pagar = _por_cobrar(), _por_pagar()
            t_cobrar, t_pagar = sum(t['amount'] for t in cobrar), sum(t['amount'] for t in pagar)
            disponible = caja + banco
            proyectado = disponible + t_cobrar - t_pagar

            izq, der = st.columns(2, gap='medium')
            with izq:
                st.markdown('**Posición financiera** (a hoy)')
                st.markdown(
                    _fila_html('Caja chica', _fmt_money(caja), tenue=True)
                    + _fila_html('Bancos / Digital', _fmt_money(banco), tenue=True)
                    + _fila_html('= Dinero disponible', _fmt_money(disponible), C_AZUL, fuerte=True, linea=True)
                    + _fila_html(f'(+) Cuentas por cobrar ({len(cobrar)})', _fmt_money(t_cobrar), C_VERDE, tenue=True)
                    + _fila_html(f'(−) Cuentas por pagar ({len(pagar)})', _fmt_money(t_pagar), C_ROJO, tenue=True)
                    + _fila_html('= Posición proyectada', _fmt_money(proyectado),
                                 C_VERDE if proyectado >= 0 else C_ROJO, fuerte=True, linea=True),
                    unsafe_allow_html=True)
                venc = [t for t in cobrar + pagar if _vencida(t)]
                if venc:
                    st.warning(f'⚠️ Hay {len(venc)} cuenta(s) vencida(s) sin saldar.')
            with der:
                pend = sorted(cobrar + pagar, key=lambda t: (t['due_date'] is None, t['due_date'] or date.max))[:6]
                st.markdown('**Próximos vencimientos**')
                if pend:
                    dfp = pd.DataFrame([{
                        '': '⚠️' if _vencida(t) else '',
                        'Tipo': 'Por cobrar' if t['type'] == 'SALE' else 'Por pagar',
                        'Detalle': t['description'][:45],
                        'Vence': t['due_date'].strftime('%d/%m') if t['due_date'] else '—',
                        'Monto': _fmt_money(t['amount']),
                    } for t in pend])
                    st.dataframe(dfp, use_container_width=True, hide_index=True, height=min(260, len(dfp) * 36 + 42))
                else:
                    st.caption('No hay cuentas pendientes. 🎉')

            st.markdown(f'**Ventas netas vs. gastos por mes · {anio}**')
            largo = pd.DataFrame({'Mes': MESES * 2,
                                  'Concepto': ['Ventas netas'] * 12 + ['Gastos'] * 12,
                                  'Monto': col('ventas_netas') + col('gastos')})
            grafico = alt.Chart(largo).mark_bar().encode(
                x=alt.X('Mes:N', sort=MESES, axis=alt.Axis(labelAngle=0, title=None)),
                xOffset='Concepto:N',
                y=alt.Y('Monto:Q', title=None),
                color=alt.Color('Concepto:N',
                                scale=alt.Scale(domain=['Ventas netas', 'Gastos'], range=[C_VERDE, C_ROJO]),
                                legend=alt.Legend(orient='bottom', title=None)),
                tooltip=['Mes', 'Concepto', alt.Tooltip('Monto:Q', format=',.0f')],
            ).properties(height=240)
            st.altair_chart(grafico, use_container_width=True)


# ==============================================================
#  CONFIGURACIÓN Y REINICIO
# ==============================================================

def _bloque_config():
    with st.container():
        st.markdown('**Nombre del negocio**')
        nn1, nn2 = st.columns([4, 1])
        with nn1:
            nombre_neg = st.text_input('Nombre del negocio', value=get_nombre_negocio(), key='pw_cfg_negocio',
                                       placeholder='Ej: Kiosco Don Pepe', label_visibility='collapsed')
        with nn2:
            if st.button('Guardar', key='pw_cfg_negocio_btn', use_container_width=True):
                st.session_state[NEGOCIO_KEY] = nombre_neg.strip()
                _flash('Nombre del negocio actualizado.')
                st.rerun()
        st.divider()

        st.markdown('**Saldos iniciales**')
        s1, s2, s3 = st.columns([2, 2, 1])
        with s1:
            caja0 = st.number_input('Caja chica inicial', min_value=0.0, step=1000.0,
                                    value=float(_s('saldo_caja')), key='pw_cfg_caja')
        with s2:
            banco0 = st.number_input('Bancos / Digital inicial', min_value=0.0, step=1000.0,
                                     value=float(_s('saldo_banco')), key='pw_cfg_banco')
        with s3:
            st.markdown('<div style="height:28px"></div>', unsafe_allow_html=True)
            if st.button('Guardar', key='pw_cfg_saldos_btn', use_container_width=True):
                st.session_state[_key('saldo_caja')] = float(caja0)
                st.session_state[_key('saldo_banco')] = float(banco0)
                _flash('Saldos iniciales actualizados.')
                st.rerun()

        st.markdown('**Medios de pago**')
        etiquetas_tipo = {'caja': 'Caja (efectivo)', 'banco': 'Banco / Digital', 'credito': 'Crédito (fiado: queda pendiente)'}
        for m in _s('medios'):
            st.checkbox(f"{m['name']} — {etiquetas_tipo[m['tipo']]}", value=m['is_active'], key=f"pw_cfg_act_{m['id']}")
        if st.button('Guardar medios activos', key='pw_cfg_medios_btn'):
            nuevos = {m['id']: st.session_state.get(f"pw_cfg_act_{m['id']}", m['is_active']) for m in _s('medios')}
            if not any(act for mid, act in nuevos.items() if next(x for x in _s('medios') if x['id'] == mid)['tipo'] != 'credito'):
                st.warning('Dejá activo al menos un medio que no sea de crédito.')
            else:
                for m in _s('medios'):
                    m['is_active'] = nuevos[m['id']]
                _flash('Medios de pago actualizados.')
                st.rerun()

        with st.form('pw_form_medio', clear_on_submit=True):
            n1, n2 = st.columns(2)
            with n1:
                nombre = st.text_input('Nuevo medio de pago', key='pw_cfg_nuevo_nombre', placeholder='Ej: Tarjeta de débito')
            with n2:
                tipo = st.selectbox('Se acredita en', list(etiquetas_tipo), format_func=etiquetas_tipo.get, index=1,
                                    key='pw_cfg_nuevo_tipo')
            if st.form_submit_button('➕ Agregar medio', use_container_width=True):
                if not nombre.strip():
                    st.warning('Escribí un nombre.')
                elif any(m['name'].lower() == nombre.strip().lower() for m in _s('medios')):
                    st.warning('Ya existe un medio con ese nombre.')
                else:
                    _s('medios').append({'id': _siguiente_id('medios'), 'name': nombre.strip(), 'tipo': tipo, 'is_active': True})
                    _flash('Medio de pago agregado.')
                    st.rerun()

    with st.expander('🔄 Reiniciar datos de ejemplo (simulación)'):
        st.caption('Vuelve a cargar los datos de ejemplo y descarta todo lo que hayas cargado en esta sesión. '
                   'El nombre del negocio se conserva.')
        if st.button('Reiniciar ahora', key='pw_reset_btn'):
            for k in list(st.session_state.keys()):
                if k.startswith(SIM_PREFIX) or k.startswith(WIDGET_PREFIX):
                    st.session_state.pop(k, None)
            _init_sim()
            _flash('Datos de ejemplo reiniciados.')
            st.rerun()


# ==============================================================
#  ATAJOS DE TECLADO + ESTILO TÁCTIL
# ==============================================================

def _inyectar_extras():
    st.markdown("""
    <style>
    .st-key-pw_quick button { min-height: 58px; font-weight: 600; }
    div[class*="st-key-pw_"] [data-testid="stRadio"] label { padding: 4px 6px; }
    </style>
    """, unsafe_allow_html=True)
    # F2 → foco en el buscador. Se registra una sola vez sobre el documento padre.
    components.html("""
    <script>
    try {
      const doc = window.parent.document;
      if (!doc.__pymeF2) {
        doc.__pymeF2 = true;
        doc.addEventListener('keydown', function (e) {
          if (e.key === 'F2') {
            const el = doc.querySelector('input[aria-label*="Buscar producto"]');
            if (el) { e.preventDefault(); el.focus(); el.select(); }
          }
        });
      }
    } catch (err) {}
    </script>
    """, height=0)


# ==============================================================
#  NAVEGACIÓN — 4 botones (uno por módulo)
# ==============================================================

SECCIONES = {
    'A': '⚡ Registradora exprés',
    'B': '📦 Inventario y costos',
    'C': '🧾 Historial de transacciones',
    'D': '📊 Estados financieros',
}
RENDER_SECCION = {'A': _modulo_a, 'B': _modulo_b, 'C': _modulo_c, 'D': _modulo_d}
NAV_KEY = 'pyme_seccion_activa'


def _ir_a(seccion):
    st.session_state[NAV_KEY] = seccion


def render_nav_pyme(columnas=None):
    """Dibuja los 4 botones de navegación del módulo PyMEs.

    - Con `columnas` (lista de 4 columnas creadas en la barra superior de app.py),
      los botones se dibujan ahí, al lado del selector "PyMEs ▾".
    - Sin `columnas`, render_pyme() los dibuja arriba del contenido.
    """
    activa = st.session_state.get(NAV_KEY, 'A')
    cols = columnas if columnas is not None else st.columns(len(SECCIONES))
    st.session_state['_pyme_nav_externa'] = columnas is not None
    for col, (clave, label) in zip(cols, SECCIONES.items()):
        with col:
            cont_key = f'navpyme_{clave}'
            with st.container(key=cont_key):
                st.button(label, key=f'pyme_nav_{clave}', use_container_width=True,
                          on_click=_ir_a, args=(clave,))
            if clave == activa:
                st.markdown(f"""
                <style>
                .st-key-{cont_key} button {{
                    background: #0d1117 !important;
                    color: var(--verde-monster, #6cc24a) !important;
                    border: 1.5px solid var(--verde-monster, #6cc24a) !important;
                    font-weight: 700 !important;
                    box-shadow: 0 0 0 2px rgba(108,194,74,0.15) !important;
                }}
                </style>
                """, unsafe_allow_html=True)

def render_config_pyme():
    """Configuración completa del módulo PyMEs (negocio + calculadora de precios).
    Se dibuja dentro del popover «Mi Cuenta» de app_pyme.py."""
    _init_sim()   # el popover se dibuja antes que render_pyme()
    t_neg, t_pre = st.tabs(['🏢 Negocio y medios de pago', '💲 Calculadora de precios'])
    with t_neg:
        _bloque_config()
    with t_pre:
        _bloque_config_precios()
        
# ==============================================================
#  ENTRY POINT
# ==============================================================

def render_pyme(supabase, user_id, **kwargs):
    """Uso desde app.py:
        from modulo_pyme import render_pyme
        render_pyme(supabase, USER_ID)

    NOTA — modo simulación: `supabase` y `user_id` todavía no se usan; todo
    vive en st.session_state. Al conectar la base, se reemplazan las
    operaciones _reg_* / _anular / _bom_* / altas de productos e insumos."""
    _init_sim()

    titulo_neg = _esc(get_nombre_negocio()) or 'Módulo PyMEs'
    st.markdown(f"""
    <div style="background:linear-gradient(135deg,#0d1520 0%,#0a1830 50%,#0d1117 100%);
         border:1px solid #21262d;border-top:2px solid #3a7bd5;border-radius:14px;
         padding:18px 26px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-size:18px;font-weight:700;color:#e6edf3;margin-bottom:4px">🏢 {titulo_neg}</div>
          <div style="font-size:12px;color:#6b7d9a;line-height:1.6">
            Cada venta, compra o gasto impacta al instante en stock, caja y resultados.
          </div>
        </div>
        <div style="padding:5px 12px;border-radius:20px;font-size:10px;font-weight:700;
             letter-spacing:.6px;text-transform:uppercase;background:rgba(227,179,65,0.12);
             border:1px solid #e3b341;color:#e3b341;white-space:nowrap">
          🧪 Modo simulación — los datos no se guardan
        </div>
      </div>
    </div>
    """, unsafe_allow_html=True)

    _mostrar_flash()
    _kpis_header()

    # Si app.py no dibujó los botones en la barra superior, los dibujamos acá.
    if not st.session_state.pop('_pyme_nav_externa', False):
        render_nav_pyme()

    activa = st.session_state.get(NAV_KEY, 'A')
    if activa not in RENDER_SECCION:
        activa = 'A'
    RENDER_SECCION[activa]()

    _inyectar_extras()


# ==============================================================
#  ESQUEMA SQL DE REFERENCIA — para cuando se conecte Supabase.
#  No se ejecuta desde acá. Es el esquema del prompt original, con los
#  campos extra que usa la simulación (marcados con ★) y user_id + RLS.
# ==============================================================
#
# create table payment_methods (
#     id serial primary key, user_id uuid not null,
#     name varchar(50) not null, is_active boolean default true,
#     tipo text not null default 'banco'        -- ★ 'caja' | 'banco' | 'credito'
# );
#
# create table products (
#     id serial primary key, user_id uuid not null,
#     barcode varchar(50), name varchar(100) not null,
#     current_stock int default 0, min_stock int default 5,
#     unit_cost numeric(12,2) default 0, sale_price numeric(12,2) not null,
#     mano_obra numeric(12,2) default 0,        -- ★ mano de obra por unidad (receta)
#     margen numeric(5,2) default 40,           -- ★ margen deseado sobre precio
#     created_at timestamp default now(),
#     unique (user_id, barcode)
# );
#
# create table raw_materials (
#     id serial primary key, user_id uuid not null,
#     name varchar(100) not null, cost_per_unit numeric(12,2) not null, unit_measure varchar(20) not null
# );
#
# create table product_ingredients (
#     id serial primary key,
#     product_id int references products(id) on delete cascade,
#     raw_material_id int references raw_materials(id) on delete cascade,
#     quantity_required numeric(10,3) not null
# );
#
# create type transaction_type as enum (
#     'SALE','PURCHASE','EXPENSE','COLLECTION','PAYMENT',
#     'SALE_RETURN','PURCHASE_RETURN','INV_IN','INV_OUT','FIN_IN','FIN_OUT');   -- ★ tipos nuevos
# create type transaction_status as enum ('PAID','PENDING');
#
# create table transactions (
#     id serial primary key, user_id uuid not null,
#     type transaction_type not null, description varchar(255),
#     amount numeric(12,2) not null, cost_amount numeric(12,2) default 0,
#     discount numeric(12,2) default 0,                       -- ★ descuento aplicado
#     payment_method_id int references payment_methods(id),
#     status transaction_status default 'PAID', due_date date,
#     anulada boolean default false,                          -- ★ anulación lógica
#     liquidado_por int references transactions(id),          -- ★ cobro/pago que saldó esta cuenta
#     liquida_a int references transactions(id),              -- ★ cuenta que salda este cobro/pago
#     created_at timestamp default now()
# );
#
# create table transaction_items (
#     id serial primary key,
#     transaction_id int references transactions(id) on delete cascade,
#     product_id int references products(id),
#     product_name varchar(100),                              -- ★ conserva el nombre si se borra el producto
#     quantity int not null, unit_price numeric(12,2) not null, unit_cost numeric(12,2) not null
# );
#
# -- Row Level Security: la misma política en todas las tablas con user_id
# -- alter table <tabla> enable row level security;
# -- create policy "usuario ve lo suyo" on <tabla> for all using (auth.uid() = user_id);
