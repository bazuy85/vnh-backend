// ============================================================
// VIỆC NHÀ HÀNG — Main Server
// ============================================================
require('dotenv').config();
const express = require('express');
const webhookRouter = require('./webhook');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON body
app.use(express.json());

// Log mọi request đến
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check — Railway dùng để kiểm tra server còn sống
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Viec Nha Hang',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});
// Zalo domain verification
app.get('/zalo_verifierGCJX3wQrQ3jvf-mclDTRF4l1oMEdjn8wCZSu.html', (req, res) => {
  res.type('html').send('GCJX3wQrQ3jvf-mclDTRF4l1oMEdjn8wCZSu');
});
// Zalo OA Webhook
app.use('/webhook/zalo', webhookRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Việc Nhà Hàng server started on port ${PORT}`);
  logger.info(`   Webhook URL: http://localhost:${PORT}/webhook/zalo`);
   logger.info(`   Health: http://localhost:${PORT}/health`);

  // Khởi động cron theo dõi 7 ngày
  const { startTrackingCron } = require('./services/tracking');
  startTrackingCron();
});
module.exports = app;
