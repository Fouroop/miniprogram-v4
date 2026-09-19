// utils/request.js —— 统一 API 请求封装，自动带 JWT token
// 注意：公网 /api 前缀被其他服务占用，本系统统一走 /cuoti/api
const BASE_URL = 'https://zblw.com.cn/cuoti/api';

function authHeader(extra) {
  const token = wx.getStorageSync('token') || '';
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

/**
 * 统一请求
 * @param {string} path 如 /auth/login
 * @param {object} opts { method, data }
 * @returns Promise<data> 后端统一返回 { ok, data } 或 { ok, error }
 *
 * 401 时不强制跳转登录页（微信规范：不得一进小程序就要求登录），
 * 只 reject 一个 unauthorized 错误，由页面自行决定是否弹"登录后使用"。
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
          wx.removeStorageSync('token');
          const app = getApp();
          if (app) app.globalData.user = null;
          const err = new Error('unauthorized');
          err.code = 401;
          reject(err);
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
        if (!opts.silent) wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
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
          const app = getApp();
          if (app) app.globalData.user = null;
          const err = new Error('unauthorized');
          err.code = 401;
          reject(err);
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
