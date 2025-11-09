import express from 'express'
import { getSupabaseClient } from '../lib/supabase.js'
import { decrypt } from '../lib/encriptacion.js'
import { binanceService } from '../services/servicioBinance.js'

export const binanceRouter = express.Router()

binanceRouter.get('/balance', async (req, res) => {
  try {
    const userId = req.query.userId as string
    if (!userId) {
      return res.json({ totalBalance: 0, connected: false, exchangesCount: 0 })
    }

    const supabase = getSupabaseClient()

    const { data: connection, error: connectionError } = await supabase
      .from('exchanges')
      .select('*')
      .eq('user_id', userId)
      .eq('exchange', 'BINANCE')
      .eq('is_active', true)
      .single()

    if (connectionError || !connection) {
      console.warn('⚠️ No hay conexión activa de Binance para el usuario:', userId)
      return res.json({ totalBalance: 0, connected: false, exchangesCount: 0 })
    }

    const apiKey = decrypt(connection.api_key)
    const apiSecret = decrypt(connection.api_secret)

    const totalBalance = await binanceService.getTotalUSDBalance({ apiKey, apiSecret })

    const { data: exchanges } = await supabase
      .from('exchanges')
      .select('exchange')
      .eq('user_id', userId)
      .eq('is_active', true)

    res.json({
      totalBalance,
      connected: true,
      exchangesCount: exchanges?.length || 0,
    })
  } catch (error) {
    console.error('❌ Error en /balance:', error)
    res.status(500).json({
      totalBalance: 0,
      connected: false,
      exchangesCount: 0,
      error: 'Error al obtener balance',
    })
  }
})

// Endpoint de diagnóstico opcional
binanceRouter.get('/diagnostic', async (_req, res) => {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ping')
    const status = response.ok ? '✅ OK' : `❌ ${response.status}`
    res.json({ binanceAPI: status })
  } catch (err) {
    res.status(500).json({ error: '❌ No se pudo conectar a Binance', details: String(err) })
  }
})


