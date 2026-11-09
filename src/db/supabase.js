const { createClient } = require('@supabase/supabase-js');

let _supabase = null;

function getClient() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL hoac SUPABASE_ANON_KEY chua duoc cau hinh');
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

module.exports = new Proxy({}, {
  get(_, prop) {
    return getClient()[prop];
  }
});
