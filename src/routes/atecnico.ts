import express from 'express';
import { binanceService } from "../services/servicioBinance.js";

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
    const { credentials, userId="", tradeAmountUSD = 10, intervals = '3m,5m', limit = 50, cooldownMinutes = 5 } = req.body;
    
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

export default router;