 // ============================================================
// VIỆC NHÀ HÀNG — Main Server
// ============================================================
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const webhookRouter = require('./webhook');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON body
app.use(express.json());
app.use(cookieParser());

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
  res.type('html').send(`<!DOCTYPE html>
<html>
<head>
<meta name="zalo-platform-site-verification" content="GCJX3wQrQ3jvf-mclDTRF4l1oMEdjn8wCZSu" />
<title>Zalo Verify</title>
</head>
<body>GCJX3wQrQ3jvf-mclDTRF4l1oMEdjn8wCZSu</body>
</html>`);
});

// Zalo OAuth start — redirect tới trang xác thực OA
app.get('/oauth/zalo/start', (req, res) => {
  const url = `https://oauth.zaloapp.com/v4/oa/permission?app_id=3316650632987873364` +
    `&redirect_uri=https://vnh-backend-production.up.railway.app/oauth/zalo/callback` +
    `&state=vnh123`;
  res.redirect(url);
});

// Zalo OAuth callback — LẤY REFRESH TOKEN (tạm thời hardcode)
app.get('/oauth/zalo/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('Thiếu code');
  try {
    const axios = require('axios');
    const r = await axios.post('https://oauth.zaloapp.com/v4/oa/access_token', null, {
      params: {
        app_id: '3316650632987873364',
        code,
        grant_type: 'authorization_code',
      },
      headers: { secret_key: 'Y1o3I73CbDJEzUB1v22p' }
    });
    res.send(`<pre>${JSON.stringify(r.data, null, 2)}</pre>`);
  } catch(e) { res.send('Lỗi: ' + e.message); }
});

// ZaloPay callback webhook
app.post('/webhook/zalopay', async (req, res) => {
  const { handleZaloPayCallback } = require('./flows/shop-payment');
  return handleZaloPayCallback(req, res);
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
