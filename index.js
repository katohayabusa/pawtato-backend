// index.js - Backend per raccogliere prezzi dai pool Cetus
require('dotenv').config();
const { SuiClient } = require('@mysten/sui.js/client');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// Configurazione
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const suiClient = new SuiClient({ url: process.env.SUI_RPC_URL });

// Pool addresses Cetus
const POOLS = [
  {
    address: '0x79b48d6da07fe618e13dfc68a3192151cd1b0947c73c8f14f7b1162848cad09a',
    name: 'WATER',
    tokenADecimals: 6, // USDC
    tokenBDecimals: 9  // WATER - verifica i decimali corretti!
  },
  {
    address: '0x821412a926b922a96c05f96054f9fa40fbb03d53b87ea865c3d717b58bcb5a46',
    name: 'COAL',
    tokenADecimals: 6,
    tokenBDecimals: 9
  },
  {
    address: '0x674ec30e2e15ecfc3efd01b61a07c254ee68fabdb9af49422cf72461b8191230',
    name: 'CRYSTAL',
    tokenADecimals: 6,
    tokenBDecimals: 9
  }
];

// Funzione per ottenere i dati del pool dalla blockchain
async function getPoolData(poolAddress) {
  try {
    console.log(`Fetching data for pool: ${poolAddress}`);
    
    // Ottieni l'oggetto pool dalla blockchain SUI
    const poolObject = await suiClient.getObject({
      id: poolAddress,
      options: {
        showContent: true,
        showType: true
      }
    });

    if (!poolObject.data || !poolObject.data.content) {
      throw new Error('Pool object not found or invalid');
    }

    const content = poolObject.data.content;
    
    // I pool Cetus hanno una struttura specifica
    // Questi campi possono variare, verifica la struttura effettiva
    const fields = content.fields;
    
    return {
      sqrtPrice: fields.current_sqrt_price || fields.sqrt_price,
      liquidity: fields.liquidity,
      tick: fields.current_tick_index || fields.tick_current_index,
      feeGrowthGlobalA: fields.fee_growth_global_a,
      feeGrowthGlobalB: fields.fee_growth_global_b
    };
  } catch (error) {
    console.error(`Error fetching pool ${poolAddress}:`, error.message);
    throw error;
  }
}

// Converti sqrt_price in prezzo reale
function sqrtPriceToPrice(sqrtPrice, decimalsA, decimalsB) {
  const Q64 = Math.pow(2, 64);
  const price = Math.pow(Number(sqrtPrice) / Q64, 2);
  const adjustedPrice = price * Math.pow(10, decimalsA - decimalsB);
  return adjustedPrice;
}

// Salva il prezzo nel database
async function savePriceData(poolAddress, tokenName, price) {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('price_data')
      .insert([
        {
          pool_address: poolAddress,
          token_name: tokenName,
          price: price,
          timestamp: now,
          created_at: now, // Aggiungi anche created_at
          close: price // Per ora usiamo il prezzo spot come close
        }
      ]);

    if (error) throw error;
    console.log(`✅ Saved ${tokenName}: ${price.toFixed(8)}`);
    return data;
  } catch (error) {
    console.error(`Error saving to database:`, error.message);
    throw error;
  }
}

// Genera candele OHLCV dall'ultimo periodo
async function generateCandles(tokenName, interval = '1h') {
  try {
    const intervalMap = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240,
      '1d': 1440
    };
    
    const minutes = intervalMap[interval] || 60;
    const startTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    // Ottieni tutti i prezzi nell'intervallo
    const { data, error } = await supabase
      .from('price_data')
      .select('*')
      .eq('token_name', tokenName)
      .gte('timestamp', startTime)
      .order('timestamp', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    // Calcola OHLCV
    const prices = data.map(d => d.price);
    return {
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: 0, // TODO: calcola volume se disponibile
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error generating candles:`, error.message);
    return null;
  }
}

// Funzione principale che raccoglie i dati
async function collectPrices() {
  console.log('\n🔄 Starting price collection...', new Date().toLocaleString());
  
  for (const pool of POOLS) {
    try {
      // Ottieni dati on-chain
      const poolData = await getPoolData(pool.address);
      
      // Calcola prezzo
      const price = sqrtPriceToPrice(
        poolData.sqrtPrice,
        pool.tokenADecimals,
        pool.tokenBDecimals
      );
      
      // Salva nel database
      await savePriceData(pool.address, pool.name, price);
      
      // Pausa tra richieste per evitare rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`❌ Error processing ${pool.name}:`, error.message);
      continue;
    }
  }
  
  console.log('✅ Price collection completed\n');
}

// Avvia raccolta prezzi
async function start() {
  console.log('🥔 Pawtato Price Collector Started!');
  console.log('📊 Monitoring pools:', POOLS.map(p => p.name).join(', '));
  
  // Raccogli immediatamente all'avvio
  await collectPrices();
  
  // Poi ogni minuto
  cron.schedule('* * * * *', async () => {
    await collectPrices();
  });
  
  console.log('⏰ Scheduler active - collecting prices every minute');
}

// Gestione errori
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Avvia il backend
start().catch(console.error);
