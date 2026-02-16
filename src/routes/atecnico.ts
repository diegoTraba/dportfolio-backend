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

export default router;