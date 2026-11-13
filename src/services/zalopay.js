// ============================================================
// VIỆC NHÀ HÀNG — ZaloPay Integration
// ============================================================
const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const ZALOPAY_CONFIG = {
  app_id:   process.env.ZALOPAY_APP_ID     || '2553',
  key1:     process.env.ZALOPAY_KEY1       || 'PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL',
  key2:     process.env.ZALOPAY_KEY2       || 'kLtgPl8HHhfvMuDHPwKfgfsY4Vu/kZxk',
  endpoint: process.env.ZALOPAY_ENDPOINT   || 'https://sb-openapi.zalopay.vn/v2',
  callback_url: process.env.ZALOPAY_CALLBACK_URL
    || 'https://vnh-backend-production.up.railway.app/webhook/zalopay',
};

const PRICES = {
  post_job:         parseInt(process.env.PRICE_POST_JOB || '50000'),
  unlock_candidate: parseInt(process.env.PRICE_UNLOCK   || '500000'),
};

async function createOrder({ shopId, zaloId, orderType, refId, description }) {
  const amount = PRICES[orderType];
  if (!amount) throw new Error(`Unknown orderType: ${orderType}`);

  const app_trans_id = generateTransId();
  const app_time     = Date.now();

  const embed_data = JSON.stringify({ shopId, zaloId, orderType, refId });
  const item = JSON.stringify([{
    itemid: refId || 'vnh_service',
    itemname: description,
    itemprice: amount,
    itemquantity: 1,
  }]);

  const macData = [
    ZALOPAY_CONFIG.app_id, app_trans_id, shopId,
    amount, app_time, embed_data, item,
  ].join('|');

  const mac = crypto
    .createHmac('sha256', ZALOPAY_CONFIG.key1)
    .update(macData)
    .digest('hex');

  const payload = {
    app_id: parseInt(ZALOPAY_CONFIG.app_id),
    app_trans_id, app_user: shopId, app_time,
    amount, item, description, embed_data,
    callback_url: ZALOPAY_CONFIG.callback_url,
    mac,
  };

  try {
    const res = await axios.post(`${ZALOPAY_CONFIG.endpoint}/create`, payload);
    const data = res.data;
    if (data.return_code !== 1) {
      logger.error('ZaloPay create order failed', { return_message: data.return_message });
      return null;
    }
    logger.info('ZaloPay order created', { app_trans_id, orderType, amount });
    return { app_trans_id, order_url: data.order_url, order_token: data.zp_trans_token };
  } catch (err) {
    logger.error('ZaloPay API error', { error: err.message });
    return null;
  }
}

function verifyCallback(data, mac) {
  const expectedMac = crypto
    .createHmac('sha256', ZALOPAY_CONFIG.key2)
    .update(data)
    .digest('hex');
  return expectedMac === mac;
}

async function queryOrder(app_trans_id) {
  const macData = `${ZALOPAY_CONFIG.app_id}|${app_trans_id}|${ZALOPAY_CONFIG.key1}`;
  const mac = crypto.createHmac('sha256', ZALOPAY_CONFIG.key1).update(macData).digest('hex');
  try {
    const res = await axios.post(`${ZALOPAY_CONFIG.endpoint}/query`, {
      app_id: parseInt(ZALOPAY_CONFIG.app_id), app_trans_id, mac,
    });
    return res.data;
  } catch (err) {
    logger.error('ZaloPay query error', { error: err.message });
    return null;
  }
}

async function refundOrder({ zp_trans_id, amount, description }) {
  const timestamp = Date.now();
  const uid = `${timestamp}${Math.floor(Math.random() * 1000)}`;
  const macData = `${ZALOPAY_CONFIG.app_id}|${zp_trans_id}|${amount}|${description}|${uid}`;
  const mac = crypto.createHmac('sha256', ZALOPAY_CONFIG.key1).update(macData).digest('hex');
  try {
    const res = await axios.post(`${ZALOPAY_CONFIG.endpoint}/refund`, {
      app_id: parseInt(ZALOPAY_CONFIG.app_id), zp_trans_id, amount, description, timestamp, uid, mac,
    });
    logger.info('ZaloPay refund', { zp_trans_id, result: res.data.return_code });
    return res.data;
  } catch (err) {
    logger.error('ZaloPay refund error', { error: err.message });
    return null;
  }
}

function generateTransId() {
  const now = new Date();
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `${ymd}_${rand}`;
}

module.exports = { createOrder, verifyCallback, queryOrder, refundOrder, PRICES };
