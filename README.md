# 冠英工作台

面向商用车刹车片的海外获客、询盘沟通、目录选型和报价草稿管理系统。

## Windows 本地启动

在项目根目录运行以下 PowerShell 命令。安装依赖需要网络。

~~~powershell
npm.cmd ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd run build
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
~~~

浏览器访问 http://127.0.0.1:8000，接口文档位于 http://127.0.0.1:8000/docs。
前端开发可另开终端执行 `npm.cmd run dev`，Vite 会将 API 请求代理到后端。

## Docker Compose

在安装 Docker Compose 的环境运行 `docker compose up --build`。应用监听本机 8000 端口。数据库及上传资料保存在 Compose 命名卷中。默认使用 SQLite。配置 `DATABASE_URL=postgresql+psycopg://user:password@host/db` 可指向外部 PostgreSQL。表由 SQLAlchemy 建立，现有数据迁移需另行执行。

## 接口配置

复制 `.env.example` 到 `.env`，按需填入后重启。API Key 只由后端读取。

| 变量 | 用途 |
| --- | --- |
| OPENAI_API_KEY | OpenAI 兼容服务密钥，留空时采用规则和话术模板 |
| OPENAI_BASE_URL | API 基地址，例如 https://api.openai.com/v1 |
| OPENAI_MODEL | 聊天模型名称 |
| SEARCH_API_KEY | Brave Search 接口密钥，留空时展示虚构线索 |
| SEARCH_API_URL | Brave 兼容搜索地址 |

AI 仅用于询盘翻译与意图识别，对客回复由目录字段和多语言模板生成。搜索结果以公开网页链接与摘录为证据，评分基于词项命中，采购需求需要人工确认。选型来自目录字段的确定性检索，评分代表命中程度。报价根据人工核定单价计算，保存为草稿。

## 演示路径

1. 在「全球客户搜索」用默认德国市场搜索，保存一条演示线索。
2. 在「客户管理」编辑客户状态和跟进备注。
3. 在「AI 智能沟通」载入 GYS-010 样例，解析参数并生成选定语言的回复。
4. 点击「使用询盘选型」并检索，核对候选来源 kooying catalog.pdf 第 6 页。
5. 从候选项进入报价，填入客户、300 套和人工单价 80 CNY，保存总额 24,000 CNY 的报价草稿。
6. 在「产品知识库」上传 UTF-8 CSV 或 JSON，使用新增型号回到选型检索。

`catalog.jsonl` 来自用户附件中现成的目录抽取结果，包含目录文件、页码或照片来源字段。首次启动导入，OCR 字段可能存在误识别。演示线索以「演示」标记。用户上传的结构化记录以文件名追溯。CSV 或 JSON/JSONL 每行须有 `model`，可附 `vehicle`、`axle`、`wva`、`bfmc`、`fmsi`、`oe_numbers`、`dims_raw`、`page`。尺寸按毫米填写，如 `213×193×178`。PDF 保存原件并提取文本页，图片保存和记录关联型号。扫描 PDF 和图片 OCR，以及 PDF 自动生成结构化型号行，尚未实现。新目录需要配套结构化数据才可直接参与型号匹配。

## 架构与验证

- `app.tsx`、`style.css` 为 React / TypeScript / Tailwind CSS 界面。Vite 构建后由 FastAPI 同源提供。
- `main.py` 包含 FastAPI 路由、外部服务适配及 SQLAlchemy 数据访问。
- `data/` 保存本地 SQLite 与上传文件。
- `smoke.py` 使用隔离数据库覆盖静态入口和业务 API。构建后运行 `.\.venv\Scripts\python.exe smoke.py`。

项目目前按本地业务工作台运行。尚未实现账号权限、外部 CRM 同步、自动定价及正式报价审批。真实第三方调用需要配置服务凭据。Docker Compose 和 PostgreSQL 需要对应环境验证。

## 海关数据看板

默认使用独立的 data/customs.db。可用 CUSTOMS_DATABASE_URL 接入企业 PostgreSQL 专库。海关看板支持上传授权导出的 CSV/XLSX，必填列为日期（YYYY-MM-DD）和目的市场（country、market、目的国等）。可选字段为 HS 编码、采购商、商品和提单号。按日期、市场、HS 编码筛选，展示月度笔数、目的市场排名和明细。导入按规范化行去重。

授权数据接口统一入口为 POST /api/customs/sync。CUSTOMS_API_URL 应指向服务商授权接口或企业的适配服务，支持 HTTPS GET 和可选的 CUSTOMS_API_TOKEN Bearer 鉴权，响应为记录数组或包含 records 数组的 JSON。平台网页登录地址与登录密码不作为数据接口参数。

## 社媒线索与终端客户跟进

打开 /#/social，载入车队演示，点击「分析需求并起草私信」。候选取自本地目录，价格取自对客价格表。业务员核实当前车桥、安装位置、编码、尺寸后，在原平台发送并更新成交阶段。照片比对使用企业资料包中的 dHash 索引，可召回外观近似样图，无法单凭照片确认尺寸和兼容性。

Facebook 将已授权公共主页的 feed、messages 订阅指向公网 HTTPS 回调 /api/social/facebook，通过 META_VERIFY_TOKEN、META_APP_SECRET 完成验证和消息签名校验。X 在后端配置 X_BEARER_TOKEN，进入页面输入品牌、车桥、采购词组合执行近期公开帖子搜索。TikTok 需将已授权的 Leads Center 或企业渠道服务输出映射到 POST /api/social/events，使用 Authorization: Bearer <SOCIAL_INGEST_TOKEN>；JSON 字段 channel、external_id、author、text、source。相同渠道、外部消息 ID 重试仅生成一条线索。可用人工录入验证流程。

真实孚盟同步需要 FUMENG_ADAPTER_URL 和 FUMENG_ADAPTER_TOKEN，指向企业部署的孚盟适配服务，接收线索 JSON，按 Idempotency-Key 去重并返回 crm_id。演示线索只执行本地模拟。当前工作台面向本机销售使用；公网反向代理仅开放已鉴权的渠道回调，销售操作接口应置于企业登录或 VPN 后。

SOCIAL_VISION_MODEL 可指定同一网关中支持图像输入的模型。销售勾选视觉模型解读后才会将图片发送至已配置网关；默认只进行本地近似图片检索。

## 登录、客户对话与团队报表

本机使用初始管理员账号 admin 和初始密码 123456 登录。可在管理后台的安全设置修改密码并获取恢复码。销售在本机通过图形验证码自助注册。管理员在「管理报表」创建、启用或停用销售账号。每个账号使用自己的密码及一次性恢复码，账号和登录会话保存在独立的 data/accounts.sqlite3。勾选记住登录会将会话保留 30 天，账号密码由浏览器密码管理器自行保存。

客户档案、网站询盘、会话和销售跟进保存在业务数据库中。网站历史询盘可发起回复，社媒线索可打开同一工作台中的客户对话。销售确认后复制草稿到原渠道。购买意愿分数按模型意图类别映射，跟进记录标明填写的负责人及实际录入账号。

DeepSeek 文本模型沿用 OPENAI_BASE_URL 和 OPENAI_MODEL。图片支持本地企业样图比对及回复草稿。可选 SOCIAL_VISION_MODEL 用于调用同一网关中支持图像输入的模型。

企业官网表单可以由服务器通过 POST /api/sales/inquiries/intake 提交 name、email、country、text，并使用 Authorization: Bearer <WEBSITE_INQUIRY_TOKEN>。令牌存放在官网后端和工作台后端。收到的记录显示在「网站询盘」。
