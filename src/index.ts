// =============================================================================
// IMPORTS Y CONFIGURACIÓN INICIAL
// =============================================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Servicios y utilidades locales
import { getSupabaseClient } from "./lib/supabase";
import { binanceService, BinanceCredentials } from "./services/servicioBinance";
import { decrypt } from "./lib/encriptacion";

// Rutas
import binanceRoutes from './routes/binance';

// Configuración de variables de entorno
dotenv.config();

// =============================================================================
// CONFIGURACIÓN DE LA APLICACIÓN EXPRESS
// =============================================================================

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// =============================================================================
// MIDDLEWARES
// =============================================================================

// CORS configurado para producción/desarrollo
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept']
}));

// Parseo de JSON con límite de tamaño
app.use(express.json({ limit: '10mb' }));

// Registrar rutas de Binance
app.use('/api/binance', binanceRoutes);

// =============================================================================
// MIDDLEWARE DE LOGGING (solo en desarrollo)
// =============================================================================

if (!isProduction) {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// =============================================================================
// MIDDLEWARE DE MANEJO DE ERRORES GLOBAL
// =============================================================================

app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error no manejado:', error);
  res.status(500).json({ 
    error: "Error interno del servidor",
    ...(isProduction ? {} : { details: error.message })
  });
});

// =============================================================================
// ENDPOINTS DE LA API
// =============================================================================

/**
 * @route GET /
 * @description Endpoint de salud/verificación del servidor
 * @access Público
 */
app.get("/", (req, res) => {
  res.json({ 
    message: "🚀 Backend funcionando correctamente",
    timestamp: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development'
  });
});

/**
 * @route GET /health
 * @description Endpoint de health check para monitorización
 * @access Público
 */
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * @route GET /balance/:userId
 * @description Obtiene el balance total en USD de una cuenta de Binance
 * @param {string} userId - ID del usuario en la base de datos
 * @returns {Object} balance total en USD
 * @access Privado (requiere userId válido)
 */
app.get("/balance/:userId", async (req, res, next) => {
  const userId = req.params.userId;
  
  // Validación básica del parámetro
  if (!userId || userId.trim().length === 0) {
    return res.status(400).json({ error: "El userId es requerido" });
  }

  try {
    const supabase = getSupabaseClient();

    // Buscar conexión activa de Binance para el usuario
    const { data: connection, error } = await supabase
      .from("exchanges")
      .select("*")
      .eq("user_id", userId)
      .eq("exchange", "BINANCE")
      .eq("is_active", true)
      .single();

      if (error) {
        console.error("❌ Error en consulta Supabase:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        return res.status(500).json({ error: "Error al consultar la base de datos" });
      }

    if (!connection) {
      return res.status(404).json({ 
        error: "No se encontró una conexión activa de Binance para este usuario",
        userId 
      });
    }

    // Preparar credenciales desencriptadas
    const credentials: BinanceCredentials = {
      apiKey: decrypt(connection.api_key),
      apiSecret: decrypt(connection.api_secret),
    };

    // Obtener balance total desde Binance
    const totalUSD = await binanceService.getTotalUSDBalance(credentials);

    // Log de auditoría (sin información sensible)
    console.log(`Balance consultado para usuario ${userId}: ${totalUSD} USD`);

    res.json({ 
      totalUSD,
      connected: true,
      exchangesCount: 1,
      currency: "USD",
      lastUpdated: new Date().toISOString()
    });

  } catch (err) {
    console.error(`Error en endpoint /balance/${userId}:`, err);
    next(err); // Pasar al middleware de manejo de errores
  }
});

/**
 * @route GET /debug-cors
 * @description Endpoint para debug de CORS
 * @access Público
 */
app.get("/debug-cors", (req, res) => {
  res.json({
    message: "✅ CORS debug endpoint",
    origin: req.headers.origin,
    allowedOrigins: [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://dportfolio-backend-production.up.railway.app'
    ],
    timestamp: new Date().toISOString()
  });
});

/**
 * @route GET /exchanges/:userId
 * @description Obtiene información de las conexiones de exchange de un usuario
 * @param {string} userId - ID del usuario
 * @access Privado
 */
app.get("/exchanges/:userId", async (req, res, next) => {
  const userId = req.params.userId;

  try {
    const supabase = getSupabaseClient();

    const { data: connections, error } = await supabase
      .from("exchanges")
      .select("exchange, is_active, created_at")
      .eq("user_id", userId);

    if (error) {
      console.error("Error consultando exchanges:", error);
      return res.status(500).json({ error: "Error al consultar exchanges" });
    }

    res.json({ 
      userId,
      exchanges: connections || [],
      count: connections?.length || 0
    });

  } catch (err) {
    console.error(`Error en endpoint /exchanges/${userId}:`, err);
    next(err);
  }
});

// =============================================================================
// MANEJO DE RUTAS NO ENCONTRADAS (404)
// =============================================================================

app.use("*", (req, res) => {
  res.status(404).json({ 
    error: "Endpoint no encontrado",
    path: req.originalUrl,
    method: req.method
  });
});

// =============================================================================
// INICIALIZACIÓN DEL SERVIDOR
// =============================================================================

const server = app.listen(port, () => {
  const address = server.address();
  const host = isProduction ? '0.0.0.0' : 'localhost';
  
  console.log(`
🚀 Servidor iniciado correctamente
📍 Entorno: ${isProduction ? 'PRODUCCIÓN' : 'DESARROLLO'}
🌐 Host: ${host}
📡 Puerto: ${port}
⏰ Iniciado: ${new Date().toISOString()}
  `);
});

process.on('SIGINT', () => {
  console.log('Recibida señal SIGINT, cerrando servidor...');
  server.close(() => {
    console.log('Servidor cerrado correctamente');
    process.exit(0);
  });
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

export default app;

