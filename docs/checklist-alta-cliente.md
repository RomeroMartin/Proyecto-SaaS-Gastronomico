# Checklist de alta de un cliente nuevo

Pasos para poner en marcha **cualquier** cliente (el primero fue Green Garden).
Marcá cada casilla a medida que avanzás. Los pasos con 🛠 los hace el dueño del
producto (vos) desde el **SQL Editor de Supabase**; los demás se hacen desde la app.

> Antes de empezar, juntá del cliente: nombre del negocio, email del dueño, rubro,
> condición fiscal (monotributo / responsable inscripto / exento), horario de
> atención, medios de pago que acepta, alias de cobro, WhatsApp de cocina (si lo usa),
> ancho del papel de la impresora (58 u 80 mm), la carta y la lista de insumos y proveedores
> que ya maneja (Excel, planilla o papel).

---

## 0. Datos a pedir al cliente

- [ ] Nombre del negocio y CUIT (opcional)
- [ ] Email del dueño (será el ADMIN) y de cada persona que va a usar la app, con su rol
- [ ] Condición fiscal del negocio
- [ ] Horario y **hora de corte del día** (a qué hora "termina" el día de negocio; por defecto 06:00)
- [ ] Medios de pago que acepta (efectivo, transferencia, tarjeta, QR, otro)
- [ ] Alias de cobro y, si usa, WhatsApp de cocina
- [ ] Impresora de comandas: marca/modelo, ancho de papel y si corta solo
- [ ] Módulos que contrata (admin, costos, carta, rrhh, ventas, reparto)
- [ ] Carta actual con precios; lista de insumos y proveedores; gastos fijos del mes; empleados y sueldos (si usa RRHH)

---

## 1. Crear la empresa y el ADMIN 🛠

1. En Supabase → **Authentication → Users → Add user**: email y contraseña del dueño
   (con "Auto Confirm User" tildado).
2. En el **SQL Editor** correr `supabase/bootstrap.sql` cambiando los dos valores marcados
   (`v_email` y `v_empresa_nombre`). Es seguro correrlo una sola vez: si el usuario ya tiene
   empresa, avisa y no hace nada.
3. Entrar a la app con ese usuario y comprobar que aparece el nombre de la empresa.

- [ ] Usuario creado en Authentication
- [ ] `bootstrap.sql` ejecutado
- [ ] El dueño entra a la app

## 2. Parámetros de la empresa

**Desde el SQL Editor** (los define el dueño del producto; el cliente no los cambia solo):

```sql
-- Zona horaria y condición fiscal (también se pueden cambiar desde la app, siendo ADMIN)
update empresas set zona_horaria = 'America/Argentina/Buenos_Aires',
                    condicion_fiscal = 'monotributo'        -- o 'responsable_inscripto' / 'exento'
 where nombre = 'NOMBRE DEL CLIENTE';
```

**Desde la app** (ADMIN → Ventas → Configuración): nombre en el ticket, medios de pago habilitados,
alias de cobro, WhatsApp de cocina, hora de corte del día, modo de comanda, ancho del ticket (58/80),
plantilla de la comanda.

- [ ] Zona horaria y condición fiscal
- [ ] Hora de corte del día
- [ ] Medios de pago, alias y WhatsApp
- [ ] Ancho del ticket y modo de comanda

## 3. Activar los módulos 🛠

```sql
update empresas
   set modulos = '{admin,costos,carta,rrhh,ventas,reparto}'   -- dejar solo los contratados
 where nombre = 'NOMBRE DEL CLIENTE';
```

Dependencias (la base las valida): `ventas` requiere `carta` y `admin`; `reparto` requiere `admin`.

- [ ] Módulos activados y verificados en el menú

## 4. Cargar los datos maestros

Orden recomendado (cada paso usa el anterior):

1. **Proveedores** (nombre, CUIT, condición fiscal, rubros, contacto).
2. **Insumos**: rubro, unidad de uso (g / ml / un), presentación y precio de compra, IVA.
   Usar nombres con la presentación ("Aperol 750cc", "Harina 0000 x 25kg").
3. **Recetas**: primero las **preparaciones** (almíbares, salsas, masas…), después los **platos**.
   Los platos llevan precio de carta, sector y categoría de venta.
4. **Carta de venta**: marcar `vende_en_mostrador` en los platos que se venden por caja;
   cargar los **adicionales** si hay.
5. **Gastos fijos** (alquiler, servicios, etc.). **Sin sueldos** si usa RRHH.

Cómo cargar:
- Pocos datos: desde la app, pantalla por pantalla.
- Muchos datos: con el **importador de Excel** (cuando esté disponible) o con un script SQL de
  carga inicial (como el de Green Garden), siempre idempotente y probado antes en una base local.

- [ ] Proveedores
- [ ] Insumos (con costos revisados: ningún costo en cero ni 10 veces más caro)
- [ ] Preparaciones y platos (costo y food cost razonables)
- [ ] Carta de venta lista para el mostrador
- [ ] Gastos fijos

## 5. RRHH (solo si lo contrató)

- [ ] Activar RRHH (RRHH → Configuración)
- [ ] Cargar empleados con sueldo vigente, **fecha de ingreso**, fecha de alta (si corresponde), modalidad y horas estimadas si cobran por hora
- [ ] Definir con el dueño o su contador el **% de cargas sociales**

## 6. Usuarios y roles

1. Crear cada cuenta en Authentication → Users (email + contraseña).
2. Vincularla a la empresa desde la app (Configuración → Usuarios) o con SQL:

```sql
-- ejecutado como ADMIN de la empresa (desde la app); roles: ADMIN, GERENTE, COCINA, AUDITOR, CAJERO
select vincular_usuario('cajero@cliente.com', 'CAJERO', 'Nombre del cajero');
```

| Rol | Qué ve / hace |
|---|---|
| ADMIN | Todo, incluida la configuración y los usuarios |
| GERENTE | Operación, reportes y cierres |
| CAJERO | Mostrador y su turno abierto |
| COCINA | Recetas y producción |
| AUDITOR | Solo lectura |

- [ ] Cuentas creadas y vinculadas
- [ ] Cada usuario probó entrar con su rol

## 7. Impresora de comandas

- [ ] Imprimir el **ticket de prueba** (Ventas → Configuración) en la impresora del local
- [ ] Ajustar **Formato** (Imagen o Texto), **Papel**, **Relleno del final** y **Espacio en blanco al final** hasta que salga completo y llegue a la cuchilla
- [ ] Si el driver es "Generic / Text Only": usar formato **Texto** (sale con la letra interna de la impresora, sin símbolos raros)
- [ ] Anotar la configuración que funcionó (es **por equipo**, se guarda en ese navegador)

## 8. Limpieza de pruebas 🛠

Antes de operar con plata real, borrar las ventas, cierres y auditoría de prueba. Usar un script
que borre **solo ese cliente**, con modo de prueba (primero solo cuenta lo que borraría) y
confirmación explícita; el que se usó en Green Garden sirve de modelo.

- [ ] Ventas, turnos, movimientos de cierre y auditoría de prueba borrados
- [ ] Se conservan: insumos, recetas, usuarios, movimientos de caja manuales y facturas

## 9. Una semana en paralelo con el sistema anterior

Cada noche comparar el **cierre de caja** de la app con el del sistema anterior.

| Día | Diferencia | ¿Dentro de la tolerancia? |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |

**Criterio de salida:** 7 cierres seguidos con diferencia menor o igual a la tolerancia
que defina el dueño.

- [ ] Tolerancia acordada con el dueño: $ ______
- [ ] 7 cierres seguidos dentro de la tolerancia

## 10. Capacitación del cajero

Práctica de 20–30 minutos con el cajero:

- [ ] Abrir caja (fondo inicial)
- [ ] Armar un pedido, cobrar (varios medios de pago) y reimprimir la comanda
- [ ] Anular un pedido (con motivo)
- [ ] Cerrar el turno: contar el efectivo y leer la diferencia
- [ ] Qué hacer **sin conexión**: tener a mano una hoja de papel para anotar pedidos y cargarlos después
- [ ] Entregar la hoja de contingencia

## 11. Criterio para dar al cliente "en producción"

- [ ] Fase 0 cerrada y verde en CI
- [ ] Datos maestros revisados (costos coherentes, carta completa)
- [ ] Impresión probada en el equipo real
- [ ] Datos de prueba borrados
- [ ] Semana en paralelo completa
- [ ] El dueño sabe leer el cierre de caja y el tablero
- [ ] **Backups**: definido el plan (ver nota abajo)

---

### Nota sobre backups (mientras no haya un plan pago)

El plan gratuito de Supabase **no garantiza backups** de ventas y sueldos. Mientras no haya
clientes que justifiquen el plan pago:

- Hacer una **exportación manual periódica** (por ejemplo semanal): desde la app, exportar a Excel
  los listados clave (insumos, recetas, ventas, caja), y/o desde Supabase correr un `pg_dump` o
  descargar las tablas desde Table Editor.
- Guardar el scripts SQL de carga inicial de cada cliente (permiten rehacer maestros).
- **Antes del primer cliente que opere con plata real**, pasar a un plan con backups automáticos
  y probar un restore.
