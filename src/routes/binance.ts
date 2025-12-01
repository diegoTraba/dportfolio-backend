import express, { Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { encrypt, decrypt } from "../lib/encriptacion.js";
import {
  binanceService,
  SUPPORTED_SYMBOLS,
  isValidSymbol,
} from "../services/servicioBinance.js";
import {
  BinanceCredentials,
  TradeHistoryParams,
} from "../interfaces/binance.types.js";

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
        code: error.code,
      });
      return res
        .status(500)
        .json({ error: "Error al consultar la base de datos" });
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
      lastUpdated: new Date().toISOString(),
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

// Obtener historial de compras del usuario para un símbolo específico
binanceRouter.get("/trades/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { symbol, startTime, endTime, limit = "100" } = req.query;

    console.log("=== 🛒 OBTENIENDO COMPRAS DEL USUARIO ===");

    // Validaciones
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({ error: "El userId es requerido" });
    }

    if (!symbol) {
      return res.status(400).json({
        error: "El parámetro 'symbol' es obligatorio",
        supportedSymbols: SUPPORTED_SYMBOLS,
      });
    }

    const symbolStr = symbol as string;
    if (!isValidSymbol(symbolStr)) {
      return res.status(400).json({
        error: `Símbolo '${symbolStr}' no soportado`,
        supportedSymbols: SUPPORTED_SYMBOLS,
      });
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
        error: "No se encontró conexión activa de Binance para este usuario",
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
      symbol: symbolStr,
      limit: parseInt(limit as string),
    };

    if (startTime) {
      tradeParams.startTime = parseInt(startTime as string);
    }

    if (endTime) {
      tradeParams.endTime = parseInt(endTime as string);
    }

    // Obtener las compras del usuario
    const buyTrades = await binanceService.getUserTrades(
      credentials,
      tradeParams
    );

    // Formatear la respuesta
    const formattedTrades = buyTrades.map((trade) => ({
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
      isMaker: trade.isMaker,
    }));

    console.log(
      `✅ ${formattedTrades.length} compras obtenidas para ${symbolStr}`
    );

    return res.json({
      success: true,
      symbol: symbolStr,
      trades: formattedTrades,
      total: formattedTrades.length,
      query: {
        startTime: startTime
          ? new Date(parseInt(startTime as string)).toISOString()
          : null,
        endTime: endTime
          ? new Date(parseInt(endTime as string)).toISOString()
          : null,
        limit: parseInt(limit as string),
      },
    });
  } catch (error) {
    console.error("❌ Error obteniendo compras del usuario:", error);
    return res.status(500).json({
      error: "Error al obtener el historial de compras",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Obtener todas las compras del usuario para todos los símbolos soportados
binanceRouter.get(
  "/all-trades/:userId",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { startTime, endTime, limit = "100" } = req.query;

      console.log("=== 🛒 OBTENIENDO TODAS LAS COMPRAS DEL USUARIO ===");

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
          error: "No se encontró conexión activa de Binance para este usuario",
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
      const tradeParams: Omit<TradeHistoryParams, "symbol"> = {
        limit: parseInt(limit as string),
      };

      if (startTime) {
        tradeParams.startTime = parseInt(startTime as string);
      }

      if (endTime) {
        tradeParams.endTime = parseInt(endTime as string);
      }

      // Obtener todas las compras del usuario para todos los símbolos soportados
      const allBuyTrades = await binanceService.getAllUserTrades(
        credentials,
        tradeParams
      );

      for (const trade of allBuyTrades) {
        try {
          // Verificar si la compra ya existe en la base de datos
          const { data: compraExistente, error: errorConsulta } = await supabase
            .from("compras")
            .select("id")
            .eq("idOrden", trade.orderId)
            .eq("simbolo", trade.symbol)
            .maybeSingle();

          if (errorConsulta) {
            console.error(
              `❌ Error verificando compra ${trade.orderId} - ${trade.symbol}:`,
              errorConsulta
            );
            continue;
          }
          if (compraExistente) {
            console.log(
              `⏭️ Compra ya existe en BD: ${trade.symbol} - Orden ${trade.orderId}`
            );
            continue;
          }

          // Preparar datos para insertar
          const datosCompra = {
            exchange: "Binance",
            idOrden: trade.orderId.toString(),
            simbolo: trade.symbol,
            precio: parseFloat(trade.price),
            cantidad: parseFloat(trade.qty),
            total: parseFloat(trade.quoteQty),
            comision: parseFloat(trade.commission),
            fechaCompra: new Date(trade.time).toISOString(),
            vendida: false,
            idUsuario: userId
          };

          // Insertar en la base de datos
          const { data: nuevaCompra, error: errorInsercion } = await supabase
            .from("compras")
            .insert([datosCompra])
            .select();

          if (errorInsercion) {
            console.error(
              `❌ Error guardando compra ${trade.orderId} - ${trade.symbol}:`,
              errorInsercion
            );

            // Si el error es por duplicado, continuar
            if (errorInsercion.code === "23505") {
              continue;
            }
          } else {
            console.log(
              `✅ Guardada: ${trade.symbol} - ${trade.qty} @ $${trade.price}`
            );
          }
        } catch (error) {
          console.error(`💥 Error procesando compra ${trade.orderId}:`, error);
        }
      }

      // Formatear estadísticas
      const estadisticas = {
        comprasIdentificadas: allBuyTrades.length,
        fechaSincronizacion: new Date().toISOString(),
      };

      console.log("=== 📈 RESUMEN DE SINCRONIZACIÓN ===");
      console.log(
        `Total transacciones obtenidas: ${estadisticas.comprasIdentificadas}`
      );
      // // Formatear la respuesta
      // const formattedTrades = allBuyTrades.map(trade => ({
      //   id: trade.id,
      //   orderId: trade.orderId,
      //   symbol: trade.symbol,
      //   price: parseFloat(trade.price),
      //   quantity: parseFloat(trade.qty),
      //   total: parseFloat(trade.quoteQty),
      //   commission: parseFloat(trade.commission),
      //   commissionAsset: trade.commissionAsset,
      //   timestamp: trade.time,
      //   date: new Date(trade.time).toISOString(),
      //   isBuyer: trade.isBuyer,
      //   isMaker: trade.isMaker
      // }));

      // console.log(`✅ ${formattedTrades.length} compras obtenidas de todos los símbolos`);

      return res.json({
        success: true,
        trades: allBuyTrades.length
      });
    } catch (error) {
      console.error("❌ Error obteniendo todas las compras:", error);
      return res.status(500).json({
        error: "Error al obtener el historial completo de compras",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

// Endpoint para obtener las compras activas (no vendidas) de un usuario
binanceRouter.get(
  "/compras-activas/:userId",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { 
        limit = "500",
        offset = "0",
        simbolo,
        orderBy = "fechaCompra",
        orderDirection = "desc"
      } = req.query;

      console.log("=== 📋 OBTENIENDO COMPRAS ACTIVAS DEL USUARIO ===");
      console.log(`👤 User ID: ${userId}`);

      if (!userId || userId.trim().length === 0) {
        return res.status(400).json({ error: "El userId es requerido" });
      }

      const supabase = getSupabaseClient();
      
      // Construir la consulta base
      let query = supabase
        .from("compras")
        .select("*", { count: 'exact' })
        .eq("idUsuario", userId)
        .eq("vendida", false);

      // Aplicar filtro por símbolo si se proporciona
      if (simbolo && simbolo.toString().trim() !== "") {
        query = query.ilike("simbolo", `%${simbolo.toString().toUpperCase()}%`);
        console.log(`🔍 Filtro por símbolo: ${simbolo}`);
      }

      // Aplicar ordenamiento
      const orden = orderDirection === "asc" ? orderDirection : "desc";
      query = query.order(orderBy.toString(), { ascending: orden === "asc" });

      // Aplicar paginación
      const limite = parseInt(limit as string);
      const desplazamiento = parseInt(offset as string);
      query = query.range(desplazamiento, desplazamiento + limite - 1);

      // Ejecutar consulta
      const { data: compras, error, count } = await query;

      if (error) {
        console.error("❌ Error obteniendo compras activas:", error);
        return res.status(500).json({
          error: "Error al obtener las compras activas",
          details: error.message,
        });
      }

      console.log(`✅ ${compras?.length || 0} compras activas encontradas`);

      // Calcular estadísticas adicionales
      let valorTotalInvertido = 0;
      let cantidadTotalCriptos = 0;
      const simbolosUnicos = new Set<string>();

      if (compras && compras.length > 0) {
        compras.forEach(compra => {
          valorTotalInvertido += compra.total || 0;
          cantidadTotalCriptos += compra.cantidad || 0;
          simbolosUnicos.add(compra.simbolo);
        });
      }

      const estadisticas = {
        totalCompras: count || 0,
        valorTotalInvertido: parseFloat(valorTotalInvertido.toFixed(2)),
        cantidadTotalCriptos: parseFloat(cantidadTotalCriptos.toFixed(8)),
        cantidadSimbolosDiferentes: simbolosUnicos.size,
        fechaConsulta: new Date().toISOString()
      };

      return res.json({
        success: true,
        compras: compras || [],
        paginacion: {
          total: count || 0,
          limite,
          desplazamiento,
          paginas: Math.ceil((count || 0) / limite)
        },
        estadisticas,
        filtros: {
          simbolo: simbolo || null,
          orderBy,
          orderDirection: orden
        }
      });

    } catch (error) {
      console.error("❌ Error inesperado obteniendo compras activas:", error);
      return res.status(500).json({
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

// Obtener símbolos con actividad del usuario
binanceRouter.get(
  "/trade-symbols/:userId",
  async (req: Request, res: Response) => {
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
          error: "No se encontró conexión activa de Binance para este usuario",
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
        total: symbols.length,
      });
    } catch (error) {
      console.error("❌ Error obteniendo símbolos:", error);
      return res.status(500).json({
        error: "Error al obtener los símbolos con actividad",
      });
    }
  }
);

export default binanceRouter;
