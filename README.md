# SANO Restaurant

Sistema para negocios de comida rápida (perros calientes, hamburguesas, pizzas, arepas, pepitos, combos, bebidas…), con inventario por recetas, mesas, cocina, caja en $ y Bs y panel multisede.

- **App:** https://sano-restaurant.web.app — un solo sistema que se instala desde el navegador en teléfonos y computadoras
- **Firebase:** proyecto `sano-restaurant` (Hosting + Authentication + Firestore)
- **Credenciales:** `CREDENCIALES_SANO_RESTAURANT.txt` (20 sedes + administrador). **No lo compartas.**
- **Ventas / soporte:** WhatsApp +58 422-190 6045

## Instalar la app (sin tiendas ni descargas)
El botón **Instalar** aparece en el inicio de sesión, en el menú lateral, en Inicio y en Configuración › Instalar y respaldo. En Chrome y Edge abre el instalador del navegador. Donde el navegador no lo ofrece, muestra los pasos:
- **Android (Chrome):** menú ⋮ › *Instalar app* o *Agregar a la pantalla principal*.
- **Computadora (Chrome o Edge):** ícono de instalar en la barra de direcciones, o menú › *Instalar*. Queda un acceso directo en el escritorio y abre en su propia ventana.
- **iPhone/iPad (Safari):** Compartir › *Agregar a inicio*.

La app instalada es la misma web: al publicar cambios, todos los equipos se actualizan solos. Funciona sin internet y sincroniza al volver la conexión. Imprime recibos y comandas con la impresora configurada en el equipo. Al mantener presionado el ícono aparecen accesos rápidos a Vender, Mesas, Cocina e Inventario.

## Cómo funciona el inventario por recetas
1. En **Inventario** registras los insumos que compras (pan, salchicha, carne, queso en rebanadas o gramos, salsas, refrescos, envases…), con su stock mínimo y su costo.
2. En **Menú y recetas** cada producto indica qué consume: *Perro caliente = 1 pan + 1 salchicha + 20 g de repollo + 20 ml de salsas*.
   - **Tamaños:** cada tamaño tiene su precio y su receta (pizza personal 180 g de masa, familiar 450 g).
   - **Extras:** "Extra queso +$0,50" descuenta 1 rebanada más.
   - **Reventa:** refrescos o agua descuentan 1 unidad de su insumo.
3. Al cobrar, el sistema descuenta los insumos, calcula el costo y la ganancia, y avisa cuando algo baja del mínimo. Si un ingrediente se agota, el producto aparece **Agotado**. Esto se puede desactivar en Configuración.
4. Si anulas una venta, los insumos regresan al inventario.

## Secciones
| Sección | Qué hace |
|---|---|
| Inicio | Ventas del día, ganancia, pedidos por cobrar, alertas, gráfico de 7 días y lo más vendido |
| Vender | Punto de venta para llevar, mesa o delivery; tamaños, extras y notas; pagos mixtos en $ y Bs; vuelto en cualquier moneda |
| Mesas | Plano por zonas: libre, en cocina, para servir; pre-cuenta, cambiar de mesa, cobrar; agregar, editar y quitar mesas |
| Pedidos | Pedidos abiertos (cobrar luego, delivery), ventas por fecha, reimprimir y anular (con PIN) |
| Cocina | Comandas: Pendiente → Preparando → Listo → Entregado, con tiempos y sonido |
| Menú y recetas | Productos, precios, recetas, tamaños, extras, foto o emoji, margen y cuántos se pueden preparar |
| Inventario | Insumos, compras (con costo promedio y pago desde la caja), mermas, conteos, movimientos y lista de compras por WhatsApp |
| Clientes | Datos de delivery, visitas, consumo, historial y WhatsApp |
| Caja | Apertura y cierre por turno con arqueo en $ y Bs, gastos e ingresos, historial imprimible |
| Reportes (PIN) | Ventas, ganancia, horas pico, formas de pago, productos, insumos consumidos y gastos; Excel (CSV) e impresión |
| Configuración | Datos y recibo, tasa (BCV automática o manual), IVA, % de servicio, delivery, zonas, meseros, PIN, contraseña y respaldo |

**Tasa del día:** cada mañana se consulta la tasa oficial BCV. Se puede escribir una tasa manual en cualquier momento (botón de la tasa en el menú lateral).

## Panel del administrador (usuario `admin`)
Crear sedes nuevas (con usuario, contraseña, PIN, plan y fecha de pago), entrar a cualquier sede, **congelar** con motivo y reactivar, **renovar** 30 días, editar dueño, teléfono, plan y vencimiento, reiniciar el PIN, enviar el acceso por WhatsApp, eliminar (con opción de borrar los datos) y restaurar, publicar un **aviso general** para todas las sedes y exportar la lista.
Cuando vence la fecha de pago, la sede se bloquea sola. Las reglas de Firestore lo aplican también en el servidor.

## Demo
El botón **"Probar demo gratis"** del inicio de sesión crea un negocio de ejemplo aislado (menú con recetas, mesas, clientes, ventas de la semana y comandas en cocina) que dura 30 minutos y se borra al terminar.

## Estructura
```
public/                 App web (Firebase Hosting), JS modular sin compilación
  js/store.js           Datos en tiempo real por sede (tenants/{uid}/...) y cálculo de recetas
  js/ops.js             Operaciones atómicas: cobrar, pedidos, cocina, anulaciones, caja, inventario
  js/charge.js          Ventana de cobro
  js/views/*.js         Secciones de la app y panel admin
firestore.rules         Seguridad: sedes aisladas, congelación, vencimiento, demo
scripts/provision.mjs   Crea/actualiza las sedes:  node provision.mjs 25
scripts/e2e.mjs         Prueba completa (39 verificaciones) con emuladores
scripts/prod-smoke.mjs  Prueba rápida en producción
scripts/pwa-check.mjs   Verifica que la app sea instalable en PC y Android
scripts/screens.mjs     Regenera las capturas que muestra Chrome al instalar
```

## Comandos
```
firebase deploy --only hosting                 # publicar cambios (todos los equipos instalados se actualizan)
firebase deploy --only firestore               # publicar reglas
cd scripts && node provision.mjs 25            # crear más sedes (conserva las existentes)

# Pruebas locales
firebase emulators:start --only auth,firestore,hosting      (con JAVA_HOME del JBR de Android Studio)
sh scripts/test-emu.sh
```

## Archivos que debes respaldar (no van a git)
- `CREDENCIALES_SANO_RESTAURANT.txt` y `scripts/.accounts.json`: contraseñas de las sedes

## Límites del plan gratuito (Spark)
Firestore permite unas 20 000 escrituras y 50 000 lecturas al día para todo el proyecto. Una venta usa aproximadamente de 5 a 12 escrituras, según los ingredientes. Con muchas sedes activas conviene pasar al plan Blaze (se paga solo lo que se usa).
