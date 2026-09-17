// utils/request.js —— 统一 API 请求封装，自动带 JWT token
// 注意：公网 /api 前缀被其他服务占用，本系统统一走 /cuoti/api
const BASE_URL = 'https://zblw.com.cn/cuoti/api';

function authHeader(extra) {
  const token = wx.getStorageSync('token') || '';
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

function goLogin() {
  wx.reLaunch({ url: '/pages/login/login' });
}

/**
 * 统一请求
 * @param {string} path 如 /auth/login
 * @param {object} opts { method, data }
 * @returns Promise<data> 后端统一返回 { ok, data } 或 { ok, error }
 */
function request(path, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      method: opts.method || 'GET',
      data: opts.data || {},
      header: authHeader(),
      success(res) {
        const body = res.data || {};
        if (res.statusCode === 401) {
          wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
          wx.removeStorageSync('token');
          goLogin();
          reject(new Error('unauthorized'));
          return;
        }
        if (body && body.ok === false) {
          wx.showToast({ title: body.error || '请求失败', icon: 'none' });
          reject(new Error(body.error || '请求失败'));
          return;
        }
        resolve(body.data !== undefined ? body.data : body);
      },
      fail(err) {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
        reject(err);
      }
    });
  });
}

/**
 * 上传文件（拍照 OCR 等）
 * @param {string} filePath 本地文件路径
 * @param {string} path 接口路径
 * @param {object} formData 额外表单
 */
function uploadFile(filePath, path, formData) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + (path || '/mistakes/ocr'),
      filePath: filePath,
      name: 'image',
      formData: formData || {},
      header: authHeader(),
      success(res) {
        let body = {};
        try { body = JSON.parse(res.data); } catch (e) { body = { ok: false, error: '返回格式错误' }; }
        if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          goLogin();
          reject(new Error('unauthorized'));
          return;
        }
        if (body.ok === false) {
          wx.showToast({ title: body.error || '识别失败', icon: 'none' });
          reject(new Error(body.error || '识别失败'));
          return;
        }
        resolve(body.data !== undefined ? body.data : body);
      },
      fail(err) {
        wx.showToast({ title: '上传失败，请检查网络', icon: 'none' });
        reject(err);
      }
    });
  });
}

module.exports = { request, uploadFile, BASE_URL };
