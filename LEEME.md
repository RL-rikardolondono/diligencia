# DiligencIA v2 – versión operativa (SkyNet Genesis)

Carpetas de este paquete (súbalas TAL CUAL a la raíz del repositorio de GitHub `diligencia`):
- `docs/` → la app (GitHub Pages en diligencia.skynetgenesis.com)
- `server/` → el servidor (Render)
- `render.yaml` → configuración automática de Render

## Pasos de publicación (una sola vez)
1. **GitHub**: crear repositorio público `diligencia` → "uploading an existing file" → arrastrar `docs`, `server`, `render.yaml` y `LEEME.md` → Commit.
2. **GitHub Pages**: Settings → Pages → rama `main`, carpeta `/docs` → Save.
3. **Neon**: proyecto nuevo `diligencia` (región Ohio) → copiar la cadena de conexión (Connection string).
4. **Render**: espacio de trabajo nuevo "DiligencIA" → New → Blueprint → repositorio `diligencia` → pegar DATABASE_URL → plan gratuito (Hobby/Free, NO el Pro).
   - Si Render asigna una dirección distinta de `diligencia-api.onrender.com`, cambiarla en `docs/config.js`.
5. **SiteGround** (DNS de skynetgenesis.com): CNAME `diligencia` → `rl-rikardolondono.github.io`. Luego en GitHub Pages: Enforce HTTPS.
6. **Crear el administrador**: abrir `https://diligencia.skynetgenesis.com/#instalar` y usar la clave SETUP_KEY que aparece en Render → Environment.
7. **cron-job.org**:
   - "DiligencIA - despertar servidor": `https://<servicio>.onrender.com/api/ping`, cada 10 min de 6 a. m. a 10 p. m. (`*/10 6-21 * * *`).
   - "DiligencIA - resumen diario": `https://<servicio>.onrender.com/api/cron/resumen?clave=<CRON_KEY>`, lunes a sábado 6:30 a. m.
8. **Brevo** (opcional, correos diarios de alertas): pegar la API key en Render → BREVO_KEY.

## Cómo se venden las cuentas
Entre con el usuario de SkyNet Genesis → "Oficinas cliente" → "+ Nueva oficina". La app genera el acceso del socio administrador para enviarlo por WhatsApp. El socio crea a sus abogados, dependientes, contabilidad y accesos de clientes desde "Usuarios" y desde la ficha de cada cliente.

Soporte: contacto@skynetgenesis.com · WhatsApp 304 437 5758
