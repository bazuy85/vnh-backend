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
  res.type('html').send(`<!DOCTYPE html>
<html>
<head>
<meta name="zalo-platform-site-verification" content="GCJX3wQrQ3jvf-mclDTRF4l1oMEdjn8wCZSu" />
<title>Zalo Verify</title>
</head>
<body>GCJX3wQrQ3jvf-mclDTRF4l1oMEdjn8wCZSu</body>
</html>`);
});
// Zalo OAuth callback — LẤY REFRESH TOKEN (tạm thời)
app.get('/oauth/zalo/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('Thiếu code');
  try {
    const axios = require('axios');
    const r = await axios.post('https://oauth.zaloapp.com/v4/oa/access_token', null, {
      params: { app_id: process.env.ZALO_APP_ID, code, grant_type: 'authorization_code' },
      headers: { secret_key: process.env.ZALO_APP_SECRET }
    });
    res.send(`<pre>ACCESS_TOKEN: ${r.data.access_token}\n\nREFRESH_TOKEN: ${r.data.refresh_token}\n\nExpires in: ${r.data.expires_in}s</pre>`);
  } catch(e) { res.send('Lỗi: ' + e.message); }
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
