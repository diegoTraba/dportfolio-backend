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
  TradeFeeResponse,
  OrderResponse,
  BinanceOrder,
  ExchangeInfoResponse,
} from "../interfaces/binance.types";

import { EMA, RSI, MACD } from "technicalindicators";

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
  "DOGEUSDC",
  "PEPEUSDC",
];

import { getSupabaseClient } from "../lib/supabase.js";

type IntervalSignal = {
  interval: string;
  lastClose: number;
  indicators: {
    ema7: number[];
    ema21: number[];
    rsi: number[];
    macd: { macd: number[]; signal: number[]; histogram: number[] };
  };
  signals: { action: "BUY" | "SELL" | "NONE"; confidence: number };
};

// =============================================================================
// CLASE PRINCIPAL DEL SERVICIO
// =============================================================================

class BinanceService {
  // private baseUrl = "https://api.binance.com";
  //pruebas
  private baseUrl = "https://testnet.binance.vision";

  private lastTradeTime: Map<string, number> = new Map();
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
      quantity?: number | string; // Hacerlo opcional
      type?: "MARKET" | "LIMIT";
      price?: number | string;
      newClientOrderId?: string;
      quoteOrderQty?: number | string; // Añadir este parámetro
    }
  ): Promise<OrderResponse> {
    try {
      console.log("=== 🛍️ INICIANDO ORDEN DE COMPRA ===");
      console.log("📊 Parámetros de la orden:", params);

      // Validar parámetros básicos
      if (!params.symbol) {
        throw new Error("El símbolo es requerido");
      }

      // MODIFICADO: Validación flexible para cantidad
      if (
        !params.quantity &&
        !params.quoteOrderQty &&
        params.type !== "LIMIT"
      ) {
        throw new Error(
          "Se requiere quantity o quoteOrderQty para órdenes MARKET"
        );
      }

      // MODIFICADO: Para órdenes LIMIT, quantity sigue siendo obligatorio
      if (params.type === "LIMIT" && !params.quantity) {
        throw new Error("La cantidad es requerida para órdenes LIMIT");
      }

      // Preparar parámetros para la orden
      const orderParams: Record<string, string> = {
        symbol: params.symbol.toUpperCase(),
        side: "BUY",
        type: params.type || "MARKET",
      };

      // MODIFICADO: Agregar quantity o quoteOrderQty según corresponda
      if (params.quantity) {
        orderParams.quantity = params.quantity.toString();
      }

      if (params.quoteOrderQty) {
        orderParams.quoteOrderQty = params.quoteOrderQty.toString();
      }

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

      // MODIFICADO: Manejar diferentes campos según el tipo de orden
      if (params.quoteOrderQty) {
        console.log(
          `   Cantidad gastada (quoteOrderQty): ${params.quoteOrderQty}`
        );
      } else {
        console.log(`   Cantidad (quantity): ${orderData.origQty}`);
      }

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
    return this.placeBuyOrder(credentials, {
      symbol,
      quantity,
      type: "MARKET",
    });
  }

  /**
   * Método para verificar si hay suficiente balance antes de comprar
   */
  async checkBuyAvailability(
    credentials: BinanceCredentials,
    symbol: string,
    quantity: number | string,
    currentPrice?: number // Parámetro opcional para evitar doble consulta
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

      // Usa el precio proporcionado o obtén uno nuevo
      let price = currentPrice;
      if (!price) {
        price = await this.getPrice(symbol);
      }
      const quantityNum = parseFloat(quantity.toString());
      const estimatedCost = quantityNum * price;

      // Obtener balance de la cuenta
      const accountResponse = await this.makeAuthenticatedRequest(
        "/api/v3/account",
        credentials
      );

      if (!accountResponse.ok) {
        throw new Error("Error obteniendo balance de cuenta");
      }

      const accountData =
        (await accountResponse.json()) as BinanceAccountResponse;

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
  async checkSellAvailability(
    credentials: BinanceCredentials,
    symbol: string,
    quantity: number | string,
    currentPrice?: number
  ): Promise<{
    canSell: boolean;
    availableBalance: number;
    estimatedRevenue: number;
    baseAsset: string;
    reasons?: string[];
    stepSize?: number;
  }> {
    try {
      console.log("=== 🔍 VERIFICANDO DISPONIBILIDAD PARA VENTA ===");
      const reasons: string[] = [];

      // Obtener información del símbolo
      const symbolInfo = await this.getSymbolInfo(credentials, symbol);
      const baseAsset = symbolInfo.baseAsset;
      console.log(`💰 Base Asset: ${baseAsset}`);

      // Obtener precio si no se proporciona
      let price = currentPrice;
      if (!price) {
        price = await this.getPrice(symbol);
      }

      const quantityNum = parseFloat(quantity.toString());
      const estimatedRevenue = quantityNum * price;
      const stepSize = symbolInfo.stepSize || 0;
      // Obtener balance de la cuenta
      const accountResponse = await this.makeAuthenticatedRequest(
        "/api/v3/account",
        credentials
      );

      if (!accountResponse.ok) {
        throw new Error("Error obteniendo balance de cuenta");
      }

      const accountData =
        (await accountResponse.json()) as BinanceAccountResponse;

      // Encontrar el balance del base asset
      const assetBalance = accountData.balances.find(
        (b) => b.asset === baseAsset
      );

      if (!assetBalance) {
        console.log(`❌ No se encontró balance para ${baseAsset}`);
        reasons.push(`No se encontró balance para ${baseAsset}`);
        return {
          canSell: false,
          availableBalance: 0,
          estimatedRevenue,
          baseAsset,
          reasons,
        };
      }

      const available = parseFloat(assetBalance.free);
      const locked = parseFloat(assetBalance.locked);

      console.log(`📊 Balance total de ${baseAsset}: ${available + locked}`);
      console.log(`📊 Balance disponible (free): ${available}`);
      console.log(`📊 Balance bloqueado (locked): ${locked}`);
      console.log(`📊 Cantidad a vender: ${quantityNum}`);
      console.log(`💰 Precio actual de ${symbol}: ${price}`);
      console.log(`📈 Ingreso estimado: ${estimatedRevenue}`);

      // Verificar balance disponible
      if (available < quantityNum) {
        const missing = quantityNum - available;
        console.log(`❌ Saldo insuficiente. Faltan: ${missing} ${baseAsset}`);
        reasons.push(
          `Saldo insuficiente. Disponible: ${available} ${baseAsset}, Necesario: ${quantityNum} ${baseAsset}`
        );
      }

      // Verificar cantidad mínima
      const minQty = symbolInfo.minQty || 0;
      if (quantityNum < minQty) {
        console.log(`❌ Cantidad menor al mínimo permitido: ${minQty}`);
        reasons.push(
          `Cantidad (${quantityNum}) menor al mínimo permitido (${minQty})`
        );
      }

      // Verificar step size

      if (stepSize > 0) {
        const remainder = quantityNum % stepSize;
        const tolerance = 0.00000001;
        if (
          remainder > tolerance &&
          Math.abs(remainder - stepSize) > tolerance
        ) {
          console.log(`❌ Cantidad no es múltiplo del step size: ${stepSize}`);
          console.log(`❌ Remainder: ${remainder}`);
          reasons.push(`Cantidad no es múltiplo del step size (${stepSize})`);

          // Calcular cantidad válida más cercana
          const validQuantity = Math.floor(quantityNum / stepSize) * stepSize;
          console.log(`💡 Cantidad válida más cercana: ${validQuantity}`);
        }
      }

      // Verificar notional mínimo (valor mínimo de la orden)
      const minNotional = symbolInfo.minNotional || 0;
      if (estimatedRevenue < minNotional) {
        console.log(
          `❌ Valor de orden muy bajo. Mínimo requerido: ${minNotional} ${symbolInfo.quoteAsset}`
        );
        console.log(
          `❌ Valor actual: ${estimatedRevenue} ${symbolInfo.quoteAsset}`
        );
        reasons.push(
          `Valor de orden (${estimatedRevenue}) menor al mínimo requerido (${minNotional})`
        );
      }

      // Verificar filtro de MARKET_LOT_SIZE si es una orden de mercado
      const marketLotFilter = symbolInfo.filters.MARKET_LOT_SIZE;
      if (marketLotFilter) {
        const maxQtyMarket = parseFloat(marketLotFilter.maxQty || "0");
        const minQtyMarket = parseFloat(marketLotFilter.minQty || "0");

        if (quantityNum < minQtyMarket) {
          console.log(
            `❌ Cantidad menor al mínimo permitido para mercado: ${minQtyMarket}`
          );
          reasons.push(
            `Cantidad menor al mínimo para órdenes de mercado (${minQtyMarket})`
          );
        }
        if (quantityNum > maxQtyMarket && maxQtyMarket > 0) {
          console.log(
            `❌ Cantidad mayor al máximo permitido para mercado: ${maxQtyMarket}`
          );
          reasons.push(
            `Cantidad mayor al máximo para órdenes de mercado (${maxQtyMarket})`
          );
        }
      }

      // Verificar filtro de MAX_NUM_ORDERS si es relevante
      const maxOrdersFilter = symbolInfo.filters.MAX_NUM_ORDERS;
      if (maxOrdersFilter && maxOrdersFilter.maxNumOrders) {
        console.log(
          `ℹ️ Límite máximo de órdenes: ${maxOrdersFilter.maxNumOrders}`
        );
      }

      const canSell = reasons.length === 0;
      console.log(`✅ ¿Puede vender? ${canSell ? "Sí" : "No"}`);

      if (!canSell) {
        console.log("📝 Razones del rechazo:");
        reasons.forEach((reason, index) =>
          console.log(`  ${index + 1}. ${reason}`)
        );
      }

      return {
        canSell,
        availableBalance: available,
        estimatedRevenue,
        baseAsset,
        reasons: reasons.length > 0 ? reasons : undefined,
        stepSize: stepSize,
      };
    } catch (error) {
      console.error("Error verificando disponibilidad para venta:", error);
      throw error;
    }
  }

  async placeSellOrder(
    credentials: BinanceCredentials,
    params: {
      symbol: string;
      quantity?: number | string;
      type?: "MARKET" | "LIMIT";
      price?: number | string;
      newClientOrderId?: string;
      quoteOrderQty?: number | string;
    }
  ): Promise<OrderResponse> {
    try {
      console.log("=== 📤 INICIANDO ORDEN DE VENTA ===");
      console.log("📊 Parámetros de la orden:", params);

      // Validaciones básicas
      if (!params.symbol) {
        throw new Error("El símbolo es requerido");
      }

      // Validación flexible para cantidad
      if (
        !params.quantity &&
        !params.quoteOrderQty &&
        params.type !== "LIMIT"
      ) {
        throw new Error(
          "Se requiere quantity o quoteOrderQty para órdenes MARKET"
        );
      }

      // Para órdenes LIMIT, quantity sigue siendo obligatorio
      if (params.type === "LIMIT" && !params.quantity) {
        throw new Error("La cantidad es requerida para órdenes LIMIT");
      }

      // Preparar parámetros para la orden
      const orderParams: Record<string, string> = {
        symbol: params.symbol.toUpperCase(),
        side: "SELL", // ¡Este es el cambio principal!
        type: params.type || "MARKET",
      };

      // Agregar quantity o quoteOrderQty según corresponda
      if (params.quantity) {
        orderParams.quantity = params.quantity.toString();
      }

      if (params.quoteOrderQty) {
        orderParams.quoteOrderQty = params.quoteOrderQty.toString();
      }

      // Agregar parámetros específicos según el tipo de orden
      if (params.type === "LIMIT") {
        if (!params.price) {
          throw new Error("El precio es requerido para órdenes LIMIT");
        }
        orderParams.price = params.price.toString();
        orderParams.timeInForce = "GTC";
      }

      if (params.newClientOrderId) {
        orderParams.newClientOrderId = params.newClientOrderId;
      }

      console.log("📝 Parámetros finales para Binance (SELL):", orderParams);

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
      console.log(`   Lado: SELL`);
      console.log(`   Cantidad ejecutada: ${orderData.executedQty}`);
      console.log(`   Valor total: ${orderData.cummulativeQuoteQty}`);
      console.log(`   Estado: ${orderData.status}`);

      // Si hay fills, mostrarlas
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
        "/api/v3/exchangeInfo",
        credentials,
        { symbol: symbol.toUpperCase() }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Error response from Binance:", errorText);

        let errorMessage = "Error obteniendo información del símbolo";
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.msg || errorMessage;
        } catch (e) {
          // Si no es JSON, usar el texto plano
        }
        throw new Error(`${errorMessage} (HTTP ${response.status})`);
      }

      const data = (await response.json()) as ExchangeInfoResponse;
      const symbolInfo = data.symbols?.find(
        (s) => s.symbol === symbol.toUpperCase()
      );

      if (!symbolInfo) {
        throw new Error(`Símbolo ${symbol} no encontrado`);
      }

      // Extraer filtros importantes
      const filters = symbolInfo.filters.reduce((acc: any, filter: any) => {
        acc[filter.filterType] = filter;
        return acc;
      }, {});

      // Extraer valores específicos de los filtros
      const lotSizeFilter = filters.LOT_SIZE || {};
      const minNotionalFilter = filters.MIN_NOTIONAL || filters.NOTIONAL || {};

      // Crear el objeto de retorno con el tipado exacto
      const result: {
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        status: string;
        filters: { [key: string]: any };
        minQty?: number;
        stepSize?: number;
        minNotional?: number;
      } = {
        symbol: symbolInfo.symbol,
        baseAsset: symbolInfo.baseAsset,
        quoteAsset: symbolInfo.quoteAsset,
        status: symbolInfo.status,
        filters: filters,
      };

      // Añadir propiedades opcionales si existen
      if (lotSizeFilter.minQty) {
        result.minQty = parseFloat(lotSizeFilter.minQty);
      }

      if (lotSizeFilter.stepSize) {
        result.stepSize = parseFloat(lotSizeFilter.stepSize);
      }

      if (minNotionalFilter.minNotional) {
        result.minNotional = parseFloat(minNotionalFilter.minNotional);
      }

      console.log("✅ Información del símbolo obtenida correctamente");
      console.log(`   Símbolo: ${result.symbol}`);
      console.log(`   Estado: ${result.status}`);
      console.log(`   Base Asset: ${result.baseAsset}`);
      console.log(`   Quote Asset: ${result.quoteAsset}`);

      return result;
    } catch (error: any) {
      console.error("❌ Error en getSymbolInfo:", error.message);
      throw new Error(
        `Error obteniendo información del símbolo ${symbol}: ${error.message}`
      );
    }
  }

  // ===========================================================================
  // OBTENER TASAS DE COMISIÓN DEL USUARIO
  // ===========================================================================

  /**
   * Obtener las tasas de comisión del usuario
   * @param credentials Credenciales del usuario
   * @param symbol (Opcional) Símbolo específico para determinar el asset de comisión
   * @returns Objeto con tasas de comisión y asset de comisión
   */
  async getUserCommissionRates(
    credentials: BinanceCredentials,
    symbol?: string
  ): Promise<{
    success: boolean;
    makerRate: number;
    takerRate: number;
    commissionAsset?: string;
    error?: string;
  }> {
    try {
      console.log("=== 💰 OBTENIENDO TASAS DE COMISIÓN DEL USUARIO ===");

      // Obtener información de la cuenta para ver comisiones
      const response = await this.makeAuthenticatedRequest(
        "/api/v3/account",
        credentials
      );

      if (!response.ok) {
        throw new Error(
          `Error obteniendo información de cuenta: ${response.statusText}`
        );
      }

      const accountData = (await response.json()) as BinanceAccountResponse;

      // En Binance, las comisiones vienen como enteros (ej: 10 = 0.001 = 0.1%)
      // makerCommission: comisión para órdenes que añaden liquidez (LIMIT)
      // takerCommission: comisión para órdenes que toman liquidez (MARKET)
      const makerCommission = accountData.makerCommission || 10; // Valor por defecto 0.1%
      const takerCommission = accountData.takerCommission || 10; // Valor por defecto 0.1%

      // Convertir a decimal (10 = 0.001)
      const makerRate = makerCommission / 10000;
      const takerRate = takerCommission / 10000;

      console.log(`💰 Comisiones del usuario:`);
      console.log(`   Maker (LIMIT): ${makerRate} (${makerRate * 100}%)`);
      console.log(`   Taker (MARKET): ${takerRate} (${takerRate * 100}%)`);

      let commissionAsset = "USDC"; // Valor por defecto

      // Determinar el asset de comisión basado en el símbolo si se proporciona
      if (symbol) {
        try {
          const symbolInfo = await this.getSymbolInfo(credentials, symbol);
          commissionAsset = symbolInfo.quoteAsset; // Normalmente la comisión se cobra en el quote asset
          console.log(`💰 Asset de comisión determinado: ${commissionAsset}`);
        } catch (error) {
          console.warn(
            "No se pudo determinar el asset de comisión, usando valor por defecto USDC"
          );
          // Fallback basado en el símbolo
          if (symbol.includes("USDC")) {
            commissionAsset = "USDC";
          } else if (symbol.includes("USDT")) {
            commissionAsset = "USDT";
          }
        }
      }

      // También podemos obtener información de comisión específica usando el endpoint de tradeFee
      try {
        const tradeFeeResponse = await this.makeAuthenticatedRequest(
          "/sapi/v1/asset/tradeFee",
          credentials,
          symbol ? { symbol: symbol.toUpperCase() } : {}
        );

        if (tradeFeeResponse.ok) {
          const tradeFeeData =
            (await tradeFeeResponse.json()) as TradeFeeResponse[];
          console.log(
            "📊 Información de comisión específica obtenida:",
            tradeFeeData
          );

          // Si hay datos específicos para el símbolo, podemos usarlos
          if (tradeFeeData && tradeFeeData.length > 0) {
            let symbolFee: TradeFeeResponse | undefined;

            // Buscar el símbolo específico si se proporcionó
            if (symbol) {
              symbolFee = tradeFeeData.find(
                (fee) => fee.symbol === symbol.toUpperCase()
              );
            }

            // Si no encontramos el símbolo específico, usar el primero
            if (!symbolFee && tradeFeeData.length > 0) {
              symbolFee = tradeFeeData[0];
            }

            if (symbolFee) {
              const specificMakerRate = parseFloat(symbolFee.makerCommission);
              const specificTakerRate = parseFloat(symbolFee.takerCommission);

              console.log(
                `💰 Comisiones específicas para ${symbol || symbolFee.symbol}:`
              );
              console.log(
                `   Maker: ${specificMakerRate} (${specificMakerRate * 100}%)`
              );
              console.log(
                `   Taker: ${specificTakerRate} (${specificTakerRate * 100}%)`
              );

              // Usar las comisiones específicas si están disponibles
              return {
                success: true,
                makerRate: specificMakerRate,
                takerRate: specificTakerRate,
                commissionAsset: commissionAsset,
              };
            }
          }
        }
      } catch (tradeFeeError) {
        console.warn(
          "No se pudo obtener comisiones específicas, usando comisiones generales:",
          tradeFeeError
        );
        // Continuar con las comisiones generales
      }

      return {
        success: true,
        makerRate,
        takerRate,
        commissionAsset,
      };
    } catch (error) {
      console.error("❌ Error obteniendo tasas de comisión:", error);

      // Valores por defecto en caso de error
      return {
        success: false,
        makerRate: 0.001, // 0.1%
        takerRate: 0.001, // 0.1%
        commissionAsset: symbol?.includes("USDC") ? "USDC" : "USDT",
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    }
  }

  /**
   * Método simplificado para obtener la tasa de comisión general
   * (Mantener compatibilidad con el endpoint que ya estás usando)
   */
  async getUserCommissionRate(
    credentials: BinanceCredentials,
    symbol: string
  ): Promise<{
    success: boolean;
    commissionRate: number;
    commissionAsset: string;
    makerRate?: number;
    takerRate?: number;
    error?: string;
  }> {
    try {
      console.log(`=== 💰 OBTENIENDO TASA DE COMISIÓN PARA ${symbol} ===`);

      // Obtener tasas completas
      const commissionRates = await this.getUserCommissionRates(
        credentials,
        symbol
      );

      if (!commissionRates.success) {
        throw new Error(commissionRates.error || "Error obteniendo comisiones");
      }

      // Para uso general, usar taker rate (para órdenes MARKET por defecto)
      // El frontend puede cambiar a maker rate para órdenes LIMIT
      return {
        success: true,
        commissionRate: commissionRates.takerRate, // Por defecto para MARKET
        commissionAsset: commissionRates.commissionAsset || "USDC",
        makerRate: commissionRates.makerRate,
        takerRate: commissionRates.takerRate,
      };
    } catch (error) {
      console.error("❌ Error en getUserCommissionRate:", error);

      return {
        success: false,
        commissionRate: 0.001, // 0.1% por defecto
        commissionAsset: symbol.includes("USDC") ? "USDC" : "USDT",
        error: error instanceof Error ? error.message : "Error desconocido",
      };
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
      console.log("\n=== 🔐 MAKE REQUEST ===");
      console.log(`📋 Endpoint: ${endpoint}`);
      console.log(`📝 Additional Params:`, additionalParams);

      // Determinar si es un endpoint público
      const isPublicEndpoint =
        endpoint.includes("/api/v3/exchangeInfo") ||
        endpoint.includes("/api/v3/klines");

      let url: string;

      if (isPublicEndpoint) {
        // Para endpoints públicos, solo añade los parámetros adicionales
        const params = new URLSearchParams(additionalParams);
        const queryString = params.toString();
        url = `${this.baseUrl}${endpoint}${
          queryString ? `?${queryString}` : ""
        }`;
        console.log(`🌐 URL (public endpoint): ${url}`);
      } else {
        // Para endpoints privados, usa autenticación completa
        const binanceTime = await this.getBinanceServerTime();
        console.log(`⏰ Tiempo Binance: ${binanceTime}`);

        const timestamp = binanceTime.toString();

        const params = new URLSearchParams({
          timestamp,
          recvWindow: "5000",
          ...additionalParams,
        });

        const queryString = params.toString();
        console.log(`📝 Query String: ${queryString}`);

        const signature = await this.generateSignature(
          queryString,
          credentials.apiSecret
        );
        console.log(`✍️ Signature: ${signature.substring(0, 30)}...`);

        url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
        console.log(`🌐 URL (private endpoint): ${url}`);
      }

      const options: RequestInit = {
        method: method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      // Solo añade la API Key si no es un endpoint público
      if (!isPublicEndpoint) {
        options.headers = {
          ...options.headers,
          "X-MBX-APIKEY": credentials.apiKey,
        };
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

  //////////////////////
  // ANALISIS TECNICO //
  //////////////////////

  /**
   * Obtiene velas (candlesticks) de un símbolo
   * @param symbol Par, ej. 'BTCUSDC'
   * @param interval Intervalo: '1m', '5m', '1h', '1d', etc.
   * @param limit Número de velas a obtener (máximo 1000)
   * @returns Array de velas con precios de cierre, apertura, etc.
   */
  async getKlines(
    symbol: string,
    interval: string = "1h",
    limit: number = 100
  ): Promise<
    {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[]
  > {
    try {
      console.log(`📊 Obteniendo ${limit} velas de ${symbol} (${interval})...`);

      // Endpoint público, no necesita autenticación
      const params = {
        symbol: symbol.toUpperCase(),
        interval,
        limit: limit.toString(),
      };

      // Usamos makeAuthenticatedRequest aunque no requiera clave; igual funciona
      const response = await this.makeAuthenticatedRequest(
        "/api/v3/klines",
        {} as BinanceCredentials,
        params,
        "GET"
      );

      if (!response.ok) {
        throw new Error(`Error obteniendo klines: ${response.statusText}`);
      }

      const data = (await response.json()) as any[];

      // Transformar a un formato más amigable
      return data.map((kline: any[]) => ({
        time: kline[0], // timestamp de apertura
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
      }));
    } catch (error) {
      console.error(`❌ Error en getKlines para ${symbol}:`, error);
      throw error;
    }
  }

  // ===========================================================================
  // MÉTODOS PRIVADOS DE CÁLCULO DE INDICADORES
  // ===========================================================================

  /**
   * Calcula la EMA para un array de precios
   * @param values Array de precios (normalmente cierres)
   * @param period Período de la EMA (ej. 7, 21)
   * @returns Array de EMA (misma longitud que values, con NaN en los primeros period-1)
   */
  private calculateEMA(values: number[], period: number): number[] {
    try {
      const ema = EMA.calculate({ period, values });
      // Rellenar con NaN al inicio para mantener la misma longitud
      const padding = new Array(values.length - ema.length).fill(NaN);
      return [...padding, ...ema];
    } catch (error) {
      console.error(`Error calculando EMA (period=${period}):`, error);
      return new Array(values.length).fill(NaN);
    }
  }

  /**
   * Calcula el RSI para un array de precios
   * @param values Array de precios (cierres)
   * @param period Período del RSI (por defecto 14)
   * @returns Array de RSI (misma longitud que values, con NaN en los primeros period)
   */
  private calculateRSI(values: number[], period: number = 14): number[] {
    try {
      const rsi = RSI.calculate({ period, values });
      const padding = new Array(values.length - rsi.length).fill(NaN);
      return [...padding, ...rsi];
    } catch (error) {
      console.error(`Error calculando RSI (period=${period}):`, error);
      return new Array(values.length).fill(NaN);
    }
  }

  /**
   * Calcula el MACD para un array de precios
   * @param values Array de precios (cierres)
   * @param fastPeriod Período rápido (por defecto 12)
   * @param slowPeriod Período lento (por defecto 26)
   * @param signalPeriod Período de señal (por defecto 9)
   * @returns Objeto con arrays MACD, signal e histogram (misma longitud que values)
   */
  private calculateMACD(
    values: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): { macd: number[]; signal: number[]; histogram: number[] } {
    try {
      const result = MACD.calculate({
        values,
        fastPeriod,
        slowPeriod,
        signalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });

      // result es un array de objetos { MACD, signal, histogram }
      const macdArray = result.map((r) => r.MACD);
      const signalArray = result.map((r) => r.signal);
      const histogramArray = result.map((r) => r.histogram);

      // Calcular padding: el resultado comienza después de slowPeriod - 1 elementos
      const paddingLength = values.length - macdArray.length;
      const padding = new Array(paddingLength).fill(NaN);

      return {
        macd: [...padding, ...macdArray],
        signal: [...padding, ...signalArray],
        histogram: [...padding, ...histogramArray],
      };
    } catch (error) {
      console.error("Error calculando MACD:", error);
      const nanArray = new Array(values.length).fill(NaN);
      return { macd: nanArray, signal: nanArray, histogram: nanArray };
    }
  }

  // ===========================================================================
  // LÓGICA DE SEÑALES (basada en tu guía)
  // ===========================================================================

  /**
   * Evalúa señales de compra/venta basadas en EMA, RSI y MACD
   * Devuelve una acción y un nivel de confianza
   */
  private evaluateSignals(
    closes: number[],
    ema7: number[],
    ema21: number[],
    rsi: number[],
    macd: { macd: number[]; signal: number[]; histogram: number[] }
  ): { action: "BUY" | "SELL" | "NONE"; confidence: number } {
    const lastIndex = closes.length - 1;
    const prevIndex = lastIndex - 1;

    // Necesitamos suficientes datos
    if (lastIndex < 30) return { action: "NONE", confidence: 0 };

    // Función auxiliar para obtener el último valor no-NaN (busca hacia atrás)
    const getPrevValid = (arr: number[], idx: number): number | null => {
      for (let i = idx; i >= 0; i--) {
        if (!isNaN(arr[i])) return arr[i];
      }
      return null;
    };

    const currentEMA7 = ema7[lastIndex];
    const prevEMA7 = getPrevValid(ema7, prevIndex);
    const currentEMA21 = ema21[lastIndex];
    const prevEMA21 = getPrevValid(ema21, prevIndex);

    const currentRSI = rsi[lastIndex];
    const prevRSI = getPrevValid(rsi, prevIndex);

    const currentMACD = macd.macd[lastIndex];
    const prevMACD = getPrevValid(macd.macd, prevIndex);
    const currentSignal = macd.signal[lastIndex];
    const prevSignal = getPrevValid(macd.signal, prevIndex);

    // Si faltan valores, no hay señal
    if (
      currentEMA7 === null ||
      currentEMA21 === null ||
      prevEMA7 === null ||
      prevEMA21 === null ||
      currentRSI === null ||
      prevRSI === null ||
      currentMACD === null ||
      prevMACD === null ||
      currentSignal === null ||
      prevSignal === null
    ) {
      return { action: "NONE", confidence: 0 };
    }

    let buySignals = 0;
    let sellSignals = 0;
    let totalSignals = 0;

    // Condición 1: Cruce de EMAs
    if (prevEMA7 <= prevEMA21 && currentEMA7 > currentEMA21) {
      buySignals++;
      totalSignals++;
    } else if (prevEMA7 >= prevEMA21 && currentEMA7 < currentEMA21) {
      sellSignals++;
      totalSignals++;
    }

    // Condición 2: Cruce de MACD y señal
    if (prevMACD <= prevSignal && currentMACD > currentSignal) {
      buySignals++;
      totalSignals++;
    } else if (prevMACD >= prevSignal && currentMACD < currentSignal) {
      sellSignals++;
      totalSignals++;
    }

    // Condición 3: RSI sale de sobreventa/sobrecompra
    if (prevRSI < 30 && currentRSI > 30) {
      buySignals++;
      totalSignals++;
    } else if (prevRSI > 70 && currentRSI < 70) {
      sellSignals++;
      totalSignals++;
    }

    if (totalSignals === 0) return { action: "NONE", confidence: 0 };

    const buyConfidence = buySignals / totalSignals;
    const sellConfidence = sellSignals / totalSignals;

    if (buyConfidence > sellConfidence && buyConfidence >= 0.5) {
      return { action: "BUY", confidence: buyConfidence };
    } else if (sellConfidence > buyConfidence && sellConfidence >= 0.5) {
      return { action: "SELL", confidence: sellConfidence };
    } else {
      return { action: "NONE", confidence: 0 };
    }
  }

  // ===========================================================================
  // MÉTODOS PÚBLICOS PARA EXPONER SEÑALES
  // ===========================================================================

  /**
   * Obtiene indicadores técnicos y señales para un símbolo específico
   * @param symbol Par (ej. 'BTCUSDC')
   * @param interval Intervalo de velas (ej. '1h', '1d')
   * @param limit Número de velas a obtener (recomendado >= 100)
   * @returns Objeto con precios, indicadores y señal
   */
  async getTechnicalSignals(
    symbol: string,
    interval: string = "1h",
    limit: number = 100
  ): Promise<{
    symbol: string;
    interval: string;
    lastClose: number;
    timestamp: number;
    indicators: {
      ema7: number[];
      ema21: number[];
      rsi: number[];
      macd: { macd: number[]; signal: number[]; histogram: number[] };
    };
    signals: { action: "BUY" | "SELL" | "NONE"; confidence: number };
  }> {
    try {
      // 1. Obtener velas
      const klines = await this.getKlines(symbol, interval, limit);
      const closes = klines.map((k) => k.close);

      // 2. Calcular indicadores
      const ema7 = this.calculateEMA(closes, 7);
      const ema21 = this.calculateEMA(closes, 21);
      const rsi = this.calculateRSI(closes, 14);
      const macd = this.calculateMACD(closes, 12, 26, 9);

      // 3. Evaluar señales
      const signals = this.evaluateSignals(closes, ema7, ema21, rsi, macd);

      return {
        symbol,
        interval,
        lastClose: closes[closes.length - 1],
        timestamp: Date.now(),
        indicators: {
          ema7,
          ema21,
          rsi,
          macd,
        },
        signals,
      };
    } catch (error) {
      console.error(`Error en getTechnicalSignals para ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Obtiene señales para todos los símbolos soportados
   * @param interval Intervalo de velas
   * @param limit Número de velas por símbolo
   * @returns Array de resultados (los que fallan se omiten)
   */
  async getAllTechnicalSignals(
    interval: string = "1h",
    limit: number = 100
  ): Promise<
    Array<{
      symbol: string;
      interval: string;
      lastClose: number;
      timestamp: number;
      indicators: any;
      signals: { action: "BUY" | "SELL" | "NONE"; confidence: number };
    }>
  > {
    const promises = SUPPORTED_SYMBOLS.map(async (symbol) => {
      try {
        console.log;
        return await this.getTechnicalSignals(symbol, interval, limit);
      } catch (error) {
        console.error(`Error obteniendo señales para ${symbol}:`, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter((r) => r !== null) as any[];
  }

  /**
   * Obtiene señales para un símbolo en un intervalo específico (uso interno)
   */
  private async getSignalsForInterval(
    symbol: string,
    interval: string,
    limit: number = 100
  ): Promise<IntervalSignal> {
    const klines = await this.getKlines(symbol, interval, limit);
    const closes = klines.map((k) => k.close);
    const ema7 = this.calculateEMA(closes, 7);
    const ema21 = this.calculateEMA(closes, 21);
    const rsi = this.calculateRSI(closes, 14);
    const macd = this.calculateMACD(closes, 12, 26, 9);
    const signals = this.evaluateSignals(closes, ema7, ema21, rsi, macd);
    return {
      interval,
      lastClose: closes[closes.length - 1],
      indicators: { ema7, ema21, rsi, macd },
      signals,
    };
  }

  /**
   * Obtiene señales combinadas para varios intervalos (ej. ['3m','5m'])
   */
  async getTechnicalSignalsMulti(
    symbol: string,
    intervals: string[] = ["3m", "5m"],
    limit: number = 100
  ): Promise<{
    symbol: string;
    timestamp: number;
    intervals: IntervalSignal[];
    combinedSignal: { action: "BUY" | "SELL" | "NONE"; confidence: number };
  }> {
    try {
      // Obtener señales para cada intervalo en paralelo
      const intervalPromises = intervals.map((interval) =>
        this.getSignalsForInterval(symbol, interval, limit).catch((err) => {
          console.error(`Error en intervalo ${interval} para ${symbol}:`, err);
          return null;
        })
      );
      const intervalResults = await Promise.all(intervalPromises);
      const validIntervals = intervalResults.filter(
        (r) => r !== null
      ) as IntervalSignal[];

      // Combinar señales: contamos cuántos intervalos dan BUY y cuántos SELL
      let buyCount = 0;
      let sellCount = 0;
      validIntervals.forEach((ir) => {
        if (ir.signals.action === "BUY") buyCount++;
        else if (ir.signals.action === "SELL") sellCount++;
      });
      const total = validIntervals.length;
      let combinedAction: "BUY" | "SELL" | "NONE" = "NONE";
      let combinedConfidence = 0;
      if (total > 0) {
        if (buyCount > sellCount) {
          combinedAction = "BUY";
          combinedConfidence = buyCount / total;
        } else if (sellCount > buyCount) {
          combinedAction = "SELL";
          combinedConfidence = sellCount / total;
        } else {
          combinedAction = "NONE";
          combinedConfidence = 0;
        }
      }

      return {
        symbol,
        timestamp: Date.now(),
        intervals: validIntervals,
        combinedSignal: {
          action: combinedAction,
          confidence: combinedConfidence,
        },
      };
    } catch (error) {
      console.error(`Error en getTechnicalSignalsMulti para ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Obtiene señales combinadas para todos los símbolos soportados
   */
  async getAllTechnicalSignalsMulti(
    intervals: string[] = ["3m", "5m"],
    limit: number = 100,
    simbolos: string[] = SUPPORTED_SYMBOLS
  ): Promise<
    Array<{
      symbol: string;
      timestamp: number;
      intervals: IntervalSignal[];
      combinedSignal: { action: "BUY" | "SELL" | "NONE"; confidence: number };
    }>
  > {
    const promises = simbolos.map(async (symbol) => {
      try {
        return await this.getTechnicalSignalsMulti(symbol, intervals, limit);
      } catch (error) {
        console.error(`Error obteniendo señales multi para ${symbol}:`, error);
        return null;
      }
    });
    const results = await Promise.all(promises);
    return results.filter((r) => r !== null) as any[];
  }

  /**
   * Ejecuta órdenes de compra/venta basadas en las señales combinadas.
   * @param credentials Credenciales de Binance
   * @param tradeAmountUSD Cantidad en USD (quote) a invertir en cada compra (por defecto 10)
   * @param intervals Intervalos a considerar
   * @param limit Número de velas por intervalo
   * @param cooldownMinutes Minutos de espera entre operaciones del mismo símbolo (por defecto 5)
   */
  async executeTrades(
    credentials: BinanceCredentials,
    userId: string,
    tradeAmountUSD: number = 10,
    intervals: string[] = ["3m", "5m"],
    simbolos: string[] = SUPPORTED_SYMBOLS,
    limit: number = 50,
    cooldownMinutes: number = 3
  ): Promise<{
    executed: {
      symbol: string;
      side: "BUY" | "SELL";
      success: boolean;
      order?: any;
      error?: string;
      skipped?: boolean;
      reason?: string;
      dbSaved?: boolean;
      confidence: number;
    }[];
  }> {
    const results: {
      symbol: string;
      side: "BUY" | "SELL";
      success: boolean;
      order?: any;
      error?: string;
      skipped?: boolean;
      reason?: string;
      dbSaved?: boolean;
      confidence: number;
    }[] = [];
    const cooldownMs = cooldownMinutes * 60 * 1000;

    try {
      // Obtener señales combinadas para todos los símbolos
      const allSignals = await this.getAllTechnicalSignalsMulti(
        intervals,
        limit,
        simbolos
      );

      for (const signal of allSignals) {
        const { symbol, combinedSignal } = signal;

        // Verificar cooldown
        const lastTrade = this.lastTradeTime.get(symbol);
        if (lastTrade && Date.now() - lastTrade < cooldownMs) {
          const minsLeft = (
            (cooldownMs - (Date.now() - lastTrade)) /
            60000
          ).toFixed(1);
          console.log(
            `⏳ Cooldown para ${symbol} (${minsLeft} min restantes). Omitiendo.`
          );
          results.push({
            symbol,
            side: combinedSignal.action === "BUY" ? "BUY" : "SELL",
            success: false,
            skipped: true,
            reason: `Cooldown activo (espera ${minsLeft} min)`,
            confidence: combinedSignal.confidence,
          });
          continue;
        }

        // Ignorar si confianza < 0.5
        if (combinedSignal.confidence < 0.5) continue;

        // ========== COMPRA ==========
        if (combinedSignal.action === "BUY") {
          console.log(
            `🔔 Señal de COMPRA para ${symbol} con confianza ${combinedSignal.confidence}. Verificando disponibilidad...`
          );

          const currentPrice = await this.getPrice(symbol);
          const symbolInfo = await this.getSymbolInfo(credentials, symbol);
          const minNotional = symbolInfo.minNotional || 5; // valor por defecto si no viene

          // 2. Ajustar el monto de compra si es menor que minNotional
          let montoCompra = tradeAmountUSD;
          if (montoCompra < minNotional) {
            console.log(
              `⚠️ tradeAmountUSD (${montoCompra}) es menor que minNotional (${minNotional}) para ${symbol}. Usando ${minNotional}`
            );
            montoCompra = minNotional;
          }
          const quantityBase = montoCompra / currentPrice;
          const rangoInferior = currentPrice * 0.996;
          const rangoSuperior = currentPrice * 1.004;

          // --- NUEVA VERIFICACIÓN: compra existente en rango ±0.4% ---
          const supabase = getSupabaseClient();
          const { data: compraExistente, error: errorExistente } =
            await supabase
              .from("compras")
              .select("id, precio")
              .eq("simbolo", symbol)
              .eq("idUsuario", userId)
              .eq("botS", true)
              .eq("vendida", false)
              .gte("precio", rangoInferior)
              .lte("precio", rangoSuperior)
              .limit(1);

          if (errorExistente) {
            console.error(
              "⚠️ Error verificando compras existentes:",
              errorExistente
            );
            results.push({
              symbol,
              side: "BUY",
              success: false,
              error: "Error al verificar compras previas",
              confidence: combinedSignal.confidence,
            });
            continue;
          }

          if (compraExistente && compraExistente.length > 0) {
            console.log(
              `⏭️ Ya existe una compra activa de ${symbol} en el rango de ±0.4% del precio actual (precio compra: ${compraExistente[0].precio}). Omitiendo.`
            );
            results.push({
              symbol,
              side: "BUY",
              success: false,
              skipped: true,
              reason: "Compra existente en rango de precio cercano",
              confidence: combinedSignal.confidence,
            });
            continue;
          }
          // -------------------------------------------------------------

          const availability = await this.checkBuyAvailability(
            credentials,
            symbol,
            quantityBase,
            currentPrice
          );
          if (!availability.canBuy) {
            console.log(
              `❌ No se puede comprar ${symbol}: saldo insuficiente de ${availability.quoteAsset}`
            );
            results.push({
              symbol,
              side: "BUY",
              success: false,
              error: `Saldo insuficiente de ${availability.quoteAsset}`,
              confidence: combinedSignal.confidence,
            });
            continue;
          }

          console.log(
            `✅ Disponibilidad OK. Ejecutando orden de compra para ${symbol}...`
          );
          const buyResult = await this.placeBuyOrder(credentials, {
            symbol,
            quoteOrderQty: montoCompra,
            type: "MARKET",
          });

          if (buyResult.success) {
            console.log(`✅ Orden de compra ejecutada para ${symbol}`);
            this.lastTradeTime.set(symbol, Date.now());

            let dbSaved = false;
            try {
              const supabase = getSupabaseClient();

              // Calcular comisión total en USDC
              let comisionTotalUSDC = 0;
              if (buyResult.order.fills && buyResult.order.fills.length > 0) {
                buyResult.order.fills.forEach((fill: any) => {
                  if (
                    fill.commissionAsset === "USDC" ||
                    fill.commissionAsset === "USDT"
                  ) {
                    comisionTotalUSDC += parseFloat(fill.commission);
                  }
                });
              }

              const datosCompra = {
                exchange: "Binance",
                idOrden: buyResult.order?.orderId?.toString() || "",
                simbolo: symbol,
                precio: buyResult.order?.fills?.[0]?.price
                  ? parseFloat(buyResult.order.fills[0].price)
                  : currentPrice,
                cantidad: quantityBase, // cantidad base comprada
                total: buyResult.order?.cummulativeQuoteQty
                  ? parseFloat(buyResult.order.cummulativeQuoteQty)
                  : null,
                comision: comisionTotalUSDC,
                comisionMoneda: "USDC",
                fechaCompra: buyResult.order?.transactTime
                  ? new Date(buyResult.order.transactTime).toISOString()
                  : new Date().toISOString(),
                vendida: false,
                idUsuario: userId,
                botS: true,
              };

              const { error: errorInsercion } = await supabase
                .from("compras")
                .insert([datosCompra]);
              if (errorInsercion) {
                console.error(
                  "⚠️ Error guardando compra en BD:",
                  errorInsercion
                );
              } else {
                console.log("✅ Compra guardada en base de datos local");
                dbSaved = true;
              }
            } catch (dbError) {
              console.error("⚠️ Error en guardado BD:", dbError);
            }

            results.push({
              symbol,
              side: "BUY",
              success: true,
              order: buyResult.order,
              dbSaved,
              confidence: combinedSignal.confidence,
            });
          } else {
            console.error(`❌ Error en compra de ${symbol}:`, buyResult.error);
            results.push({
              symbol,
              side: "BUY",
              success: false,
              error: buyResult.error,
              confidence: combinedSignal.confidence,
            });
          }
        }

        // ========== VENTA ==========
        else if (combinedSignal.action === "SELL") {
          console.log(
            `🔔 Señal de VENTA para ${symbol} con confianza ${combinedSignal.confidence}. Verificando disponibilidad...`
          );

          // Obtener precio actual y calcular umbral (0.5% por debajo)
          const currentPrice = await this.getPrice(symbol);
          const symbolInfo = await this.getSymbolInfo(credentials, symbol);
          const umbral = currentPrice * 0.995; // precio de compra debe ser menor a este valor

          // 1. Obtener balance disponible del activo base
          const availability = await this.checkSellAvailability(
            credentials,
            symbol,
            1,
            undefined
          );
          let balanceDisponible = availability.availableBalance;
          if (balanceDisponible <= 0) {
            console.log(
              `⚠️ No hay balance de ${availability.baseAsset} para vender.`
            );
            results.push({
              symbol,
              side: "SELL",
              success: false,
              error: `Balance insuficiente de ${availability.baseAsset}`,
              confidence: combinedSignal.confidence,
            });
            continue;
          }

          // 2. Buscar en BD todas las compras no vendidas de este símbolo con botS=true y precio < umbral
          const supabase = getSupabaseClient();
          const { data: compras, error: errorBusqueda } = await supabase
            .from("compras")
            .select("*")
            .eq("simbolo", symbol)
            .eq("idUsuario", userId)
            .eq("vendida", false)
            .eq("botS", true)
            .lt("precio", umbral) // precio de compra menor que el umbral
            .order("fechaCompra", { ascending: true });

          if (errorBusqueda || !compras || compras.length === 0) {
            console.log(
              `⚠️ No hay compras de ${symbol} con precio un 0.5% por debajo del actual (${currentPrice}). No se vende.`
            );
            results.push({
              symbol,
              side: "SELL",
              success: false,
              error: "No hay compras rentables para vender",
              confidence: combinedSignal.confidence,
            });
            continue;
          }

          console.log(
            `📦 Se encontraron ${compras.length} compra(s) que cumplen la condición.`
          );

          // 3. Verificar que el balance total sea suficiente para la suma de todas las cantidades
          const cantidadTotalAVender = compras.reduce(
            (sum, c) => sum + c.cantidad,
            0
          );
          if (balanceDisponible < cantidadTotalAVender) {
            console.log(
              `❌ Balance insuficiente para vender todas las compras elegibles. Disponible: ${balanceDisponible}, necesario: ${cantidadTotalAVender}.`
            );
            results.push({
              symbol,
              side: "SELL",
              success: false,
              error:
                "Balance insuficiente para vender todas las compras elegibles",
              confidence: combinedSignal.confidence,
            });
            continue;
          }

          // 4. Ejecutar ventas individuales para cada compra
          for (const compra of compras) {
            const cantidadOriginal = compra.cantidad;
            const stepSize = symbolInfo.stepSize || 1;
            const minQty = symbolInfo.minQty || 0;

            // Redondear hacia abajo al múltiplo de stepSize más cercano
            let cantidadAVender =
              Math.floor(cantidadOriginal / stepSize) * stepSize;

            // --- NUEVO: Ajustar precisión decimal ---
            const precision = stepSize.toString().split(".")[1]?.length || 0;
            cantidadAVender = parseFloat(cantidadAVender.toFixed(precision));

            // Si la cantidad redondeada es menor que el mínimo permitido, omitir esta compra
            if (cantidadAVender < minQty) {
              console.log(
                `⚠️ Cantidad redondeada ${cantidadAVender} < minQty (${minQty}) para ${symbol}. Omitiendo compra ${compra.id}.`
              );
              results.push({
                symbol,
                side: "SELL",
                success: false,
                skipped: true,
                reason: `Cantidad redondeada insuficiente (${cantidadAVender} < ${minQty})`,
                confidence: combinedSignal.confidence,
              });
              continue;
            }
            //valor mínimo de venta ---
            const valorVenta = cantidadAVender * currentPrice;
            const minNotional = symbolInfo.minNotional || 0;
            if (valorVenta < minNotional) {
              console.log(
                `⚠️ Valor de venta ${valorVenta.toFixed(
                  2
                )} es menor que minNotional (${minNotional}) para ${symbol}. Omitiendo compra ${
                  compra.id
                }.`
              );
              results.push({
                symbol,
                side: "SELL",
                success: false,
                skipped: true,
                reason: `Valor de venta (${valorVenta.toFixed(
                  2
                )}) menor que mínimo (${minNotional})`,
                confidence: combinedSignal.confidence,
              });
              continue;
            }
            // Verificar que la cantidad sea válida según los filtros de Binance (step size, minNotional, etc.)
            const sellCheck = await this.checkSellAvailability(
              credentials,
              symbol,
              cantidadAVender,
              currentPrice
            );
            if (!sellCheck.canSell) {
              console.log(
                `❌ No se puede vender ${cantidadAVender} de ${symbol} (compra ${compra.id}):`,
                sellCheck.reasons
              );
              results.push({
                symbol,
                side: "SELL",
                success: false,
                error: sellCheck.reasons?.join(", "),
                confidence: combinedSignal.confidence,
              });
              continue; // pasar a la siguiente compra
            }

            console.log(
              `✅ Vendiendo ${cantidadAVender} de ${symbol} correspondiente a compra ${compra.id}...`
            );
            const sellResult = await this.placeSellOrder(credentials, {
              symbol,
              quantity: cantidadAVender,
              type: "MARKET",
            });

            if (sellResult.success) {
              console.log(
                `✅ Orden de venta ejecutada para compra ${compra.id}`
              );
              this.lastTradeTime.set(symbol, Date.now());

              let dbSaved = false;
              try {
                // Calcular comisiones y precio promedio de venta
                let comisionTotalVenta = 0;
                let comisionMonedaVenta = "";
                let precioVentaReal = 0;

                if (
                  sellResult.order.fills &&
                  sellResult.order.fills.length > 0
                ) {
                  let totalCantidad = 0;
                  let totalValor = 0;
                  sellResult.order.fills.forEach((fill: any) => {
                    const cantidad = parseFloat(fill.qty);
                    const precio = parseFloat(fill.price);
                    totalCantidad += cantidad;
                    totalValor += cantidad * precio;

                    if (
                      fill.commissionAsset === "USDC" ||
                      fill.commissionAsset === "USDT"
                    ) {
                      comisionTotalVenta += parseFloat(fill.commission);
                      comisionMonedaVenta = fill.commissionAsset;
                    } else if (!comisionMonedaVenta) {
                      comisionMonedaVenta = fill.commissionAsset;
                    }
                  });
                  precioVentaReal = totalValor / totalCantidad;
                }

                const totalVentaReal = sellResult.order?.cummulativeQuoteQty
                  ? parseFloat(sellResult.order.cummulativeQuoteQty)
                  : cantidadAVender * precioVentaReal;

                // Calcular beneficio
                const totalCompra = compra.precio * cantidadAVender;
                const beneficio = totalVentaReal - totalCompra;
                const porcentajeBeneficio = (beneficio / totalCompra) * 100;

                // Insertar en tabla ventas
                const datosVenta = {
                  idCompra: compra.id,
                  exchange: "Binance",
                  simbolo: symbol,
                  precioVenta: precioVentaReal,
                  cantidadVendida: cantidadAVender,
                  comisionVenta: comisionTotalVenta,
                  comisionMoneda: comisionMonedaVenta,
                  beneficio: beneficio,
                  porcentajeBeneficio: porcentajeBeneficio,
                  idUsuario: userId,
                  fechaVenta: sellResult.order?.transactTime
                    ? new Date(sellResult.order.transactTime).toISOString()
                    : new Date().toISOString(),
                  botS: true,
                };

                const { error: errorVenta } = await supabase
                  .from("ventas")
                  .insert([datosVenta]);
                if (errorVenta) {
                  console.error("⚠️ Error guardando venta en BD:", errorVenta);
                } else {
                  console.log("✅ Venta guardada en base de datos");
                  dbSaved = true;
                }

                // Marcar la compra como vendida
                const { error: errorUpdateCompra } = await supabase
                  .from("compras")
                  .update({ vendida: true })
                  .eq("id", compra.id);

                if (errorUpdateCompra) {
                  console.error(
                    "⚠️ Error actualizando compra:",
                    errorUpdateCompra
                  );
                } else {
                  console.log("✅ Compra marcada como vendida");
                }

                // Restar del balance disponible (para control interno)
                balanceDisponible -= cantidadAVender;
              } catch (dbError) {
                console.error("⚠️ Error en guardado BD:", dbError);
              }

              results.push({
                symbol,
                side: "SELL",
                success: true,
                order: sellResult.order,
                dbSaved,
                confidence: combinedSignal.confidence,
              });
            } else {
              console.error(
                `❌ Error en venta de compra ${compra.id}:`,
                sellResult.error
              );
              results.push({
                symbol,
                side: "SELL",
                success: false,
                error: sellResult.error,
                confidence: combinedSignal.confidence,
              });
              // Si falla una orden, detenemos el proceso para este símbolo (podría afectar el balance)
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error("Error en executeTrades:", error);
      throw error;
    }

    return { executed: results };
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
