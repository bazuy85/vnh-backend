// ============================================================
// Flow chủ quán — Onboarding + Đăng tin tuyển dụng
// ============================================================
// Luồng: follow OA → Chào → Profile quán (1 lần) → Đăng tin
//        Q1 vị trí → Q2 số lượng → Q3 lương → Q4 ca
//        → Q5 kinh nghiệm → Q6 yêu cầu mềm → Thanh toán 50k
// ============================================================
const { sendText, sendButtons } = require('../services/zalo');
const { getSession, updateSession, clearSession } = require('../services/session');
const supabase = require('../db/supabase');
const logger = require('../utils/logger');

const ROLES = {
  'phuc_vu': 'Phục vụ / Nhân viên bàn',
  'bep':     'Nhân viên bếp / Phụ bếp',
  'bartender': 'Bartender / Pha chế',
  'thu_ngan': 'Thu ngân',
  'quan_ly': 'Quản lý / Trưởng ca',
};

const SHIFTS = {
  'sang':  'Ca sáng (6h–14h)',
  'chieu': 'Ca chiều (14h–22h)',
  'toi':   'Ca tối (18h–24h)',
};

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function detectRole(text) {
  const t = normalize(text);
  if (t.includes('phuc vu') || t === '1') return 'phuc_vu';
  if (t.includes('bep') || t.includes('nau') || t === '2') return 'bep';
  if (t.includes('bar') || t.includes('pha che') || t === '3') return 'bartender';
  if (t.includes('thu ngan') || t === '4') return 'thu_ngan';
  if (t.includes('quan ly') || t === '5') return 'quan_ly';
  return null;
}

function detectShifts(text) {
  const t = normalize(text);
  const result = [];
  if (t.includes('sang') || t.includes('1')) result.push('sang');
  if (t.includes('chieu') || t.includes('2')) result.push('chieu');
  if (t.includes('toi') || t.includes('3')) result.push('toi');
  if (t.includes('tat ca') || t.includes('linh hoat')) return ['sang', 'chieu', 'toi'];
  return [...new Set(result)];
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

  // Kiểm tra đã onboard chưa
  const { data: shop } = await supabase
    .from('shops')
    .select('id, onboarding_completed, shop_name')
    .eq('zalo_id', zaloId)
    .single();

  // Chưa có shop record hoặc chưa onboard profile quán
  if (!shop || !shop.onboarding_completed) {
    if (!session || session.flow !== 'shop_profile') {
      return startShopProfile(zaloId, displayName);
    }
    return processShopProfile(zaloId, messageText, session);
  }

  // Đang trong flow đăng tin
  if (session?.flow === 'shop_post_job') {
    return processJobPost(zaloId, messageText, session, shop);
  }

  // Shop đã onboard → xử lý lệnh
  return handleShopCommands(zaloId, messageText, shop);
}

// ============================================================
// Flow 1: Onboarding profile quán (1 lần duy nhất)
// ============================================================
async function startShopProfile(zaloId, displayName) {
  await updateSession(zaloId, { flow: 'shop_profile', step: 'q1_shop_name' });

  const name = displayName ? `, ${displayName.split(' ').pop()}` : '';
  await sendText(zaloId,
    `Chào bạn${name}! 👋 Mình là Việc Nhà Hàng.\n\n` +
    `Mình giúp quán F&B tìm nhân viên nhanh hơn — không qua trung gian, tự động lọc theo vị trí và khoảng cách.\n\n` +
    `Phí đăng tin: **50.000đ/tin** | Mở hồ sơ ứng viên: **500.000đ**\n\n` +
    `Đầu tiên, cho mình biết thêm về quán nhé! 📋`
  );

  await sendText(zaloId, '📌 Quán của bạn tên là gì? (gõ tên quán)');
}

async function processShopProfile(zaloId, text, session) {
  const step = session.step;

  // Q1: Tên quán
  if (step === 'q1_shop_name') {
    await updateSession(zaloId, { step: 'q2_address', shop_name: text.trim() });
    await sendText(zaloId,
      `✅ Tên quán: **${text.trim()}**\n\n` +
      `📌 Địa chỉ quán ở đâu? (gõ địa chỉ cụ thể, kèm quận)\n` +
      `Ví dụ: 123 Nguyễn Trãi, Thanh Xuân`
    );
    return;
  }

  // Q2: Địa chỉ
  if (step === 'q2_address') {
    // Trích quận từ địa chỉ
    const addressLower = text.toLowerCase();
    let district = null;
    const districts = ['hoàng mai', 'tây hồ', 'cầu giấy', 'đống đa', 'hai bà trưng',
                       'ba đình', 'thanh xuân', 'long biên', 'gia lâm', 'nam từ liêm',
                       'bắc từ liêm', 'hà đông', 'hoàn kiếm', 'tây hồ'];
    for (const d of districts) {
      if (addressLower.includes(d)) { district = d; break; }
    }

    await updateSession(zaloId, { step: 'q3_shop_type', address: text.trim(), district });
    await sendButtons(zaloId,
      `✅ Địa chỉ: **${text.trim()}**\n\n📌 Quán thuộc loại nào?`,
      [
        { title: '🍜 Quán ăn / Nhà hàng', payload: 'type_nha_hang' },
        { title: '☕ Cà phê / Trà sữa', payload: 'type_cafe' },
        { title: '🍺 Bar / Pub', payload: 'type_bar' },
        { title: '🥐 Bánh mì / Fast food', payload: 'type_fastfood' },
      ]
    );
    return;
  }

  // Q3: Loại quán
  if (step === 'q3_shop_type') {
    const typeMap = {
      'type_nha_hang': 'nha_hang',
      'type_cafe':     'cafe',
      'type_bar':      'bar',
      'type_fastfood': 'fastfood',
    };
    const shopType = typeMap[text] || 'nha_hang';
    await updateSession(zaloId, { step: 'confirm_profile', shop_type: shopType });
    return completeShopProfile(zaloId);
  }
}

async function completeShopProfile(zaloId) {
  const session = await getSession(zaloId);
  try {
    await supabase.from('shops').upsert({
      zalo_id: zaloId,
      shop_name: session.shop_name,
      address: session.address,
      district: session.district,
      shop_type: session.shop_type,
      status: 'active',
      onboarding_completed: true,
      last_active_at: new Date().toISOString(),
    }, { onConflict: 'zalo_id' });

    await clearSession(zaloId);
    await sendText(zaloId,
      `🎉 Hồ sơ quán đã được lưu!\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🏪 Quán: ${session.shop_name}\n` +
      `📍 Địa chỉ: ${session.address}\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `Bây giờ bạn có thể đăng tin tuyển dụng!\n\n` +
      `Gõ **đăng tin** để bắt đầu (phí 50.000đ/tin)`
    );
  } catch (err) {
    logger.error('Failed to save shop profile', { zaloId, error: err.message });
    await sendText(zaloId, 'Có lỗi xảy ra 😕 Gõ *bắt đầu* để thử lại nhé!');
  }
}

// ============================================================
// Flow 2: Đăng tin tuyển dụng
// ============================================================
async function startJobPost(zaloId, shop) {
  await updateSession(zaloId, { flow: 'shop_post_job', step: 'jp_role', shopId: shop.id });

  await sendButtons(zaloId,
    `📌 Đăng tin tuyển dụng — ${shop.shop_name}\n\nBước 1/6: Tuyển vị trí gì?`,
    [
      { title: '🍽️ Phục vụ / Nhân viên bàn', payload: 'role_phuc_vu' },
      { title: '🍳 Nhân viên bếp / Phụ bếp', payload: 'role_bep' },
      { title: '🍹 Bartender / Pha chế', payload: 'role_bartender' },
      { title: '💰 Thu ngân', payload: 'role_thu_ngan' },
      { title: '📋 Quản lý / Trưởng ca', payload: 'role_quan_ly' },
    ]
  );
}

async function processJobPost(zaloId, text, session, shop) {
  const step = session.step;

  // Bước 1: Vị trí tuyển
  if (step === 'jp_role') {
    const payload = text.startsWith('role_') ? text.replace('role_', '') : null;
    const role = payload || detectRole(text);
    if (!role) {
      await sendText(zaloId, 'Bấm vào nút hoặc gõ: phục vụ / bếp / bartender / thu ngân / quản lý');
      return;
    }
    await updateSession(zaloId, { step: 'jp_slots', jp_role: role });
    await sendButtons(zaloId,
      `✅ Vị trí: ${ROLES[role]}\n\nBước 2/6: Tuyển bao nhiêu người?`,
      [
        { title: '1 người', payload: 'slots_1' },
        { title: '2 người', payload: 'slots_2' },
        { title: '3 người', payload: 'slots_3' },
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
      `✅ Số lượng: ${slots} người\n\nBước 3/6: Mức lương quán đề nghị (NET/tháng)?`,
      [
        { title: '4–6 triệu', payload: 'sal_4_6' },
        { title: '6–8 triệu', payload: 'sal_6_8' },
        { title: '8–12 triệu', payload: 'sal_8_12' },
        { title: 'Thương lượng (gõ số cụ thể)', payload: 'sal_tl' },
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
    if (salMap[text]) { [salMin, salMax] = salMap[text]; }
    else if (text === 'sal_tl') {
      await updateSession(zaloId, { step: 'jp_salary_input' });
      await sendText(zaloId, 'Bạn gõ mức lương cụ thể nhé! Ví dụ: "5 triệu", "5-7 triệu"');
      return;
    } else {
      const nums = text.match(/\d[\d,\.]+/g);
      if (nums) { salMin = parseSalary(nums[0]) || 0; salMax = nums[1] ? parseSalary(nums[1]) || salMin : salMin; }
      if (!salMin) {
        await sendText(zaloId, 'Bạn nhập lương hoặc bấm nút nhé!');
        return;
      }
    }
    await updateSession(zaloId, { step: 'jp_shifts', jp_sal_min: salMin, jp_sal_max: salMax });
    const salText = salMax > salMin ? `${salMin/1e6}–${salMax/1e6} triệu` : `${salMin/1e6} triệu`;
    await sendButtons(zaloId,
      `✅ Lương: ${salText}/tháng\n\nBước 4/6: Ca làm việc cần tuyển?`,
      [
        { title: '☀️ Ca sáng (6h–14h)', payload: 'shift_sang' },
        { title: '🌤️ Ca chiều (14h–22h)', payload: 'shift_chieu' },
        { title: '🌙 Ca tối (18h–24h)', payload: 'shift_toi' },
        { title: '🔄 Linh hoạt (tất cả)', payload: 'shift_all' },
      ]
    );
    return;
  }

  // Bước 4: Ca làm việc
  if (step === 'jp_shifts') {
    let shifts = text === 'shift_all' ? ['sang','chieu','toi']
                : text.startsWith('shift_') ? [text.replace('shift_', '')]
                : detectShifts(text);
    if (!shifts.length) {
      await sendText(zaloId, 'Chọn ca nào? sáng / chiều / tối / linh hoạt');
      return;
    }
    await updateSession(zaloId, { step: 'jp_experience', jp_shifts: shifts });
    await sendButtons(zaloId,
      `✅ Ca: ${shifts.map(s => SHIFTS[s]).join(', ')}\n\nBước 5/6: Yêu cầu kinh nghiệm tối thiểu?`,
      [
        { title: 'Không yêu cầu (nhận sinh viên)', payload: 'exp_0' },
        { title: 'Từ 6 tháng trở lên', payload: 'exp_1' },
        { title: 'Từ 1 năm trở lên', payload: 'exp_2' },
        { title: 'Từ 2 năm trở lên', payload: 'exp_3' },
      ]
    );
    return;
  }

  // Bước 5: Kinh nghiệm yêu cầu
  if (step === 'jp_experience') {
    let exp = 0;
    if (text.startsWith('exp_')) exp = parseInt(text.replace('exp_', ''));
    await updateSession(zaloId, { step: 'jp_soft', jp_exp: exp });
    await sendText(zaloId,
      `✅ Kinh nghiệm: ${exp === 0 ? 'Không yêu cầu' : exp + ' năm+'}\n\n` +
      `Bước 6/6: Bạn có yêu cầu gì thêm không? (không bắt buộc)\n\n` +
      `Ví dụ: "nhanh nhẹn, chịu khó, nói được tiếng Anh cơ bản"\n` +
      `Hoặc gõ **bỏ qua** nếu không có yêu cầu thêm.`
    );
    return;
  }

  // Bước 6: Yêu cầu mềm
  if (step === 'jp_soft') {
    const soft = normalize(text) === 'bo qua' ? null : text.trim();
    await updateSession(zaloId, { step: 'jp_confirm', jp_soft: soft });
    return confirmJobPost(zaloId, shop);
  }
}

async function confirmJobPost(zaloId, shop) {
  const session = await getSession(zaloId);
  const salText = session.jp_sal_max > session.jp_sal_min
    ? `${session.jp_sal_min/1e6}–${session.jp_sal_max/1e6} triệu`
    : `${session.jp_sal_min/1e6} triệu`;

  await sendText(zaloId,
    `📋 Xác nhận tin tuyển dụng:\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🏪 Quán: ${shop.shop_name}\n` +
    `👤 Vị trí: ${ROLES[session.jp_role]}\n` +
    `👥 Số lượng: ${session.jp_slots} người\n` +
    `💰 Lương: ${salText}/tháng\n` +
    `🕐 Ca: ${session.jp_shifts.map(s => SHIFTS[s]).join(', ')}\n` +
    `📋 Kinh nghiệm: ${session.jp_exp === 0 ? 'Không yêu cầu' : session.jp_exp + ' năm+'}\n` +
    (session.jp_soft ? `✍️ Yêu cầu khác: ${session.jp_soft}\n` : '') +
    `━━━━━━━━━━━━━━━━\n` +
    `💳 Phí đăng tin: **50.000đ**\n\n` +
    `Thanh toán qua ZaloPay để đăng tin!\n` +
    `Gõ **thanh toán** để tiếp tục hoặc **hủy** để bỏ.`
  );
  // Lưu state chờ thanh toán
  await updateSession(zaloId, { step: 'jp_waiting_payment' });
}

// ============================================================
// Xử lý lệnh của shop đã onboard
// ============================================================
async function handleShopCommands(zaloId, text, shop) {
  const t = normalize(text);

  if (t.includes('dang tin') || t.includes('tuyen') || t.includes('tim nhan vien')) {
    return startJobPost(zaloId, shop);
  }

  if (t.includes('xem tin') || t.includes('tin dang') || t.includes('tin hien tai')) {
    return showShopJobPosts(zaloId, shop.id);
  }

  if (t.includes('thanh toan') || t.includes('pay')) {
    const session = await getSession(zaloId);
    if (session?.step === 'jp_waiting_payment') {
      // TODO: Tạo ZaloPay link
      await sendText(zaloId, '💳 Đang tạo link thanh toán ZaloPay... (Tính năng sẽ hoàn thiện trong tuần tới)');
      return;
    }
  }

  // Default
  await sendButtons(zaloId,
    `Xin chào ${shop.shop_name}! Bạn cần gì?`,
    [
      { title: '📝 Đăng tin tuyển dụng mới', payload: 'cmd_post_job' },
      { title: '📋 Xem tin đang tuyển', payload: 'cmd_view_posts' },
      { title: '📊 Xem ứng viên đang chờ', payload: 'cmd_view_candidates' },
    ]
  );
}

async function showShopJobPosts(zaloId, shopId) {
  const { data: posts } = await supabase
    .from('job_posts')
    .select('id, role, salary_min, status, created_at')
    .eq('shop_id', shopId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!posts || posts.length === 0) {
    await sendText(zaloId, 'Quán chưa có tin tuyển dụng nào đang active.\n\nGõ **đăng tin** để đăng tin mới!');
    return;
  }

  const lines = posts.map((p, i) => {
    const role = ROLES[p.role] || p.role;
    const sal = p.salary_min ? `${(p.salary_min/1e6).toFixed(0)}tr+` : '?';
    return `${i+1}. ${role} — ${sal}/tháng`;
  }).join('\n');

  await sendText(zaloId, `📋 Tin đang tuyển (${posts.length} tin):\n\n${lines}`);
}

module.exports = { handleShopMessage };
