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
  
  // Interface para la respuesta de la cuenta de Binance
  export interface BinanceAccountResponse {
    balances: BinanceBalance[];
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