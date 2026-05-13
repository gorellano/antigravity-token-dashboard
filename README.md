# ⚡ Antigravity Token Dashboard

Monitor visual y CLI para el consumo de cuota de modelos de IA en [Antigravity](https://antigravity.ai).

Obtiene datos **en tiempo real** desde el Language Server local de Antigravity — sin API keys externas, sin accounts adicionales.

---

## ¿Qué muestra?

| Métrica | Descripción |
|---|---|
| **% restante por modelo** | Cuánta cuota te queda en Claude, Gemini, GPT, etc. |
| **Barra de progreso** | Visualización rápida del consumo |
| **Tiempo hasta reset** | Cuándo se restablece cada cuota |
| **AI Credits** | Créditos de prompt disponibles en el plan |
| **Cuenta activa** | Tu email de la sesión |

---

## Requisitos

- **Node.js 18+** — [descargar](https://nodejs.org)
- **Antigravity abierto** — la app debe estar corriendo mientras usás el monitor

Verificá tu versión de Node:
```bash
node --version   # debe ser v18.0.0 o superior
```

---

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/TU_USUARIO/widget_antigravity.git
cd widget_antigravity
```

> No hay `npm install` necesario — **cero dependencias externas**. Todo usa módulos nativos de Node.js.

---

## Modo 1 — Terminal (CLI)

La forma más simple. Abrí una terminal y ejecutá:

```bash
node src/cli.js
```

**Output esperado:**
```
⚡ Antigravity Token Dashboard
  5/12/2026, 3:04:03 PM · tu@email.com

  Model                          Usage                  Remaining  Resets In
─────────────────────────────────────────────────────────────────────────────
  Claude Sonnet 4.6 (Thinking)   ██████████████░░░░        20%      2h 33m
  Claude Opus 4.6 (Thinking)     ██████████████░░░░        20%      2h 33m
  GPT-OSS 120B (Medium)          ██████████████░░░░        20%      2h 33m
  Gemini 3.1 Pro (High)          ░░░░░░░░░░░░░░░░░░       100%      4h 57m
  Gemini 3.1 Pro (Low)           ░░░░░░░░░░░░░░░░░░       100%      4h 57m
  Gemini 3 Flash                 ░░░░░░░░░░░░░░░░░░       100%      2h 38m
─────────────────────────────────────────────────────────────────────────────
  AI Credits (prompt)            ██████████████████         1%   500 / 50,000
```

### Opciones del CLI

| Comando | Descripción |
|---|---|
| `node src/cli.js` | Consulta una vez y muestra la tabla |
| `node src/cli.js --watch` | Auto-refresh cada 30 segundos |
| `node src/cli.js --json` | Output en JSON crudo (para pipes/scripts) |

### Atajos con npm

```bash
npm run cli           # equivalente a: node src/cli.js
```

---

## Modo 2 — Dashboard Web

Interfaz visual con gauges, barras de progreso y predicción de agotamiento.

### Iniciar el servidor

```bash
node bridge.js
```

Luego abrí en tu browser:

```
http://localhost:4000
```

**Lo que vas a ver:**
- Cards por modelo con gauge circular de consumo
- Código de colores: 🟢 Saludable / 🟡 Advertencia / 🔴 Crítico
- Tiempo exacto hasta el reset de cada modelo
- Badge "Live · tu@email.com" cuando los datos son reales

### Con npm

```bash
npm run web    # equivalente a: node bridge.js
```

### ¿Qué hace el bridge?

1. Al iniciar, encuentra automáticamente el Language Server de Antigravity
2. Consulta la cuota vía Connect RPC (protocolo interno de Antigravity)
3. Sirve el dashboard en `http://localhost:4000`
4. Refresca los datos cada 30 segundos

**API endpoints disponibles:**
- `GET /api/quota` — datos de cuota en JSON
- `GET /api/status` — estado del bridge (último poll, errores)

---

## Cómo funcionan los datos

```
Antigravity (app)
   └─ Language Server (proceso local en background)
         └─ Listen en puerto dinámico (ej: 51062)
               └─ Connect RPC: /exa.language_server_pb.LanguageServerService/GetUserStatus
                     └─ Devuelve: quotaInfo.remainingFraction por modelo
```

El monitor:
1. Usa `ps aux` para encontrar el proceso del Language Server
2. Usa `lsof` para detectar los puertos en escucha
3. Prueba los puertos con Connect RPC para encontrar el endpoint activo
4. Llama a `GetUserStatus` y parsea los datos de cuota

**No se necesitan credenciales externas** — se reutiliza la sesión autenticada de Antigravity.

---

## Troubleshooting

### "Antigravity not found. Is the app open?"

Asegurate de que:
1. La app Antigravity esté abierta
2. Estés logueado en Antigravity
3. Hayas esperado a que la app cargue completamente (puede tardar 10-20s)

Verificá si el proceso existe:
```bash
ps aux | grep -i antigravity | grep -v grep
```

### "No Connect RPC endpoint found on any port"

El Language Server está corriendo pero el endpoint no responde. Probá:
```bash
# Encontrar el PID manualmente
ps aux | grep language-server

# Ver los puertos que está usando
lsof -nP -iTCP -sTCP:LISTEN -a -p <PID>
```

### El dashboard muestra datos mock (badge "Mock data")

El bridge no está corriendo o hubo un error al conectarse. Verificá la terminal donde corriste `node bridge.js` para ver el mensaje de error.

### Puerto 4000 ya en uso

```bash
# Matar el proceso en el puerto 4000
lsof -ti:4000 | xargs kill -9
```

O cambiar el puerto en `bridge.js`:
```js
const PORT = 4001; // cambiar esta línea
```

---

## Estructura del proyecto

```
widget_antigravity/
├── src/
│   ├── fetcher.js      # Detección del Language Server + llamadas al API
│   └── cli.js          # Interfaz de terminal
├── index.html          # Dashboard web (UI)
├── styles.css          # Estilos con glassmorphism
├── app.js              # Lógica del dashboard
├── bridge.js           # Servidor HTTP + polling
├── package.json        # Metadata del proyecto
└── README.md           # Este archivo
```

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| **CLI** | Node.js nativo, ANSI colors |
| **Dashboard** | HTML/CSS/JavaScript vanilla |
| **Charts** | Chart.js (doughnut gauges) |
| **Bridge server** | Node.js `http` module nativo |
| **Data source** | Antigravity Language Server (Connect RPC) |
| **Dependencias** | **Ninguna** — cero `npm install` |

---

## Datos que devuelve la API

```json
{
  "_email": "tu@email.com",
  "_timestamp": "2026-05-12T18:00:00.000Z",
  "models": [
    {
      "name":              "Claude Sonnet 4.6 (Thinking)",
      "remainingFraction": 0.20,
      "resetTimestamp":    "2026-05-12T20:37:51Z"
    }
  ],
  "promptCredits": {
    "available": 500,
    "monthly":   50000
  }
}
```
