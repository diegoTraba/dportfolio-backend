// lib/binanceService.ts

/**
 * SERVICIO OPTIMIZADO PARA LA API DE BINANCE
 *
 * Este servicio se encarga de:
 * 1. Conectar con la API de Binance usando credenciales de usuario
 * 2. Obtener el balance total de Spot y Earn
 * 3. Calcular el valor total en USD de todos los activos
 */

// Importamos las interfaces necesarias
import {
  BinanceCredentials,
  BinanceBalance,
  SimpleEarnAccount,
  SimpleEarnFlexibleResponse,
  SimpleEarnLockedResponse,
  BinanceAccountResponse,
  BinanceTrade,
  TickerPrice,
  TradeHistoryParams,
  OrderResponse,
  BinanceOrder,
  ExchangeInfoResponse
} from "../interfaces/binance.types";

// Lista fija de símbolos a consultar
export const SUPPORTED_SYMBOLS = [
  "BTCUSDC",
  "ETHUSDC",
  "SOLUSDC",
  "ADAUSDC",
  "XRPUSDC",
  "BNBUSDC",
  "AVAXUSDC",
  "LINKUSDC",
];

// =============================================================================
// CLASE PRINCIPAL DEL SERVICIO
// =============================================================================

class BinanceService {
  // private baseUrl = "https://api.binance.com";
  //pruebas
  private baseUrl = "https://testnet.binance.vision";

  // ===========================================================================
  // MÉTODOS PÚBLICOS
  // ===========================================================================

  async testConnection(credentials: BinanceCredentials): Promise<boolean> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "/api/v3/account",
        credentials
      );
      return response.ok;
    } catch (error) {
      console.error("Error testing Binance connection:", error);
      return false;
    }
  }

  async getTotalUSDBalance(credentials: BinanceCredentials): Promise<number> {
    try {
      console.log("🚀 Calculando balance total de Binance...");

      // Obtener balances de Spot y Earn en paralelo para mejor rendimiento
      const [spotBalance, earnBalance] = await Promise.all([
        this.getSpotBalance(credentials),
        this.getEarnBalance(credentials),
      ]);

      const totalUSD = spotBalance + earnBalance;

      console.log("🎯 BALANCE TOTAL CALCULADO:", totalUSD.toFixed(2), "USD");
      console.log(`💵 Spot: ${spotBalance.toFixed(2)} USD`);
      console.log(`🏦 Earn: ${earnBalance.toFixed(2)} USD`);

      return parseFloat(totalUSD.toFixed(2));
    } catch (error) {
      console.error("❌ Error calculando balance total:", error);
      throw error;
    }
  }

  // ===========================================================================
  // MÉTODOS PRIVADOS - CÁLCULO DE BALANCES
  // ===========================================================================

  private async getSpotBalance(
    credentials: BinanceCredentials
  ): Promise<number> {
    try {
      console.log("api-key:" + credentials.apiKey);
      console.log("api-secret:" + credentials.apiSecret);
      // Obtener balances y precios en paralelo
      const [balances, usdtPrices, btcPrice, ethPrice] = await Promise.all([
        this.getAccountBalance(credentials),
        this.getUSDTPrices(),
        this.getPrice("BTCUSDT"),
        this.getPrice("ETHUSDT"),
      ]);

      let spotTotal = 0;

      for (const balance of balances) {
        const asset = balance.asset;
        const totalBalance =
          parseFloat(balance.free) + parseFloat(balance.locked);

        if (totalBalance === 0) continue;

        // Stablecoins directamente en USD
        if (
          ["USDT", "BUSD", "USDC", "TUSD", "USDP", "DAI", "FDUSD"].includes(
            asset
          )
        ) {
          spotTotal += totalBalance;
          continue;
        }

        // Buscar precio en USDT
        if (usdtPrices[asset]) {
          const usdValue = totalBalance * usdtPrices[asset];
          spotTotal += usdValue;
          continue;
        }

        // BTC y ETH como fallback
        if (asset === "BTC" && btcPrice > 0) {
          spotTotal += totalBalance * btcPrice;
          continue;
        }

        if (asset === "ETH" && ethPrice > 0) {
          spotTotal += totalBalance * ethPrice;
          continue;
        }

        console.log(`⚠️ ${asset} spot: Sin par USDT disponible, no incluido`);
      }

      console.log(`💵 BALANCE SPOT TOTAL: ${spotTotal.toFixed(2)} USD`);
      return spotTotal;
    } catch (error) {
      console.error("❌ Error obteniendo balance spot:", error);
      return 0;
    }
  }

  private async getEarnBalance(
    credentials: BinanceCredentials
  ): Promise<number> {
    try {
      console.log("=== 🏦 OBTENIENDO BALANCE EARN ===");

      // Intentar endpoint principal primero (más eficiente)
      const accountResponse = await this.makeAuthenticatedRequest(
        "/sapi/v1/simple-earn/account",
        credentials
      );

      if (accountResponse.ok) {
        const accountData = (await accountResponse.json()) as SimpleEarnAccount; // ✅ Type assertion
        console.log("✅ Datos de Simple Earn Account recibidos");

        if (accountData.totalAmountInBTC) {
          const btcAmount = parseFloat(accountData.totalAmountInBTC);
          const btcPrice = await this.getPrice("BTCUSDT");
          const total = btcAmount * btcPrice;
          console.log(
            `💰 TOTAL EARN: ${btcAmount} BTC × ${btcPrice} = ${total.toFixed(
              2
            )} USD`
          );
          return total;
        } else if (accountData.totalAmountInUSDT) {
          const total = parseFloat(accountData.totalAmountInUSDT);
          console.log(`💰 TOTAL EARN: ${total} USD`);
          return total;
        }
      }

      // Fallback a endpoints individuales
      console.log(
        "⚠️ Endpoint principal falló, usando endpoints individuales..."
      );
      return await this.getEarnBalanceFromPositions(credentials);
    } catch (error) {
      console.error("❌ Error obteniendo balance earn:", error);
      return 0;
    }
  }

  private async getEarnBalanceFromPositions(
    credentials: BinanceCredentials
  ): Promise<number> {
    try {
      console.log("=== 🔄 USANDO FALLBACK PARA EARN BALANCE ===");

      // Obtener precios y posiciones en paralelo
      const [usdtPrices, flexibleResponse, lockedResponse] = await Promise.all([
        this.getUSDTPrices(),
        this.makeAuthenticatedRequest(
          "/sapi/v1/simple-earn/flexible/position",
          credentials
        ),
        this.makeAuthenticatedRequest(
          "/sapi/v1/simple-earn/locked/position",
          credentials
        ),
      ]);

      let totalEarn = 0;

      // Procesar posiciones flexibles
      if (flexibleResponse.ok) {
        const data =
          (await flexibleResponse.json()) as SimpleEarnFlexibleResponse; // ✅ Type assertion
        totalEarn += this.calculateEarnFromPositions(
          data,
          "flexible",
          usdtPrices
        );
      }

      // Procesar posiciones locked
      if (lockedResponse.ok) {
        const data = (await lockedResponse.json()) as SimpleEarnLockedResponse; // ✅ Type assertion
        totalEarn += this.calculateEarnFromPositions(
          data,
          "locked",
          usdtPrices
        );
      }

      console.log(
        `🏦 EARN BALANCE TOTAL (fallback): ${totalEarn.toFixed(2)} USD`
      );
      return totalEarn;
    } catch (error) {
      console.error("❌ Error en fallback de earn balance:", error);
      return 0;
    }
  }

  /**
   * Obtener el historial de trades (compras/ventas) de un usuario para un símbolo específico
   */
  async getUserTrades(
    credentials: BinanceCredentials,
    params: TradeHistoryParams
  ): Promise<BinanceTrade[]> {
    try {
      console.log("=== 📋 OBTENIENDO TRADES PARA SÍMBOLO ===");
      console.log("📊 Parámetros:", params);

      if (!params.symbol) {
        throw new Error("El parámetro 'symbol' es obligatorio");
      }

      const response = await this.makeAuthenticatedRequest(
        "/api/v3/myTrades",
        credentials,
        params as Record<string, string>
      );

      if (!response.ok) {
        throw new Error(`Error obteniendo trades: ${response.statusText}`);
      }

      const trades = (await response.json()) as BinanceTrade[];

      console.log(`✅ Obtenidos ${trades.length} trades para ${params.symbol}`);

      // Filtrar solo compras (isBuyer = true)
      const buyTrades = trades.filter((trade) => trade.isBuyer === true);
      console.log(`🛒 Compras encontradas: ${buyTrades.length}`);

      return buyTrades;
    } catch (error) {
      console.error("❌ Error obteniendo historial de trades:", error);
      throw error;
    }
  }

  /**
   * Obtener todos los trades del usuario iterando por la lista fija de símbolos
   */
  async getAllUserTrades(
    credentials: BinanceCredentials,
    params: Omit<TradeHistoryParams, "symbol"> = {}
  ): Promise<BinanceTrade[]> {
    try {
      console.log("=== 🔄 OBTENIENDO TODOS LOS TRADES DEL USUARIO ===");
      console.log("📊 Usando lista fija de símbolos:", SUPPORTED_SYMBOLS);

      let allTrades: BinanceTrade[] = [];

      console.log(
        `📊 Obteniendo trades para ${SUPPORTED_SYMBOLS.length} símbolos...`
      );

      // Usamos Promise.all con limitación de concurrencia para mejor performance
      const batchSize = 2; // Número de requests concurrentes
      for (let i = 0; i < SUPPORTED_SYMBOLS.length; i += batchSize) {
        const batch = SUPPORTED_SYMBOLS.slice(i, i + batchSize);

        const batchPromises = batch.map(async (symbol) => {
          try {
            console.log(`🔍 Buscando trades para ${symbol}...`);

            const symbolTrades = await this.getUserTrades(credentials, {
              ...params,
              symbol: symbol,
            });

            console.log(
              `✅ ${symbol}: ${symbolTrades.length} trades encontrados`
            );
            return symbolTrades;
          } catch (error) {
            console.error(`❌ Error obteniendo trades para ${symbol}:`, error);
            return []; // Retornar array vacío en caso de error
          }
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach((trades) => {
          allTrades = [...allTrades, ...trades];
        });

        // Pequeño delay entre batches para evitar rate limiting
        if (i + batchSize < SUPPORTED_SYMBOLS.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      // Ordenamos por timestamp (más reciente primero)
      allTrades.sort((a, b) => b.time - a.time);

      // Aplicamos límite global si se especifica
      if (params.limit && allTrades.length > params.limit) {
        allTrades = allTrades.slice(0, params.limit);
      }

      console.log(
        `✅ Obtenidos ${allTrades.length} trades de ${SUPPORTED_SYMBOLS.length} símbolos`
      );

      return allTrades;
    } catch (error) {
      console.error("❌ Error obteniendo todos los trades:", error);
      throw error;
    }
  }

  /**
   * Obtener todos los símbolos en los que el usuario ha tenido actividad
   */
  async getUserTradeSymbols(
    credentials: BinanceCredentials
  ): Promise<string[]> {
    try {
      console.log("=== 🔍 OBTENIENDO SÍMBOLOS SOPORTADOS ===");

      // Devolvemos directamente la lista fija
      console.log(`✅ Símbolos soportados: ${SUPPORTED_SYMBOLS.length}`);

      return SUPPORTED_SYMBOLS;
    } catch (error) {
      console.error("❌ Error obteniendo símbolos:", error);
      return SUPPORTED_SYMBOLS; // Fallback a la lista fija
    }
  }
 // ===========================================================================
  // COMPRAS
  // ===========================================================================

  /**
 * Realizar una orden de compra en Binance
 */
async placeBuyOrder(
  credentials: BinanceCredentials,
  params: {
    symbol: string;
    quantity: number | string;
    type?: "MARKET" | "LIMIT";
    price?: number | string;
    newClientOrderId?: string;
  }
): Promise<OrderResponse> {
  try {
    console.log("=== 🛍️ INICIANDO ORDEN DE COMPRA ===");
    console.log("📊 Parámetros de la orden:", params);

    // Validar parámetros básicos
    if (!params.symbol) {
      throw new Error("El símbolo es requerido");
    }

    if (!params.quantity) {
      throw new Error("La cantidad es requerida");
    }

    // Preparar parámetros para la orden
    const orderParams: Record<string, string> = {
      symbol: params.symbol.toUpperCase(),
      side: "BUY",
      type: params.type || "MARKET",
      quantity: params.quantity.toString(),
    };

    // Agregar parámetros específicos según el tipo de orden
    if (params.type === "LIMIT") {
      if (!params.price) {
        throw new Error("El precio es requerido para órdenes LIMIT");
      }
      orderParams.price = params.price.toString();
      orderParams.timeInForce = "GTC"; // Good Till Cancelled
    }

    if (params.newClientOrderId) {
      orderParams.newClientOrderId = params.newClientOrderId;
    }

    console.log("📝 Parámetros finales para Binance:", orderParams);

    // Realizar la solicitud a la API de Binance
    const response = await this.makeAuthenticatedRequest(
      "/api/v3/order",
      credentials,
      orderParams,
      "POST"
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error("❌ Error en la orden de compra:", responseText);

      try {
        const errorData = JSON.parse(responseText);
        return {
          success: false,
          error: errorData.msg || "Error desconocido",
          code: errorData.code,
        };
      } catch {
        return {
          success: false,
          error: responseText || "Error en la API de Binance",
        };
      }
    }

    // Parsear respuesta exitosa
    const orderData = JSON.parse(responseText) as BinanceOrder;

    console.log("✅ Orden de compra ejecutada exitosamente");
    console.log("📋 Detalles de la orden:");
    console.log(`   ID: ${orderData.orderId}`);
    console.log(`   Símbolo: ${orderData.symbol}`);
    console.log(`   Cantidad: ${orderData.origQty}`);
    console.log(`   Cantidad ejecutada: ${orderData.executedQty}`);
    console.log(`   Valor total: ${orderData.cummulativeQuoteQty}`);
    console.log(`   Estado: ${orderData.status}`);

    // Si hay fills (transacciones individuales), mostrarlas
    if (orderData.fills && orderData.fills.length > 0) {
      console.log(`   📦 ${orderData.fills.length} transacción(es):`);
      orderData.fills.forEach((fill, index) => {
        console.log(
          `      ${index + 1}. Precio: ${fill.price}, Cantidad: ${
            fill.qty
          }, Comisión: ${fill.commission} ${fill.commissionAsset}`
        );
      });
    }

    return {
      success: true,
      order: orderData,
    };
  } catch (error) {
    console.error("💥 Error en placeBuyOrder:", error);

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error desconocido al realizar la orden",
    };
  }
}

/**
 * Método sobrecargado para órdenes de compra simplificadas
 */
async buyAsset(
  credentials: BinanceCredentials,
  symbol: string,
  quantity: number | string
): Promise<OrderResponse> {
  return this.placeBuyOrder(credentials, { symbol, quantity, type: "MARKET" });
}

/**
 * Método para verificar si hay suficiente balance antes de comprar
 */
async checkBuyAvailability(
  credentials: BinanceCredentials,
  symbol: string,
  quantity: number | string
): Promise<{
  canBuy: boolean;
  availableBalance: number;
  estimatedCost: number;
  quoteAsset: string;
}> {
  try {
    console.log("=== 🔍 VERIFICANDO DISPONIBILIDAD PARA COMPRA ===");

    // Obtener información del símbolo para conocer el quote asset
    const symbolInfo = await this.getSymbolInfo(credentials, symbol);
    const quoteAsset = symbolInfo.quoteAsset; // Ej: USDT, USDC, etc.
    console.log(`💰 Quote Asset: ${quoteAsset}`);

    // Obtener precio actual para calcular el costo estimado
    const currentPrice = await this.getPrice(symbol);
    const quantityNum = parseFloat(quantity.toString());
    const estimatedCost = quantityNum * currentPrice;

    // Obtener balance de la cuenta
    const accountResponse = await this.makeAuthenticatedRequest(
      "/api/v3/account",
      credentials
    );

    if (!accountResponse.ok) {
      throw new Error("Error obteniendo balance de cuenta");
    }

    const accountData = (await accountResponse.json()) as BinanceAccountResponse;

    // Encontrar el balance del quote asset
    const assetBalance = accountData.balances.find(
      (b) => b.asset === quoteAsset
    );

    if (!assetBalance) {
      console.log(`❌ No se encontró balance para ${quoteAsset}`);
      return {
        canBuy: false,
        availableBalance: 0,
        estimatedCost,
        quoteAsset,
      };
    }

    const available = parseFloat(assetBalance.free);
    const canBuy = available >= estimatedCost;

    console.log(`📊 Balance disponible de ${quoteAsset}: ${available}`);
    console.log(`📊 Costo estimado: ${estimatedCost}`);
    console.log(`💰 Precio actual de ${symbol}: ${currentPrice}`);
    console.log(`✅ ¿Puede comprar? ${canBuy ? "Sí" : "No"}`);

    return {
      canBuy,
      availableBalance: available,
      estimatedCost,
      quoteAsset,
    };
  } catch (error) {
    console.error("Error verificando disponibilidad para compra:", error);
    throw error;
  }
}
  // ===========================================================================
  // VENTAS
  // ===========================================================================

  /**
   * Realizar una orden de venta en Binance
   */
  async placeSellOrder(
    credentials: BinanceCredentials,
    params: {
      symbol: string;
      quantity: number | string;
      type?: "MARKET" | "LIMIT";
      price?: number | string;
      newClientOrderId?: string;
    }
  ): Promise<OrderResponse> {
    try {
      console.log("=== 🛒 INICIANDO ORDEN DE VENTA ===");
      console.log("📊 Parámetros de la orden:", params);

      // Validar parámetros básicos
      if (!params.symbol) {
        throw new Error("El símbolo es requerido");
      }

      if (!params.quantity) {
        throw new Error("La cantidad es requerida");
      }

      // Preparar parámetros para la orden
      const orderParams: Record<string, string> = {
        symbol: params.symbol.toUpperCase(),
        side: "SELL",
        type: params.type || "MARKET",
        quantity: params.quantity.toString(),
      };

      // Agregar parámetros específicos según el tipo de orden
      if (params.type === "LIMIT") {
        if (!params.price) {
          throw new Error("El precio es requerido para órdenes LIMIT");
        }
        orderParams.price = params.price.toString();
        orderParams.timeInForce = "GTC"; // Good Till Cancelled
      }

      if (params.newClientOrderId) {
        orderParams.newClientOrderId = params.newClientOrderId;
      }

      console.log("📝 Parámetros finales para Binance:", orderParams);

      // Realizar la solicitud a la API de Binance
      const response = await this.makeAuthenticatedRequest(
        "/api/v3/order",
        credentials,
        orderParams,
        "POST"
      );

      const responseText = await response.text();

      if (!response.ok) {
        console.error("❌ Error en la orden de venta:", responseText);

        try {
          const errorData = JSON.parse(responseText);
          return {
            success: false,
            error: errorData.msg || "Error desconocido",
            code: errorData.code,
          };
        } catch {
          return {
            success: false,
            error: responseText || "Error en la API de Binance",
          };
        }
      }

      // Parsear respuesta exitosa
      const orderData = JSON.parse(responseText) as BinanceOrder;

      console.log("✅ Orden de venta ejecutada exitosamente");
      console.log("📋 Detalles de la orden:");
      console.log(`   ID: ${orderData.orderId}`);
      console.log(`   Símbolo: ${orderData.symbol}`);
      console.log(`   Cantidad: ${orderData.origQty}`);
      console.log(`   Cantidad ejecutada: ${orderData.executedQty}`);
      console.log(`   Valor total: ${orderData.cummulativeQuoteQty}`);
      console.log(`   Estado: ${orderData.status}`);

      // Si hay fills (transacciones individuales), mostrarlas
      if (orderData.fills && orderData.fills.length > 0) {
        console.log(`   📦 ${orderData.fills.length} transacción(es):`);
        orderData.fills.forEach((fill, index) => {
          console.log(
            `      ${index + 1}. Precio: ${fill.price}, Cantidad: ${
              fill.qty
            }, Comisión: ${fill.commission} ${fill.commissionAsset}`
          );
        });
      }

      return {
        success: true,
        order: orderData,
      };
    } catch (error) {
      console.error("💥 Error en placeSellOrder:", error);

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido al realizar la orden",
      };
    }
  }

  /**
 * Método sobrecargado para órdenes de venta simplificadas
 */
async sellAsset(
  credentials: BinanceCredentials,
  symbol: string,
  quantity: number | string
): Promise<OrderResponse> {
  return this.placeSellOrder(credentials, { symbol, quantity, type: 'MARKET' });
}

/**
 * Método para verificar si hay suficiente balance antes de vender
 */
async checkSellAvailability(
  credentials: BinanceCredentials,
  symbol: string,
  quantity: number | string
): Promise<{ canSell: boolean; availableBalance: number; neededBalance: number; asset: string }> {
  try {
    console.log("=== 🔍 VERIFICANDO DISPONIBILIDAD PARA VENTA ===");
    
    // Extraer el activo base del símbolo (ej: BTC de BTCUSDT)
    const baseAsset = symbol.replace(/USDT$|USDC$|BUSD$/, '');
    console.log(`💰 Activo base: ${baseAsset}`);
    
    // Obtener balance de la cuenta
    const accountResponse = await this.makeAuthenticatedRequest(
      '/api/v3/account',
      credentials
    );
    
    if (!accountResponse.ok) {
      throw new Error('Error obteniendo balance de cuenta');
    }
    
    const accountData = await accountResponse.json() as BinanceAccountResponse;
    
    // Encontrar el balance del activo
    const assetBalance = accountData.balances.find(b => b.asset === baseAsset);
    
    if (!assetBalance) {
      console.log(`❌ No se encontró balance para ${baseAsset}`);
      return {
        canSell: false,
        availableBalance: 0,
        neededBalance: parseFloat(quantity.toString()),
        asset: baseAsset
      };
    }
    
    const available = parseFloat(assetBalance.free);
    const needed = parseFloat(quantity.toString());
    const canSell = available >= needed;
    
    console.log(`📊 Balance disponible de ${baseAsset}: ${available}`);
    console.log(`📊 Cantidad necesaria: ${needed}`);
    console.log(`✅ ¿Puede vender? ${canSell ? 'Sí' : 'No'}`);
    
    return {
      canSell,
      availableBalance: available,
      neededBalance: needed,
      asset: baseAsset
    };
    
  } catch (error) {
    console.error("Error verificando disponibilidad:", error);
    throw error;
  }
}

/**
 * Método para obtener información del símbolo (precios mínimos, lot size, etc.)
 */
async getSymbolInfo(
  credentials: BinanceCredentials,
  symbol: string
): Promise<{
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  filters: { [key: string]: any };
  minQty?: number;
  stepSize?: number;
  minNotional?: number;
}> {
  try {
    console.log(`🔍 Obteniendo información del símbolo ${symbol}...`);
    
    const response = await this.makeAuthenticatedRequest(
      '/api/v3/exchangeInfo',
      credentials,
      { symbol: symbol.toUpperCase() }
    );
    
    if (!response.ok) {
      throw new Error('Error obteniendo información del símbolo');
    }
    
    const data = await response.json() as ExchangeInfoResponse;
    const symbolInfo = data.symbols?.find((s) => s.symbol === symbol.toUpperCase());
    
    if (!symbolInfo) {
      throw new Error(`Símbolo ${symbol} no encontrado`);
    }
    
    // Extraer filtros importantes
    const filters = symbolInfo.filters.reduce((acc: any, filter: any) => {
      acc[filter.filterType] = filter;
      return acc;
    }, {});
    
    const info = {
      symbol: symbolInfo.symbol,
      status: symbolInfo.status,
      baseAsset: symbolInfo.baseAsset,
      quoteAsset: symbolInfo.quoteAsset,
      baseAssetPrecision: symbolInfo.baseAssetPrecision,
      quotePrecision: symbolInfo.quotePrecision,
      filters: filters,
      orderTypes: symbolInfo.orderTypes,
      icebergAllowed: symbolInfo.icebergAllowed,
      ocoAllowed: symbolInfo.ocoAllowed,
      quoteOrderQtyMarketAllowed: symbolInfo.quoteOrderQtyMarketAllowed,
      isSpotTradingAllowed: symbolInfo.isSpotTradingAllowed,
      isMarginTradingAllowed: symbolInfo.isMarginTradingAllowed,
    };
    
    console.log("📋 Información del símbolo obtenida");
    console.log(`   Base Asset: ${info.baseAsset}`);
    console.log(`   Quote Asset: ${info.quoteAsset}`);
    console.log(`   Estado: ${info.status}`);
    console.log(`   LOT_SIZE: Min Qty: ${filters.LOT_SIZE?.minQty || 'N/A'}, Step Size: ${filters.LOT_SIZE?.stepSize || 'N/A'}`);
    
    return info;
    
  } catch (error) {
    console.error("Error obteniendo información del símbolo:", error);
    throw error;
  }
}
  // ===========================================================================
  // MÉTODOS AUXILIARES
  // ===========================================================================

  private async getAccountBalance(
    credentials: BinanceCredentials
  ): Promise<BinanceBalance[]> {
    const response = await this.makeAuthenticatedRequest(
      "/api/v3/account",
      credentials
    );

    if (!response.ok) {
      throw new Error(`❌ Error de API Binance: ${response.statusText}`);
    }

    const data = (await response.json()) as BinanceAccountResponse; // ✅ Type assertion
    return data.balances.filter(
      (balance: BinanceBalance) =>
        parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0
    );
  }

  private async getUSDTPrices(): Promise<{ [asset: string]: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v3/ticker/price`);
      if (!response.ok) throw new Error("Failed to fetch prices");

      const prices = (await response.json()) as TickerPrice[]; // ✅ Type assertion

      const usdtPrices: { [asset: string]: number } = {};

      prices.forEach((price: TickerPrice) => {
        if (price.symbol.endsWith("USDT")) {
          const asset = price.symbol.replace("USDT", "");
          usdtPrices[asset] = parseFloat(price.price);
        }
      });

      console.log(
        `📊 Obtenidos precios de ${Object.keys(usdtPrices).length} pares USDT`
      );
      return usdtPrices;
    } catch (error) {
      console.error("❌ Error obteniendo precios USDT:", error);
      return {};
    }
  }

  private calculateEarnFromPositions(
    data: SimpleEarnFlexibleResponse | SimpleEarnLockedResponse,
    type: string,
    usdtPrices: { [asset: string]: number }
  ): number {
    try {
      let total = 0;
      const rows = data.rows || [];

      console.log(`📊 Procesando ${rows.length} posiciones de earn (${type})`);

      for (const position of rows) {
        const amountStr = position.totalAmount;
        if (!amountStr) continue;

        const amount = parseFloat(amountStr);
        if (amount > 0 && position.asset) {
          if (["USDT", "BUSD", "USDC"].includes(position.asset)) {
            total += amount;
          } else if (usdtPrices[position.asset]) {
            total += amount * usdtPrices[position.asset];
          } else {
            console.log(
              `⚠️ ${position.asset} earn: Sin precio disponible, no incluido`
            );
          }
        }
      }

      return total;
    } catch (error) {
      console.error("❌ Error calculando earn desde posiciones:", error);
      return 0;
    }
  }

  // ===========================================================================
  // MÉTODOS PARA PRECIOS Y ALERTAS
  // ===========================================================================

  /**
   * Obtener el precio actual de un símbolo (público - no necesita autenticación)
   */
  async getPrice(symbol: string): Promise<number> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v3/ticker/price?symbol=${symbol}`
      );

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as TickerPrice;
      return parseFloat(data.price);
    } catch (error) {
      console.error(`Error obteniendo precio para ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Obtener múltiples precios a la vez (público)
   */
  async getMultiplePrices(
    symbols: string[]
  ): Promise<{ [key: string]: number }> {
    try {
      const prices: { [key: string]: number } = {};

      // Usar Promise.all para obtener todos los precios en paralelo
      const pricePromises = symbols.map(async (symbol) => {
        try {
          const price = await this.getPrice(symbol);
          return { symbol, price };
        } catch (error) {
          console.error(`Error obteniendo precio para ${symbol}:`, error);
          return { symbol, price: 0 };
        }
      });

      const results = await Promise.all(pricePromises);

      results.forEach((result) => {
        prices[result.symbol] = result.price;
      });

      return prices;
    } catch (error) {
      console.error("Error obteniendo múltiples precios:", error);
      throw error;
    }
  }

  // ===========================================================================
  // MÉTODOS DE AUTENTICACIÓN
  // ===========================================================================

  // Actualiza el método makeAuthenticatedRequest para soportar POST
  private async makeAuthenticatedRequest(
    endpoint: string,
    credentials: BinanceCredentials,
    additionalParams: Record<string, string> = {},
    method: "GET" | "POST" = "GET"
  ): Promise<Response> {
    try {
      console.log("\n=== 🔐 MAKE AUTHENTICATED REQUEST ===");
      console.log(`📋 Endpoint: ${endpoint}`);
      console.log(`🔤 Method: ${method}`);

      // Obtener el tiempo del servidor de Binance
      const binanceTime = await this.getBinanceServerTime();
      const localTime = Date.now();
      const timeDiff = binanceTime - localTime;

      console.log(`⏰ Tiempo Binance: ${binanceTime}`);

      const timestamp = binanceTime.toString();

      const params = new URLSearchParams({
        timestamp,
        recvWindow: "5000",
        ...additionalParams,
      });

      const queryString = params.toString();
      console.log(`📝 Parámetros: ${queryString}`);

      const signature = await this.generateSignature(
        queryString,
        credentials.apiSecret
      );
      console.log(`✍️ Signature: ${signature.substring(0, 30)}...`);

      let url: string;
      let options: RequestInit = {
        headers: {
          "X-MBX-APIKEY": credentials.apiKey,
        },
        method: method,
      };

      if (method === "GET") {
        url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
      } else {
        // Para POST, la firma va en el body
        url = `${this.baseUrl}${endpoint}`;
        params.append("signature", signature);
        options.body = params.toString();
        options.headers = {
          ...options.headers,
          "Content-Type": "application/x-www-form-urlencoded",
        };
      }

      console.log(
        `🌐 URL: ${method === "GET" ? url : `${this.baseUrl}${endpoint}`}`
      );
      if (method === "POST") {
        console.log(`📦 Body: ${options.body}`);
      }

      console.log("🚀 Enviando request a Binance...");

      const startTime = Date.now();
      const response = await fetch(url, options);
      const endTime = Date.now();

      console.log(`⏱️ Tiempo de respuesta: ${endTime - startTime}ms`);
      console.log(`📊 Status: ${response.status} ${response.statusText}`);

      return response;
    } catch (error) {
      console.error("💥 ERROR en makeAuthenticatedRequest:", error);
      throw error;
    }
  }

  private async getBinanceServerTime(): Promise<number> {
    try {
      const response = await fetch("https://api.binance.com/api/v3/time");
      if (!response.ok) throw new Error("Failed to get server time");
      const data = (await response.json()) as { serverTime: number }; // ✅ Type assertion
      return data.serverTime;
    } catch (error) {
      console.error("Error obteniendo tiempo de Binance:", error);
      return Date.now(); // Fallback al tiempo local
    }
  }

  private async generateSignature(
    data: string,
    apiSecret: string
  ): Promise<string> {
    try {
      console.log("\n=== ✍️ GENERATE SIGNATURE ===");
      console.log(`📝 Data to sign: "${data}"`);
      console.log(
        `🔒 API Secret (primeros 10): ${apiSecret.substring(0, 10)}...`
      );
      console.log(`🔒 API Secret length: ${apiSecret.length}`);

      const encoder = new TextEncoder();
      console.log("🔧 Codificando datos...");

      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(apiSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      console.log("🔧 Key importada correctamente");

      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(data)
      );
      console.log("🔧 Firma generada, convirtiendo a hex...");

      const signatureHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      console.log(`✅ Signature generada: ${signatureHex.substring(0, 30)}...`);
      console.log(`✅ Signature length: ${signatureHex.length} caracteres`);

      return signatureHex;
    } catch (error) {
      console.error("💥 ERROR en generateSignature:", error);
      throw error;
    }
  }
}

/**
 * Valida si un símbolo está en la lista de soportados
 */
export function isValidSymbol(symbol: string): boolean {
  return SUPPORTED_SYMBOLS.includes(symbol.toUpperCase());
}

/**
 * Obtiene la lista de símbolos soportados
 */
export function getSupportedSymbols(): string[] {
  return [...SUPPORTED_SYMBOLS]; // Retorna copia para evitar mutaciones
}

export const binanceService = new BinanceService();
