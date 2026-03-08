# SmartBuy

Extensión de navegador construida con WXT + React + TypeScript para guardar productos mientras navegas, compararlos en una sola vista y recibir una recomendación explicada.

Ahora también incluye un servidor MCP para VS Code, de forma que GitHub Copilot en el editor puede consultar la cesta compartida, listar productos y pedir recomendaciones mientras la extensión sincroniza datos por un bridge local HTTP.

## MVP incluido

- Detección del producto actual desde la página abierta.
- Cesta de comparación local con hasta 5 productos.
- Caché local de páginas saneadas con HTML resumido, metadatos y texto útil para análisis posterior.
- Comparador con tabla normalizada de precio, rating, reviews y atributos.
- Recomendación explicada para:
  - Mejor calidad/precio
  - Más barato
  - Mejor valorado
  - Mejor opción para un presupuesto

## Stack

- WXT
- React
- TypeScript
- Chrome Storage API
- Model Context Protocol (MCP)

## Scripts

- `npm run dev`: desarrollo para Chromium.
- `npm run dev:firefox`: desarrollo para Firefox.
- `npm run build`: build de producción.
- `npm run mcp`: arranca el servidor MCP + bridge local para VS Code.
- `npm run mcp:dev`: arranca el servidor MCP en modo watch.
- `npm run zip`: empaqueta la extensión.
- `npm run typecheck`: chequeo de tipos.

## Integración con VS Code vía MCP

El proyecto incluye la configuración de workspace en [.vscode/mcp.json](.vscode/mcp.json), para que VS Code pueda arrancar el servidor `smartbuy` automáticamente.

### Qué expone el servidor MCP

- `smartbuy_list_products`
- `smartbuy_get_recommendation`
- `smartbuy_save_product`
- `smartbuy_remove_product`
- `smartbuy_clear_basket`
- `smartbuy_list_page_cache`
- `smartbuy_get_page_cache`
- `smartbuy_bridge_status`

### Cómo conectarlo

1. Instala dependencias con `npm install`.
2. Abre este workspace en VS Code.
3. Asegúrate de tener habilitado soporte MCP en VS Code.
4. Abre [.vscode/mcp.json](.vscode/mcp.json) y arranca el servidor `smartbuy` desde la UI de MCP o ejecuta `npm run mcp` manualmente.
5. Abre el popup de la extensión y usa **Sincronizar con VS Code**.
6. Desde el chat de VS Code, ya puedes pedir acciones sobre la cesta de SmartBuy.

### Cómo funciona la conexión

- La extensión sigue guardando datos localmente con `chrome.storage.local`.
- Cuando guardas, eliminas o vacías productos, también intenta sincronizar la cesta contra `http://127.0.0.1:3210`.
- Cuando abres el popup sobre una ficha de producto, SmartBuy también guarda una instantánea saneada de la página y la sincroniza con el bridge local.
- El servidor MCP usa esa misma información para responder herramientas dentro de VS Code.

## Cómo usar

1. Arranca el proyecto con `npm run dev`.
2. Carga la extensión generada en tu navegador.
3. En paralelo, arranca `npm run mcp` si quieres que VS Code se conecte al bridge local.
4. Navega a una ficha de producto.
5. Abre el popup de SmartBuy y guarda el producto detectado.
6. Usa el botón de sincronización si quieres empujar la cesta al servidor MCP inmediatamente.
7. Abre el comparador para revisar la recomendación o consulta la cesta desde VS Code.

## Siguientes iteraciones sugeridas

- Restringir la extracción a 3 tiendas concretas.
- Añadir historial persistente en nube.
- Alertas de precio.
- Integración con afiliación.
- Explicaciones apoyadas por un LLM externo.

## Licencia

Este proyecto se distribuye bajo una licencia personalizada de uso personal.

- Gratis para uso personal, privado, educativo y no comercial.
- Uso comercial prohibido sin permiso previo por escrito del autor.
- Atribución obligatoria a `Ebyn Nerlys` en cualquier uso o redistribución.
- Se permiten obras derivadas, pero también quedan restringidas a uso no comercial.

Consulta el texto completo en [LICENSE](LICENSE).
