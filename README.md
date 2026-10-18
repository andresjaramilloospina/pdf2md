# PDF a Markdown

**Úsala aquí:** <https://pdf2md-pi-beige.vercel.app>. Cada cambio que se sube a `main` se publica automáticamente en Vercel.

Web para convertir PDFs a Markdown **dentro del navegador**:

- **Sin tokens ni IA**: usa pdf.js (Mozilla) para leer el texto y Tesseract.js para el OCR.
- **Privada**: los PDFs nunca salen del computador de quien la usa; no hay servidor.
- **Gratis de alojar**: son archivos estáticos (`index.html` + `converter.js`).

## Qué hace

- Detecta títulos (`#`, `##`, …) por el tamaño de letra.
- Une las líneas de un párrafo y repara las palabras cortadas con guion.
- Reconoce listas con viñetas y numeradas.
- Convierte en tablas Markdown las tablas sencillas (columnas alineadas).
- Quita los encabezados, pies y números de página repetidos.
- Aplica OCR (español/inglés y otros idiomas) a las páginas escaneadas.
- Convierte varios archivos a la vez; permite copiar, editar, descargar `.md` o un `.zip` con todo.

Limitaciones: los diseños a varias columnas y las tablas con celdas combinadas pueden necesitar retoques. Las imágenes no se exportan.

## Publicarla en Vercel (gratis)

**Opción A, con GitHub (sin terminal):**
1. Sube esta carpeta a un repositorio nuevo de GitHub.
2. En <https://vercel.com>, pulsa **Add New → Project** e importa ese repositorio.
3. En *Framework Preset* elige **Other**, deja vacío el *build command* y pulsa **Deploy**.

**Opción B, desde la terminal (necesita Node.js):**

```bash
npx vercel deploy --prod
```

Ejecútalo dentro de esta carpeta. La primera vez te pedirá iniciar sesión y confirmar el nombre del proyecto. Al final te da una URL `https://….vercel.app` que funciona en cualquier computador o celular.

**Alternativas igual de gratis:** Netlify Drop (<https://app.netlify.com/drop>: arrastras la carpeta y listo), GitHub Pages o Cloudflare Pages.

## Probarla en tu computador

```bash
python3 -m http.server 8765
```

Luego abre <http://localhost:8765>. Hace falta un servidor porque `converter.js` es un módulo: abrir `index.html` con doble clic no funciona.
