// custom-tab-bar/index.js
const ICONS = require('./icons.js');

Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: 'home' },
      { pagePath: '/pages/knowledge/knowledge', text: '知识地图', icon: 'map' },
      { pagePath: '/pages/mistakes/mistakes', text: '错题本', icon: 'book' },
      { pagePath: '/pages/me/me', text: '我的', icon: 'user' }
    ].map(function (it) {
      return Object.assign({}, it, {
        iconPath: ICONS[it.icon].normal,
        selectedIconPath: ICONS[it.icon].active
      });
    })
  },

  methods: {
    switchTab(e) {
      const ds = e.currentTarget.dataset;
      wx.switchTab({ url: ds.path });
      this.setData({ selected: ds.index });
    }
  }
});
