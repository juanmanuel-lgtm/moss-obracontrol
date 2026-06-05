[LEEME.md](https://github.com/user-attachments/files/28656728/LEEME.md)
# MOSS ObraControl — Documento de Arquitectura y Contrato Técnico
**Versión:** 2026.06.05  
**Proyecto:** MOSS Arquitectura y Mobiliario S.A.S. — NIT 901.159.078-6  
**Mantenedor:** Juan Manuel Guevara (CEO)

---

> **⚠️ REGLA DE ORO PARA CUALQUIER IA O DESARROLLADOR**  
> Antes de tocar una sola línea de código, leer este documento completo.  
> Antes de subir un `index.html` nuevo a GitHub, releer la sección **"Cómo subir cambios sin perder datos"**.  
> El 100% de las pérdidas de datos ocurridas en este proyecto se debieron a no seguir estas reglas.

---

## 1. Qué es este sistema

MOSS ObraControl es un dashboard interno para gestionar obras de remodelación. Tiene dos partes:

| Componente | Qué es | Dónde vive |
|---|---|---|
| **Frontend** | `index.html` — una sola página HTML/JS | GitHub Pages: `https://juanmanuel-lgtm.github.io/moss-obracontrol/` |
| **Backend** | Google Apps Script — recibe y guarda datos | Script URL fija (ver sección 3) |
| **Base de datos** | PropertiesService de Apps Script | Dentro del mismo proyecto de Apps Script |

---

## 2. Dónde vive cada dato

### PropertiesService (fuente de verdad — clave: `moss_cron_blob`)
Todo el estado del sistema vive en **una sola propiedad** del Apps Script llamada `moss_cron_blob`. Es un JSON con esta estructura:

```
{
  obras:       { [id]: {id, cod, nom, cli, res, maestro, av, act, fI, fE, fl, pres, m2, ...} }
  pedidos:     { [obraId]: { [capN]: [ {matId, cantidad, estado, origenMat, fechaSolicitud, ...} ] } }
  materiales:  { [capN]: [ {id, nom, uni, precio, proveedor, cant_m2, ...} ] }
  cronograma:  { [obraId]: { [capN]: {fIni, fFin, checks: {item: bool}} } }
  videos:      { [obraId]: { [keyISO]: {link, coment, estado, notaRev, revisor} } }
  garantias:   [ {id, proy, cli, maestro, estado, items, fecha, fotos} ]
  estados:     { [obraId]: "enobra"|"preobra"|"sinrecibir"|"proxima"|"entregado" }
  drives:      { [obraId]: {raiz, carpetas: [{ic, nom, url}]} }
  comunicados: [ {titulo, texto, fecha, autor, ts} ]
  presupuesto: { precios: { [capN]: {mat, mdo, markup, notas} } }
}
```

### localStorage del navegador (caché local — NO es fuente de verdad)
- `moss_cron_backup` — snapshot del último estado conocido (respaldo de emergencia)
- `moss_backups_hist` — últimos 5 backups con timestamp (para restaurar desde Logística → General)
- `moss_obras` — caché de obras para carga rápida
- `moss_comunicados` — caché local de comunicados del equipo
- `moss_version` — versión del app para detectar actualizaciones

**Importante:** el localStorage es solo caché. Los datos reales están en PropertiesService. Si hay conflicto, PropertiesService gana — siempre.

---

## 3. Archivos del Apps Script

### `Código.gs` — Punto de entrada de todas las peticiones POST
- Recibe el POST del dashboard
- Registra en la pestaña "Log" del Sheet para diagnóstico
- **Delega siempre** a `doPost_router(e)` del `01_router.gs`
- **NO procesa datos directamente** — solo registra y delega
- SHEET_ID usado para logs: `1UI-UcKt09yjL_wzV07Zf62q5jrO8quTvatjHoevVE7I`

### `01_router.gs` — Router principal
- `doGet(e)`: maneja GET con `?hoja=cron` → llama `cron_leer()` → devuelve JSON
- `doPost_router(e)`: extrae `action` y `payload` del body → llama `routeAction()`
- `routeAction(action, payload, user)`: despacha según `action`:
  - `"cron.guardar"` → llama `cron_guardar(payload, user)`
  - otras acciones → sus funciones respectivas
- SHEET_ID activo: `1UI-UcKt09yjL_wzV07Zf62q5jrO8quTvatjHoevVE7I`

### `10_cron.gs` — Lectura y escritura del blob principal
- `cron_leer()`: lee `moss_cron_blob` de PropertiesService → devuelve objeto JS
- `cron_guardar(payload, user)`: recibe el objeto completo → lo serializa a JSON → lo guarda en `moss_cron_blob`
- **Límite importante:** PropertiesService acepta máximo 500KB por propiedad. El blob actual pesa ~88KB. Hay margen amplio.

### `02_auth.gs` — Autenticación
- `getCurrentUser(email)`: busca el email en la lista de usuarios autorizados
- `canExecute(rol, action)`: verifica si el rol puede ejecutar la acción

### `05_proyectos.gs` — Operaciones de obras individuales
- `proyecto_listar()`: lista obras del Sheet (usado en fallback)
- `_upsertObra(obra)`: crea o actualiza una obra en el Sheet

### `04_log.gs` (o sección en Código.gs) — Registro de operaciones
- Escribe una fila por cada POST recibido en la pestaña "Log" del Sheet
- Mantiene máximo 500 filas (borra las más antiguas)
- Columnas: Timestamp, OK/FAIL, Etapa, Error, ClavesBody, Bytes, DuracionMs, CuerpoCrudo

---

## 4. Flujo de datos — cómo funciona

### Al cargar el dashboard (GET)
```
Usuario abre el dashboard
  → frontend hace GET a SCRIPT_URL?hoja=cron&_t=timestamp
  → Apps Script: doGet → cron_leer() → lee moss_cron_blob de PropertiesService
  → devuelve JSON completo
  → frontend: _sesionSincronizada = true (SOLO después de este GET exitoso)
  → frontend renderiza con los datos recibidos
```

### Al guardar cambios (POST)
```
Usuario hace un cambio (agregar material, cambiar estado, etc.)
  → frontend: guardarCronogramaRemoto() — solo si _sesionSincronizada === true
  → espera 300ms (debounce para juntar cambios)
  → POST a SCRIPT_URL con body: {action:"cron.guardar", payload:{...todo el CRON...}}
  → Apps Script: Código.gs registra → doPost_router → routeAction → cron_guardar
  → cron_guardar serializa y guarda en PropertiesService
  → respuesta: {ok:true, bytes:N} (con mode:"no-cors", no se puede leer la respuesta)
```

### Protección crítica anti-pérdida de datos
La variable `_sesionSincronizada` en el frontend es el guardián principal:
- Empieza en `false` al cargar
- Solo cambia a `true` cuando el GET inicial completa exitosamente
- Mientras sea `false`, **ningún cambio se envía a Sheets**
- Esto evita que el localStorage con datos viejos sobreescriba datos nuevos en Sheets

---

## 5. Usuarios y roles

| Usuario | Email | Rol | PIN |
|---|---|---|---|
| Juan Manuel Guevara | ceo@mosscolombia.com.co | ceo | 1984 |
| Sandra Cristiano | coordinacion@mosscolombia.com.co | coordinacion | 2026 |
| Luis (Contabilidad) | operaciones@mosscolombia.com.co | coordinacion | 3311 |
| Ana Maria | diseno@mosscolombia.com.co | diseno | 4455 |
| Lizeth Figueroa | care@mosscolombia.com.co | comercial | 7890 |
| Brian Simijaca | proyectos@mosscolombia.com.co | residente | 8800 |

### Permisos por rol
- **ceo / coordinacion:** acceso total — ver precios, editar obras, generar planillas, gestionar materiales
- **diseno:** solo diseño y notas
- **comercial:** solo información comercial
- **residente:** todo operativo — pedir materiales, marcar checklist, subir videos

---

## 6. Módulo de materiales — flujo operativo MOSS

### Proveedores fijos
1. M Sierra — materiales generales
2. Corona — enchapes
3. ADL — drywall, omegas, viguetas, ángulos, cintas
4. La Roca — instalaciones hidrosanitarias
5. Ultrapinturas — pintura
6. Cobelec — eléctricos
7. Ferretería cercana — arena, yeso, cemento, menudencias
8. Proveedor directo — otros
9. Bodega MOSS — materiales internos

### Estados de un material en una obra
```
pendiente → solicitado → en_bodega / en_camino → en_obra
```
- **pendiente:** identificado, sin pedir
- **solicitado:** Brian o residente lo pidió, Sandra debe gestionarlo
- **en_bodega:** está en bodega MOSS, listo para despachar
- **en_camino:** se generó planilla de despacho, conductor lo lleva
- **en_obra:** maestro confirmó recepción

### Días de despacho
El conductor de MOSS trabaja **martes y jueves**. La planilla de despacho agrupa materiales por proveedor y muestra el día del viaje.

---

## 7. Cronograma — 11 capítulos MOSS

| Cap | Nombre | Días hábiles estándar |
|---|---|---|
| 1 | Diseño | 8 días antes de obra |
| 2 | Redes eléctricas e hidrosanitarias | 5 |
| 3 | Obra blanca | 7 |
| 4 | Pisos y enchapes | 6 |
| 5 | Instalación de carpintería | 6 |
| 6 | Remates y acabados | 7 |
| 7 | Instalaciones | 5 |
| 8 | Electrodomésticos empotrados | 2 |
| 9 | Aseo general | 2 |
| 10 | Pre-entrega | 5 días antes de entrega (automático) |
| 11 | Entrega final | Día de entrega al cliente |

**Total: 45 días hábiles** (lunes a viernes = 1 día, sábados = 0.5 día). Los festivos de Colombia 2024-2027 están hardcodeados.

---

## 8. URLs y IDs críticos

```
Dashboard:     https://juanmanuel-lgtm.github.io/moss-obracontrol/
Repositorio:   https://github.com/juanmanuel-lgtm/moss-obracontrol
Script URL:    https://script.google.com/macros/s/AKfycbyV1vK-Aw0kyAekawzvoB--JSBhl5ksbaNqSxuNorNQtyf00de5z43lSGvhFc0H-6cUKw/exec
Sheet ID:      1UI-UcKt09yjL_wzV07Zf62q5jrO8quTvatjHoevVE7I
```

**⚠️ La Script URL NO cambia al crear nuevas versiones.** Al reimplementar, siempre usar "Editar versión existente → Nueva versión", nunca crear una implementación nueva.

---

## 9. Cómo subir cambios sin perder datos

Esta es la causa número 1 de pérdida de datos. Seguir este procedimiento **siempre**:

### Antes de subir
1. Verificar que el dashboard muestra datos correctos (Sync OK en el badge)
2. Ir a Logística → General → Backups locales → confirmar que hay un backup reciente
3. Anotar cuántos proyectos y materiales hay (para verificar después)

### Al subir
1. Descargar `index.html` desde `https://raw.githubusercontent.com/juanmanuel-lgtm/moss-obracontrol/main/index.html`
2. Editar el archivo localmente
3. Abrir GitHub → editar el archivo → pegar el contenido nuevo → Commit
4. Esperar 2-3 minutos para que GitHub Pages se actualice

### Después de subir
1. Abrir el dashboard en una pestaña nueva
2. Esperar a que el badge diga **"Sync OK"** (no "Cargando datos...")
3. Verificar que el número de proyectos coincide con el de antes
4. Si algo falta: Logística → General → Backups locales → Restaurar el backup más reciente

### Por qué se pierden datos (explicación técnica)
Cuando se sube un `index.html` nuevo, el navegador carga la página con el `localStorage` del navegador anterior (que puede tener datos más viejos). Si el dashboard guardara en Sheets inmediatamente, sobreescribiría los datos nuevos con los viejos. 

**La protección `_sesionSincronizada`** evita esto: el dashboard no puede guardar nada en Sheets hasta que primero haya leído de Sheets exitosamente en esa sesión.

---

## 10. Cómo reimplementar el Apps Script

Cuando se modifica código en Apps Script, hay que crear una nueva versión de la implementación existente:

1. Apps Script → Implementar → Administrar implementaciones
2. Clic en el **lápiz** (editar) de la implementación activa ("Sin título" con el ID que termina en `...6cUKw`)
3. En "Versión" seleccionar **"Nueva versión"**
4. Agregar descripción: `v2026.X - descripción del cambio`
5. Clic en **Implementar**

**Nunca** crear una implementación nueva — eso genera una URL diferente y el dashboard dejaría de funcionar.

---

## 11. Qué NO hacer

- ❌ No crear una nueva implementación del Apps Script (cambia la URL)
- ❌ No borrar ni vaciar PropertiesService sin un backup confirmado
- ❌ No subir un `index.html` sin esperar a que `_sesionSincronizada` sea true antes de hacer cambios
- ❌ No usar JSONBin (fue abandonado en v27 por pérdida de datos silenciosa)
- ❌ No usar `localStorage` como fuente de verdad — es solo caché
- ❌ No modificar `Código.gs` para que procese datos directamente — solo debe registrar y delegar
- ❌ No cambiar el SHEET_ID sin actualizar tanto `Código.gs` como `01_router.gs`

---

## 12. Historial de versiones principales

| Versión | Fecha | Cambio principal |
|---|---|---|
| v1-v10 | Feb 2026 | Diseño inicial, JSONBin como BD |
| v11-v20 | Mar 2026 | Migración a Sheets, módulo de materiales |
| v21-v28 | Abr 2026 | JSONBin abandonado, migración a PropertiesService |
| v29 | May 2026 | Fix race condition polling, POLL 5 minutos |
| v30 | Jun 2026 | Fix `_sesionSincronizada`, proveedores fijos, planilla agrupada por proveedor |

---

*Última actualización: 5 de junio de 2026*  
*Generado por Claude (Anthropic) para MOSS Arquitectura y Mobiliario S.A.S.*
