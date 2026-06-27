# 暗房 · Film Archive

一款独具风格的纯前端照片档案管理应用，以胶片暗房为美学方向。

## 设计方向

**胶片档案 / 编辑部暗房** — 暖黄底纸、炭灰文字、微妙的纸纹颗粒、每张照片带有胶片边框。瀑布流拼图排版适配横、竖、方、超宽各种比例，像翻阅摄影师的小样档案一样浏览。

- **字体**: Fraunces（展示） + Work Sans（正文） + Caveat（Welcome 手写）
- **配色**: 暖黄 (#FBF8F4) / 深炭 (#1E1D1C) / 琥珀 (#B8752C)
- **纹理**: SVG 噪点颗粒覆盖层，3.5% 透明度
- **排版**: CSS Grid 瀑布流，根据实际宽高比动态计算 `grid-row-end: span N`

## 功能

### 照片画廊
- 瀑布流拼图排版 — 自适应横/竖/方/超宽图
- 保持原始比例，不强制裁切
- 响应式适配：手机 375px / 平板 768px / 桌面 1024px+

### 排序与筛选
- 按拍摄时间 / 上传时间 / 标题排序，升序降序切换
- 筛选模式：全部 / 精选 / 最近 7 天
- 标签徽章过滤，点击切换
- 当前筛选状态栏

### 上传系统
- 单张 / 批量 / 拖拽 / 粘贴上传
- 保存前预览 + 元数据表单
- 字段：标题、描述、日期、地点、标签、相册
- **EXIF 自动提取** — 上传时自动读取拍摄日期、相机型号、光圈、快门、ISO、焦距、GPS 坐标，自动填充表单

### 灯箱预览
- 全屏大图 + 毛玻璃遮罩
- 键盘方向键 + 触摸滑动切换（无左右箭头图标）
- 显示标题、日期、地点、描述、标签
- 点击标签筛选画廊
- 灯箱内编辑 / 删除 / 切换精选和隐私状态

### 相册管理
- 新建 / 编辑 / 删除相册
- 上传或编辑时为照片指定相册
- 私密相册支持密码保护
- 自定义封面照片

### 搜索
- 全文搜索：标题 + 描述 + 地点 + 标签
- 搜索类型过滤（全部 / 标题 / 标签 / 地点）
- 日期范围筛选

### 隐私与权限
- 公开 / 私密照片
- 上传入口管理员密码保护（默认密码 `darkroom`）
- 私密相册独立密码
- 基于 sessionStorage 的登录态

### 深色模式
- 亮 / 暗一键切换
- 独立背景图交叉淡入淡出过渡
- 偏好在 localStorage 和 IndexedDB 中持久化

### 数据备份
- **导出** — 全部照片 + 相册 + 设置打包为 JSON 文件下载（图片以 base64 编码）
- **导入** — 读取备份文件恢复整个档案库，支持拖拽，含进度反馈和冲突确认

## 架构

### 技术栈
- **零构建依赖** — 纯 HTML + CSS + 原生 JavaScript
- **IndexedDB** 持久化存储，照片以 Blob 形式存储
- **CSS Grid** 瀑布流排版，动态行跨度计算
- **Canvas API** 客户端缩略图生成
- **exifr** (CDN lite) EXIF 元数据解析

### 文件结构
```
├── index.html      # 应用外壳
├── style.css        # 完整设计系统 + 响应式
├── app.js           # 全部应用逻辑
└── README.md
```

### 数据模型 (IndexedDB: FilmArchive v1)
```
photos  { id, title, description, dateTaken, dateUploaded, location,
          tags[], albumId, isFeatured, isPublic, imageData (Blob),
          thumbnailData (Blob), width, height }
albums  { id, name, description, coverPhotoId, isPrivate,
          password, dateCreated }
settings { key, value }
```

## 快速开始

### 本地运行
```bash
# 任意静态服务器
npx serve . -p 3456

# 或者直接浏览器打开
open index.html
```

### 默认管理员密码
首次启动时默认密码为 **`darkroom`**，可在上传页面输入。

如需修改，打开浏览器控制台执行：
```javascript
const db = await new Promise(r => {
  const req = indexedDB.open('FilmArchive');
  req.onsuccess = e => r(e.target.result);
});
const tx = db.transaction('settings', 'readwrite');
tx.objectStore('settings').put({ key: 'adminPassword', value: '新密码' });
```

## 键盘快捷键

| 按键 | 操作 |
|------|------|
| `←` `→` | 灯箱上下张切换 |
| `Esc` | 关闭灯箱 / 弹窗 / 清除标签筛选 |
| `Ctrl+K` 或 `/` | 打开搜索 |

## 浏览器兼容
- Chrome / Edge 90+
- Firefox 90+
- Safari 15+
- iOS Safari 15+
- Android Chrome

## 存储限制
IndexedDB 的浏览器配额通常在 50MB ~ 2GB+ 之间，取决于设备和剩余磁盘空间。如果照片较多，建议定期导出备份，或考虑接入 Supabase Storage、Cloudflare R2 等云端存储方案。

## 部署
适用于任何静态文件托管：
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

无需构建步骤，推送即可部署。
