import express from 'express';
import { binanceService } from "../services/servicioBinance.js";
import { servicioUsuario } from "../services/servicioUsuario.js";
import { decrypt } from "../lib/encriptacion.js";
import {
  BinanceCredentials,
} from "../interfaces/binance.types.js";
import { monitorService } from '../services/servicioMonitoreo.js';

interface Exchange {
  id: number;
  exchange: string;
  api_key: string;
  api_secret: string;
}

const router = express.Router();

// Obtener señales de un símbolo específico
router.get('/signals/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = '1h', limit = 100 } = req.query;
    const signals = await binanceService.getTechnicalSignals(
      symbol,
      interval as string,
      parseInt(limit as string)
    );
    res.json(signals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener señales de todos los símbolos
router.get('/signals', async (req, res) => {
  try {
    const { interval = '1h', limit = 100 } = req.query;
    const allSignals = await binanceService.getAllTechnicalSignals(
      interval as string,
      parseInt(limit as string)
    );
    res.json(allSignals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// NUEVA RUTA: Señales multi-intervalo para un símbolo específico
router.get('/signals-multi/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { intervals = '3m,5m', limit = 50 } = req.query;
    const intervalArray = (intervals as string).split(',').map(s => s.trim());
    const signals = await binanceService.getTechnicalSignalsMulti(
      symbol,
      intervalArray,
      parseInt(limit as string)
    );
    res.json(signals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// NUEVA RUTA: Señales multi-intervalo para todos los símbolos
router.get('/signals-multi', async (req, res) => {
  try {
    const { intervals = '3m,5m', limit = 50 } = req.query;
    const intervalArray = (intervals as string).split(',').map(s => s.trim());
    const allSignals = await binanceService.getAllTechnicalSignalsMulti(
      intervalArray,
      parseInt(limit as string)
    );
    res.json(allSignals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ejecuta órdenes automáticas basadas en señales técnicas
 * Espera un body con:
 * - credentials: { apiKey, apiSecret }
 * - tradeAmountUSD: número (opcional, default 10)
 * - intervals: string (opcional, default "3m,5m")
 * - limit: número (opcional, default 50)
 * - cooldownMinutes: número (opcional, default 5)
 */
router.post('/execute', async (req, res) => {
  try {
    const { userId="", tradeAmountUSD = 10, intervals = '3m,5m', limit = 50, cooldownMinutes = 5 } = req.body;
    
    const exchanges: Exchange[] =
        await servicioUsuario.obtenerExchangesUsuario(userId, {
          exchange: "BINANCE",
          is_active: true,
        });

      // Verificar si hay exchanges
      if (!exchanges || exchanges.length === 0) {
        return res.json({
          totalBalance: 0,
          connected: false,
          exchangesCount: 0,
          message:
            "No se encontraron exchanges de Binance activos para este usuario",
        });
      }

      // Tomar el primer exchange del array
      const exchange = exchanges[0];

      const decryptedApiKey = decrypt(exchange.api_key);
      const decryptedApiSecret = decrypt(exchange.api_secret);

      const credentials: BinanceCredentials = {
        apiKey: decryptedApiKey,
        apiSecret: decryptedApiSecret,
      };


    if (!credentials || !credentials.apiKey || !credentials.apiSecret) {
      return res.status(400).json({ error: 'Credenciales incompletas' });
    }

    const intervalArray = (intervals as string).split(',').map(s => s.trim());
    const result = await binanceService.executeTrades(
      credentials,
      userId,
      Number(tradeAmountUSD),
      intervalArray,
      Number(limit),
      Number(cooldownMinutes)
    );
    
    res.json(result);
  } catch (error: any) {
    console.error('Error en POST /execute:', error);
    res.status(500).json({ error: error.message });
  }
});

// Activar bot para un usuario (con parámetros opcionales)
router.post('/bot/activar', async (req, res) => {
  try {
    const { userId, tradeAmountUSD, intervals, limit, cooldownMinutes } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido' });
    }

    const intervalArray = intervals ? (intervals as string).split(',').map(s => s.trim()) : undefined;

    const activado = monitorService.activarBot(userId, {
      tradeAmountUSD: tradeAmountUSD ? Number(tradeAmountUSD) : undefined,
      intervals: intervalArray,
      limit: limit ? Number(limit) : undefined,
      cooldownMinutes: cooldownMinutes ? Number(cooldownMinutes) : undefined,
    });

    res.json({
      success: activado,
      message: activado ? 'Bot activado correctamente' : 'El bot ya estaba activo'
    });
  } catch (error: any) {
    console.error('Error en /bot/activar:', error);
    res.status(500).json({ error: error.message });
  }
});

// Desactivar bot (solo userId)
router.post('/bot/desactivar', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido' });
    }

    const desactivado = monitorService.desactivarBot(userId);
    res.json({
      success: desactivado,
      message: desactivado ? 'Bot desactivado correctamente' : 'El bot no estaba activo'
    });
  } catch (error: any) {
    console.error('Error en /bot/desactivar:', error);
    res.status(500).json({ error: error.message });
  }
});

// (Opcional) Obtener lista de usuarios activos
router.get('/bot/activos', (req, res) => {
  const activos = monitorService.obtenerUsuariosActivos();
  res.json({ usuarios: activos });
});

export default router;