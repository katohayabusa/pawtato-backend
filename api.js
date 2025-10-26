// api.js - API REST per servire i dati al frontend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Endpoint: Ottieni candele OHLCV
app.get('/api/ohlcv/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { interval = '1h', limit = 100 } = req.query;
    
    // Mappa intervalli a minuti
    const intervalMinutes = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240,
      '1d': 1440
    };
    
    const minutes = intervalMinutes[interval] || 60;
    
    // Calcola timestamp di inizio
    const startTime = new Date(Date.now() - (limit * minutes * 60 * 1000)).toISOString();
    
    // Query database
    const { data, error } = await supabase
      .from('price_data')
      .select('*')
      .eq('token_name', token.toUpperCase())
      .gte('timestamp', startTime)
      .order('timestamp', { ascending: true });
    
    if (error) throw error;
    
    // Aggrega in candele
    const candles = aggregateToCandles(data, minutes, limit);
    
    res.json({
      success: true,
      token,
      interval,
      candles
    });
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint: Ottieni prezzo corrente e stats
app.get('/api/price/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const { data, error } = await supabase
      .from('price_data')
      .select('*')
      .eq('token_name', token.toUpperCase())
      .order('timestamp', { ascending: false })
      .limit(1);
    
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found for token'
      });
    }

    const currentData = data[0];
    
    // Calcola variazione 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: oldData } = await supabase
      .from('price_data')
      .select('price')
      .eq('token_name', token.toUpperCase())
      .lte('timestamp', oneDayAgo)
      .order('timestamp', { ascending: false })
      .limit(1);
    
    let priceChange24h = 0;
    if (oldData && oldData.length > 0) {
      priceChange24h = ((currentData.price - oldData[0].price) / oldData[0].price) * 100;
    }
    
    res.json({
      success: true,
      token,
      price: parseFloat(currentData.price),
      priceChange24h,
      timestamp: currentData.timestamp
    });
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint: Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Pawtato Price API'
  });
});

// Funzione per aggregare prezzi in candele
function aggregateToCandles(data, intervalMinutes, limit) {
  if (!data || data.length === 0) return [];
  
  const candles = [];
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Raggruppa per intervallo
  const groups = {};
  data.forEach(item => {
    const timestamp = new Date(item.timestamp).getTime();
    const bucketTime = Math.floor(timestamp / intervalMs) * intervalMs;
    
    if (!groups[bucketTime]) {
      groups[bucketTime] = [];
    }
    groups[bucketTime].push(parseFloat(item.price));
  });
  
  // Crea candele
  Object.keys(groups)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .slice(-limit)
    .forEach(time => {
      const prices = groups[time];
      if (prices.length > 0) {
        candles.push({
          time: parseInt(time) / 1000, // Unix timestamp in secondi
          open: prices[0],
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1],
          volume: 0
        });
      }
    });
  
  return candles;
}

// Avvia server
app.listen(PORT, () => {
  console.log(`🚀 Pawtato API Server running on http://localhost:${PORT}`);
  console.log(`📊 Endpoints:`);
  console.log(`   GET /api/ohlcv/:token?interval=1h&limit=100`);
  console.log(`   GET /api/price/:token`);
  console.log(`   GET /health`);
});
