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

