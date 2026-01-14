export interface BinanceCredentials {
    apiKey: string;
    apiSecret: string;
  }
  
  export interface BinanceBalance {
    asset: string;
    free: string;
    locked: string;
  }
  
  export interface FlexiblePosition {
    asset: string;
    totalAmount: string;
    annualPercentageRate: string;
  }
  
  export interface LockedPosition {
    asset: string;
    totalAmount: string;
    positionId: string;
    projectId: string;
  }
  
  export interface SimpleEarnAccount {
    totalAmountInBTC?: string;
    totalAmountInUSDT?: string;
    totalFlexibleAmountInBTC?: string;
    totalLockedAmountInBTC?: string;
  }
  
  export interface TickerPrice {
    symbol: string;
    price: string;
  }
  
  export interface SimpleEarnFlexibleResponse {
    rows: FlexiblePosition[];
    total: number;
  }
  
  export interface SimpleEarnLockedResponse {
    rows: LockedPosition[];
    total: number;
  }
  
  export interface TradeFeeResponse {
    symbol: string;
    makerCommission: string; // Binance devuelve estos como strings
    takerCommission: string;
    // Puede haber otros campos según la respuesta
  }
  
  // Interface para la respuesta de la cuenta de Binance
  export interface BinanceAccountResponse {
    makerCommission: number;
    takerCommission: number;
    buyerCommission: number;
    sellerCommission: number;
    canTrade: boolean;
    canWithdraw: boolean;
    canDeposit: boolean;
    updateTime: number;
    accountType: string;
    balances: BinanceBalance[];
    permissions: string[];
    // otras propiedades que pueda tener la respuesta...
  }
  
  // Añade estas interfaces en servicioBinance.ts
  export interface BinanceTrade {
    id: number;
    orderId: number;
    symbol: string;
    price: string;
    qty: string;
    quoteQty: string;
    commission: string;
    commissionAsset: string;
    time: number;
    isBuyer: boolean;
    isMaker: boolean;
    isBestMatch: boolean;
  }
  
  export interface TradeHistoryParams {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    fromId?: number;
    limit?: number;
  }

  // Agrega estas interfaces si no las tienes
export interface BinanceOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  strategyId?: number;
  strategyType?: number;
  workingTime: number;
  selfTradePreventionMode: string;
  fills: Array<{
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
    tradeId: number;
  }>;
}

export interface PlaceOrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT' | 'LIMIT_MAKER';
  quantity?: number | string;
  quoteOrderQty?: number | string;
  price?: number | string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  newClientOrderId?: string;
  stopPrice?: number | string;
}

export interface OrderResponse {
  success: boolean;
  order?: BinanceOrder;
  error?: string;
  code?: number;
}
export interface ExchangeInfoResponse {
  timezone: string;
  serverTime: number;
  rateLimits: Array<{
    rateLimitType: string;
    interval: string;
    intervalNum: number;
    limit: number;
  }>;
  exchangeFilters: any[];
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    baseAssetPrecision: number;
    quoteAsset: string;
    quotePrecision: number;
    quoteAssetPrecision: number;
    baseCommissionPrecision: number;
    quoteCommissionPrecision: number;
    orderTypes: string[];
    icebergAllowed: boolean;
    ocoAllowed: boolean;
    quoteOrderQtyMarketAllowed: boolean;
    isSpotTradingAllowed: boolean;
    isMarginTradingAllowed: boolean;
    filters: Array<{
      filterType: string;
      [key: string]: any;
    }>;
    permissions: string[];
  }>;
}