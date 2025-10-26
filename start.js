// start.js - Avvia sia collector che API
const { spawn } = require('child_process');

console.log('🥔 Starting Pawtato Backend Services...\n');

// Avvia collector
const collector = spawn('node', ['index.js'], { stdio: 'inherit' });

// Avvia API dopo 2 secondi
setTimeout(() => {
  const api = spawn('node', ['api.js'], { stdio: 'inherit' });
  
  api.on('error', (error) => {
    console.error('API Error:', error);
  });
}, 2000);

collector.on('error', (error) => {
  console.error('Collector Error:', error);
});

// Gestione chiusura
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down services...');
  collector.kill();
  process.exit(0);
});
