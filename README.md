# MIKUY — Mini-ERP para restaurante criollo

Proyecto académico para la asignatura **Sistemas de Información**. Incluye mapa de 16 mesas, gestión de pedidos, control de ingredientes mediante recetas y registro de pedidos por voz con Gemini.

## 1. Requisitos

- Node.js 18 o superior.
- Cuenta de Supabase.
- API key de Google AI Studio (Gemini) para la función de voz.
- Navegador actualizado. El reconocimiento de voz funciona mejor en Chrome/Edge y requiere conexión segura o `localhost`.

## 2. Instalación

1. Descomprime el proyecto.
2. Abre la carpeta `MIKUY-MINI-ERP` en Visual Studio Code.
3. Abre una terminal dentro de esa carpeta.
4. Ejecuta:

```bash
npm install
```

5. Copia `.env.example` y crea un archivo `.env`. Completa `GEMINI_API_KEY` y `GEMINI_MODEL`. `SUPABASE_URL` y `SUPABASE_ANON_KEY` son opcionales en `.env` (el frontend los lee desde `public/config.json`). **No compartas ni subas `.env` a GitHub.**
6. En `public/`, copia `config.json.example` como `config.json` y completa:
   - `SUPABASE_URL`: URL del proyecto Supabase.
   - `SUPABASE_ANON_KEY`: clave pública anon/publishable del proyecto.
7. En Supabase, abre **SQL Editor**, pega el contenido de `database/schema.sql` y ejecuta el script.
8. Ejecuta el proyecto:

```bash
npm start
```

9. Abre `http://localhost:3000`.

## 3. Primer acceso

1. En la pantalla de Mikuy, escribe un correo y una contraseña de al menos 6 caracteres.
2. Pulsa **Crear cuenta de acceso**.
3. Si Supabase tiene confirmación de correo habilitada, confirma el correo.
4. En Supabase > Table Editor > `usuarios`, identifica tu usuario y cambia `rol` a `administrador`. También puedes ejecutar el UPDATE comentado al final de `database/schema.sql`.
5. Inicia sesión.

El sistema crea automáticamente un perfil con rol `mesero` para cada usuario nuevo. El rol se muestra en la interfaz; la versión académica inicial aplica RLS para usuarios autenticados, pero todavía no implementa permisos diferenciados por rol. Para producción, deben añadirse políticas RLS por rol y controles de autorización en el backend.

## 4. Cómo probar las cuatro funcionalidades

### A. Mapa de mesas
- Entra a **Mapa de mesas**.
- Se muestran 16 mesas.
- Una mesa libre permite registrar un pedido.
- Al registrar el pedido, la mesa pasa a ocupada.
- Al entregar/cerrar el pedido, vuelve a disponible.

### B. Gestión de pedidos
- Pulsa **Nuevo pedido**.
- Selecciona mesa, productos y cantidades.
- Registra el pedido.
- En Pedidos, cambia el estado: Pendiente → En preparación → Preparado → Entregado.
- El total incluye IGV referencial del 18%.

### C. Control de ingredientes
- El SQL inicial crea ingredientes, existencias y algunas recetas demostrativas.
- Al marcar como preparado un pedido con productos que tienen receta, el sistema descuenta los insumos.
- Los productos sin receta no descuentan ingredientes.
- Usa **Ingresar stock** para registrar compras o reposiciones.
- El sistema muestra alertas cuando el stock llega al mínimo.

**Importante:** las cantidades de las recetas precargadas son datos de demostración. Deben validarse y ajustarse con recetas reales del restaurante antes de usar el sistema para operaciones reales.

### D. Pedidos por voz e IA
- Abre **Pedido por voz**.
- Permite al navegador usar el micrófono.
- Dicta, por ejemplo: “Dos lomo saltado y una limonada”.
- También puedes escribir el texto manualmente.
- Pulsa **Interpretar con IA**.
- Revisa los productos y cantidades detectados.
- Selecciona una mesa y confirma el pedido.

La transcripción se realiza en el navegador con Web Speech API. Gemini interpreta el texto en el servidor. La IA no guarda pedidos: el usuario siempre debe confirmar.

## 5. Arquitectura

- **Frontend:** HTML, CSS y JavaScript.
- **Backend:** Node.js + Express.
- **Base de datos y autenticación:** Supabase / PostgreSQL.
- **IA:** Gemini API, llamada desde el backend.
- **Speech to Text:** Web Speech API del navegador.

## 6. Estructura

```text
MIKUY-MINI-ERP/
├── public/
│   ├── index.html
│   ├── config.json.example
│   ├── css/style.css
│   └── js/app.js
├── server/
├── database/schema.sql
├── .env.example
├── .gitignore
├── package.json
└── server.js
```

## 7. Consideraciones y límites de esta versión

- Es un MVP académico funcional que requiere configurar las credenciales propias.
- `public/config.json` contiene únicamente URL y clave pública de Supabase. Nunca pongas ahí la service role key ni la API key de Gemini.
- No se requiere una clave service role en esta versión. No la expongas ni la coloques en archivos públicos.
- El sistema utiliza una tasa de IGV referencial del 18% para fines académicos. Los comprobantes generados no son comprobantes electrónicos SUNAT.
- Las ventas del dashboard representan el total de pedidos registrados en la fecha, no necesariamente pagos cobrados.
- La preparación descuenta inventario en una transacción PostgreSQL y evita descontar dos veces el mismo pedido.
- El menú y las recetas iniciales son datos ficticios de demostración.
- Para un despliegue real deben completarse autorización por roles, auditoría, pagos, manejo de anulaciones/devoluciones, cierre de caja, respaldos y validación de seguridad.

## 8. Solución de problemas

- **No aparece el login conectado:** revisa `public/config.json` y que la URL y anon key correspondan al mismo proyecto.
- **No permite registrarse:** revisa Authentication > Providers > Email y la confirmación de correo en Supabase.
- **No carga el menú o las mesas:** ejecuta `database/schema.sql` y verifica que la sesión esté autenticada.
- **Gemini no responde:** revisa `GEMINI_API_KEY`, `GEMINI_MODEL` y la consola de la terminal. Puedes probar `/api/health`.
- **No funciona el micrófono:** usa Chrome o Edge en `localhost`, concede permiso de micrófono o escribe el pedido manualmente.
- **Stock insuficiente:** ingresa stock o corrige las recetas y cantidades de demostración.

---
**MIKUY · Mini-ERP Empresarial · Proyecto académico**
