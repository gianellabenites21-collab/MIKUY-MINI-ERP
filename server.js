require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Mikuy Mini-ERP",
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

app.post("/api/interpret-order", async (req, res) => {
  try {
    const { transcript, menu } = req.body || {};
    if (!transcript || typeof transcript !== "string" || transcript.length > 1500) {
      return res.status(400).json({ error: "Envía una transcripción válida (máximo 1500 caracteres)." });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "Falta configurar GEMINI_API_KEY en el archivo .env." });
    }

    const safeMenu = Array.isArray(menu) ? menu.map(p => ({
      nombre: String(p.nombre || "").slice(0, 100),
      categoria: String(p.categoria || "").slice(0, 60),
      precio: Number(p.precio || 0)
    })) : [];

    const prompt = `Eres un asistente que estructura pedidos de un restaurante peruano llamado Mikuy.
Interpreta la transcripción del mesero y devuelve SOLO JSON válido, sin Markdown, con esta forma:
{"items":[{"producto":"nombre exacto del menú o null","cantidad":1,"observacion":""}],"mensaje":"resumen breve","requiere_revision":true}
Reglas:
- Usa exclusivamente productos del menú proporcionado.
- Si no encuentras coincidencia razonable, producto debe ser null. No inventes productos.
- Cantidades deben ser enteros positivos.
- No agregues precios ni ingredientes.
- Si hay ambigüedad, indícalo en mensaje y deja requiere_revision=true.
MENÚ DISPONIBLE:
${JSON.stringify(safeMenu)}
TRANSCRIPCIÓN:
${transcript}`;

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "No se pudo consultar Gemini." });
    }
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    let parsed;
    try { parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, "").trim()); }
    catch { return res.status(502).json({ error: "La IA devolvió una respuesta que no se pudo interpretar.", raw }); }

    if (!Array.isArray(parsed.items)) parsed.items = [];
    parsed.items = parsed.items.map(i => ({
      producto: typeof i.producto === "string" ? i.producto : null,
      cantidad: Math.max(1, Math.floor(Number(i.cantidad) || 1)),
      observacion: String(i.observacion || "")
    }));
    res.json(parsed);
  } catch (error) {
    console.error("Gemini:", error);
    res.status(500).json({ error: "Error interno al interpretar el pedido." });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Mikuy Mini-ERP: http://localhost:${PORT}`));
