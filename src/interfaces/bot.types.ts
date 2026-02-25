export interface SimboloConfig {
  symbol: string;
  lowerLimit?: number | null;
  upperLimit?: number | null;
}

export interface BotConfig {
  tradeAmountUSD: number;
  intervals: string[];
  simbolos: SimboloConfig[]; // Ahora almacena objeto con límites
  limit: number;
  cooldownMinutes: number;
  fechaActivacion?: string;
  maxInversion: number;
}
