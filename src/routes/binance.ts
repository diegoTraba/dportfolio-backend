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
import { servicioUsuario } from "../services/servicioUsuario.js";

interface Exchange {
  id: number;
  exchange: string;
  api_key: string;
  api_secret: string;
}

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
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

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
    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    // Obtener balance actual
    const credentials: BinanceCredentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };
    const totalUSD = await binanceService.getTotalUSDBalance(credentials);
    const exchangesCount = await servicioUsuario.contarExchangesUsuario(userId);

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
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

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
      const exchanges: Exchange[] =
        await servicioUsuario.obtenerExchangesUsuario(userId, {
          exchange: "binance",
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
          const supabase = getSupabaseClient();
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
            idUsuario: userId,
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

      return res.json({
        success: true,
        trades: allBuyTrades.length,
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
        fechaDesde,
        fechaHasta,
        orderBy = "fechaCompra",
        orderDirection = "desc",
      } = req.query;

      console.log("=== 📋 OBTENIENDO COMPRAS ACTIVAS DEL USUARIO ===");
      console.log(`👤 User ID: ${userId}`);

      // Log de filtros de fecha si se proporcionan
      if (fechaDesde) {
        console.log(`📅 Fecha desde: ${fechaDesde}`);
      }
      if (fechaHasta) {
        console.log(`📅 Fecha hasta: ${fechaHasta}`);
      }

      if (!userId || userId.trim().length === 0) {
        return res.status(400).json({ error: "El userId es requerido" });
      }

      // Validar formato de fechas si se proporcionan
      if (fechaDesde && !isValidDateString(fechaDesde as string)) {
        return res
          .status(400)
          .json({ error: "Formato de fechaDesde inválido. Use YYYY-MM-DD" });
      }

      if (fechaHasta && !isValidDateString(fechaHasta as string)) {
        return res
          .status(400)
          .json({ error: "Formato de fechaHasta inválido. Use YYYY-MM-DD" });
      }

      const supabase = getSupabaseClient();

      // Construir la consulta base
      let query = supabase
        .from("compras")
        .select("*", { count: "exact" })
        .eq("idUsuario", userId)
        .eq("vendida", false);

      // Aplicar filtro por símbolo si se proporciona
      if (simbolo && simbolo.toString().trim() !== "") {
        query = query.ilike("simbolo", `%${simbolo.toString().toUpperCase()}%`);
        console.log(`🔍 Filtro por símbolo: ${simbolo}`);
      }

      // Aplicar filtro por fecha desde si se proporciona
      if (fechaDesde) {
        const fechaDesdeObj = new Date(fechaDesde as string);
        // Establecer hora a 00:00:00 para incluir todo el día
        fechaDesdeObj.setHours(0, 0, 0, 0);
        query = query.gte("fechaCompra", fechaDesdeObj.toISOString());
        console.log(`📅 Filtrando desde: ${fechaDesdeObj.toISOString()}`);
      }

      // Aplicar filtro por fecha hasta si se proporciona
      if (fechaHasta) {
        const fechaHastaObj = new Date(fechaHasta as string);
        // Establecer hora a 23:59:59 para incluir todo el día
        fechaHastaObj.setHours(23, 59, 59, 999);
        query = query.lte("fechaCompra", fechaHastaObj.toISOString());
        console.log(`📅 Filtrando hasta: ${fechaHastaObj.toISOString()}`);
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
        compras.forEach((compra) => {
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
        fechaConsulta: new Date().toISOString(),
      };

      return res.json({
        success: true,
        compras: compras || [],
        paginacion: {
          total: count || 0,
          limite,
          desplazamiento,
          paginas: Math.ceil((count || 0) / limite),
        },
        estadisticas,
        filtros: {
          simbolo: simbolo || null,
          fechaDesde: fechaDesde || null,
          fechaHasta: fechaHasta || null,
          orderBy,
          orderDirection: orden,
        },
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

// Función auxiliar para validar formato de fecha (YYYY-MM-DD)
function isValidDateString(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

// Obtener símbolos con actividad del usuario
binanceRouter.get(
  "/trade-symbols/:userId",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      if (!userId || userId.trim().length === 0) {
        return res.status(400).json({ error: "El userId es requerido" });
      }
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
// ====================================
// Compras
// ====================================

/**
 * Ruta para realizar una compra en Binance
 */
binanceRouter.post("/buy", async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol, quantity, price, type } = req.body;

    // Validaciones básicas
    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        error: "API Key y Secret son requeridos",
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: "El símbolo es requerido",
      });
    }

    if (!quantity) {
      return res.status(400).json({
        success: false,
        error: "La cantidad es requerida",
      });
    }

    const credentials = { apiKey, apiSecret };

    // Primero verificar disponibilidad
    const availability = await binanceService.checkBuyAvailability(
      credentials,
      symbol,
      quantity
    );

    if (!availability.canBuy) {
      return res.status(400).json({
        success: false,
        error: `Saldo insuficiente. Disponible: ${availability.availableBalance} ${availability.quoteAsset}, Necesario estimado: ${availability.estimatedCost}`,
      });
    }

    // Realizar la orden de compra
    const orderParams: any = {
      symbol,
      quantity,
      type: type || "MARKET",
    };

    if (type === "LIMIT" && price) {
      orderParams.price = price;
    }

    const result = await binanceService.placeBuyOrder(credentials, orderParams);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: "Orden de compra ejecutada exitosamente",
      order: result.order,
    });
  } catch (error) {
    console.error("Error en /buy:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error desconocido al realizar la compra",
    });
  }
});

/**
 * Ruta para verificar disponibilidad antes de comprar
 */
binanceRouter.post("/check-buy", async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol, quantity } = req.body;

    if (!apiKey || !apiSecret || !symbol || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Todos los parámetros son requeridos",
      });
    }

    const credentials = { apiKey, apiSecret };
    const result = await binanceService.checkBuyAvailability(
      credentials,
      symbol,
      quantity
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en /check-buy:", error);
    res.status(500).json({
      success: false,
      error: "Error verificando disponibilidad",
    });
  }
});

/**
 * Ruta para compra simplificada con credenciales de usuario
 */
binanceRouter.post("/user/:userId/buy", async (req, res) => {
  try {
    const { userId } = req.params;
    const { symbol, quantity, price, type } = req.body;

    console.log("=== 🛒 COMPRA DESDE USUARIO ===");
    console.log(`👤 User ID: ${userId}`);
    console.log(`📊 Parámetros:`, { symbol, quantity, price, type });

    // Validaciones básicas
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "El userId es requerido",
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: "El símbolo es requerido",
      });
    }

    if (!quantity) {
      return res.status(400).json({
        success: false,
        error: "La cantidad es requerida",
      });
    }

    // Obtener credenciales de Binance del usuario
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

    // Verificar si hay exchanges
    if (!exchanges || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No se encontraron exchanges de Binance activos para este usuario",
      });
    }

    // Tomar el primer exchange del array
    const exchange = exchanges[0];

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials = { 
      apiKey: decryptedApiKey, 
      apiSecret: decryptedApiSecret 
    };

    console.log(`🔐 Credenciales obtenidas para usuario ${userId}`);

    // Verificar disponibilidad
    const availability = await binanceService.checkBuyAvailability(
      credentials,
      symbol,
      quantity
    );

    if (!availability.canBuy) {
      return res.status(400).json({
        success: false,
        error: `Saldo insuficiente. Disponible: ${availability.availableBalance} ${availability.quoteAsset}, Necesario estimado: ${availability.estimatedCost}`,
      });
    }

    // Realizar la orden de compra
    const orderParams: any = {
      symbol,
      quantity,
      type: type || "MARKET",
    };

    if (type === "LIMIT" && price) {
      orderParams.price = price;
    }

    const result = await binanceService.placeBuyOrder(credentials, orderParams);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Opcional: Guardar la compra en la base de datos local
    try {
      const supabase = getSupabaseClient();
      const datosCompra = {
        exchange: "Binance",
        idOrden: result.order?.orderId.toString() || "",
        simbolo: symbol,
        precio: result.order?.fills?.[0]?.price ? parseFloat(result.order.fills[0].price) : 0,
        cantidad: parseFloat(quantity),
        total: result.order?.cummulativeQuoteQty ? parseFloat(result.order.cummulativeQuoteQty) : 0,
        comision: result.order?.fills?.[0]?.commission ? parseFloat(result.order.fills[0].commission) : 0,
        fechaCompra: result.order?.transactTime ? new Date(result.order.transactTime).toISOString() : new Date().toISOString(),
        vendida: false,
        idUsuario: userId,
      };

      const { data: nuevaCompra, error: errorInsercion } = await supabase
        .from("compras")
        .insert([datosCompra])
        .select();

      if (errorInsercion) {
        console.error("⚠️ Error guardando compra en BD:", errorInsercion);
        // No fallamos la respuesta, solo logueamos el error
      } else {
        console.log("✅ Compra guardada en base de datos local");
      }
    } catch (dbError) {
      console.error("⚠️ Error en guardado BD:", dbError);
    }

    res.json({
      success: true,
      message: "Orden de compra ejecutada exitosamente",
      order: result.order,
      localId: result.order?.orderId,
    });
  } catch (error) {
    console.error("Error en /user/:userId/buy:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error desconocido al realizar la compra",
    });
  }
});

/**
 * Ruta para verificar disponibilidad antes de comprar (con credenciales de usuario)
 */
binanceRouter.post("/user/:userId/check-buy", async (req, res) => {
  try {
    const { userId } = req.params;
    const { symbol, quantity } = req.body;

    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "El userId es requerido",
      });
    }

    if (!symbol || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Todos los parámetros son requeridos",
      });
    }

    // Obtener credenciales de Binance del usuario
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

    // Verificar si hay exchanges
    if (!exchanges || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No se encontraron exchanges de Binance activos para este usuario",
      });
    }

    // Tomar el primer exchange del array
    const exchange = exchanges[0];

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials = { 
      apiKey: decryptedApiKey, 
      apiSecret: decryptedApiSecret 
    };

    const result = await binanceService.checkBuyAvailability(
      credentials,
      symbol,
      quantity
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en /user/:userId/check-buy:", error);
    res.status(500).json({
      success: false,
      error: "Error verificando disponibilidad",
    });
  }
});


//====================================
// Ventas
//====================================

/**
 * Ruta para realizar una venta en Binance
 */
binanceRouter.post("/sell", async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol, quantity, price, type } = req.body;

    // Validaciones básicas
    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        error: "API Key y Secret son requeridos",
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: "El símbolo es requerido",
      });
    }

    if (!quantity) {
      return res.status(400).json({
        success: false,
        error: "La cantidad es requerida",
      });
    }

    const credentials = { apiKey, apiSecret };

    // Primero verificar disponibilidad
    const availability = await binanceService.checkSellAvailability(
      credentials,
      symbol,
      quantity
    );

    if (!availability.canSell) {
      return res.status(400).json({
        success: false,
        error: `Saldo insuficiente. Disponible: ${availability.availableBalance} ${availability.asset}, Necesario: ${availability.neededBalance}`,
      });
    }

    // Realizar la orden de venta
    const orderParams: any = {
      symbol,
      quantity,
      type: type || "MARKET",
    };

    if (type === "LIMIT" && price) {
      orderParams.price = price;
    }

    const result = await binanceService.placeSellOrder(
      credentials,
      orderParams
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: "Orden de venta ejecutada exitosamente",
      order: result.order,
    });
  } catch (error) {
    console.error("Error en /sell:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error desconocido al realizar la venta",
    });
  }
});

/**
 * Ruta para verificar disponibilidad antes de vender
 */
binanceRouter.post("/check-sell", async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol, quantity } = req.body;

    if (!apiKey || !apiSecret || !symbol || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Todos los parámetros son requeridos",
      });
    }

    const credentials = { apiKey, apiSecret };
    const result = await binanceService.checkSellAvailability(
      credentials,
      symbol,
      quantity
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en /check-sell:", error);
    res.status(500).json({
      success: false,
      error: "Error verificando disponibilidad",
    });
  }
});

/**
 * Ruta para obtener información de un símbolo
 */
binanceRouter.get("/symbol-info/:symbol", async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.query;
    const { symbol } = req.params;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        error: "API Key y Secret son requeridos",
      });
    }

    const credentials = {
      apiKey: apiKey as string,
      apiSecret: apiSecret as string,
    };

    const info = await binanceService.getSymbolInfo(credentials, symbol);

    res.json({
      success: true,
      info,
    });
  } catch (error) {
    console.error("Error en /symbol-info:", error);
    res.status(500).json({
      success: false,
      error: "Error obteniendo información del símbolo",
    });
  }
});

export default binanceRouter;
