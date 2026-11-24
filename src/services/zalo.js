// ============================================================
// Zalo OA API — gửi tin nhắn cho user
// ============================================================
const axios = require('axios');
const logger = require('../utils/logger');

const ZALO_API_BASE = 'https://openapi.zalo.me/v3.0/oa';

// Cache access token (Zalo token hết hạn sau 1 giờ)
let accessToken = null;
let tokenExpiry = 0;

// Lấy access token từ app credentials
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  try {
    const res = await axios.post('https://oauth.zaloapp.com/v4/oa/access_token', null, {
      params: {
        app_id: process.env.ZALO_APP_ID,
        grant_type: 'refresh_token',
        refresh_token: process.env.ZALO_REFRESH_TOKEN,
      },
      headers: { secret_key: process.env.ZALO_APP_SECRET }
    });

    // Zalo trả HTTP 200 ngay cả khi lỗi — PHẢI kiểm tra body
    if (res.data.error && res.data.error !== 0) {
      throw new Error(`Zalo token error ${res.data.error}: ${res.data.message}`);
    }
    if (!res.data.access_token) {
      logger.error('Zalo token refresh: no access_token in response', { body: JSON.stringify(res.data) });
      throw new Error('Zalo did not return access_token');
    }

    accessToken = res.data.access_token;
    const expiresIn = parseInt(res.data.expires_in, 10) || 3600;
    tokenExpiry = Date.now() + (expiresIn - 60) * 1000; // trừ 60s buffer
    logger.info('Zalo access token refreshed', { expiresIn, tokenPreview: accessToken.substring(0, 12) + '...' });
    return accessToken;
  } catch (err) {
    logger.error('Failed to get Zalo access token', { error: err.message });
    accessToken = null; // reset cache khi lỗi
    tokenExpiry = 0;
    throw err;
  }
}

// Gửi tin nhắn văn bản thường
async function sendText(zaloUserId, text) {
  try {
    const token = await getAccessToken();
    const res = await axios.post(`${ZALO_API_BASE}/message/cs`, {
      recipient: { user_id: zaloUserId },
      message: { text }
    }, {
      headers: { access_token: token }
    });

    // Zalo trả HTTP 200 ngay cả khi lỗi — PHẢI kiểm tra body
    if (res.data.error !== 0) {
      throw new Error(`Zalo API error ${res.data.error}: ${res.data.message}`);
    }
    logger.info('Text sent OK', { zaloUserId, msgId: res.data.data?.message_id, preview: text.substring(0, 50) });
  } catch (err) {
    logger.error('Failed to send text message', { zaloUserId, error: err.message });
    throw err;
  }
}

// Gửi tin nhắn với nút bấm (button template)
async function sendButtons(zaloUserId, text, buttons) {
  // buttons: [{ title: 'Phục vụ', payload: 'role_phuc_vu' }, ...]
  // Thử dùng list template trước; nếu Zalo báo lỗi → fallback về text
  try {
    const token = await getAccessToken();
    const elements = buttons.map(btn => ({
      title: btn.title,
      image_url: btn.imageUrl || '',
      subtitle: btn.subtitle || '',
      default_action: { type: 'oa.query.show', payload: btn.payload },
      buttons: [{
        title: btn.title,
        type: 'oa.query.show',
        payload: btn.payload
      }]
    }));

    const res = await axios.post(`${ZALO_API_BASE}/message/cs`, {
      recipient: { user_id: zaloUserId },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'list',
            elements,
          }
        }
      }
    }, {
      headers: { access_token: token }
    });

    // Zalo trả HTTP 200 ngay cả khi lỗi — PHẢI kiểm tra body
    if (res.data.error !== 0) {
      throw new Error(`Zalo template error ${res.data.error}: ${res.data.message}`);
    }
    logger.info('Buttons sent OK', { zaloUserId, buttonCount: buttons.length, msgId: res.data.data?.message_id });
  } catch (err) {
    // Fallback: gửi text với danh sách đánh số nếu template lỗi
    logger.warn('Button template failed, falling back to text', { zaloUserId, error: err.message });
    const fallback = text + '\n\n' + buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n') +
      '\n\n(Nhắn số hoặc tên để chọn)';
    await sendText(zaloUserId, fallback);
  }
}

// Gửi ZNS (Zalo Notification Service) — chỉ dùng được với Certified OA
async function sendZNS(zaloPhone, templateId, templateData) {
  try {
    const token = await getAccessToken();
    const res = await axios.post('https://business.openapi.zalo.me/message/template', {
      phone: zaloPhone,
      template_id: templateId,
      template_data: templateData,
      tracking_id: `vnh_${Date.now()}`
    }, {
      headers: { access_token: token }
    });

    logger.info('ZNS sent', { phone: zaloPhone, templateId });
    return res.data;
  } catch (err) {
    logger.error('ZNS send failed', { phone: zaloPhone, templateId, error: err.message });
    throw err;
  }
}

module.exports = { sendText, sendButtons, sendZNS, getAccessToken };
