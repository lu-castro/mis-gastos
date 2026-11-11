# Mis Gastos

App para cargar gastos desde el celu, basada en la planilla "GASTOS 2026".
Es 100% gratis: se publica con GitHub Pages y los datos quedan guardados en el celu
(con backup opcional en un Gist secreto de GitHub).

## Qué tiene

- **Gastos**: fecha, motivo (categoría), monto, nota y si es fijo. Muestra cuánto te queda
  después de cada gasto (como la columna "SALARIO FINAL").
- **Resumen del mes**: ingresos, gasto total, cuánto te queda, gasto por día y cuánto
  podés gastar por día hasta fin de mes. También hay una nota del mes.
- **Resumen por categoría** y cuánto quedó cada mes.
- **Ingresos** por fuente (20DEDOS, ALEXDATA, OESTE B…), en pesos o dólares.
- **Ahorro**: cuentas (USD, LEMON, UPWORK…) con el total.
- **Copiar** ingresos y gastos fijos del mes anterior.
- **Exportar** el mes a CSV (se abre en Excel) y backup completo en JSON.
- **Benito, tu estratega** (el búho de abajo a la izquierda): tocalo para chatear con él.
  Preguntale cuánto podés gastar hoy, cuánto gastaste en algo, si te alcanza para una compra,
  en qué se te va la plata, pedile un consejo o decile "gasté 5000 en café" y lo anota.
  No aparece solo: cuando tiene algo para contarte, muestra un puntito rojo.
  Entiende preguntas sobre tus gastos (no es una IA general) y no da consejos de inversión.
- **Informe de fin de mes**: se arma solo cuando termina el mes, con lo que pasó y
  próximos pasos concretos. Los pasos se acumulan en **Resumen → Tu plan de mejora**:
  cada mes se evalúan (✅/❌) y, si cumplís uno dos meses seguidos, pasa a "hábito logrado".
- La meta de ahorro (15% por defecto) y si Benito te habla al abrir se cambian en **Ajustes**.

Todo el análisis lo hace la app en tu dispositivo: no usa servicios pagos ni manda tus datos a nadie.
Son sugerencias para organizar tu presupuesto, no asesoramiento financiero profesional.

## Publicarla gratis en GitHub Pages

1. Entrá a https://github.com/new, poné de nombre `mis-gastos` y creá el repositorio
   (puede ser público; tus gastos NO se suben ahí, quedan en tu celu).
2. En el repo, tocá **Add file → Upload files** y arrastrá todos los archivos de esta carpeta.
   Después **Commit changes**.
3. Andá a **Settings → Pages**. En "Branch" elegí `main` y `/ (root)`, y **Save**.
4. En un minuto la app queda en `https://TU-USUARIO.github.io/mis-gastos/`.

## Instalarla en el celu

- **Android (Chrome)**: abrí el link → menú ⋮ → **Agregar a la pantalla principal** / **Instalar app**.
- **iPhone (Safari)**: abrí el link → botón compartir → **Agregar a inicio**.

## Sincronizar compu y celu (gratis, con GitHub)

Lo que cargues en un dispositivo aparece en el otro, y no perdés nada si cambiás de celu.
Los datos se guardan en un Gist secreto de tu cuenta de GitHub.

Hacé esto **en cada dispositivo** (compu y celu), entrando a GitHub desde ese dispositivo:

1. Entrá a https://github.com/settings/tokens/new (token "classic").
2. Nombre: `mis-gastos compu` (o `mis-gastos celu`). Vencimiento: **No expiration**.
   Tildá **solo** el permiso `gist`.
3. Tocá **Generate token** y copiá el código que empieza con `ghp_`.
4. En la app: **Ajustes → Sincronizar con GitHub**, pegá el token y tocá **Conectar**.

El primer dispositivo crea el backup; el segundo lo encuentra solo y junta los datos de los dos.
Después se sincroniza sola: al cargar algo, al abrir la app y cada minuto mientras está abierta.
Si cargás algo sin internet, se sube cuando vuelve la conexión.

El token queda guardado solo en ese dispositivo. No lo compartas con nadie.

## Actualizar la app

Si cambiás algún archivo, subilo de nuevo al repo y en `sw.js` cambiá `gastos-v1` por
`gastos-v2` (y así) para que el celu tome la versión nueva.
