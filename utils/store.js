// utils/store.js —— 本地缓存便捷封装
function get(key, def) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? (def === undefined ? null : def) : v;
  } catch (e) {
    return def === undefined ? null : def;
  }
}

function set(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) {}
}

function remove(key) {
  try { wx.removeStorageSync(key); } catch (e) {}
}

module.exports = { get, set, remove };
