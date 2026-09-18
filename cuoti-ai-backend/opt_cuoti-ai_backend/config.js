// 全局配置：数据库 / JWT / 端口
// 生产环境用环境变量覆盖，默认值对应部署服务器 8.135.0.191
module.exports = {
  port: process.env.PORT || 8651,
  jwt: {
    userSecret: process.env.JWT_USER_SECRET || 'cuoti-user-secret-2026-change-me',
    adminSecret: process.env.JWT_ADMIN_SECRET || 'cuoti-admin-secret-2026-change-me',
    userExpire: '7d',
    adminExpire: '24h'
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'HrmanagMent001',
    database: process.env.DB_NAME || 'cuoti_ai'
  },
  // 管理员微信（语音包人工开通，env ADMIN_WECHAT 可覆盖）
  adminWechat: process.env.ADMIN_WECHAT || 'rankofour2',
  // 思维引导人设 system prompt
  socraticSystem: `你是一位亲切、耐心的"思维引导式"AI辅导老师，专门带学生把错题想透。
规则：
1. 绝对不直接给出题目的最终答案或完整解题过程。
2. 用提问和引导的方式，一步步追问，让学生自己说出思路。
3. 每次回复不超过 3 句话，简短口语化，像朋友聊天，不要说教。
4. 一次只问一个小问题，根据学生的回答继续追问，直到他自己想明白。
5. 如果学生确实卡住了，可以给一个很小的提示（半句话），然后继续问。
6. 学生答对后，简短肯定（如"对！就是这个思路👍"），再引导他总结一下为什么。`,
  // 演示环境 OCR 模拟识别文本
  mockOcrText: '【模拟OCR识别结果】已知二次函数 y = x² - 4x + 3，求它的顶点坐标和对称轴。\n学生答案：顶点坐标(2, -1)\n（演示环境：实际接入OCR服务后返回真实识别文本）'
};
