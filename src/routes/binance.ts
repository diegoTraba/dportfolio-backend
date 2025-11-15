import express, { Request, Response } from 'express';
import { getSupabaseClient } from '../lib/supabase.js'
import { encrypt, decrypt } from '../lib/encriptacion.js'
import { binanceService, BinanceCredentials } from '../services/servicioBinance.js'

const binanceRouter = express.Router()

// Conexion a binance
binanceRouter.post('/connect', async (req: Request, res: Response) => {
  try {
    console.log('=== CONEXIÓN BINANCE - BACKEND ===');
    
    const { apiKey, apiSecret, userId } = req.body;

    console.log('Datos recibidos:', {
      userId,
      apiKey: apiKey ? `...${apiKey.slice(-4)}` : 'undefined'
    });

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no identificado' });
    }

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key y Secret son requeridos' });
    }

    // Probar conexión con Binance
    const credentials: BinanceCredentials = {
      apiKey: apiKey,
      apiSecret: apiSecret,
    };
    const isValid = await binanceService.testConnection(credentials);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Credenciales de Binance inválidas' });
    }

    // Encriptar credenciales
    const encryptedApiKey = encrypt(apiKey);
    const encryptedApiSecret = encrypt(apiSecret);

    // Guardar en base de datos
    const supabase = getSupabaseClient();
    const { data: exchange, error: exchangeError } = await supabase
      .from('exchanges')
      .upsert({
        user_id: userId,
        exchange: 'BINANCE',
        api_key: encryptedApiKey,
        api_secret: encryptedApiSecret,
        is_active: true,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (exchangeError) {
      console.error('Error saving exchange:', exchangeError);
      return res.status(500).json({ 
        error: 'Error al guardar la conexión en la base de datos' 
      });
    }

    // Obtener balance total
    const totalBalance = await binanceService.getTotalUSDBalance(credentials);

    console.log('=== CONEXIÓN EXITOSA ===');
    return res.json({ 
      success: true, 
      totalBalance,
      message: 'Binance conectado correctamente' 
    });

  } catch (error) {
    console.error('Error en conexión Binance:', error);
    return res.status(500).json({ 
      error: 'Error al conectar con Binance. Verifica tus credenciales.' 
    });
  }
});

//obtener balance de la cuenta
binanceRouter.get('/balance/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Obtener credenciales de Binance del usuario
    const supabase = getSupabaseClient();
    const { data: exchange, error } = await supabase
      .from('exchanges')
      .select('*')
      .eq('user_id', userId)
      .eq('exchange', 'BINANCE')
      .eq('is_active', true)
      .single();

    if (error || !exchange) {
      return res.json({
        totalBalance: 0,
        connected: false,
        exchangesCount: 0
      });
    }

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    // Obtener balance actual
    const credentials: BinanceCredentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };
    const totalBalance = await binanceService.getTotalUSDBalance(credentials);

    // Contar exchanges conectados
    const { data: exchanges, count: exchangesCount } = await supabase
      .from('exchanges')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('is_active', true);

    return res.json({
      totalBalance,
      connected: true,
      exchangesCount: exchangesCount || 0
    });

  } catch (error) {
    console.error('Error obteniendo balance:', error);
    return res.json({
      totalBalance: 0,
      connected: false,
      exchangesCount: 0
    });
  }
});

export default binanceRouter;

