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

## Backup en GitHub (opcional, recomendado)

Así no perdés los datos si cambiás o perdés el celu.

1. Entrá a https://github.com/settings/tokens/new (token "classic").
2. Nombre: `mis-gastos`. Vencimiento: el que quieras. Tildá **solo** el permiso `gist`.
3. Generá el token, copialo y pegalo en la app en **Ajustes → Backup en GitHub → Conectar**.
4. La app crea un Gist secreto con tus datos y lo actualiza sola cada vez que cargás algo.
   Para usarla en otro dispositivo, pegá el mismo token y el **ID del Gist** que aparece en Ajustes.

El token queda guardado solo en tu celu. No lo compartas con nadie.

## Actualizar la app

Si cambiás algún archivo, subilo de nuevo al repo y en `sw.js` cambiá `gastos-v1` por
`gastos-v2` (y así) para que el celu tome la versión nueva.
