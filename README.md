# 财富自由指南灯

> 每一笔收入，点亮一颗人生星辰。每一笔支出，记录一次代价。

把抽象的财富自由目标变成**一张可视化的人生方格图**：
- 收入 → 按当前日花销折算 → **点亮 N 个人生方格**
- 支出 → 抬高日花销 → **可能熄灭已点亮的方格**
- 全部点亮 = **走完财富自由之旅**

---

## 快速开始

```bash
chmod +x run.sh
./run.sh                       # 自动 venv + 装依赖 + 开浏览器
```

访问 **http://127.0.0.1:8766**

---

## 进阶使用

📖 **完整使用指南** → [使用指南.md](./使用指南.md)（首次使用必读）
🛠️ **数学模型 / API / 设计** → [设计方案.md](./设计方案.md)

---

## 注入演示数据

```bash
.venv/bin/python backend/seed_demo.py
```

默认 60 天 · 平均日花销 ≈ ¥70 · 平均日收入 ≈ ¥500。
**会清空现有交易**，仅首次体验使用。可编辑文件顶部常量自定义。

---

## 文件结构

```
backend/
  main.py            FastAPI + SQLite
  seed_demo.py       演示数据注入器
  requirements.txt
frontend/
  index.html         结构
  style.css          视觉
  app.js             状态机 + API + 仪式编排
  grid.js            Canvas 方格 + 仪式动画引擎
data/                自动创建，存放 ledger.db（本地）
README.md            本文件
使用指南.md           面向使用者的详细指南
设计方案.md           数学模型 / API 契约 / 动画规格
run.sh               一键启动脚本
```

---

## 核心公式

```
avg_daily_expense    = total_expense / tracking_days
net_savings          = total_income - total_expense
freedom_days_bought  = floor(net_savings / avg_daily_expense)
                     + floor(initial_assets / avg_daily_expense)   （可选）
lit_count            = min(freedom_days_bought, future_cells)
```

> 数据是真相，动画是仪式。仪式服从真相。

---

## 隐私

所有数据存储在本地 `data/ledger.db`，**不上传任何服务器**。后端仅监听 `127.0.0.1`。
