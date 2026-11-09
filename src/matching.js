// ============================================================
// VIỆC NHÀ HÀNG — Matching Engine
// Ghép người tìm việc với tin tuyển dụng
//
// Điểm tối đa: 100
//   - Khoảng cách    : 30 điểm
//   - Lương          : 20 điểm
//   - Kinh nghiệm    : 20 điểm
//   - Yêu cầu mềm   : 15 điểm (LLM hoặc keyword)
//   - Uy tín quán    : 15 điểm
// ============================================================
const supabase = require('../db/supabase');
const logger = require('../utils/logger');

const geocodeCache = new Map();

async function geocodeAddress(address) {
  if (!address) return null;
  const cacheKey = address.toLowerCase().trim();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  if (!process.env.GOOGLE_MAPS_KEY) {
    const coords = getHanoiDistrictCoords(address);
    if (coords) { geocodeCache.set(cacheKey, coords); return coords; }
    return null;
  }
  try {
    const axios = require('axios');
    const query = encodeURIComponent(`${address}, Hà Nội, Việt Nam`);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GOOGLE_MAPS_KEY}`;
    const res = await axios.get(url, { timeout: 3000 });
    if (res.data.results && res.data.results.length > 0) {
      const loc = res.data.results[0].geometry.location;
      const coords = { lat: loc.lat, lng: loc.lng };
      geocodeCache.set(cacheKey, coords);
      return coords;
    }
  } catch (err) {
    logger.warn('Geocoding failed', { address, error: err.message });
  }
  const coords = getHanoiDistrictCoords(address);
  if (coords) geocodeCache.set(cacheKey, coords);
  return coords;
}

function getHanoiDistrictCoords(text) {
  const t = text.toLowerCase();
  const districts = {
    'hoàn kiếm': { lat: 21.0285, lng: 105.8542 }, 'hoan kiem': { lat: 21.0285, lng: 105.8542 },
    'ba đình': { lat: 21.0358, lng: 105.8406 }, 'ba dinh': { lat: 21.0358, lng: 105.8406 },
    'đống đa': { lat: 21.0245, lng: 105.8412 }, 'dong da': { lat: 21.0245, lng: 105.8412 },
    'hai bà trưng': { lat: 21.0167, lng: 105.8600 }, 'hai ba trung': { lat: 21.0167, lng: 105.8600 },
    'tây hồ': { lat: 21.0712, lng: 105.8220 }, 'tay ho': { lat: 21.0712, lng: 105.8220 },
    'cầu giấy': { lat: 21.0317, lng: 105.7978 }, 'cau giay': { lat: 21.0317, lng: 105.7978 },
    'thanh xuân': { lat: 20.9950, lng: 105.8167 }, 'thanh xuan': { lat: 20.9950, lng: 105.8167 },
    'hoàng mai': { lat: 20.9800, lng: 105.8600 }, 'hoang mai': { lat: 20.9800, lng: 105.8600 },
    'long biên': { lat: 21.0469, lng: 105.8900 }, 'long bien': { lat: 21.0469, lng: 105.8900 },
    'nam từ liêm': { lat: 21.0100, lng: 105.7700 }, 'nam tu liem': { lat: 21.0100, lng: 105.7700 },
    'bắc từ liêm': { lat: 21.0600, lng: 105.7700 }, 'bac tu liem': { lat: 21.0600, lng: 105.7700 },
    'hà đông': { lat: 20.9700, lng: 105.7800 }, 'ha dong': { lat: 20.9700, lng: 105.7800 },
    'đông anh': { lat: 21.1500, lng: 105.8500 }, 'dong anh': { lat: 21.1500, lng: 105.8500 },
    'gia lâm': { lat: 21.0200, lng: 105.9300 }, 'gia lam': { lat: 21.0200, lng: 105.9300 },
  };
  for (const [key, coords] of Object.entries(districts)) {
    if (t.includes(key)) return coords;
  }
  return { lat: 21.0285, lng: 105.8542 };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function passHardFilters(user, job) {
  if (user.desired_role && job.role) {
    if (normalizeRole(user.desired_role) !== normalizeRole(job.role)) return false;
  }
  if (user.min_salary && job.salary_max) {
    if (user.min_salary > job.salary_max) return false;
  }
  if (user.available_shifts && job.required_shifts) {
    const overlap = toArray(user.available_shifts).some(s => toArray(job.required_shifts).includes(s));
    if (!overlap) return false;
  }
  if (job.min_experience_months != null && user.experience_months != null) {
    if (user.experience_months < job.min_experience_months) return false;
  }
  return true;
}

async function scoreMatch(user, job, userCoords, jobCoords) {
  let score = 0;
  const breakdown = {};

  if (userCoords && jobCoords) {
    const km = haversineKm(userCoords.lat, userCoords.lng, jobCoords.lat, jobCoords.lng);
    const distScore = Math.max(0, 30 - km * 3);
    score += distScore;
    breakdown.distance = { km: Math.round(km*10)/10, score: Math.round(distScore) };
  }

  if (user.min_salary && job.salary_min && job.salary_max) {
    const mid = (job.salary_min + job.salary_max) / 2;
    const salaryScore = Math.min(20, Math.max(0, (mid / user.min_salary) * 20));
    score += salaryScore;
    breakdown.salary = { jobMid: mid, userMin: user.min_salary, score: Math.round(salaryScore) };
  } else {
    score += 10; breakdown.salary = { score: 10, note: 'missing data' };
  }

  if (user.experience_months != null && job.min_experience_months != null) {
    const extra = user.experience_months - job.min_experience_months;
    const expScore = extra < 0 ? 0 : extra === 0 ? 15 : Math.min(20, 15 + extra * 0.5);
    score += expScore;
    breakdown.experience = { userMonths: user.experience_months, jobMin: job.min_experience_months, score: Math.round(expScore) };
  } else {
    score += 10; breakdown.experience = { score: 10, note: 'missing data' };
  }

  const softScore = scoreSoftRequirements(user, job);
  score += softScore; breakdown.soft = { score: softScore };

  const repScore = await scoreReputation(job.shop_id);
  score += repScore; breakdown.reputation = { score: repScore };

  return { total: Math.round(Math.min(100, score)), breakdown };
}

function scoreSoftRequirements(user, job) {
  if (!job.soft_requirements) return 8;
  const req = job.soft_requirements.toLowerCase();
  const combined = ((user.bio || '') + ' ' + toArray(user.skills || []).join(' ')).toLowerCase();
  const keywords = ['nhanh nhẹn','nhanh nhen','chăm chỉ','cham chi','thân thiện','than thien',
    'giao tiếp','giao tiep','chịu áp lực','chiu ap luc','teamwork','trung thực','trung thuc','đúng giờ','dung gio'];
  let matches = 0;
  for (const kw of keywords) { if (req.includes(kw) && combined.includes(kw)) matches++; }
  return Math.min(15, 8 + matches * 2);
}

async function scoreReputation(shopId) {
  if (!shopId) return 8;
  try {
    const { data: events } = await supabase.from('reputation_events').select('delta').eq('shop_id', shopId);
    if (!events || events.length === 0) return 8;
    const total = events.reduce((sum, e) => sum + (e.delta || 0), 0);
    return Math.min(15, Math.max(0, Math.round(total / 100 * 15)));
  } catch { return 8; }
}

async function findMatchesForUser(userId) {
  logger.info('Finding matches', { userId });
  const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', userId).single();
  if (userErr || !user) { logger.error('User not found', { userId }); return []; }

  const { data: jobs, error: jobErr } = await supabase.from('job_posts').select('*, shops(name, address, district)').eq('status', 'active');
  if (jobErr || !jobs || jobs.length === 0) { logger.info('No active jobs found'); return []; }

  const userCoords = await geocodeAddress(user.district || user.address);
  const results = [];

  for (const job of jobs) {
    if (!passHardFilters(user, job)) continue;
    const jobCoords = await geocodeAddress(job.shops?.district || job.shops?.address || job.district);
    const { total, breakdown } = await scoreMatch(user, job, userCoords, jobCoords);
    if (total >= 40) {
      results.push({ job_post_id: job.id, shop_name: job.shops?.name || 'Quán không tên',
        role: job.role, salary_min: job.salary_min, salary_max: job.salary_max,
        district: job.shops?.district || '', distance_km: breakdown.distance?.km, score: total, breakdown });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 10);

  for (const r of top) {
    await supabase.from('matches').upsert({
      user_id: userId, job_post_id: r.job_post_id, score: r.score,
      score_breakdown: r.breakdown, status: 'pending', created_at: new Date().toISOString()
    }, { onConflict: 'user_id,job_post_id' });
  }

  logger.info('Matches found', { userId, count: top.length });
  return top;
}

function normalizeRole(role) {
  if (!role) return '';
  const r = role.toLowerCase().trim();
  if (r.includes('phục vụ') || r.includes('phuc vu') || r.includes('server')) return 'phuc_vu';
  if (r.includes('bếp') || r.includes('bep') || r.includes('cook') || r.includes('chef')) return 'bep';
  if (r.includes('pha chế') || r.includes('pha che') || r.includes('bartender') || r.includes('barista')) return 'pha_che';
  if (r.includes('thu ngân') || r.includes('thu ngan') || r.includes('cashier')) return 'thu_ngan';
  if (r.includes('quản lý') || r.includes('quan ly') || r.includes('manager')) return 'quan_ly';
  return r;
}

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

module.exports = { findMatchesForUser, geocodeAddress, haversineKm, passHardFilters, scoreMatch, normalizeRole };
