# PEDILA

**Compras mayoristas en grupo para el comercio de barrio.** PEDILA es un marketplace B2B para Argentina que conecta a **preventistas y distribuidores** con **comercios** (kioscos, despensas, almacenes, minimercados) a través de un catálogo y, sobre todo, de **pools de compra mayorista**.

Este README es el documento central del proyecto: explica qué hace PEDILA, cómo se construyó, qué decisiones se tomaron, cómo se instala, cómo se despliega en un VPS de DonWeb con panel Ferozo y cómo se opera día a día.

## Índice

1. [Qué es PEDILA](#1-qué-es-pedila)
2. [Bitácora de construcción](#2-bitácora-de-construcción)
3. [Decisiones](#3-decisiones)
4. [Arquitectura](#4-arquitectura)
5. [Instalación local](#5-instalación-local)
6. [Variables de entorno](#6-variables-de-entorno)
7. [Despliegue en VPS DonWeb + Ferozo](#7-despliegue-en-vps-donweb--ferozo)
8. [Operación diaria](#8-operación-diaria)
9. [Actualizaciones y rollback](#9-actualizaciones-y-rollback)
10. [Solución de problemas](#10-solución-de-problemas)
11. [Tests](#11-tests)

---

## 1. Qué es PEDILA

### El problema

Un kiosco compra de a pocas unidades y paga precio de reventa. Un pallet entero (por ejemplo, 600 gaseosas) tiene un precio mucho mejor, pero ningún comercio chico puede comprarlo solo.

### La solución: pools de compra

1. Un **preventista** publica una oferta por volumen: "pallet de 600 unidades a $ 1.500 cada una", con un **mínimo para cerrar** (por ejemplo 480), un mínimo y máximo por comercio, una fecha límite y las zonas donde entrega.
2. Los **comercios** de esas zonas se suman con las unidades que necesitan (por ejemplo 10). **No pagan nada todavía**: se comprometen.
3. La barra de progreso se actualiza en vivo. Cuando entre todos llegan al mínimo, el pool pasa a **COMPLETO** y se cierra (o sigue sumando hasta el total, si el preventista lo eligió así).
4. Al cerrarse, cada comercio recibe el **link de pago** (Mercado Pago) con un plazo (48 h por defecto). Todos pagan el precio del pallet.
5. Si alguien no paga, sus unidades se liberan y, según la configuración, el pool **se reabre** o **se cierra con lo pagado**.
6. Con todo pagado, el preventista programa la entrega, arma la **hoja de reparto por zona** (PDF) y marca las entregas. Los comercios califican.
7. Si el pool **vence sin llegar al mínimo**, nadie paga. El preventista puede **extender la fecha una vez** o **cerrar igual** con lo alcanzado.

Además del pool existe el **catálogo normal**: el comercio pide directamente productos por unidad o bulto, paga y el preventista entrega.

### Roles

| Rol | Qué hace |
|---|---|
| **Admin (PEDILA)** | Configura comisiones (global, por categoría y por preventista) y plazos, aprueba preventistas y pools, gestiona usuarios, categorías, zonas, disputas y liquidaciones; ve KPIs, auditoría y exportaciones. |
| **Preventista / distribuidor** | Carga su catálogo (con imágenes o por CSV), publica pools con la calculadora de comisión en vivo, gestiona participantes, pedidos, entregas y hoja de reparto, y ve sus liquidaciones. Necesita aprobación del admin para publicar. |
| **Comercio** | Navega pools de su zona, se suma, paga, pide por catálogo, sigue sus entregas, califica y hace reclamos. |

### Modelo de ingresos y ejemplo de comisión

PEDILA cobra una **comisión porcentual por cada pool vendido**, configurable desde el panel admin (prioridad: **preventista > categoría > global**). El porcentaje se **congela en el pool al publicarlo**.

Ejemplo con la comisión global del 8 % en el modo por defecto ("se descuenta del precio del preventista"):

| Concepto | Cálculo | Monto |
|---|---|---|
| Precio por unidad que paga el comercio | | $ 1.500,00 |
| Comisión PEDILA por unidad | 8 % de $ 1.500 | $ 120,00 |
| Neto del preventista por unidad | $ 1.500 − $ 120 | $ 1.380,00 |
| Pallet completo (600 u.) | 600 × $ 1.500 | **$ 900.000,00** |
| Comisión PEDILA total | 600 × $ 120 | **$ 72.000,00** |
| Neto que recibe el preventista | 600 × $ 1.380 | **$ 828.000,00** |
| Si cierra con el mínimo (480 u.) | 480 × $ 1.380 | $ 662.400,00 neto |

Un kiosco que se suma con 10 unidades paga $ 15.000, al mismo precio unitario que si comprara el pallet entero.

En el modo alternativo ("se suma al precio que ve el comercio"), el preventista carga lo que quiere cobrar ($ 1.500) y el comercio ve $ 1.620 ($ 1.500 + 8 %).

---

## 2. Bitácora de construcción

### Etapa 0 — Planificación

- **Modelo de datos**: usuarios con rol, un `Business` con los datos fiscales (CUIT, razón social, condición frente al IVA, dirección), provincias (código INDEC) y localidades, catálogo (`Product`, `ProductImage`), pools (`Pool`, `PoolZone`, `Participation`), pedidos de catálogo (`Order`, `OrderItem`), pagos (`Payment`, `WebhookEvent`), liquidaciones (`Settlement`), calificaciones, disputas, notificaciones, cola de tareas (`Job`), auditoría (`AuditLog`), configuración (`PlatformConfig`) e historial de comisiones (`CommissionChange`).
- **Capas**: `src/domain` (reglas puras y testeadas) → `src/server/services` (transacciones y efectos) → acciones de servidor y rutas API → UI. El worker reutiliza los mismos servicios.
- **Orden de trabajo**: DB → dominio con tests → servicios y API → UI → jobs y pagos → seed → scripts de despliegue → README.

### Etapa 1 — Base de datos

- `prisma/schema.prisma` con MySQL/MariaDB y Prisma 7 (cliente sin motor nativo, con el adaptador `@prisma/adapter-mariadb`) y la migración inicial en `prisma/migrations`. Montos en centavos (`BIGINT`), porcentajes en puntos básicos, índices para las consultas frecuentes.

### Etapa 2 — Dominio

- `src/domain/money.ts` (centavos, redondeo, formato `$ 12.345,67`), `commission.ts` (resolución y cálculo de comisiones), `pool-rules.ts` (máquina de estados y decisiones), `zones.ts`, `cuit.ts`, y utilidades `src/lib/dates.ts` (hora argentina), `csv.ts`, `rate-limit.ts`. 102 tests unitarios.

### Etapa 3 — Servicios, pagos y cola de tareas

- Servicios transaccionales: pools (publicación con comisión congelada, participaciones con `SELECT … FOR UPDATE`, cierre, vencimiento, extensión, reapertura, entregas), pagos (checkout, aplicación idempotente de novedades del proveedor, vencimientos, reintegros), pedidos de catálogo, comisiones con historial y liquidaciones.
- Interfaz `PaymentProvider` con Mercado Pago (Checkout Pro + webhooks firmados) y un proveedor simulado para desarrollo.
- Cola de tareas en la base (`Job`) escrita en la misma transacción que el cambio de negocio (patrón *outbox*).
- 23 tests de integración contra MariaDB real: concurrencia (40 compras simultáneas sobre un pool de 100 unidades), ciclo de vida completo, reglas de pago vencido y webhooks idempotentes.

### Etapa 4 — Autenticación, API y seguridad

- Auth.js v5 (JWT) con email + contraseña y Google opcional; el usuario se verifica contra la base en cada página y acción; `proxy.ts` de Next 16 con control de acceso por rol y verificación de origen (CSRF) para las API; headers de seguridad y CSP; rate limiting en memoria.
- Rutas API: salud, progreso en vivo, notificaciones, webhooks, subida de imágenes, exportaciones CSV y hoja de reparto en PDF.

### Etapa 5 — Interfaz

- UI mobile-first en español rioplatense con la paleta amarillo/blanco/negro (contraste AA), componentes accesibles propios, páginas públicas cacheadas (ISR) y los tres paneles completos.
- Calculadora de comisión en vivo con las mismas funciones del dominio que usa el servidor.
- Gráficos del admin como *small multiples* de una sola serie en tinta negra (el amarillo sobre blanco no llega a 3:1 para elementos gráficos: se validó con un script de paletas) más una tabla con los mismos datos.

### Etapa 6 — Worker, seed y tests E2E

- Worker con node-cron (cola de tareas, vencimientos, finalización, latido, limpieza), empaquetado con esbuild (~290 KB).
- Seed demo transaccional: 1 admin, 3 preventistas, 10 comercios, 23 productos con imagen y 14 pools que cubren los 9 estados.
- 15 tests E2E con Playwright sobre el build de producción. Encontraron y se corrigieron: un formulario que por un instante aparecía duplicado al cargar (lo causaba un `loading.tsx` global) y páginas públicas que no se invalidaban después de un pago.

### Etapa 7 — Despliegue

- `deploy/`: PM2 (`ecosystem.config.js`), nginx, variantes para Ferozo (Apache/.htaccess/nginx del panel), `setup-servidor.sh`, `deploy.sh`, `backup.sh`, crontab. Workflow de GitHub Actions que corre los tests y publica el build listo para el servidor.
- `scripts/inicializar-produccion.mjs`: datos base (provincias, localidades, categorías, configuración) y primer admin, sin datos demo.
- **Prueba real del kit en un sandbox local** (usuario, carpetas y PM2 aislados): primer deploy, segundo deploy bajo carga (**5.746 pedidos, 0 fallidos** durante el `pm2 reload`), rollback bajo carga (**5.352 pedidos, 0 fallidos**), backup y restauración en una base nueva. Esa prueba encontró un error en `deploy.sh` (un `rsync --exclude uploads` sin anclar que también excluía la ruta `src/app/uploads`), ya corregido.

### Etapa 8 — Verificación final

- `npm run lint`, `npm run typecheck`, `npm test` (125 tests), `npm run build` y `npm run test:e2e` (15 tests) en verde. `npm run setup` probado desde una base vacía.

---

## 3. Decisiones

Supuestos y decisiones tomadas donde el pedido no lo definía, con su justificación.

### Stack y versiones

| Decisión | Por qué |
|---|---|
| **Node.js 24 LTS** (mínimo 20.9) | Node 18 está fuera de soporte desde 2025 y Next 16 exige ≥ 20.9. Hay `.nvmrc` con `24`. |
| **Next.js 16** (App Router, Turbopack, `output: "standalone"`) | Versión estable actual. En Next 16 el antiguo `middleware.ts` se llama `proxy.ts` y corre en Node. |
| **Prisma 7** con `@prisma/adapter-mariadb` | El cliente de Prisma 7 ya no usa un binario nativo en Rust: el build es más liviano y no hay problemas de "binary targets" entre la PC y el VPS. El mismo adaptador funciona con MySQL y MariaDB. Prisma 8 todavía está en *release candidate*. |
| **Auth.js v5 (`next-auth@5.0.0-beta.32`)** | Es la línea de Auth.js para App Router que pidió el proyecto; sigue publicada como *beta*. Se usa con sesiones JWT y sin adaptador de base (el alta y vinculación de Google se hace en los callbacks), para tener control total de roles y suspensiones. |
| **TypeScript 5.9** | TypeScript 7 (el compilador nativo) todavía no ofrece la API de JavaScript que usan Next y typescript-eslint. |
| **ESLint 9** | Next 16 acepta ESLint 10, pero varios plugins que trae `eslint-config-next` todavía declaran ESLint ≤ 9 como dependencia par: con ESLint 10 un `npm ci` común fallaría. npm muestra un aviso de "versión sin soporte" que no afecta el funcionamiento. |
| **Tailwind CSS 4, Zod 4, componentes propios** | Componentes accesibles con HTML nativo (`<dialog>`, `<details>`, `<select>`) en lugar de una librería de UI: menos JavaScript para celulares y VPS chicos. Íconos con `lucide-react`. |
| **Sin `AGENTS.md` autogenerado** | Next 16 genera ese archivo al correr `next dev`; se desactivó (`agentRules: false`) porque la documentación vive en un único README. |

### Dinero y comisiones

- **Centavos enteros** en toda la lógica (`number` entero, exacto hasta ±9 × 10¹⁵) y `BIGINT` en la base: un pallet de cigarrillos o bebidas puede superar los $ 21 millones, el límite de un `INT` en centavos.
- **Porcentajes en puntos básicos** (8,5 % = 850). Rango permitido: 0 % a 50 % (tope de seguridad contra errores de carga).
- **Regla de redondeo única**: la comisión se calcula **por unidad**, al centavo, con redondeo **mitad hacia arriba**, y los totales se obtienen multiplicando por la cantidad. Así el neto que el preventista ve al publicar coincide exactamente con lo que cobra y la suma de las participaciones da exactamente el total del pallet (está testeado). El error máximo frente a calcular sobre el total es medio centavo por unidad.
- **La comisión se congela al publicar** (cuando el preventista aprieta "Publicar"), aunque el pool requiera aprobación del admin. Si el admin lo devuelve a borrador, al volver a publicar se toma la comisión vigente en ese momento.
- **Pedidos de catálogo**: el pedido habla de comisión "por cada pool vendido", así que por defecto el catálogo **no** paga comisión. Hay un interruptor en el admin para cobrarla también en catálogo (con las mismas reglas).
- En el modo "se suma al precio del comercio", la comisión por unidad se calcula sobre lo que carga el preventista y se suma al precio que ve el comercio.

### Pools

- **COMPLETO tiene dos fases**: "sigue sumando" (si el preventista eligió no cerrar al llegar al mínimo) y "cerrado esperando pagos". En la primera, los comercios **pueden sumar unidades pero no bajar ni retirarse** (el pedido dice que se puede modificar o retirar "mientras el pool esté ABIERTO"; así además se evita que el pool rebote entre estados).
- **Una participación por comercio y pool**: modificar cambia la cantidad; retirarse la deja como `RETIRADA` y se puede volver a sumar.
- **Zonas**: un comercio solo puede sumarse si su localidad está dentro de las zonas del pool (una zona sin localidad cubre toda la provincia). En catálogo, el preventista solo recibe pedidos de su zona de reparto.
- **Vencimiento**: al pasar la fecha sin llegar al mínimo, el pool queda `VENCIDO_SIN_COMPLETAR` y se avisa a todos que no se cobra nada. El preventista tiene una **ventana de decisión** (48 h, configurable) para **extender la fecha una sola vez** o **cerrar igual** con lo alcanzado. Si no hace nada, el pool se finaliza: las participaciones se cancelan y se reintegra lo que se hubiera pagado.
- **Pago vencido, regla REABRIR** (por defecto): se liberan las unidades impagas; si lo pagado no llega al mínimo, el pool vuelve a ABIERTO con fecha límite = la mayor entre la original y "ahora + 48 h" (configurable). Quienes ya pagaron conservan su lugar y no pueden modificarlo. Si lo pagado ya alcanza el mínimo, el pool queda pagado igual.
- **Regla CERRAR_CON_PAGADO**: se cierra con lo pagado; si nadie pagó, el pool se cancela. Si el preventista aceptó cerrar por debajo del mínimo, siempre se aplica esta regla.
- Las reglas de pago (plazo y regla de impago) también **se congelan en el pool al publicarlo**.
- **Transiciones automáticas por jobs**: vencimiento de pools, vencimiento de pagos y finalización corren en el worker cada 1 a 5 minutos. Las transiciones disparadas por una acción (llegar al mínimo, pagar) ocurren en la misma transacción de esa acción. Todas quedan en la auditoría.
- **Concurrencia**: todas las altas, bajas y pagos bloquean primero la fila del pool (`SELECT … FOR UPDATE`) en transacciones `READ COMMITTED`, con reintento automático ante *deadlocks*. Nunca se venden más unidades que el total (test con 40 compras simultáneas).

### Pagos

- **PEDILA cobra en su propia cuenta de Mercado Pago** (Checkout Pro) y liquida a cada preventista desde el módulo de liquidaciones (transferencia manual + referencia). El "split" automático de Mercado Pago (marketplace con OAuth de cada vendedor) no se implementó.
- El **estado de un pago siempre se consulta a la API de Mercado Pago**: el contenido del webhook nunca se toma como válido. Además se verifica la firma `x-signature` si está configurado `MP_WEBHOOK_SECRET`, y el `notification_url` pide solo notificaciones en formato Webhooks (`source_news=webhooks`).
- **Idempotencia doble**: cada notificación se registra con una clave única (no se procesa dos veces) y aplicar un estado ya aplicado no tiene efecto.
- Un **intento rechazado no cierra el pago**: el comercio puede reintentar con otro medio hasta el vencimiento. Un pago "en proceso" (por ejemplo efectivo en Rapipago) tiene 24 h extra de gracia.
- Un pago que se acredita **después de vencido** (unidades ya liberadas) se **reintegra automáticamente**. Un monto distinto al esperado no se aprueba y se avisa al admin.
- Un reintegro o contracargo hecho **fuera de PEDILA** (desde Mercado Pago) marca el pago como reintegrado y avisa al admin, pero no recalcula automáticamente el pool ni la liquidación: queda para revisión manual.
- **Proveedor SIMULADO** (función simulada, señalada a propósito): en desarrollo y en los tests E2E, el "checkout" es una página de PEDILA con botones *Aprobar / Rechazar* que aplica el resultado por el mismo camino que un webhook real. Se usa si no hay `MP_ACCESS_TOKEN` y **está bloqueado en producción** salvo `ALLOW_SIMULATED_PAYMENTS=true` (para un staging de demo).
- **Transferencia con comprobante y efectivo contra entrega**: solo quedó la interfaz `PaymentProvider` lista; no están implementados.

### Notificaciones

- In-app + email por SMTP (pensado para una casilla creada en Ferozo). Los emails se envían desde el worker con reintentos; si no hay `SMTP_HOST`, se registran en el log (desarrollo).
- **WhatsApp**: hay un canal `WhatsAppChannel` con la interfaz lista, **sin proveedor conectado** (no envía nada).
- "Nuevo pool en tu zona" avisa a todos los comercios de las zonas del pool, en lotes de 200. Con muchos comercios conviene revisar el límite de envío diario de la casilla SMTP del plan.
- No hay preferencias de notificación por usuario en esta versión.

### Usuarios y seguridad

- **Sin verificación de email al registrarse** y sin 2FA en esta versión. Hay recuperación de contraseña por email (link de 1 h, de un solo uso).
- **Google**: un usuario nuevo entra como comercio y completa sus datos en `/completar-perfil` (allí puede elegir ser preventista). Si el email ya existía con contraseña, se vincula (Google exige email verificado).
- **CUIT validado** con dígito verificador; único por negocio.
- **Sesiones JWT de 30 días**; los datos del token se refrescan desde la base cada 60 s y una cuenta suspendida pierde la sesión. Igual, **cada página, acción y endpoint vuelve a verificar usuario y rol contra la base**.
- **CSRF**: las Server Actions de Next ya verifican el origen; las rutas `/api/*` que modifican datos exigen que el `Origin` coincida con el host (en `proxy.ts`); las cookies son `SameSite=Lax`. Los webhooks están exentos (los llama Mercado Pago) pero tienen firma.
- **CSP sin nonces** (con `'unsafe-inline'` para los scripts de hidratación de Next): los nonces obligan a renderizar todo dinámico y anulan el caché de páginas públicas. Ningún contenido de usuarios se inserta como HTML.
- **Sanitización**: Zod en cliente y servidor, limpieza de caracteres de control, escape en emails, protección contra inyección de fórmulas en CSV y filtrado de caracteres en el PDF.
- **Archivos subidos**: solo JPG/PNG/WebP detectados por su contenido (no por la extensión), máximo `UPLOAD_MAX_MB` (5 MB), límite de píxeles, se eliminan metadatos EXIF (incluida la ubicación GPS) y se guardan como WebP 1200 px + miniatura 400 px.
- **Rate limiting en memoria** por proceso (con 2 instancias web, el límite efectivo se duplica); nginx suma una segunda capa (`limit_req`).

### Rendimiento y caché

- **Tiempo real con polling liviano**: la barra de progreso consulta `/api/pools/:id/progreso` cada 5 s solo con la pestaña visible, y el servidor responde desde un micro-caché de 2 s. Se descartó SSE/WebSockets para no mantener conexiones abiertas ni ajustar el buffering del proxy.
- **Caché**: la ficha pública de cada pool y de cada preventista es ISR (60/120 s) y los listados usan `unstable_cache` (30–300 s). Al sumarse, pagar o publicar se invalida al instante. Los cambios hechos por el worker (por ejemplo, un vencimiento) aparecen en las páginas públicas en hasta 60 s; el progreso en vivo no se cachea.
- Con 2 instancias de PM2, cada una tiene su caché en memoria: una invalidación en una instancia puede tardar hasta el TTL en reflejarse en la otra (por eso los TTL son cortos).
- Se quitó el `loading.tsx` global: provocaba que el contenido se mostrara dos veces por un instante al cargar.
- Pool de conexiones chico (`DB_POOL_LIMIT=5` web, 3 worker), `--max-old-space-size` en cada proceso, `max_memory_restart` en PM2, sharp con un solo hilo y sin caché, imágenes con `loading="lazy"`, y sin optimizador de imágenes de Next (las imágenes ya se guardan optimizadas).

### Otros

- **Moneda y fechas**: formato `$ 12.345,67` implementado a mano (idéntico en servidor y navegador); fechas guardadas en UTC (la sesión de MySQL se fuerza a UTC) y mostradas en `America/Argentina/Buenos_Aires`.
- **CSV**: separador `;` y BOM UTF-8, que es lo que espera Excel configurado en español. La importación detecta `;` o `,` sola.
- **Hoja de reparto**: agrupa por provincia › localidad y, dentro, por comercio. No optimiza el recorrido. El PDF usa fuentes estándar (sin archivos de fuentes que empaquetar).
- **Catálogo sin control de stock**: el preventista desactiva productos sin stock. **Disputas** sin adjuntos: texto del comercio, respuesta del preventista y resolución del admin.
- **Almacenamiento**: disco local (`UPLOAD_DIR`) detrás de la interfaz `StorageAdapter`; el adaptador S3 **no** está implementado (solo la interfaz).
- **Gráficos del admin**: una serie por gráfico (GMV, comisiones, pools pagados, pools publicados) en lugar de un gráfico de doble eje, con tooltip al pasar el mouse o con el teclado, y una tabla con los mismos datos.
- **Datos demo**: los nombres de marcas de los productos son ilustrativos y los precios, ficticios. Las imágenes se generan en el seed.
- **Tests no destructivos**: los tests de integración y E2E nunca borran la base: aplican migraciones con `migrate deploy` y crean datos con nombres únicos, por lo que se pueden repetir sobre la misma base de pruebas.
- **Primer admin en producción**: no se carga el seed demo en producción; se usa `scripts/inicializar-produccion.mjs`, que carga solo datos base y crea el admin.

---

## 4. Arquitectura

### Estructura de carpetas

```
pedila/
├── prisma/
│   ├── schema.prisma              # modelo de datos (MySQL/MariaDB)
│   ├── migrations/                # migraciones SQL versionadas
│   ├── data/geo.json              # provincias (INDEC) y localidades
│   ├── data/categorias.json       # categorías base
│   └── seed.ts                    # datos demo
├── prisma.config.ts               # configuración de la CLI de Prisma
├── src/
│   ├── domain/                    # reglas de negocio PURAS (sin base): dinero, comisiones, pools, CUIT, zonas
│   ├── lib/                       # utilidades compartidas cliente/servidor: fechas AR, CSV, validación Zod, rate limit
│   ├── server/
│   │   ├── services/              # casos de uso transaccionales (pools, pagos, pedidos, liquidaciones, usuarios…)
│   │   ├── actions/               # Server Actions (formularios) con control de rol
│   │   ├── queries/               # consultas de lectura para páginas (con caché)
│   │   ├── payments/              # PaymentProvider: Mercado Pago y simulado
│   │   ├── notifications/         # notificaciones in-app, email SMTP, WhatsApp (interfaz)
│   │   ├── storage/               # StorageAdapter (disco local) + procesamiento de imágenes
│   │   ├── jobs/queue.ts          # cola de tareas en la base
│   │   ├── auth/guards.ts         # verificación de usuario y rol
│   │   ├── db.ts, tx.ts           # cliente Prisma y transacciones con reintento
│   │   └── audit.ts, config.ts, env.ts, logger.ts, http.ts
│   ├── app/                       # páginas y rutas (App Router)
│   │   ├── page.tsx, pools/[id], catalogo, preventistas/[id], como-funciona   # públicas
│   │   ├── ingresar, registro, recuperar, completar-perfil, notificaciones
│   │   ├── comercio/…             # panel del comercio
│   │   ├── preventista/…          # panel del preventista
│   │   ├── admin/…                # panel de administración
│   │   ├── api/…                  # health, progreso, webhooks, imágenes, exportaciones, PDF, auth
│   │   └── uploads/[...path]      # sirve imágenes (respaldo si el proxy no las sirve)
│   ├── components/                # UI (botones, formularios, badges, gráficos, pools, catálogo…)
│   ├── worker/index.ts            # proceso de tareas programadas (node-cron)
│   ├── auth.ts, auth.config.ts    # Auth.js
│   └── proxy.ts                   # control de acceso por rol + CSRF de las API
├── tests/unit, tests/integration, tests/e2e
├── deploy/                        # PM2, nginx, Ferozo, scripts de servidor, deploy y backup
├── scripts/                       # build del worker, setup local, inicialización de producción
├── docker-compose.yml             # solo desarrollo
└── .github/workflows/ci.yml       # CI + build para el servidor
```

### Modelo de datos

```mermaid
erDiagram
    User ||--o| Business : "tiene"
    User ||--o{ Account : "OAuth"
    User ||--o{ Notification : "recibe"
    User ||--o{ AuditLog : "actor"
    User ||--o{ CommissionChange : "cambió"
    Business }o--|| Province : "en"
    Business }o--|| Locality : "en"
    Business ||--o{ DistributorCoverage : "reparte en"
    Province ||--o{ Locality : "tiene"
    Category ||--o{ Product : "agrupa"
    Business ||--o{ Product : "vende"
    Product ||--o{ ProductImage : "imágenes"
    Business ||--o{ Pool : "publica"
    Product ||--o{ Pool : "se ofrece en"
    Pool ||--o{ PoolZone : "entrega en"
    Pool ||--o{ Participation : "tiene"
    Business ||--o{ Participation : "comercio"
    Participation ||--o{ Payment : "se paga con"
    Business ||--o{ Order : "pide / recibe"
    Order ||--o{ OrderItem : "líneas"
    Order ||--o{ Payment : "se paga con"
    Pool ||--o| Settlement : "liquida"
    Order ||--o| Settlement : "liquida"
    Participation ||--o| Rating : "califica"
    Order ||--o| Rating : "califica"
    Business ||--o{ Dispute : "reclamos"

    Pool {
        string status
        bigint unitPriceCents
        bigint netUnitCents
        int commissionBps "congelado al publicar"
        int totalUnits
        int minUnitsToClose
        int committedUnits "bajo FOR UPDATE"
        datetime deadlineAt
        datetime closedAt
    }
    Participation {
        int quantity
        bigint totalCents
        bigint commissionCents
        string status
    }
    Payment {
        string provider
        string status
        bigint amountCents
        string providerPaymentId
        datetime dueAt
    }
    Settlement {
        bigint grossCents
        bigint commissionCents
        bigint netCents
        string status
    }
```

Tablas de soporte: `PlatformConfig` (fila única con comisiones y plazos), `WebhookEvent` (idempotencia), `Job` (cola), `AuditLog`, `PasswordResetToken`, `SystemStatus` (latido del worker).

### Máquina de estados del pool

```mermaid
stateDiagram-v2
    [*] --> BORRADOR
    BORRADOR --> PENDIENTE_APROBACION: publicar (si el admin exige aprobación)
    BORRADOR --> ABIERTO: publicar (comisión congelada)
    PENDIENTE_APROBACION --> ABIERTO: admin aprueba
    PENDIENTE_APROBACION --> BORRADOR: admin devuelve
    ABIERTO --> COMPLETO: se alcanza el mínimo
    ABIERTO --> VENCIDO_SIN_COMPLETAR: job: fecha límite sin mínimo
    COMPLETO --> COMPLETO: cierre (al mínimo, al total o a la fecha) → links de pago
    COMPLETO --> CERRADO_PAGADO: todos pagaron / regla de impago
    COMPLETO --> ABIERTO: job: pago vencido + regla REABRIR
    VENCIDO_SIN_COMPLETAR --> ABIERTO: preventista extiende (una vez)
    VENCIDO_SIN_COMPLETAR --> COMPLETO: preventista cierra igual
    CERRADO_PAGADO --> EN_ENTREGA: entrega programada
    CERRADO_PAGADO --> ENTREGADO: todo entregado
    EN_ENTREGA --> ENTREGADO: todo entregado
    BORRADOR --> CANCELADO
    PENDIENTE_APROBACION --> CANCELADO
    ABIERTO --> CANCELADO
    COMPLETO --> CANCELADO: cancelación / nadie pagó
    VENCIDO_SIN_COMPLETAR --> CANCELADO
    CERRADO_PAGADO --> CANCELADO: solo admin (con reintegros)
    ENTREGADO --> [*]
    CANCELADO --> [*]
```

`VENCIDO_SIN_COMPLETAR` sin decisión dentro de la ventana queda finalizado (participaciones canceladas y reintegros) y ya no admite cambios.

### Flujo de pagos

```mermaid
sequenceDiagram
    autonumber
    actor C as Comercio
    participant P as PEDILA (web)
    participant W as Worker
    participant DB as MySQL
    participant MP as Mercado Pago

    C->>P: Se suma y completa el mínimo
    P->>DB: FOR UPDATE pool · participaciones → PENDIENTE_PAGO · Payment(vence 48 h) · Job CREATE_CHECKOUT · notificaciones
    W->>DB: Toma la tarea
    W->>MP: POST /checkout/preferences (external_reference = Payment.id, vencimiento)
    MP-->>W: init_point
    W->>DB: Guarda el link de pago
    C->>P: "Pagar ahora"
    P-->>C: Redirige al checkout (o crea el link en el momento)
    C->>MP: Paga
    MP-->>C: Vuelve a /comercio/pagos/:id?resultado=aprobado
    MP->>P: Webhook (x-signature)
    P->>DB: WebhookEvent (clave única: ignora duplicados)
    P->>MP: GET /v1/payments/:id (nunca se confía en el cuerpo)
    MP-->>P: approved, monto, external_reference
    P->>DB: FOR UPDATE pool + pago → APROBADO · participación PAGADA
    alt no quedan pagos pendientes
        P->>DB: Pool → CERRADO_PAGADO · Liquidación PENDIENTE · avisos
    end
    Note over W,DB: Cada minuto el worker vence pagos impagos: libera unidades y aplica REABRIR o CERRAR_CON_PAGADO
```

### Procesos en producción

```
Internet ──HTTPS──▶ Proxy inverso (Apache de Ferozo o nginx) ──▶ 127.0.0.1:3000
                      │  /uploads/ se sirve directo del disco        │
                      │                                            PM2: pedila-web (cluster ×2, Next standalone)
                      │                                            PM2: pedila-worker (node-cron + cola)
                      └──────────────────────────────────────────▶ MySQL / MariaDB
```

---

## 5. Instalación local

### Opción A — Un solo comando con Docker

Requiere Docker con Docker Compose.

```bash
docker compose up
```

Levanta MariaDB 11.4 y la app (web + worker), aplica las migraciones y carga los datos demo. Abrí <http://localhost:3000>. La primera vez tarda unos minutos (instala dependencias). Docker se usa **solo para desarrollo**.

### Opción B — Sin Docker (con MySQL/MariaDB propio, por ejemplo el de XAMPP)

1. **Node.js 24** (o ≥ 20.9). Con nvm: `nvm install 24 && nvm use 24` (hay un `.nvmrc`).
2. **Base de datos**: MySQL 5.7+/8 o MariaDB 10.4+. Creá un usuario con permiso para crear bases (Prisma usa una base temporal en `migrate dev`):
   ```sql
   CREATE USER 'pedila'@'localhost' IDENTIFIED BY 'pedila';
   GRANT ALL PRIVILEGES ON *.* TO 'pedila'@'localhost';
   ```
   Con XAMPP: `sudo /opt/lampp/lampp startmysql` y ejecutá lo anterior en phpMyAdmin (pestaña SQL).
3. **Dependencias**: `npm install`
4. **Configuración**: `cp .env.example .env` y ajustá `DATABASE_URL` (por ejemplo `mysql://pedila:pedila@127.0.0.1:3306/pedila`). Si no copiás el archivo, `npm run setup` lo crea con un `AUTH_SECRET` aleatorio.
5. **Base + datos demo + app, en un comando**:
   ```bash
   npm run local
   ```
   Equivale a `npm run setup` (cliente Prisma, migraciones y seed) seguido de `npm run dev:all` (web en <http://localhost:3000> + worker).

Comandos útiles: `npm run dev` (solo web), `npm run dev:worker` (solo worker), `npm run db:migrate` (crear una migración nueva), `npm run db:seed`, `npm run db:reset` (**borra toda la base** y la recrea; después corré `npm run db:seed`).

El seed **no modifica una base que ya tiene usuarios**. Para recargar el demo desde cero: `npm run db:reset && npm run db:seed`.

Sin `MP_ACCESS_TOKEN`, los pagos usan el **checkout simulado** (botones *Aprobar / Rechazar*). Sin `SMTP_HOST`, los emails se muestran en la consola del worker.

### Credenciales demo

| Rol | Email | Contraseña | Qué tiene |
|---|---|---|---|
| Admin | `admin@pedila.com.ar` | `Pedila2026!` | Acceso total. Hay un preventista y un pool esperando aprobación. |
| Preventista | `preventista1@pedila.com.ar` | `Demo2026!` | Distribuidora Del Sur (CABA + zona sur): pools en todos los estados, pedidos, liquidaciones, un reclamo. |
| Preventista | `preventista2@pedila.com.ar` | `Demo2026!` | Mayorista Mediterráneo (Córdoba), con comisión acordada del 7,5 %. |
| Preventista | `preventista3@pedila.com.ar` | `Demo2026!` | Preventa Litoral (Rosario), **pendiente de aprobación**. |
| Comercio | `comercio1@pedila.com.ar` … `comercio10@pedila.com.ar` | `Demo2026!` | 1–5 en CABA, 6 Lanús, 7 Avellaneda, 8 Quilmes, 9–10 Córdoba. El 4 y el 7 tienen pagos pendientes. |

Pools del seed: abiertos (uno al 85 % que cierra en menos de 24 h, destacado), completo que sigue sumando, cerrado esperando pagos, pagado, en entrega, entregado (con calificaciones y liquidación pagada), vencido con decisión pendiente, vencido finalizado, cancelado, borrador y pendiente de aprobación. Comisión global 8 %, Bebidas 6 %.

---

## 6. Variables de entorno

Todas están en `.env.example`, con comentarios. En el servidor van en `~/pedila/shared/.env`.

| Variable | Para qué sirve | Obligatoria | Ejemplo |
|---|---|---|---|
| `DATABASE_URL` | Conexión a MySQL/MariaDB | **Sí** | `mysql://pedila:clave@127.0.0.1:3306/pedila` |
| `DB_POOL_LIMIT` | Conexiones por proceso | No (5) | `5` |
| `APP_URL` | URL pública, sin barra final (emails, Mercado Pago) | **Sí** en producción | `https://pedila.com.ar` |
| `AUTH_SECRET` | Firma de las sesiones (`openssl rand -base64 32`) | **Sí** | `k3Jx…` |
| `AUTH_TRUST_HOST` | Confiar en el host que envía el proxy inverso | **Sí** detrás de proxy | `true` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Login con Google (si faltan, no se muestra el botón) | No | `1234….apps.googleusercontent.com` |
| `PAYMENTS_PROVIDER` | `mercadopago` o `simulado` (vacío: automático) | No | `mercadopago` |
| `MP_ACCESS_TOKEN` | Token de Mercado Pago (de prueba `TEST-…` o de producción) | **Sí** para cobrar | `TEST-1234…` |
| `MP_WEBHOOK_SECRET` | Clave para validar la firma de los webhooks | Recomendada | `a1b2c3…` |
| `MP_USE_SANDBOX` | Usar el link de checkout de prueba | No (`true`) | `false` en producción real |
| `ALLOW_SIMULATED_PAYMENTS` | Habilita el checkout simulado con `NODE_ENV=production` (solo demos) | No (`false`) | `false` |
| `SMTP_HOST` | Servidor SMTP (vacío: los emails van al log) | Recomendada | `mail.tudominio.com.ar` |
| `SMTP_PORT` / `SMTP_SECURE` | Puerto y modo (465 + `true`, o 587 + `false`) | No (465/`true`) | `465` / `true` |
| `SMTP_USER` / `SMTP_PASS` | Usuario y clave de la casilla | Si hay SMTP | `no-responder@tudominio.com.ar` |
| `MAIL_FROM` | Remitente | No | `PEDILA <no-responder@tudominio.com.ar>` |
| `UPLOAD_DIR` | Carpeta de imágenes (absoluta en producción; la define PM2) | No (`./uploads`) | `/home/pedila/pedila/shared/uploads` |
| `UPLOAD_MAX_MB` | Tamaño máximo por imagen | No (5) | `5` |
| `PORT` | Puerto local de la app (solo escucha en 127.0.0.1) | No (3000) | `3000` |
| `WEB_INSTANCES` | Instancias web en PM2 (2 = recarga sin corte) | No (2) | `1` en VPS de 1 GB |
| `WEB_MAX_OLD_SPACE_MB` / `WEB_MAX_MEMORY` | Memoria de cada instancia web / reinicio por memoria | No | `384` / `480M` |
| `WORKER_MAX_OLD_SPACE_MB` / `WORKER_MAX_MEMORY` | Lo mismo para el worker | No | `192` / `260M` |
| `WHATSAPP_ENABLED` | Canal WhatsApp (sin proveedor conectado) | No | `false` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | No (`info`) | `info` |
| `DATABASE_URL_TEST` | Base **aparte** para tests de integración | Solo tests | `mysql://…/pedila_test` |
| `DATABASE_URL_E2E` | Base **aparte** para tests E2E | Solo tests | `mysql://…/pedila_e2e` |

---

## 7. Despliegue en VPS DonWeb + Ferozo

### 7.1 Qué vas a tener al final

- La app Node corriendo con **PM2** como usuario `pedila` (sin privilegios): `pedila-web` (2 instancias en `127.0.0.1:3000`) y `pedila-worker`.
- Un **proxy inverso** (el servidor web que gestiona Ferozo, o nginx) que recibe HTTPS en el dominio y lo pasa a `127.0.0.1:3000`.
- La base **MySQL/MariaDB** (gestionada desde Ferozo o instalada por SSH).
- Backups diarios, logs rotados, arranque automático al reiniciar el servidor.

Estructura en el servidor:

```
/home/pedila/pedila/
├── current -> releases/20261025-031500     # release activa
├── releases/                               # últimas 5 versiones (para volver atrás)
└── shared/
    ├── .env          # configuración y secretos (permisos 600)
    ├── uploads/      # imágenes subidas
    ├── backups/      # dumps diarios (7 días)
    └── logs/         # logs de PM2 y de backups
```

### 7.2 Requisitos

- VPS Linux **Ubuntu 22.04/24.04 o Debian 12**, x86_64, con acceso SSH como root.
- **2 GB de RAM** recomendados (funciona con 1 GB usando `WEB_INSTANCES=1` y swap), 1–2 vCPU, 10 GB libres.
- Un dominio con el DNS gestionado en Ferozo.

> **Sobre Ferozo**: las opciones disponibles (si el panel permite definir un proxy hacia un puerto local, editar el VirtualHost, emitir certificados o abrir puertos) **dependen de la versión del panel y del plan contratado**. Esta guía marca esos puntos y siempre da un **camino alternativo por SSH**, que funciona en cualquier VPS Linux. Ante la duda, consultá al soporte de DonWeb qué permite tu plan.

### 7.3 Paso 1 — DNS

En Ferozo, en la zona DNS del dominio, creá (o verificá) registros **A** para `@` y `www` apuntando a la IP del VPS. Comprobá la propagación con `dig +short pedila.com.ar` (puede tardar desde minutos hasta algunas horas).

### 7.4 Paso 2 — Base de datos

**Opción A: desde Ferozo.** Si el panel gestiona MySQL en el VPS, creá desde la sección de bases de datos una base (`pedila`) y un usuario con todos los permisos sobre esa base. Anotá el host que indica el panel (normalmente `localhost`/`127.0.0.1`). phpMyAdmin queda disponible desde el panel para consultas y respaldos manuales.

**Opción B: por SSH.** Si no hay panel de bases, instalá MariaDB con el script (`INSTALL_MARIADB=1`, paso 4) y después:

```bash
sudo mariadb
```
```sql
CREATE DATABASE pedila CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pedila'@'localhost' IDENTIFIED BY 'una-clave-larga';
CREATE USER 'pedila'@'127.0.0.1' IDENTIFIED BY 'una-clave-larga';
GRANT ALL PRIVILEGES ON pedila.* TO 'pedila'@'localhost';
GRANT ALL PRIVILEGES ON pedila.* TO 'pedila'@'127.0.0.1';
FLUSH PRIVILEGES;
```

En ambos casos: `DATABASE_URL="mysql://pedila:una-clave-larga@127.0.0.1:3306/pedila"`. Si la clave tiene símbolos, codificalos en la URL (`@` → `%40`, `#` → `%23`).

### 7.5 Paso 3 — Casilla de correo (SMTP)

Creá en Ferozo una casilla como `no-responder@tudominio.com.ar`. Los datos de servidor SMTP y puertos los muestra el panel (en la configuración de cliente de correo de la casilla) y **pueden variar según el plan**; lo habitual es puerto **465 con SSL** (`SMTP_SECURE=true`) o **587 con STARTTLS** (`SMTP_SECURE=false`). Verificá en la zona DNS que existan los registros **SPF** (y DKIM si el panel lo ofrece) para que los emails no caigan en spam.

### 7.6 Paso 4 — Preparar el servidor

Copiá el script al VPS y corrélo como root:

```bash
scp deploy/setup-servidor.sh root@IP_DEL_VPS:/root/
ssh root@IP_DEL_VPS
bash /root/setup-servidor.sh
```

Opciones (como variables antes del comando):

```bash
INSTALL_NGINX=1 INSTALL_CERTBOT=1 bash setup-servidor.sh          # VPS sin panel web (variante B)
INSTALL_MARIADB=1 bash setup-servidor.sh                           # sin MySQL gestionado por Ferozo
EXTRA_PORTS="25 465 587 993" bash setup-servidor.sh                # si el VPS también corre el correo
CONFIGURE_FIREWALL=0 bash setup-servidor.sh                        # si el firewall lo gestiona el panel
```

El script es **idempotente** (se puede correr de nuevo sin problemas). Instala Node.js 24 LTS, PM2 (con rotación de logs), Git, el cliente de MariaDB (para backups), crea el usuario `pedila` y sus carpetas, agrega **swap** de 2 GB si hay menos de 3 GB de RAM, configura el **firewall** (solo 22, 80 y 443), registra PM2 para que arranque al bootear y programa el backup diario.

> ⚠️ **Firewall y Ferozo**: si el mismo VPS corre el **panel Ferozo** o el **correo**, sus puertos quedarían bloqueados. Consultá a DonWeb qué puertos usa tu panel y pasalos en `EXTRA_PORTS`, o usá `CONFIGURE_FIREWALL=0` y gestioná el firewall desde el panel. Si el script detecta `firewalld` activo, no lo toca.

`sharp` (procesamiento de imágenes) trae binarios precompilados con libvips para Linux x64 con glibc ≥ 2.26: no hace falta instalar nada más (el script muestra la versión de glibc y `deploy.sh` verifica que sharp cargue).

### 7.7 Paso 5 — Configuración (`.env`)

```bash
sudo -iu pedila
nano ~/pedila/shared/.env      # completar a partir de .env.example
chmod 600 ~/pedila/shared/.env
```

Mínimo: `DATABASE_URL`, `APP_URL=https://tudominio.com.ar`, `AUTH_SECRET` (`openssl rand -base64 32`), `AUTH_TRUST_HOST=true`, `MP_ACCESS_TOKEN` (de prueba al principio), `MP_WEBHOOK_SECRET`, `SMTP_*`. Con 1 GB de RAM: `WEB_INSTANCES=1`.

### 7.8 Paso 6 — Primer deploy

Siempre como usuario `pedila` (`sudo -iu pedila`). Elegí **una** forma de llevar el código:

**a) Desde el repositorio de GitHub** (el servidor compila). El repo es privado, así que el VPS necesita una *deploy key*: una clave SSH de **solo lectura** que vale únicamente para este repo.

```bash
# 1. En el VPS, como pedila: crear la clave (sin contraseña) y mostrar la parte pública
ssh-keygen -t ed25519 -C "deploy pedila VPS" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

2. En GitHub: repo → *Settings* → *Deploy keys* → *Add deploy key*. Pegá la clave pública, título "VPS DonWeb" y **no** tildes *Allow write access*.

```bash
# 3. Probar el acceso y hacer el primer deploy
ssh -T git@github.com                     # aceptá la huella (yes); responde "Hi tomascanavidez/pedila!"
git clone git@github.com:tomascanavidez/pedila.git ~/pedila-src      # solo para tener deploy.sh a mano
echo 'export REPO_URL=git@github.com:tomascanavidez/pedila.git' >> ~/.bashrc && source ~/.bashrc
bash ~/pedila-src/deploy/deploy.sh
```

Para las siguientes actualizaciones alcanza con `cd ~/pedila-src && git pull && bash deploy/deploy.sh` (el `git pull` trae la última versión del script; `deploy.sh` clona siempre la rama `main` en una release nueva).

**b) Subiendo el código por SFTP** (por ejemplo con FileZilla, a `/home/pedila/pedila-src`, sin `node_modules` ni `.next`):
```bash
bash ~/pedila-src/deploy/deploy.sh --source ~/pedila-src
```

**c) Con un build ya compilado** (recomendado si el VPS tiene poca RAM, ver abajo):
```bash
bash ~/pedila-src/deploy/deploy.sh --artifact ~/pedila-build.tar.gz
```

`deploy.sh` crea la release, instala dependencias, compila (salvo en modo artefacto), verifica sharp, corre **`prisma migrate deploy`**, cambia el enlace `current`, hace **`pm2 startOrReload`** y espera a que `/api/health` responda. Si no responde, **vuelve solo a la versión anterior**.

**Datos base y primer admin** (solo la primera vez):
```bash
cd ~/pedila/current
node scripts/inicializar-produccion.mjs --admin-email admin@tudominio.com.ar --admin-nombre "Tu Nombre"
```
Carga provincias, localidades, categorías y la configuración inicial, y crea el admin con una clave temporal que se muestra una sola vez (cambiala desde *Mi cuenta* al ingresar). Es idempotente: no borra ni pisa nada. **No cargues el seed demo en producción.**

**Si la RAM no alcanza para compilar** (`next build` puede necesitar ~1–1,5 GB): el swap del paso 4 suele alcanzar; si no, compilá afuera:

- **GitHub Actions**: el workflow `.github/workflows/ci.yml` corre lint, tests y build, y publica `pedila-build.tar.gz` como artefacto. Descargalo desde la pestaña *Actions*, subilo al servidor (`scp pedila-build.tar.gz pedila@IP:~/`) y desplegá con `--artifact`.
- **En tu PC** (Linux x64 o WSL, para que los binarios coincidan): `npm ci && NEXT_DEPLOYMENT_ID=$(date +%s) npm run build` y luego
  `tar --exclude=.next/standalone/.env -czf pedila-build.tar.gz .next/standalone dist prisma prisma.config.ts package.json package-lock.json deploy scripts public`.

En modo artefacto el servidor solo corre `npm ci --omit=dev` (necesario para el worker y la CLI de migraciones), que usa poca memoria.

### 7.9 Paso 7 — Proxy inverso: ¿variante A o B?

Fijate quién atiende hoy los puertos 80 y 443:

```bash
sudo ss -ltnp | grep -E ':(80|443) '
```

- Si aparecen **Apache/httpd o nginx gestionados por Ferozo** (el panel aloja el sitio del dominio en este VPS) → **Variante A**.
- Si no hay nada escuchando, o el panel se usa **solo para DNS y correo** → **Variante B** (nginx propio).

#### Variante A — Servidor web gestionado por Ferozo

Lo que hay que lograr es que el dominio reenvíe todo a `http://127.0.0.1:3000`. Según lo que permita tu panel:

1. **Directivas del VirtualHost / "proxy a puerto local"**: si el panel tiene un campo de directivas personalizadas de Apache o una opción de proxy, usá `deploy/ferozo/apache-vhost-proxy.conf`. Necesita los módulos `mod_proxy`, `mod_proxy_http` y `mod_headers`.
2. **Solo `.htaccess`**: copiá `deploy/ferozo/htaccess-proxy` como `.htaccess` en la carpeta pública del dominio. Funciona **solo si mod_proxy está habilitado** en el servidor; si ves un error 500, no lo está.
3. **Panel con nginx al frente**: pegá `deploy/ferozo/nginx-panel-location.conf` en la configuración adicional del sitio.

Si el panel no ofrece ninguna de estas opciones, **pedile al soporte de DonWeb** que agregue el bloque de `apache-vhost-proxy.conf` al VirtualHost del dominio (o que habilite mod_proxy). Como último recurso, podés liberar los puertos 80/443 del panel para ese dominio y usar la variante B.

En esta variante el **SSL lo maneja el certificado que emite Ferozo** para el dominio (si tu plan lo incluye); la app recibe `X-Forwarded-Proto: https`.

#### Variante B — nginx propio (VPS sin panel o panel solo para DNS/correo)

```bash
sudo cp ~/pedila/current/deploy/nginx.conf /etc/nginx/sites-available/pedila.conf
sudo cp ~/pedila/current/deploy/nginx-proxy-snippet.conf /etc/nginx/snippets/pedila-proxy.conf   # si no lo creó el setup
sudo sed -i 's/pedila.com.ar/tudominio.com.ar/g' /etc/nginx/sites-available/pedila.conf
sudo ln -s /etc/nginx/sites-available/pedila.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
```

Antes de tener certificado, comentá temporalmente los bloques `listen 443` (o emití el certificado primero, paso 8). nginx sirve `/uploads/` directo del disco, comprime, limita pedidos por IP y reenvía el resto a la app.

### 7.10 Paso 8 — SSL

- **Variante A**: activá el certificado SSL del dominio desde Ferozo (si el plan lo ofrece, suele ser Let's Encrypt automático). Si no está disponible, consultá a soporte.
- **Variante B (Let's Encrypt con Certbot)**:
  ```bash
  sudo certbot --nginx -d tudominio.com.ar -d www.tudominio.com.ar --redirect
  sudo certbot renew --dry-run       # prueba la renovación automática
  sudo nginx -t && sudo systemctl reload nginx
  ```
  Certbot deja un temporizador del sistema que renueva solo.

### 7.11 Paso 9 — Arranque automático y logs

El setup ya registró PM2 con systemd. Verificá:

```bash
systemctl status pm2-pedila
sudo -iu pedila pm2 status
```

Después de cada deploy se ejecuta `pm2 save`, así que tras un reinicio del VPS los procesos vuelven solos. Los logs rotan con `pm2-logrotate` (10 MB, 14 archivos, comprimidos).

### 7.12 Paso 10 — Mercado Pago

1. En <https://www.mercadopago.com.ar/developers> creá una aplicación (Checkout Pro).
2. Copiá el **Access Token de prueba** a `MP_ACCESS_TOKEN` (`MP_USE_SANDBOX=true`).
3. En **Webhooks**, configurá la URL `https://tudominio.com.ar/api/webhooks/mercadopago`, evento **Pagos**, y copiá la **clave secreta** a `MP_WEBHOOK_SECRET`.
4. Recargá: `pm2 reload ~/pedila/current/deploy/ecosystem.config.js --update-env`.
5. Probá un pago completo con los usuarios de prueba que da Mercado Pago (comprador y vendedor de prueba).
6. Para cobrar de verdad: credenciales de **producción**, `MP_USE_SANDBOX=false`, y recargá.

Desde el panel admin, *Configuración* muestra qué proveedor está activo y si la firma de webhooks está configurada; *Tareas y worker* muestra los últimos webhooks recibidos.

### 7.13 Paso 11 — Verificación final

```bash
curl -s https://tudominio.com.ar/api/health
# {"status":"ok","db":"ok","worker":{"ok":true,...},"version":"20261025-031500",...}
```

- Ingresá con el admin, revisá *Comisiones* y *Configuración*.
- Registrate como comercio y como preventista de prueba; aprobá al preventista; publicá un pool y sumate.
- En *Tareas y worker* el worker tiene que figurar activo y los emails como completados.

Recomendaciones de seguridad del servidor: acceso SSH solo con clave (`PasswordAuthentication no`), actualizaciones automáticas (`sudo apt install unattended-upgrades`) y copiar los backups fuera del VPS periódicamente.

---

## 8. Operación diaria

### Cambiar la comisión

*Admin › Comisiones*:
- **Global** y **modo de cobro** (se descuenta al preventista / se suma al comercio), y si se cobra en pedidos de catálogo.
- **Override por categoría** y **por preventista** (vacío = sin override). Prioridad: preventista > categoría > global.
- Cada cambio queda en el **historial** (quién, cuándo, valor anterior y nuevo), exportable a CSV.
- Los pools **ya publicados conservan** el porcentaje con el que se publicaron.

Plazos de pago, regla ante impagos, ventana de decisión de pools vencidos y aprobación previa de pools: *Admin › Configuración* (aplican a los pools que se publiquen desde ese momento).

### Aprobar preventistas y pools

- *Admin › Preventistas*: revisá CUIT, razón social, condición IVA y zonas; **Aprobar** o **Rechazar** con motivo (el preventista recibe el aviso).
- Si activaste la aprobación previa: *Admin › Pools › En revisión* → **Aprobar y publicar** o **Devolver con comentario**. Desde ahí también se destacan pools en el inicio o se cancelan (con reintegro de lo pagado).

### Liquidar a los preventistas

*Admin › Liquidaciones*: cada pool pagado o pedido pagado genera una liquidación pendiente (bruto, comisión, neto). Transferí el neto y marcala como **transferida** con la referencia; el preventista recibe el aviso y la ve en su panel.

### Ver logs

```bash
sudo -iu pedila
pm2 status                          # estado, memoria y reinicios
pm2 logs pedila-web --lines 100     # errores de la web
pm2 logs pedila-worker --lines 100  # tareas programadas, emails, pagos
pm2 monit                           # monitoreo en vivo
ls ~/pedila/shared/logs/            # archivos de log (rotados)
```

En la aplicación: *Admin › Auditoría* (todos los cambios de estado, pagos, comisiones e ingresos), *Admin › Tareas y worker* (cola de emails, links de pago y reintegros, con reintento manual de las fallidas).

### Reiniciar servicios

```bash
pm2 reload pedila-web          # recarga sin cortar (instancia por instancia)
pm2 restart pedila-worker      # el worker retoma la cola sin perder tareas (están en la base)
pm2 reload ~/pedila/current/deploy/ecosystem.config.js --update-env   # después de editar .env
sudo systemctl reload nginx    # variante B
```

### Backups

- Automático todos los días a las 03:30: `~/pedila/shared/backups/db-…sql.gz` y `uploads-….tar.gz`, se conservan 7 días.
- Manual: `bash ~/pedila/current/deploy/backup.sh`
- **Copialos fuera del VPS** (por ejemplo `scp pedila@IP:~/pedila/shared/backups/* ./backups/` desde tu PC).

### Restaurar un backup

> Restaurar **reemplaza** los datos actuales. Primero hacé un backup del estado actual.

```bash
sudo -iu pedila
bash ~/pedila/current/deploy/backup.sh                       # resguardo del estado actual
pm2 stop pedila-worker                                       # que no corran tareas mientras tanto
cd ~/pedila/shared/backups && ls -lt                         # elegí el archivo
gunzip -c db-pedila-20261025-033000.sql.gz | mysql -h 127.0.0.1 -u pedila -p pedila
tar -xzf uploads-20261025-033000.tar.gz -C ~/pedila/shared   # imágenes
pm2 reload ~/pedila/current/deploy/ecosystem.config.js --update-env
```

Alternativa más segura: restaurar en una base nueva (`CREATE DATABASE pedila_restaurada …`), revisarla con phpMyAdmin y recién después cambiar `DATABASE_URL` y recargar. El dump también se puede importar desde phpMyAdmin (pestaña *Importar*) si el tamaño lo permite.

---

## 9. Actualizaciones y rollback

### Subir una versión nueva sin cortar el servicio

```bash
# en tu PC: subir los cambios a GitHub
git add -A && git commit -m "Descripción del cambio" && git push

# en el VPS
sudo -iu pedila
cd ~/pedila-src && git pull && bash deploy/deploy.sh    # o --source / --artifact, como en el paso 6
```

Cómo se evita el corte: la release nueva se prepara en su propia carpeta mientras la anterior sigue atendiendo; recién al final se cambia el enlace `current` y `pm2 reload` reinicia las **2 instancias web de a una** (siempre hay una atendiendo). Next recibe un `deploymentId` por release: si un navegador quedó con la versión vieja, recarga la página en lugar de fallar. En la prueba del sandbox, **5.746 pedidos durante un deploy: 0 fallidos**. Con `WEB_INSTANCES=1` la recarga implica unos segundos de reinicio.

**Migraciones**: `deploy.sh` corre `prisma migrate deploy` antes de activar la release nueva, mientras la vieja sigue atendiendo. Por eso las migraciones tienen que ser **compatibles hacia atrás** (agregar columnas o tablas primero; borrar o renombrar en un deploy posterior, cuando ya nada las use).

Para crear una migración en desarrollo: cambiar `prisma/schema.prisma` y correr `npm run db:migrate -- --name descripcion`; el archivo SQL generado en `prisma/migrations` se sube con el código.

### Volver atrás (rollback)

```bash
bash ~/pedila/current/deploy/deploy.sh rollback      # vuelve a la release anterior
bash ~/pedila/current/deploy/deploy.sh status        # releases disponibles y estado de PM2
```

Se conservan las últimas 5 releases. El rollback **no revierte las migraciones de base**: si una versión cambió la base de forma incompatible, restaurá el backup previo al deploy (sección 8). `deploy.sh` también hace rollback automático si la versión nueva no pasa el chequeo de salud.

---

## 10. Solución de problemas

**La app no arranca / `EADDRINUSE` (puerto ocupado).**
`sudo ss -ltnp | grep :3000` muestra qué proceso usa el puerto. Si es otra app, cambiá `PORT` en `shared/.env` (y el proxy) y recargá PM2. Si son procesos viejos de PM2: `pm2 delete all && pm2 startOrReload ~/pedila/current/deploy/ecosystem.config.js && pm2 save`.

**`/api/health` responde 503.** La base no responde: ver el punto de MySQL. Si responde `"worker":{"ok":false}`: `pm2 logs pedila-worker`.

**SSL: Certbot falla.** El DNS todavía no apunta al VPS (`dig +short dominio`) o el puerto 80 está cerrado (firewall del VPS o del panel). Certbot necesita el puerto 80 abierto para validar.

**SSL: "demasiadas redirecciones" (`ERR_TOO_MANY_REDIRECTS`).** Dos capas redirigen a HTTPS a la vez o el proxy no informa el protocolo. Verificá que el proxy envíe `X-Forwarded-Proto: https`, que `APP_URL` empiece con `https://` y que haya una sola redirección (la del panel **o** la de nginx/.htaccess).

**El login vuelve siempre a la pantalla de ingreso.** Falta `AUTH_TRUST_HOST=true`, `AUTH_SECRET` cambió entre instancias, o el proxy no envía `Host`/`X-Forwarded-Proto`. Revisá `pm2 logs pedila-web`.

**MySQL: `ECONNREFUSED`.** Host o puerto equivocados en `DATABASE_URL`, o MySQL detenido (`systemctl status mariadb`). En Ferozo, usá el host que indica el panel.

**MySQL: `Access denied`.** El usuario no tiene permisos desde ese host: MySQL distingue `'pedila'@'localhost'` de `'pedila'@'127.0.0.1'`. Creá ambos (paso 2) o cambiá el host de la URL. Si la clave tiene símbolos, codificalos en la URL.

**MySQL 8: error de autenticación (`caching_sha2_password`).** La app ya pide la clave pública al servidor; si igual falla, agregá `?ssl=true` a la URL (si el servidor tiene TLS) o creá el usuario con `IDENTIFIED WITH mysql_native_password`.

**`Too many connections`.** Bajá `DB_POOL_LIMIT` (cada instancia web y el worker abren su propio pool) o subí `max_connections` en MySQL.

**Los webhooks de Mercado Pago no llegan (los pagos quedan "pendientes").**
1. La URL configurada en Mercado Pago tiene que ser pública y con HTTPS válido: `https://tudominio.com.ar/api/webhooks/mercadopago`.
2. Mirá *Admin › Tareas y worker › Últimos webhooks* y `pm2 logs pedila-web`: un **401** indica que `MP_WEBHOOK_SECRET` no coincide con la clave del panel de Mercado Pago.
3. Revisá que el firewall o el panel no bloqueen pedidos entrantes al 443.
4. Desde el panel de desarrolladores de Mercado Pago podés ver el historial de notificaciones y reenviarlas; la app las procesa una sola vez aunque lleguen repetidas.
5. Verificá que `APP_URL` sea la URL pública correcta: se usa para armar `notification_url`.

**Falta de memoria.**
- *Al compilar* (`JavaScript heap out of memory` o el proceso muere): asegurate de tener swap (`free -h`), subí `BUILD_MEMORY_MB` o compilá afuera (modo `--artifact`, paso 6).
- *En funcionamiento* (PM2 muestra reinicios `↺` frecuentes): `pm2 monit` para ver el consumo; usá `WEB_INSTANCES=1`, bajá `WEB_MAX_OLD_SPACE_MB` y revisá cuánta RAM usa MySQL (`innodb_buffer_pool_size`).

**Los emails no salen.** *Admin › Tareas y worker* muestra el error de cada envío. Probá el otro puerto (465/`SMTP_SECURE=true` o 587/`SMTP_SECURE=false`), verificá usuario y clave de la casilla y los registros SPF. Sin `SMTP_HOST` los emails solo van al log.

**Las imágenes no se ven (404).** Con la variante B o A, revisá que el `alias` de `/uploads/` apunte a `/home/pedila/pedila/shared/uploads/` y que el proxy pueda atravesar las carpetas (`chmod o+x /home/pedila /home/pedila/pedila /home/pedila/pedila/shared`; el setup ya lo hace).

**`sharp` no carga.** Pasa con glibc muy viejo o una arquitectura distinta de la del build. En el servidor: `cd ~/pedila/current && npm rebuild sharp`. Si el build viene de otra máquina, compilalo en Linux x64 (GitHub Actions o WSL).

**"Failed to find Server Action" después de un deploy.** Una pestaña quedó abierta con la versión anterior: recargá la página. Con `deploymentId` (lo pone `deploy.sh`) Next lo hace solo al navegar.

---

## 11. Tests

```bash
npm run test:unit          # 102 tests unitarios (sin base de datos)
npm run test:integration   # 23 tests contra MySQL/MariaDB (necesita DATABASE_URL_TEST)
npm test                   # los dos anteriores
npm run build && npm run test:e2e   # 15 tests E2E con Playwright (necesita DATABASE_URL_E2E)
npm run check              # lint + typecheck + tests + build
```

**Preparación**:
- `DATABASE_URL_TEST` y `DATABASE_URL_E2E` tienen que ser **bases distintas** de la de desarrollo (los tests se niegan a correr sobre `DATABASE_URL`). Los tests **no borran datos**: aplican migraciones (`migrate deploy`) y crean registros con nombres únicos, así que se pueden repetir sobre la misma base.
- E2E: `npx playwright install chromium` la primera vez. El servidor de E2E (`scripts/e2e-server.mjs`) usa el build de producción, aplica migraciones, carga el seed si la base está vacía y habilita los pagos simulados solo para esa corrida.

**Qué cubren**:

| Archivo | Cubre |
|---|---|
| `tests/unit/money.test.ts` | Formato `$ 12.345,67`, interpretación de precios ingresados, redondeo half-up, puntos básicos, rangos seguros. |
| `tests/unit/commission.test.ts` | Prioridad preventista > categoría > global, overrides en 0 %, ambos modos de cobro, redondeo por unidad, invariante total = comisión + neto, suma de participaciones = total del pallet, ejemplo del README, ahorro. |
| `tests/unit/pool-rules.test.ts` | Todas las transiciones válidas e inválidas, alta/modificación/baja (mínimos, máximos, disponibilidad, plazos), cierre al mínimo o al total, aviso del 80 %, vencimiento, reglas REABRIR y CERRAR_CON_PAGADO, extensión única, validación de la definición del pool. |
| `tests/unit/utils.test.ts` | CUIT, zonas, CSV (escape, inyección de fórmulas, importación), fechas en hora argentina, cuenta regresiva, rate limit. |
| `tests/integration/pool-concurrency.test.ts` | 40 comercios comprando a la vez sobre 100 unidades (se venden exactamente 100), cantidades distintas en paralelo, doble click, altas y bajas simultáneas. |
| `tests/integration/pool-lifecycle.test.ts` | Comisión congelada al publicar, overrides y modo "sumar", aprobación del admin, camino feliz completo con liquidación y auditoría, pool que sigue sumando y lo cierra el job, vencimiento + extensión única + cierre igual, finalización, reglas de impago, cancelación con reintegro, comercio fuera de zona. |
| `tests/integration/payments-webhook.test.ts` | Webhook duplicado procesado una sola vez, firma inválida, tópicos ignorados, error de la API de Mercado Pago (se reintenta), monto inconsistente, pago fuera de plazo reintegrado. |
| `tests/e2e/flujo-pool.spec.ts` | De punta a punta en celular: el preventista publica con la calculadora en vivo → un comercio nuevo se registra, se suma y cierra el pool → paga → el preventista entrega → el comercio califica; el admin cambia la comisión y queda en el historial. |
| `tests/e2e/navegacion-y-seguridad.spec.ts` | Inicio, filtros, ficha del pool, cómo funciona, salud, áreas privadas, permisos por rol, CSRF en API, error de credenciales. |
