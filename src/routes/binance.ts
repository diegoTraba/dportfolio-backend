import express, { Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { encrypt, decrypt } from "../lib/encriptacion.js";
import {
  binanceService,
  BinanceCredentials,
  TradeHistoryParams,
} from "../services/servicioBinance.js";

const binanceRouter = express.Router();

// Conexion a binance
binanceRouter.post("/connect", async (req: Request, res: Response) => {
  try {
    console.log("=== CONEXIÓN BINANCE - BACKEND ===");

    const { apiKey, apiSecret, userId } = req.body;

    console.log("Datos recibidos:", {
      userId,
      apiKey: apiKey ? `...${apiKey.slice(-4)}` : "undefined",
    });

    if (!userId) {
      return res.status(401).json({ error: "Usuario no identificado" });
    }

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "API Key y Secret son requeridos" });
    }

    // Probar conexión con Binance
    const credentials: BinanceCredentials = {
      apiKey: apiKey,
      apiSecret: apiSecret,
    };
    const isValid = await binanceService.testConnection(credentials);

    if (!isValid) {
      return res
        .status(401)
        .json({ error: "Credenciales de Binance inválidas" });
    }

    // Encriptar credenciales
    const encryptedApiKey = encrypt(apiKey);
    const encryptedApiSecret = encrypt(apiSecret);

    // Guardar en base de datos
    const supabase = getSupabaseClient();
    const { data: exchange, error: exchangeError } = await supabase
      .from("exchanges")
      .upsert({
        user_id: userId,
        exchange: "BINANCE",
        api_key: encryptedApiKey,
        api_secret: encryptedApiSecret,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (exchangeError) {
      console.error("Error saving exchange:", exchangeError);
      return res.status(500).json({
        error: "Error al guardar la conexión en la base de datos",
      });
    }

    // Obtener balance total
    const totalBalance = await binanceService.getTotalUSDBalance(credentials);

    console.log("=== CONEXIÓN EXITOSA ===");
    return res.json({
      success: true,
      totalBalance,
      message: "Binance conectado correctamente",
    });
  } catch (error) {
    console.error("Error en conexión Binance:", error);
    return res.status(500).json({
      error: "Error al conectar con Binance. Verifica tus credenciales.",
    });
  }
});

//obtener balance de la cuenta
binanceRouter.get("/balance/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Validación básica del parámetro
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({ error: "El userId es requerido" });
    }

    // Obtener credenciales de Binance del usuario
    const supabase = getSupabaseClient();
    const { data: exchange, error } = await supabase
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
    if (!exchange) {
      return res.json({
        totalBalance: 0,
        connected: false,
        exchangesCount: 0,
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
    const totalUSD = await binanceService.getTotalUSDBalance(credentials);

    // Contar exchanges conectados
    const { data: exchanges, count: exchangesCount } = await supabase
      .from("exchanges")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .eq("is_active", true);

    return res.json({ 
      totalUSD,
      connected: true,
      exchangesCount: exchangesCount,
      currency: "USD",
      lastUpdated: new Date().toISOString()
    });

    
  } catch (error) {
    console.error("Error obteniendo balance:", error);
    return res.json({
      totalUSD: 0,
      connected: false,
      exchangesCount: 0,
    });
  }
});

// Obtener historial de compras del usuario
binanceRouter.get("/trades/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { 
      symbol, 
      startTime, 
      endTime, 
      limit = "100" 
    } = req.query;

    console.log("=== 🛒 OBTENIENDO COMPRAS DEL USUARIO ===");
    console.log("📋 Parámetros recibidos:", {
      userId,
      symbol,
      startTime,
      endTime,
      limit
    });

    // Validación básica del parámetro
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({ error: "El userId es requerido" });
    }

    // Obtener credenciales de Binance del usuario
    const supabase = getSupabaseClient();
    const { data: exchange, error } = await supabase
      .from("exchanges")
      .select("*")
      .eq("user_id", userId)
      .eq("exchange", "BINANCE")
      .eq("is_active", true)
      .single();

    if (error || !exchange) {
      console.error("❌ Error obteniendo exchange:", error);
      return res.status(404).json({ 
        error: "No se encontró conexión activa de Binance para este usuario" 
      });
    }

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials: BinanceCredentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };

    // Preparar parámetros para la consulta
    const tradeParams: TradeHistoryParams = {
      limit: parseInt(limit as string)
    };

    if (symbol) {
      tradeParams.symbol = symbol as string;
    }

    if (startTime) {
      tradeParams.startTime = parseInt(startTime as string);
    }

    if (endTime) {
      tradeParams.endTime = parseInt(endTime as string);
    }

    // Obtener las compras del usuario
    const buyTrades = await binanceService.getUserTrades(credentials, tradeParams);

    // Formatear la respuesta
    const formattedTrades = buyTrades.map(trade => ({
      id: trade.id,
      orderId: trade.orderId,
      symbol: trade.symbol,
      price: parseFloat(trade.price),
      quantity: parseFloat(trade.qty),
      total: parseFloat(trade.quoteQty),
      commission: parseFloat(trade.commission),
      commissionAsset: trade.commissionAsset,
      timestamp: trade.time,
      date: new Date(trade.time).toISOString(),
      isBuyer: trade.isBuyer,
      isMaker: trade.isMaker
    }));

    console.log(`✅ ${formattedTrades.length} compras obtenidas exitosamente`);

    return res.json({
      success: true,
      trades: formattedTrades,
      total: formattedTrades.length,
      query: {
        symbol: symbol || 'all',
        startTime: startTime ? new Date(parseInt(startTime as string)).toISOString() : null,
        endTime: endTime ? new Date(parseInt(endTime as string)).toISOString() : null,
        limit: parseInt(limit as string)
      }
    });

  } catch (error) {
    console.error("❌ Error obteniendo compras del usuario:", error);
    return res.status(500).json({ 
      error: "Error al obtener el historial de compras",
      details: error instanceof Error ? error.message : "Error desconocido"
    });
  }
});

// Obtener símbolos con actividad del usuario
binanceRouter.get("/trade-symbols/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({ error: "El userId es requerido" });
    }

    // Obtener credenciales (misma lógica que el endpoint anterior)
    const supabase = getSupabaseClient();
    const { data: exchange, error } = await supabase
      .from("exchanges")
      .select("*")
      .eq("user_id", userId)
      .eq("exchange", "BINANCE")
      .eq("is_active", true)
      .single();

    if (error || !exchange) {
      return res.status(404).json({ 
        error: "No se encontró conexión activa de Binance para este usuario" 
      });
    }

    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials: BinanceCredentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };

    const symbols = await binanceService.getUserTradeSymbols(credentials);

    return res.json({
      success: true,
      symbols,
      total: symbols.length
    });

  } catch (error) {
    console.error("❌ Error obteniendo símbolos:", error);
    return res.status(500).json({ 
      error: "Error al obtener los símbolos con actividad"
    });
  }
});

export default binanceRouter;
