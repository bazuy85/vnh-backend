// ============================================================
// Flow chủ quán — Onboarding profile + Đăng tin tuyển dụng
// Schema: users (zalo_id, role='shop_owner', name, onboarding_completed)
//         shops (owner_id -> users.id, name, address, district,
//                type, zalo_id, onboarding_completed)
//         job_posts (shop_id, role, salary_min, salary_max,
//                    shift, requirements, status)
// ============================================================
const { sendText, sendButtons } = require('../services/zalo');
const { getSession, updateSession, clearSession } = require('../services/session');
const supabase = require('../db/supabase');
const logger = require('../utils/logger');

const ROLES = {
  'phuc_vu':   'Phục vụ / Nhân viên bàn',
  'bep':       'Nhân viên bếp / Phụ bếp',
  'bartender': 'Bartender / Pha chế',
  'thu_ngan':  'Thu ngân',
  'quan_ly':   'Quản lý / Trưởng ca',
};

const SHIFTS = {
  'sang':  'Ca sáng (6h–14h)',
  'chieu': 'Ca chiều (14h–22h)',
  'toi':   'Ca tối (18h–24h)',
};

function normalize(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').trim();
}

function detectRole(text) {
  const t = normalize(text);
  if (t.includes('phuc vu') || t === '1') return 'phuc_vu';
  if (t.includes('bep') || t.includes('nau') || t === '2') return 'bep';
  if (t.includes('bar') || t.includes('pha che') || t === '3') return 'bartender';
  if (t.includes('thu ngan') || t === '4') return 'thu_ngan';
  if (t.includes('quan ly') || t.includes('truong ca') || t === '5') return 'quan_ly';
  return null;
}

function detectShift(text) {
  const t = normalize(text);
  if (t === 'shift_all' || t.includes('linh hoat') || t.includes('tat ca')) return 'linh hoạt';
  if (t.includes('sang') || t === 'shift_sang') return 'sáng';
  if (t.includes('chieu') || t === 'shift_chieu') return 'chiều';
  if (t.includes('toi') || t === 'shift_toi') return 'tối';
  return 'linh hoạt';
}

function parseSalary(text) {
  const t = normalize(text).replace(/[,\.]/g, '');
  const match = t.match(/(\d+)/);
  if (!match) return null;
  let num = parseInt(match[1]);
  if (num < 1000) num = num * 1_000_000;
  else if (num < 10_000) num = num * 1_000;
  return num;
}

// ============================================================
// ENTRY POINT
// ============================================================
async function handleShopMessage(zaloId, messageText, displayName) {
  const session = await getSession(zaloId);

  // Đang trong flow profile quán
  if (session?.flow === 'shop_profile') {
    return processShopProfile(zaloId, messageText, session);
  }

  // Đang trong flow đăng tin
  if (session?.flow === 'shop_post_job') {
    // Lấy thông tin quán
    const shop = await getShopByZaloId(zaloId);
    if (!shop) { await clearSession(zaloId); return startShopProfile(zaloId, displayName); }
    return processJobPost(zaloId, messageText, session, shop);
  }

  // Kiểm tra đã onboard chưa (tìm qua users → shops)
  const shop = await getShopByZaloId(zaloId);

  if (!shop || !shop.onboarding_completed) {
    return startShopProfile(zaloId, displayName);
  }

  return handleShopCommands(zaloId, messageText, shop);
}

// Helper: lấy shop từ zalo_id (qua bảng shops.zalo_id denorm)
async function getShopByZaloId(zaloId) {
  const { data } = await supabase
    .from('shops')
    .select('id, name, district, type, onboarding_completed, zalo_id')
    .eq('zalo_id', zaloId)
    .maybeSingle();
  return data;
}

// ============================================================
// Flow 1: Onboarding profile quán (1 lần duy nhất)
// ============================================================
async function startShopProfile(zaloId, displayName) {
  await updateSession(zaloId, { flow: 'shop_profile', step: 'q1_shop_name', displayName });
  const name = displayName ? `, ${displayName.split(' ').pop()}` : '';

  await sendText(zaloId,
    `Chào bạn${name}! 👋 Mình là Việc Nhà Hàng.\n\n` +
    `Mình giúp quán F&B tìm nhân viên nhanh — không qua trung gian, tự động lọc theo vị trí và khoảng cách.\n\n` +
    `Phí đăng tin: **50.000đ/tin**\n\n` +
    `Đầu tiên, cho mình biết thêm về quán nhé! 📋`
  );

  await sendText(zaloId, '📌 Bước 1/3 — Quán của bạn tên là gì?');
}

async function processShopProfile(zaloId, text, session) {
  const step = session.step;

  // Bước 1: Tên quán
  if (step === 'q1_shop_name') {
    await updateSession(zaloId, { step: 'q2_address', shop_name: text.trim() });
    await sendText(zaloId,
      `✅ Tên quán: **${text.trim()}**\n\n` +
      `📌 Bước 2/3 — Địa chỉ quán ở đâu? (kèm quận)\n` +
      `Ví dụ: 123 Lý Tự Trọng, Quận 1`
    );
    return;
  }

  // Bước 2: Địa chỉ
  if (step === 'q2_address') {
    // Trích quận từ địa chỉ
    const addressLower = text.toLowerCase();
    let district = null;
    const districtPatterns = [
      'quận 1', 'quận 2', 'quận 3', 'quận 4', 'quận 5',
      'quận 6', 'quận 7', 'quận 8', 'quận 9', 'quận 10',
      'quận 11', 'quận 12', 'bình thạnh', 'gò vấp', 'phú nhuận',
      'tân bình', 'tân phú', 'bình tân', 'thủ đức', 'bình dương',
      'hóc môn', 'củ chi', 'nhà bè', 'cần giờ', 'bình chánh',
    ];
    for (const d of districtPatterns) {
      if (addressLower.includes(d)) { district = d; break; }
    }

    await updateSession(zaloId, { step: 'q3_shop_type', address: text.trim(), district });
    await sendButtons(zaloId,
      `✅ Địa chỉ: **${text.trim()}**\n\n📌 Bước 3/3 — Quán thuộc loại nào?`,
      [
        { title: '🍜 Quán ăn / Nhà hàng', payload: 'type_restaurant' },
        { title: '☕ Cà phê / Trà sữa',   payload: 'type_cafe' },
        { title: '🍺 Bar / Pub',           payload: 'type_bar' },
        { title: '🥐 Bánh mì / Fast food', payload: 'type_fastfood' },
      ]
    );
    return;
  }

  // Bước 3: Loại quán
  if (step === 'q3_shop_type') {
    const typeMap = {
      'type_restaurant': 'restaurant',
      'type_cafe':       'cafe',
      'type_bar':        'bar',
      'type_fastfood':   'fastfood',
    };
    const shopType = typeMap[text] || 'restaurant';
    await updateSession(zaloId, { shop_type: shopType });
    return completeShopProfile(zaloId);
  }
}

async function completeShopProfile(zaloId) {
  const session = await getSession(zaloId);
  try {
    // Tạo/cập nhật user với role shop_owner
    const { data: user, error: userErr } = await supabase
      .from('users')
      .upsert({
        zalo_id:              zaloId,
        name:                 session.displayName || null,
        role:                 'shop_owner',
        status:               'active',
        onboarding_completed: true,
        last_active_at:       new Date().toISOString(),
      }, { onConflict: 'zalo_id' })
      .select('id').single();

    if (userErr) throw userErr;

    // Tạo/cập nhật shop
    const { error: shopErr } = await supabase
      .from('shops')
      .upsert({
        zalo_id:              zaloId,          // denorm để query nhanh
        owner_id:             user.id,
        name:                 session.shop_name,
        address:              session.address,
        district:             session.district,
        type:                 session.shop_type,
        status:               'active',
        onboarding_completed: true,
        last_active_at:       new Date().toISOString(),
      }, { onConflict: 'zalo_id' });

    if (shopErr) throw shopErr;

    await clearSession(zaloId);
    await sendText(zaloId,
      `🎉 Hồ sơ quán đã được lưu!\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🏪 Quán: ${session.shop_name}\n` +
      `📍 Địa chỉ: ${session.address}\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `Bây giờ bạn có thể đăng tin tuyển dụng!\n\n` +
      `Gõ **đăng tin** để bắt đầu (phí 50.000đ/tin) ✅`
    );
    logger.info('Shop profile completed', { zaloId, shopName: session.shop_name });
  } catch (err) {
    logger.error('Failed to save shop profile', { zaloId, error: err.message });
    await sendText(zaloId, 'Có lỗi xảy ra 😕 Gõ *bắt đầu* để thử lại nhé!');
  }
}

// ============================================================
// Flow 2: Đăng tin tuyển dụng (6 bước)
// ============================================================
async function startJobPost(zaloId, shop) {
  await updateSession(zaloId, { flow: 'shop_post_job', step: 'jp_role', shopId: shop.id });

  await sendButtons(zaloId,
    `📌 Đăng tin tuyển dụng — ${shop.name}\n\nBước 1/6: Tuyển vị trí gì?`,
    [
      { title: '🍽️ Phục vụ / Nhân viên bàn', payload: 'role_phuc_vu' },
      { title: '🍳 Nhân viên bếp / Phụ bếp',  payload: 'role_bep' },
      { title: '🍹 Bartender / Pha chế',       payload: 'role_bartender' },
      { title: '💰 Thu ngân',                  payload: 'role_thu_ngan' },
      { title: '📋 Quản lý / Trưởng ca',       payload: 'role_quan_ly' },
    ]
  );
}

async function processJobPost(zaloId, text, session, shop) {
  const step = session.step;

  // Bước 1: Vị trí
  if (step === 'jp_role') {
    const role = text.startsWith('role_') ? text.replace('role_', '') : detectRole(text);
    if (!role) {
      await sendText(zaloId, 'Bấm nút hoặc gõ: phục vụ / bếp / bartender / thu ngân / quản lý');
      return;
    }
    await updateSession(zaloId, { step: 'jp_slots', jp_role: role });
    await sendButtons(zaloId,
      `✅ Vị trí: ${ROLES[role]}\n\nBước 2/6: Tuyển bao nhiêu người?`,
      [
        { title: '1 người',          payload: 'slots_1' },
        { title: '2 người',          payload: 'slots_2' },
        { title: '3 người',          payload: 'slots_3' },
        { title: 'Từ 4 người trở lên', payload: 'slots_4' },
      ]
    );
    return;
  }

  // Bước 2: Số lượng
  if (step === 'jp_slots') {
    let slots = 1;
    if (text.startsWith('slots_')) slots = parseInt(text.replace('slots_', ''));
    else { const n = parseInt(text); if (!isNaN(n) && n > 0) slots = n; }
    await updateSession(zaloId, { step: 'jp_salary', jp_slots: slots });
    await sendButtons(zaloId,
      `✅ Số lượng: ${slots} người\n\nBước 3/6: Mức lương đề nghị (NET/tháng)?`,
      [
        { title: '4–6 triệu',                payload: 'sal_4_6' },
        { title: '6–8 triệu',                payload: 'sal_6_8' },
        { title: '8–12 triệu',               payload: 'sal_8_12' },
        { title: 'Thương lượng (gõ số)',      payload: 'sal_tl' },
      ]
    );
    return;
  }

  // Bước 3: Lương
  if (step === 'jp_salary') {
    let salMin = 0, salMax = 0;
    const salMap = {
      'sal_4_6':  [4_000_000, 6_000_000],
      'sal_6_8':  [6_000_000, 8_000_000],
      'sal_8_12': [8_000_000, 12_000_000],
    };
    if (salMap[text]) {
      [salMin, salMax] = salMap[text];
    } else if (text === 'sal_tl') {
      await updateSession(zaloId, { step: 'jp_salary_input' });
      await sendText(zaloId, 'Bạn gõ mức lương cụ thể nhé! Ví dụ: "5 triệu", "5-7 triệu"');
      return;
    } else {
      const nums = text.match(/\d[\d,\.]+/g);
      if (nums) {
        salMin = parseSalary(nums[0]) || 0;
        salMax = nums[1] ? parseSalary(nums[1]) || salMin : salMin;
      }
      if (!salMin) { await sendText(zaloId, 'Bạn nhập lương hoặc bấm nút nhé!'); return; }
    }
    await updateSession(zaloId, { step: 'jp_shifts', jp_sal_min: salMin, jp_sal_max: salMax });
    const salText = salMax > salMin ? `${salMin/1e6}–${salMax/1e6} triệu` : `${salMin/1e6} triệu`;
    await sendButtons(zaloId,
      `✅ Lương: ${salText}/tháng\n\nBước 4/6: Ca làm việc cần tuyển?`,
      [
        { title: '☀️ Ca sáng (6h–14h)',   payload: 'shift_sang' },
        { title: '🌤️ Ca chiều (14h–22h)', payload: 'shift_chieu' },
        { title: '🌙 Ca tối (18h–24h)',    payload: 'shift_toi' },
        { title: '🔄 Linh hoạt (tất cả)', payload: 'shift_all' },
      ]
    );
    return;
  }

  // Bước 3b: Nhập lương thủ công
  if (step === 'jp_salary_input') {
    const nums = text.match(/\d[\d,\.]+/g);
    let salMin = 0, salMax = 0;
    if (nums) {
      salMin = parseSalary(nums[0]) || 0;
      salMax = nums[1] ? parseSalary(nums[1]) || salMin : salMin;
    }
    if (!salMin) { await sendText(zaloId, 'Mình chưa hiểu 😅 Nhập lại nhé! Ví dụ: "5 triệu", "5-7 triệu"'); return; }
    await updateSession(zaloId, { step: 'jp_shifts', jp_sal_min: salMin, jp_sal_max: salMax });
    const salText = salMax > salMin ? `${salMin/1e6}–${salMax/1e6} triệu` : `${salMin/1e6} triệu`;
    await sendButtons(zaloId,
      `✅ Lương: ${salText}/tháng\n\nBước 4/6: Ca làm việc cần tuyển?`,
      [
        { title: '☀️ Ca sáng (6h–14h)',   payload: 'shift_sang' },
        { title: '🌤️ Ca chiều (14h–22h)', payload: 'shift_chieu' },
        { title: '🌙 Ca tối (18h–24h)',    payload: 'shift_toi' },
        { title: '🔄 Linh hoạt (tất cả)', payload: 'shift_all' },
      ]
    );
    return;
  }

  // Bước 4: Ca làm việc
  if (step === 'jp_shifts') {
    const shift = detectShift(text);
    await updateSession(zaloId, { step: 'jp_experience', jp_shift: shift });
    await sendButtons(zaloId,
      `✅ Ca: ${shift}\n\nBước 5/6: Yêu cầu kinh nghiệm tối thiểu?`,
      [
        { title: '🌱 Không yêu cầu (nhận SV)', payload: 'exp_0' },
        { title: '📅 Từ 6 tháng trở lên',      payload: 'exp_1' },
        { title: '📅 Từ 1 năm trở lên',         payload: 'exp_2' },
        { title: '⭐ Từ 2 năm trở lên',          payload: 'exp_3' },
      ]
    );
    return;
  }

  // Bước 5: Kinh nghiệm yêu cầu
  if (step === 'jp_experience') {
    let exp = 0;
    if (text.startsWith('exp_')) exp = parseInt(text.replace('exp_', ''));
    await updateSession(zaloId, { step: 'jp_requirements', jp_exp: exp });
    await sendText(zaloId,
      `✅ Kinh nghiệm: ${exp === 0 ? 'Không yêu cầu' : exp < 2 ? '6 tháng+' : exp + ' năm+'}\n\n` +
      `Bước 6/6: Yêu cầu khác không? (không bắt buộc)\n\n` +
      `Ví dụ: "nhanh nhẹn, chịu khó, biết tiếng Anh cơ bản"\n` +
      `Hoặc gõ **bỏ qua** nếu không có.`
    );
    return;
  }

  // Bước 6: Yêu cầu mềm
  if (step === 'jp_requirements') {
    const requirements = normalize(text) === 'bo qua' ? null : text.trim();
    await updateSession(zaloId, { step: 'jp_confirm', jp_requirements: requirements });
    return confirmJobPost(zaloId, shop);
  }
}

async function confirmJobPost(zaloId, shop) {
  const session = await getSession(zaloId);
  const salText = session.jp_sal_max > session.jp_sal_min
    ? `${session.jp_sal_min/1e6}–${session.jp_sal_max/1e6} triệu`
    : `${session.jp_sal_min/1e6} triệu`;
  const expText = session.jp_exp === 0 ? 'Không yêu cầu' : (session.jp_exp < 2 ? '6 tháng+' : session.jp_exp + ' năm+');

  await sendText(zaloId,
    `📋 Xác nhận tin tuyển dụng:\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🏪 Quán: ${shop.name}\n` +
    `👤 Vị trí: ${ROLES[session.jp_role]}\n` +
    `👥 Số lượng: ${session.jp_slots} người\n` +
    `💰 Lương: ${salText}/tháng\n` +
    `🕐 Ca: ${session.jp_shift}\n` +
    `📋 Kinh nghiệm: ${expText}\n` +
    (session.jp_requirements ? `✍️ Yêu cầu khác: ${session.jp_requirements}\n` : '') +
    `━━━━━━━━━━━━━━━━\n` +
    `💳 Phí đăng tin: **50.000đ**\n\n` +
    `Gõ **thanh toán** để tiến hành ZaloPay.\n` +
    `Gõ **hủy** để bỏ.`
  );
  await updateSession(zaloId, { step: 'jp_waiting_payment' });
}

// ============================================================
// Lưu job_post sau khi thanh toán thành công
// ============================================================
async function saveJobPost(zaloId, transactionId) {
  const session = await getSession(zaloId);
  if (!session?.shopId) return null;
  try {
    const { data, error } = await supabase.from('job_posts').insert({
      shop_id:      session.shopId,
      role:         session.jp_role,
      salary_min:   session.jp_sal_min,
      salary_max:   session.jp_sal_max,
      shift:        session.jp_shift,
      requirements: session.jp_requirements,
      status:       'open',
    }).select().single();
    if (error) throw error;
    await clearSession(zaloId);
    logger.info('Job post saved', { shopId: session.shopId, role: session.jp_role, jobPostId: data.id });
    return data;
  } catch (err) {
    logger.error('Failed to save job post', { zaloId, error: err.message });
    return null;
  }
}

// ============================================================
// Xử lý lệnh của shop đã onboard
// ============================================================
async function handleShopCommands(zaloId, text, shop) {
  const t = normalize(text);

  if (t.includes('dang tin') || t.includes('tuyen') || t.includes('tim nhan vien') || t === 'cmd_post_job') {
    return startJobPost(zaloId, shop);
  }

  if (t.includes('xem tin') || t.includes('tin dang') || t === 'cmd_view_posts') {
    return showShopJobPosts(zaloId, shop.id);
  }

  if (t.includes('thanh toan') || t.includes('pay')) {
    const session = await getSession(zaloId);
    if (session?.step === 'jp_waiting_payment') {
      const { createPaymentLink } = require('./shop-payment');
      return createPaymentLink(zaloId, shop, session);
    }
  }

  if (t.includes('huy') || t === 'cancel') {
    await clearSession(zaloId);
    await sendText(zaloId, 'Đã hủy. Gõ **đăng tin** bất cứ lúc nào để bắt đầu lại nhé!');
    return;
  }

  // Default menu
  await sendButtons(zaloId,
    `Xin chào ${shop.name}! 🏪 Bạn cần gì?`,
    [
      { title: '📝 Đăng tin tuyển dụng mới', payload: 'cmd_post_job' },
      { title: '📋 Xem tin đang tuyển',      payload: 'cmd_view_posts' },
    ]
  );
}

async function showShopJobPosts(zaloId, shopId) {
  const { data: posts } = await supabase
    .from('job_posts')
    .select('id, role, salary_min, status, created_at')
    .eq('shop_id', shopId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!posts || posts.length === 0) {
    await sendText(zaloId, 'Quán chưa có tin tuyển dụng nào đang active.\n\nGõ **đăng tin** để đăng tin mới!');
    return;
  }

  const lines = posts.map((p, i) => {
    const role = ROLES[p.role] || p.role;
    const sal  = p.salary_min ? `${(p.salary_min/1e6).toFixed(0)}tr+` : '?';
    return `${i+1}. ${role} — ${sal}/tháng`;
  }).join('\n');

  await sendText(zaloId, `📋 Tin đang tuyển (${posts.length} tin):\n\n${lines}\n\nGõ **đăng tin** để thêm tin mới!`);
}

module.exports = { handleShopMessage, saveJobPost };
