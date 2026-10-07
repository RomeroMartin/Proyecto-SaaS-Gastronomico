# Módulo RRHH — guía de instalación y uso

Módulo de **Recursos Humanos** para el SaaS: alta de empleados, legajo con datos
sensibles, historial de sueldos, ausencias (vacaciones/enfermedad/franco/
licencias), documentación con control de vencimientos y saldo de vacaciones.

> **No liquida sueldos.** No genera recibos ni calcula cargas sociales; llega
> hasta el reporte de datos. La liquidación la hace el contador con sus
> herramientas. Los cálculos de vacaciones son **orientativos y editables**.

Este módulo **se agrega** al SaaS existente sin modificar nada de lo ya hecho:
reutiliza el cliente Supabase, la tabla `empresas`, la tabla `usuarios`, los
helpers `mi_empresa()` / `mi_rol()` y la convención de dinero en centavos.

---

## Roles

Se mapean sobre los roles ya existentes en `usuarios`:

| RRHH | Rol del SaaS | Puede |
|---|---|---|
| Dueño | `ADMIN` | Todo, incluido **legajo** y **sueldos** (datos sensibles). |
| Encargado | `GERENTE` | Empleados, ausencias y documentos. **No** ve legajo ni sueldos. |
| — | `COCINA` / `AUDITOR` | **Sin acceso** al módulo (la RLS les devuelve cero filas). |

El ocultamiento en la UI es cosmético; la barrera real es la **RLS**.

---

## Instalación (una vez por proyecto)

1. **SQL Editor de Supabase** → ejecutar `supabase/rrhh.sql` **después** de
   `schema.sql` y `functions.sql` (necesita las tablas `empresas`/`usuarios` y
   los helpers `mi_empresa()`/`mi_rol()`). El script es idempotente.
   - Crea las 7 tablas, activa RLS, crea las vistas (`security_invoker`), la
     función de vacaciones, la función de seed y la política de Storage.
   - Crea el bucket **privado** `rrhh-docs` automáticamente.
2. **Activar el módulo por empresa:** entrar como `ADMIN` a
   **Recursos Humanos → Configuración** y tocar **"Activar módulo"**. Eso
   siembra los tipos de documento sugeridos (libreta sanitaria, curso de
   manipulación, etc.) y los tramos de vacaciones de la LCT. Se pueden editar
   después. (Equivale a llamar a la RPC `seed_rrhh_empresa()`.)

No hace falta tocar `js/config/supabase.js`: usa el mismo cliente.

---

## Cómo funciona

- **Empleados** — lista con búsqueda, filtro por puesto y por estado
  (activos/inactivos/todos), badge de semáforo por documentación y alta/edición.
- **Ficha** — pestañas:
  - *Datos* (ambos roles): nombre, puesto, **fecha de ingreso** (cuándo empezó a trabajar; base de antigüedad y vacaciones), **fecha de alta** (cuándo se lo registró formalmente; opcional), teléfono, foto, baja lógica.
  - *Legajo* (solo dueño): DNI, CUIL, domicilio, CBU, obra social, etc.
  - *Sueldo* (solo dueño): sueldo vigente + historial. Un aumento es un
    **registro nuevo**; los históricos no se editan. Montos en centavos.
  - *Ausencias*: saldo de vacaciones (orientativo) + carga de ausencias. Los
    días se precalculan (corridos) pero son editables. El solapamiento lo
    bloquea la base y se muestra un mensaje claro.
  - *Documentos*: carga de archivo (imagen o PDF), autocompletado del
    vencimiento según la vigencia del tipo, y visor por **signed URL** (60s).
- **Vencimientos** — tablero de documentos vencidos y por vencer (30 días),
  agrupado por empleado.
- **Configuración** (solo dueño) — ABM de tipos de documento y tramos de
  vacaciones.

### Compresión de imágenes

Antes de subir, las imágenes se redimensionan al lado mayor de **1200px** y se
exportan como **JPEG 0.7** (una foto de 4 MB baja a decenas/cientos de KB). Los
PDF se suben tal cual. Se rechazan archivos de más de **10 MB**.

---

## Baja lógica

Nunca se borra un empleado: "Dar de baja" setea `estado='inactivo'` +
`fecha_egreso`. La documentación laboral se conserva.

---

## Checklist de seguridad

- [x] RLS activada en las 7 tablas.
- [x] Vistas con `security_invoker = true`.
- [x] Legajo y sueldos: solo `ADMIN`. Con `GERENTE` devuelven vacío.
- [x] Aislamiento por empresa vía `mi_empresa()`.
- [x] Bucket `rrhh-docs` privado; archivos solo por signed URL.
- [x] Sin `DELETE` sobre `empleados` en todo el código.

---

## Compatibilidad hacia adelante

El diseño deja lugar para fases futuras sin migración destructiva:
fichaje (`fichajes(empleado_id, entrada, salida)` colgando de `empleados`),
turnos, y el cruce **horas × sueldo vigente = costo laboral** con el módulo de
costos —por eso el historial de sueldos con vigencia y el tipo `por_hora`.
