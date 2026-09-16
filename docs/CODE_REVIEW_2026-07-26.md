# CIPC LabEquip Hub 代码审查报告

> 历史审查快照：本文记录的是 2026-07-26 当时的源码状态，部分问题后来已经修复。原始账号、人员和部署标识已脱敏；当前部署边界以 `README.md`、`docs/VERSION_MATRIX.md` 和 `docs/RELEASE_AND_MIGRATION.md` 为准。

> 审查日期：2026-07-26。方法：6 个维度并行审查，每条发现由独立验证 agent 对照实际代码逐条核实（confirmed = 完全属实；partially = 方向正确但细节已在核实备注中修正）。

共 **74** 条经核实的发现：高 15 / 中 32 / 低 27。

## 目录
- 后端（API 正确性与健壮性）（12 条）
- 安全（12 条）
- 前端（16 条）
- 架构与文档一致性（10 条）
- 测试与工程质量（13 条）
- 部署与运维（11 条）

## 后端（API 正确性与健壮性）

### 🔴 高 · URL 解析在 try/catch 之外，恶意/畸形 Host 头可导致进程崩溃

**位置**：`apps/api/server.mjs:70`

apps/api/server.mjs:70 的 `const url = new URL(request.url, \`http://${request.headers.host || "localhost"}\`)` 位于 line 71 的 try 块之前。HTTP 头值允许包含空格等字符，例如客户端发送 `Host: exa mple` 时 `new URL()` 会抛 TypeError: Invalid URL（已实测验证）。该异常发生在 createServer 的 async 回调中且无人捕获，成为 unhandled rejection，Node 默认行为是终止进程——一条畸形请求即可打挂整个 API（且没有进程守护自动重启逻辑）。

**建议**：把 `new URL(...)` 移入 try 块内（或单独 try/catch 返回 400）；更稳妥的做法是只解析 request.url 的 pathname/query（如 `new URL(request.url, "http://localhost")`），不信任 Host 头。

### 🔴 高 · 请求体按块隐式 toString 拼接，多字节 UTF-8 字符跨 chunk 边界时中文被静默损坏

**位置**：`apps/api/server.mjs:23-25`

apps/api/server.mjs:22-26 中 `let body = ""; for await (const chunk of request) { body += chunk; ... }`：未调用 setEncoding，chunk 是 Buffer，`body += chunk` 对每个 chunk 单独 toString。当一个 3 字节中文字符恰好被 TCP 分包切开时，两半各自解码为 U+FFFD。已实测：`{"purpose":"实验"}` 在字节 13 处切分后解析结果为 `{ purpose: '���验' }`——JSON 仍解析成功，损坏的文本被静默写入数据库（预约用途、设备名称等全是中文字段）。另外 `body.length > 1_000_000` 统计的是 UTF-16 字符数而非字节数，中文场景下实际字节上限约为 3MB，限流口径错误。

**建议**：改为收集 Buffer 数组并累加 `chunk.length`（字节数）做限流，结束后 `Buffer.concat(chunks).toString("utf8")` 一次性解码；或 `request.setEncoding("utf8")`（Node 的 StringDecoder 会正确处理跨块字符）并用 Buffer.byteLength 计量。

### 🟡 中 · 非法日历日期通过校验并被 V8 滚动进位，reservation_date 与 start_at/end_at 不一致

**位置**：`apps/api/lib/service.mjs:270-277`

apps/api/lib/service.mjs:270 的正则 `/^\d{4}-\d{2}-\d{2}$/` 允许 "2026-02-31" 这类不存在的日期，line 273 `new Date(`${date}T${start}:00+08:00`)` 在 V8 下不返回 Invalid Date 而是滚动进位（已实测：2026-02-31 解析为 2026-03-03），因此 line 275 的 NaN 校验拦不住。结果：数据库中 `reservation_date='2026-02-31'` 而 `start_at/end_at` 落在 3 月 3 日——冲突触发器（database.mjs:134-146 基于 start_at/end_at）会阻塞 3 月 3 日的其他预约，但按日期查询（service.mjs:247-249 `reservation_date = ?`）查 3 月 3 日却看不到这条记录，产生用户不可见的“幽灵冲突”。

**建议**：解析后做回读校验：确认 startAt 在 Asia/Shanghai 下的年月日与输入 date 一致（或用 Date.UTC 手工构造并校验 getUTCMonth/getUTCDate 未进位），不一致则抛 400。

### 🟡 中 · 启动种子逻辑含破坏性 DELETE，标记缺失的库（如从备份恢复）首次启动即清空业务数据

**位置**：`apps/api/lib/database.mjs:155-162`

apps/api/lib/database.mjs:159-162：seedDatabase 每次启动都执行，只要 app_settings 中没有 'real_data_reset_20260726' 标记，就执行 `DELETE FROM reservations; DELETE FROM equipment; DELETE FROM sessions;`。任何缺失该标记的数据库（从旧备份恢复、复制到新环境、标记行被误删）在下次启动时会静默清空全部设备和预约数据。另外 line 155 的标记检查在 line 157 `BEGIN IMMEDIATE` 之前，两个进程同时首启时存在 TOCTOU：都通过检查，第二个进程 INSERT 标记时撞主键约束，事务回滚后异常上抛导致启动失败。

**建议**：将一次性数据重置从常驻种子代码中移除，改为独立的显式迁移脚本；至少把标记检查移入 BEGIN IMMEDIATE 事务内，并在 DELETE 前校验表是否确实是待清理的模拟数据。

### 🟡 中 · scryptSync 在请求路径上同步执行，阻塞事件循环，登录接口可被打成整体拒绝服务

**位置**：`apps/api/lib/service.mjs:36-38, 133`

apps/api/lib/service.mjs:36 verifyPassword 使用 `scryptSync(password, row.password_salt, 64)`（默认 N=16384，单次数十毫秒），在 authenticate（line 133）和 changePassword（line 169、171，一次请求最多跑 2 次）中同步执行。整个 API 是单线程 http 服务，无登录限流，单个客户端循环 POST /api/auth/login 即可让所有请求（包括健康检查）排队卡死。另外 line 133 `!row || !row.is_active || !verifyPassword(...)` 短路求值导致用户名不存在时响应明显更快，构成基于时延的用户名枚举。

**建议**：改用 `crypto.scrypt` 异步版本（走 libuv 线程池）；用户不存在时对固定假哈希执行一次同等开销的比对以抹平时延；为登录接口增加简单的失败计数/限流。

### 🟡 中 · 修改密码后旧会话不失效，被盗会话在改密后仍长期有效

**位置**：`apps/api/lib/service.mjs:166-181`

apps/api/lib/service.mjs:166-181 changePassword 只 UPDATE users 表，不触碰 sessions 表。用户因怀疑泄露而改密后，攻击者手中的会话 cookie 在 12 小时生命周期内继续有效（getSessionUser 仅校验 token_hash 与 expires_at，见 service.mjs:151-160）。

**建议**：changePassword 成功后执行 `DELETE FROM sessions WHERE user_id = ?`（可保留当前会话的 token_hash），并让接口层为当前会话重新签发 cookie。

### 🟢 低 · 未设置 busy_timeout，多进程访问同一 SQLite 文件时写操作立即 SQLITE_BUSY 报 500

**位置**：`apps/api/lib/database.mjs:51-53`

apps/api/lib/database.mjs:51-53 只设置了 foreign_keys 和 journal_mode=WAL，没有 `PRAGMA busy_timeout`。WAL 允许多进程读写，但若有第二个进程持有写锁（另一 API 实例、sqlite3 CLI 巡检、备份工具），本进程的写语句会立刻抛 SQLITE_BUSY 而不是等待，被 server.mjs:142 兜底成 500。连带问题：service.mjs:316 假定冲突回查必命中（`conflict.start_time` 直接解引用），多进程下冲突行可能在 INSERT 失败与回查之间被另一进程改为 cancelled，`conflict` 为 null 时抛 TypeError 变成 500 而非预期的 409。

**建议**：增加 `PRAGMA busy_timeout = 5000;`；service.mjs:316 对 `conflict` 判空，为 null 时退化为不带明细的 409 响应。

### 🟢 低 · 请求体为 JSON 字面量 null 时返回 500 而非 400

**位置**：`apps/api/server.mjs:27-32`

apps/api/server.mjs:27 `if (!body) return {}` 只兜底空字符串；body 为字符串 "null" 时 JSON.parse 返回 null（已实测），随后 server.mjs:79 `input.username`、service.mjs:216 `input.status` 等属性访问抛 TypeError: Cannot read properties of null，被兜底为 500 INTERNAL_ERROR 并打印堆栈——这是客户端输入问题，语义上应为 400。

**建议**：readJson 解析后校验结果是普通对象：`const parsed = JSON.parse(body); if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppError(400, "INVALID_JSON", ...)`。同时可顺带校验 Content-Type 为 application/json（当前完全未校验，server.mjs:21-33 接受任意 Content-Type）。

### 🟢 低 · 畸形 Cookie 使 decodeURIComponent 抛 URIError，未登录请求变成 500

**位置**：`apps/api/server.mjs:38`

apps/api/server.mjs:38 `decodeURIComponent(entry.slice(separator + 1))`：客户端发送 `Cookie: cipc_session=%` 之类非法百分号编码时抛 URIError。虽然被外层 catch 兜住不会崩溃，但返回 500 INTERNAL_ERROR 并在日志刷堆栈，正确语义应是 401 AUTH_REQUIRED/400。

**建议**：对 decodeURIComponent 包 try/catch，解码失败时返回原始值或视为无效 cookie。

### 🟢 低 · 允许创建过去时间的预约，无任何时间下限校验

**位置**：`apps/api/lib/service.mjs:267-277`

apps/api/lib/service.mjs:259-321 createReservation 只校验格式与 start<end，未校验 endAt 是否晚于当前时间，可以为任意历史日期（如 2020-01-01）创建 pending 预约。历史区间同样参与冲突触发器判定并永远占位（没有任何状态流转接口把它标记为 completed/cancelled），污染数据且无法释放。

**建议**：增加 `if (endAt <= new Date()) throw new AppError(400, "INVALID_TIME_RANGE", "不能预约过去的时间")`（如需容忍少量时钟偏差可放宽几分钟）。

### 🟢 低 · 设备搜索未转义 LIKE 通配符，%/_ 导致匹配结果错误

**位置**：`apps/api/lib/service.mjs:194-197`

apps/api/lib/service.mjs:195-197 将用户输入直接包进 `%${query}%` 交给 LIKE。参数化避免了注入，但输入中的 `%` 和 `_` 仍是 LIKE 元字符：搜索 "100%" 会匹配所有含 "100" 前缀的任意后续内容，搜索 "_" 匹配所有非空字段，结果与用户预期不符。

**建议**：对 query 做 `query.replace(/[\\%_]/g, "\\$&")` 并在 SQL 中使用 `LIKE ? ESCAPE '\\'`。

### 🟢 低 · 413 超限在 for-await 中抛出会销毁请求流，客户端大概率收不到 413 响应

**位置**：`apps/api/server.mjs:21-26`

apps/api/server.mjs:25 在 `for await` 迭代体内抛 AppError 会触发迭代器的 return()，Node 会 destroy 该 IncomingMessage 及其 socket。此时客户端往往还在上传剩余数据，连接被重置，精心构造的 413 JSON（server.mjs:144 写出）通常无法送达，客户端只看到 ECONNRESET，无法得知失败原因。

**建议**：先根据 Content-Length 头提前拒绝明显超限的请求；超限时记录标志跳出循环后再抛错，或对超大请求直接 `response.writeHead(413).end()` 后 `request.resume()` 排空。

**核实备注（partially）**：机制部分属实：实测（Node v24.18.0）在 for-await 内抛错后 req.destroyed=true、req.socket 被置 null，客户端在继续上传时收到 EPIPE/ECONNRESET，连接非正常终止。但核心结论'大概率收不到 413'被实测否定：raw socket 客户端和 undici fetch 客户端都完整收到了 413 状态行和 JSON body（Node 的 ServerResponse 在 req 销毁后仍能写出响应，server.mjs:144 的写出并未失败）。真实网络上 RST 先于客户端读取时确有丢失响应的竞态（Linux 收到 RST 会丢弃接收缓冲），但至少在现代 Node 上响应通常能送达，严重性被夸大。

## 安全

### 🔴 高 · 全部 21 个种子账号共用初始密码 123456，且真实姓名/用户名硬编码在源码中，未认领账号可被任何人抢注

**位置**：`apps/api/lib/database.mjs:6`

apps/api/lib/database.mjs:6 `const initialPassword = "123456";`，database.mjs:19-41 列出全部真实用户名（developer、member01、member02 等拼音缩写，极易猜测）和真实姓名。所有账号 must_change_password=1，但在账号主人第一次登录之前，任何知道用户名的人都可以用 123456 登录并把密码改成自己的（POST /api/auth/change-password 首登即可改密），完成账号接管——之后真正的主人只会发现"密码错误"。内网场景下同事之间即可发生；一旦部署到公网（Caddy 配置显示计划走 equip.labequip.example.edu），用户名列表就在源码里，风险直接放大。

**建议**：为每个用户生成独立的随机初始密码并通过线下渠道分发（或改为邀请链接/一次性激活码模式）；至少不要把统一初始密码写死在会入库的源码里。同时考虑把真实姓名花名册移出代码（PII），改为部署时导入的种子文件。

### 🔴 高 · 登录接口无任何限流/锁定机制，配合弱密码策略可被暴力破解

**位置**：`apps/api/server.mjs:77`

apps/api/server.mjs:77-83 的 /api/auth/login 没有失败计数、锁定或速率限制；整个 server.mjs 也没有任何全局限流。密码策略（apps/api/lib/service.mjs:41-49）仅要求 8-128 位且含字母和数字，"password1"、"aaaa1111" 均合法。内网可低速爆破，正式部署到公网前这是必须修的项（Caddy/Cloudflare 层也未见 rate limit 配置）。另外 service.mjs:132-135 中用户名不存在时不执行 scrypt 直接返回，存在明显的时间侧信道可枚举有效用户名。

**建议**：在 login 路径加内存级失败计数（如同一用户名/IP 5 次失败后指数退避或锁定 15 分钟）；用户名不存在时也执行一次假 scrypt 对齐耗时；公网部署时在 Caddy 层叠加 rate_limit。

### 🟡 中 · 任何登录用户可无限创建 pending 预约占满所有设备时段，且系统没有任何取消/审批接口，无人能撤销

**位置**：`apps/api/lib/service.mjs:270`

数据库触发器 reservations_no_overlap_insert（apps/api/lib/database.mjs:134-146）把 pending 状态也计入冲突排斥；service.mjs:267-277 只校验日期格式 `^\d{4}-\d{2}-\d{2}$`，不限制日期范围（可预约 2099 年）也无每人配额；server.mjs:128-138 只有 GET/POST /api/reservations，不存在任何 cancel/reject/approve 端点（前端 app.js:14 的"审批"确实只是界面演示）。结果：一个 member 账号脚本化提交预约即可让全部设备永久不可预约，管理员在系统内没有任何手段撤销，只能手改 SQLite。这是拒绝服务 + 业务闭环缺失的组合问题，内网也会实际发生（哪怕是误操作）。

**建议**：补齐预约状态流转接口（本人可取消、custodian/admin 可审批/驳回，服务端按角色校验）；限制预约日期窗口（如今天起 30 天内、不可过去日期）；增加每用户未完成预约数量上限。

### 🟡 中 · 根目录 compose.yaml 将 Postgres/MinIO/Mailpit 以弱默认口令绑定到 0.0.0.0，整个局域网可直连

**位置**：`compose.yaml:11`

compose.yaml:11-12 `"5432:5432"`（未指定 127.0.0.1，即监听所有网卡），配合 compose.yaml:9 硬编码 POSTGRES_PASSWORD: cipc_dev；compose.yaml:28-30 MinIO 9000/9001 同样全网卡暴露，root 凭据 minio/minio_dev_secret（compose.yaml:26-27）；mailpit 8025 管理界面无认证（compose.yaml:42-44）。实验室内网中任何同网段机器都能以这些凭据读写数据库和对象存储。API 进程自身绑定 127.0.0.1（server.mjs:148）做对了，但基础设施容器没有跟上。

**建议**：开发环境将端口映射改为 `"127.0.0.1:5432:5432"` 等形式；口令改为从 .env 注入（`${POSTGRES_PASSWORD:?}` 强制必填），不要在 compose 文件中硬编码。

### 🟡 中 · .env.example 中的占位密钥（cipc_dev / minio_dev_secret / AUTH_SECRET 占位串）没有任何防照抄上线的机制

**位置**：`.env.example:17`

.env.example:14 `DATABASE_URL=postgresql://cipc:cipc_dev@...`、:17 `AUTH_SECRET=replace-with-a-local-development-secret`、:26-27 `S3_ACCESS_KEY=minio / S3_SECRET_KEY=minio_dev_secret`。scripts/check-env.mjs 只检查 node/pnpm/git/docker 版本，完全不校验环境变量取值；代码中也没有 NODE_ENV=production 时拒绝弱密钥的守卫。cp .env.example .env 直接上生产是最常见的事故路径。另外 .env.example:35-36 的 DEPLOY_HOST/DEPLOY_DOMAIN 泄露了真实部署域名信息。

**建议**：在服务启动路径（或 check-env.mjs）加校验：NODE_ENV=production 时若 AUTH_SECRET/数据库口令等命中已知占位值列表则拒绝启动；.env.example 中的口令改成明显不可用的形式（如 CHANGE_ME__）。

### 🟡 中 · 修改密码后不撤销该用户已有会话，被盗 cookie 在改密后仍有效最长 12 小时

**位置**：`apps/api/lib/service.mjs:174`

apps/api/lib/service.mjs:166-181 changePassword 只更新 users 表，未删除 sessions 表中该 user_id 的记录；会话有效期 12 小时（service.mjs:12）。用户怀疑账号泄露而改密（这是改密的典型动机）后，攻击者手里的旧会话 cookie 依然可用。同理，管理侧也没有任何强制下线手段（无 is_active 置 0 之外的会话吊销接口，好在 getSessionUser 每次都检查 is_active，service.mjs:158）。

**建议**：changePassword 成功后执行 `DELETE FROM sessions WHERE user_id = ?`（可保留当前会话：新签发一枚并 Set-Cookie），这是一行 SQL 的成本。

### 🟢 低 · 预约接口的 requesterLab 在用户未分配实验室时直接采信客户端输入，可伪造所属实验室

**位置**：`apps/api/lib/service.mjs:303`

apps/api/lib/service.mjs:303 `requiredText(actor.laboratoryName || input.requesterLab || "未分配实验室", ...)`——种子用户 laboratory_id 全部为 NULL（database.mjs:176 固定插 NULL），所以当前所有用户的 laboratoryName 均为 null，任何人都可在请求体里填任意 requesterLab 字符串（如冒充"量子实验室"）写入预约记录并展示给全员。requesterName 无此问题（actor.displayName 恒存在，service.mjs:302）。

**建议**：requesterLab 应只取服务端用户档案（未分配时固定写"未分配实验室"），不接受客户端字段；或校验输入必须命中 laboratories 表。

### 🟢 低 · 开发静态服务器的路径穿越防护使用无分隔符的 startsWith 前缀比较，可越权访问以 web 开头的兄弟目录

**位置**：`scripts/dev-web.mjs:32`

scripts/dev-web.mjs:31-32 `const file = normalize(join(root, requested)); if (!file.startsWith(root))`，root 为 `.../apps/web`（无尾部分隔符）。构造原始请求 `GET /../web-backup/x` 会解析到 `.../apps/web-backup/x`，startsWith 判定通过。当前 apps/ 下只有 web 和 api 两个目录所以暂不可利用，且该服务仅用于本地开发，但这是经典的前缀比较漏洞，目录一旦增加（如 web-admin、web.bak）即成立。

**建议**：改为 `file === root || file.startsWith(root + sep)`（node:path 的 sep），并对 request.url 先 decodeURIComponent 再规范化。

### 🟢 低 · 会话 cookie 的 Secure 标志仅依赖 NODE_ENV=production，部署时漏设环境变量则明文可携带

**位置**：`apps/api/server.mjs:13`

apps/api/server.mjs:13 `const secureCookie = process.env.NODE_ENV === "production";`，server.mjs:42-43 据此拼接 Set-Cookie。systemd/compose 部署时忘记设 NODE_ENV 是高频事故，届时经 Caddy TLS 访问的站点签发的会话 cookie 不带 Secure，任何被降级/诱导的 http 请求都会携带会话。HttpOnly 和 SameSite=Lax 已正确设置（值得肯定），CSRF 面因此很小。

**建议**：引入显式 COOKIE_SECURE 环境变量，或反转默认值（非明确 development 即加 Secure）；部署清单中固化 NODE_ENV=production。

### 🟢 低 · 畸形 cookie 会使每个请求抛 URIError 落入 500 分支并打印完整堆栈，可被用来刷爆日志

**位置**：`apps/api/server.mjs:38`

apps/api/server.mjs:38 `decodeURIComponent(entry.slice(separator + 1))` 未做异常保护：发送 `Cookie: cipc_session=%zz` 的任何请求都会抛 URIError，被 server.mjs:141-144 兜底为 500 INTERNAL_ERROR 且 console.error 打印全栈。功能上等于把认证失败（应 401）变成服务器错误，且可零成本制造日志噪音掩盖真实攻击痕迹。

**建议**：parseCookies 中对 decodeURIComponent 包 try/catch，解码失败时保留原始值或视为无 cookie（返回 401）。

**核实备注（partially）**：机制属实：server.mjs:38 的 decodeURIComponent 无 try/catch，`Cookie: cipc_session=%zz` 会抛 URIError，被 server.mjs:141-144 兜底为 500 INTERNAL_ERROR 并 console.error 全栈，认证失败被升格为服务器错误。但'每个请求'不准确：parseCookies 仅在 requireUser（server.mjs:47）和 logout（server.mjs:98）中调用，/api/health、/api/auth/login、OPTIONS 预检和 404 路径不解析 cookie、不受影响；实际波及的是所有需登录的端点 + logout。

### 🟢 低 · 生产 nginx.conf 未设置任何安全响应头，且对 /api 的兜底会返回 index.html

**位置**：`deploy/vps/nginx.conf:20`

deploy/vps/nginx.conf 全文没有 X-Content-Type-Options、X-Frame-Options/CSP frame-ancestors、Referrer-Policy 等头；Caddy 侧 cipc-labequip.caddy:6 `import security_headers` 引用了仓库外的片段，无法确认是否补齐。另外 nginx.conf:21 `try_files $uri $uri/ /index.html` 意味着当前生产环境对 /api/* 会返回 index.html——说明 API 尚未部署（与 README 一致），但将来接入 API 时必须新增受控的 reverse proxy location，届时前述限流、NODE_ENV、Secure cookie 项都成为硬前提。Caddy 仅放行 Cloudflare 网段（cipc-labequip.caddy:9-10）这点做得不错。

**建议**：在 nginx.conf 中显式添加 add_header X-Content-Type-Options nosniff、Content-Security-Policy（至少 frame-ancestors 'none'）、Referrer-Policy strict-origin-when-cross-origin，作为纵深防御不依赖仓库外的 Caddy 片段；将 security_headers 片段纳入版本控制。

### 🟢 低 · createEquipment 的 thumb 字段无长度与取值校验，任意字符串直接成为前端 CSS 类名

**位置**：`apps/api/lib/service.mjs:228`

apps/api/lib/service.mjs:228 `thumb: typeof input.thumb === "string" && input.thumb ? input.thumb : "thumb-orange"`——不像 icon 有 slice(0,4)（service.mjs:227），thumb 完全不限长（受 1MB 请求体上限约束），并在 app.js:91 以 `class="equipment-thumb ${thumb}"` 注入 DOM。escapeHtml 覆盖了 &<>'" 所以无法逃逸出属性形成 XSS（前端整体转义做得扎实，本次审查未发现可利用 XSS；SQL 全部参数化，也未发现注入），但管理员可注入任意 class 名影响页面样式/布局，并可存储超长垃圾数据。

**建议**：对 thumb 做白名单校验（如仅允许 thumb-orange/thumb-blue/thumb-green 等预设值），与前端 styles.css 中实际存在的类保持一致。

## 前端

### 🔴 高 · 生产部署没有 /api 代理，前端所有 API 请求会拿到 index.html，且失败时向用户暴露英文内部错误

**位置**：`deploy/vps/nginx.conf:20-22, apps/web/app.js:67-68, apps/web/app.js:585`

前端统一用相对路径请求 `fetch(\`/api${path}\`)`（app.js:62）。开发环境 scripts/dev-web.mjs 会把 /api/* 代理到 4000 端口，但生产部署 deploy/vps/nginx.conf 只有 `location / { try_files $uri $uri/ /index.html; }`，没有任何 /api 代理段，deploy/vps/compose.yaml 也只起了 nginx 静态服务、没有 api 服务。结果是生产环境下 /api/auth/session 返回 200 + text/html（index.html 内容），apiRequest 在 app.js:68 抛出 `new Error("API response is not JSON")`——该 Error 没有 status 属性，登录处理器 app.js:585 的 `error.status === 502` 分支永远走不到，用户在登录框看到的是英文内部消息 "API response is not JSON"。

**建议**：在 nginx.conf 增加 `location /api/ { proxy_pass http://api:4000; }` 并在 compose 中加入 api 服务（挂载 SQLite 卷）；同时在 apiRequest 里为非 JSON 响应保留 response.status 并映射为中文兜底文案（如 `if (!contentType.includes(...)) { const e = new Error("服务暂时不可用"); e.status = response.status; throw e; }`），避免任何英文内部错误直接进入 UI。

### 🔴 高 · 预约日历只渲染前 5 台设备且周导航全是死按钮，超出部分的预约完全不可见

**位置**：`apps/web/app.js:145, apps/web/index.html:208`

renderFullCalendar 中 `equipment.slice(0, 5)`（app.js:145）硬性截断为 5 行，没有任何 "还有 N 台设备" 提示；第 6 台及之后设备的预约在日历上永远不显示，用户只能在提交时撞上 409 冲突才知道时段被占。同时 index.html:208 的 `‹` `›` `今天` `周/月` 按钮都没有绑定事件（app.js 中无对应 listener），日历被锁死在 `currentDate` 所在周——明天以后的预约提交成功后也无法在日历中核对，与指南里"先查看周日历，再提交"的引导矛盾。

**建议**：MVP 内最小改法：去掉 slice(0,5) 改为渲染全部设备（行数多时加容器滚动即可）；给周切换按钮接上状态（把 currentDate 换成可变的 viewWeekStart，`‹›/今天` 修改它后重跑 renderFullCalendar + updateDateLabels）。月视图按钮如短期不做请隐藏而不是留死按钮。

### 🟡 中 · 数据加载失败被当成"未登录"处理：会话有效时可能被静默踢回登录页，或登录成功却停在登录框

**位置**：`apps/web/app.js:617-630, apps/web/app.js:568-589, apps/web/app.js:412-420`

initializeApp 的 try/catch（app.js:623-629）把 `/auth/session` 鉴权失败和 `enterApplication → loadApplicationData` 的失败混在一个 catch 里：/api/laboratories 等任何一个请求瞬时失败都会走 showLogin()，且不给任何错误提示——用户会话明明有效却被要求重新登录。登录提交处理器（app.js:574-585）同理：login 成功后 cookie 已种下，但 loadApplicationData 抛错会被 catch 显示成"登录失败"类错误，用户重试登录或刷新页面反而能进去，行为不可解释。

**建议**：区分两类失败：鉴权 401 才 showLogin；loadApplicationData 失败时保留已认证状态，显示"数据加载失败，点击重试"的界面或至少 toast + 重试按钮。可以给 apiRequest 的错误对象带上 code/status，在 initializeApp 里 `if (error.status === 401) showLogin(); else showLoadError()`。

### 🟡 中 · 无全局 401 处理：会话过期后 UI 停留在已登录界面，所有操作只弹 toast

**位置**：`apps/web/app.js:61-77, apps/web/app.js:463-478`

后端会话 12 小时过期（service.mjs:12），过期后所有接口返回 401 SESSION_EXPIRED。前端 apiRequest 抛错后各调用点只做局部处理：预约提交（app.js:474-475）和新增设备只 `showToast(error.message)`，页面继续显示旧数据和已登录侧边栏，用户反复提交反复失败，没有任何路径回到登录页（除非手动点退出）。

**建议**：在 apiRequest 中集中拦截：`if (error.status === 401 && 已处于 authenticated 状态) { showToast("登录已过期"); showLogin(); }`。一处修改即可覆盖所有调用点。

### 🟡 中 · 总览页 mini 日历日期整块硬编码（20-26 日、today=22），永远不随真实日期更新

**位置**：`apps/web/index.html:179, apps/web/app.js:367-385`

updateDateLabels 更新了 kicker、date-badge、.calendar-range 和 .week-head（预约日历页表头），但总览 schedule-panel 里的 `.calendar-days`（index.html:179：`周一<small>20</small>…<small class="today">22</small>…<span class="selected-day">周四<small>23</small>`）从未被 JS 触碰，永远显示 2026-07-20~26 那一周且高亮错误的"今天"。同面板的"已占用 0% / 共 0 小时"（index.html:177）也从不计算。另外 .week-head 里硬编码的 `<b>周四</b>` 加粗（index.html:209）不会随 current 类切换而移动。

**建议**：在 updateDateLabels 中一并渲染 `.calendar-days`（用 weekStart 循环 7 天生成），或者干脆用 JS 生成整个 mini 日历；占用率如暂不计算就先移除该行文案，避免展示恒为 0 的假统计。

### 🟡 中 · "待审批"面板与"需要关注"计数永远为 0/空，即使内存里确有 pending 预约

**位置**：`apps/web/index.html:209, apps/web/index.html:192-193, apps/web/app.js:198-206`

reservations 数组里 status='pending' 的记录真实存在（POST 后 push 进数组，日历也用橙色块渲染 pending，app.js:153），但预约日历页右侧 approval-panel（index.html:209）和总览 attention-panel（index.html:192-193）是写死的空状态 + `<span class="attention-count">0</span>`，renderAll 从不更新它们。保管人角色看到"暂无待审批预约"会以为没有待办，与同屏日历上显示的橙色 pending 块直接自相矛盾。

**建议**：即使审批操作未实现，也应把 pending 预约列表只读渲染进 approval-panel 并更新两个 count（`reservations.filter(r => r.status === 'pending')`），按钮可先禁用并注明"审批操作即将上线"；否则请隐藏整个面板而不是显示恒 0。

### 🟡 中 · 日期/时区约定不一致：后端固定 +08:00，前端用浏览器本地时区判定"今天"，且 currentDate 加载后永不刷新

**位置**：`apps/web/app.js:17, apps/web/app.js:41-46, apps/web/app.js:115, apps/api/lib/service.mjs:273-274`

后端把预约时间按 `new Date(\`${date}T${start}:00+08:00\`)` 固定解析为东八区（service.mjs:273），即 date/start 是"实验室墙钟时间"约定；而前端 `currentDate = localDate(new Date())`（app.js:17）用浏览器本地时区，`item.date === currentDate`（app.js:115、169）据此筛"今日预约"。浏览器时区非 Asia/Shanghai 时（出差、远程 VPN），今日列表、日历 today 高亮、统计卡"今日预约"全部错位一天。此外 currentDate 是模块加载时的常量，页面跨零点后不刷新，"今天"仍是昨天，预约表单默认日期（app.js:372）也随之过期。

**建议**：MVP 可接受"墙钟时间"约定，但要统一：前端用 Intl API 按 Asia/Shanghai 计算 currentDate（`new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())`），并在 setInterval 或 visibilitychange 时检测日期变更后重跑 updateDateLabels/renderAll。把时区约定写进 docs 与 .env（后端也不应硬编码 +08:00 字符串）。

### 🟡 中 · 可访问性：全站大量 8-10px 字号叠加低对比度灰字，远低于 WCAG AA，移动端接近不可读

**位置**：`apps/web/styles.css:53, apps/web/styles.css:55, apps/web/styles.css:64-66, apps/web/styles.css:69`

正文级信息普遍 8-10px：表格单元格 `font-size: 10px`、表头 9px（styles.css:53），`.calendar-block { font-size: 8px }`（:65 区段）、`.cell-subline { font-size: 8px }`（:69）、`.upcoming-info span` 9px 等；配色如 #a1a9b4/#a0a8b3 在白底上的对比度约 2.2:1（AA 要求 4.5:1）。这不是个别装饰文字，而是设备编号、预约时段、成员信息等核心业务数据的呈现字号。在手机上 8px 实际渲染不足 2mm 高，属于严重可用性问题。

**建议**：建立字号阶梯并设下限：正文数据不小于 12px（0.75rem），辅助说明不小于 11px；把 #a0a8b3 一类灰字提升到 #6b7480 以上。因为字号散落在数十条规则里，建议趁机抽成 CSS 变量（--text-sm/--text-xs/--muted-strong）一次性替换。

### 🟡 中 · 预约/设备模态与抽屉无焦点圈禁、关闭后不归还焦点，焦点可残留在 aria-hidden 容器内

**位置**：`apps/web/app.js:223-238, apps/web/app.js:306-319`

setGuideModal 做了焦点记忆与归还（app.js:306-319），但 setModal/setEquipmentModal/setDrawer 只是 toggle class + aria-hidden：打开后 Tab 可以移出对话框进入被遮罩的背景内容；关闭后焦点留在被设置为 aria-hidden="true" 的容器里的按钮上（如 close-modal），屏幕阅读器焦点丢失。三个容器都标了 role="dialog" aria-modal="true" 但没有兑现 modal 语义。抽屉打开时（setDrawer）甚至不做任何 focus。

**建议**：把 guide modal 的模式抽成通用 openDialog(container, initialFocusSelector) helper：记录 document.activeElement、开启时 focus 首控件、keydown 里做 Tab 循环圈禁、关闭时归还焦点。四个弹层复用同一实现，也顺带消除现有四份重复的 setXxx 函数。

### 🟡 中 · 632 行单文件已出现明显耦合：索引序号绑定 DOM、深层脆弱选择器、四套重复弹层逻辑——建议拆 ES module，不建议上框架

**位置**：`apps/web/app.js:170-180, apps/web/app.js:252, apps/web/app.js:428, apps/web/app.js:223-246`

具体耦合点：(1) renderStats 用 `document.querySelectorAll(".stats-grid .stat-value")` 按下标 0-3 写值（app.js:171-174），`.directory-stats strong` 同样按下标（:176-180）——HTML 中调整卡片顺序会静默写错统计；(2) `document.querySelector(".guide-header > div > p:last-child")`（:252）、`".workspace-button > span:first-child").lastChild.textContent`（:428，依赖文本节点位置且写入的正是 HTML 里已有的常量，属无效残留代码）这类结构选择器一改版式就断；(3) setModal/setEquipmentModal/setDrawer/setRoleMenu/setGuideModal 五段近似重复；(4) equipmentRow 等模板是数百字符的单行字符串，diff/review 困难。权衡：当前交互（整表重绘 + 少量弹层）vanilla JS 完全够用，且与零依赖后端、无构建部署（nginx 直接吊静态文件）的架构一致，引入框架会带来构建链和部署改造，收益不成比例。真正会逼出框架的是审批流、月视图日历这类细粒度增量更新场景，届时再评估。

**建议**：近期做三件事即可：(a) `<script type="module">` 原生拆分为 api.mjs / state.mjs / render-*.mjs / dialogs.mjs，无需构建工具；(b) 所有 JS 写值的节点补 id 或 data-stat="total" 之类的语义锚点，消灭下标与结构选择器；(c) 弹层逻辑收敛为一个 dialog helper。framework 迁移作为审批功能立项时的决策点，写入 docs 备忘。

### 🟢 低 · XSS 现状良好但防线依赖人工纪律：所有 innerHTML 拼接点均正确使用 escapeHtml，唯漏一处即破防

**位置**：`apps/web/app.js:48-50, apps/web/app.js:91-92, apps/web/app.js:117, apps/web/app.js:163, apps/web/app.js:193-195`

逐点核查了全部 innerHTML/模板拼接：equipmentRow、renderUpcoming、renderFullCalendar（含 title 属性）、renderAccessData、renderLaboratoryOptions、refreshReservationOptions、#page-title（app.js:281）均对用户可控字段（name/code/owner/requesterName/displayName/purpose 等）调用了 escapeHtml，且 escapeHtml 覆盖 &<>'" 五个字符，属性注入也被阻断——本次未发现可利用的 XSS。风险在于模式本身：每次渲染整段 innerHTML 重建 + 重绑监听，未来新增任何字段（如设备备注、审批意见）只要漏包一层 escapeHtml 即成存储型 XSS，管理员创建的设备数据会打到所有角色。次要点：`statusClasses[item.status]` 遇到未知状态输出 class="undefined"（app.js:91）。

**建议**：拆模块时把行模板收敛为少数几个经过 escape 的 helper（如 html`...` 标签模板函数自动转义插值），新代码禁止裸拼 innerHTML；给 statusClasses 加兜底 `|| "status-maintenance"`。可另行加一条 CSP（default-src 'self'）作为纵深防御，当前页面除 Google Fonts 外无外部依赖，代价很小。

### 🟢 低 · 可以预约过去的日期和时段，前后端均无校验

**位置**：`apps/web/index.html:238, apps/web/app.js:455-462, apps/api/lib/service.mjs:267-277`

`#reservation-date` 没有 min 属性（index.html:238），提交处理器（app.js:455-462）不检查日期是否早于今天；后端 createReservation 只校验格式与 start<end（service.mjs:270-276）。用户可为上周提交"待审批"预约，还会占用该时段的冲突判定窗口（conflict 检查不区分过去/未来），产生无意义的历史 pending 记录。

**建议**：前端给 date input 设 `min="${currentDate}"` 并在 submit 时校验 `startAt >= Date.now()`（同日需比较时间）；后端 createReservation 同步加校验返回 400，前端提示复用现有 toast 通道。

### 🟢 低 · openEquipmentDetail 查不到 id 时静默回退到 equipment[0]，会显示错误设备的详情

**位置**：`apps/web/app.js:338`

`drawerEquipment = equipment.find((item) => item.id === id) || equipment[0];`——find 失败（如数据刚被其他会话删除、id 为 undefined）时不是报错而是打开第一台设备的抽屉，用户可能基于错误设备的位置/保管人信息去预约（reserve-from-drawer 用的正是 drawerEquipment.id，app.js:522）。

**建议**：去掉 `|| equipment[0]` 回退，查不到时 `showToast("设备信息已变更，请刷新列表")` 并 return。

### 🟢 低 · 一次性拉取全量 reservations 且不用后端已支持的过滤参数，数据量随时间无限增长

**位置**：`apps/web/app.js:413, apps/api/server.mjs:128-131`

loadApplicationData 请求 `/api/reservations` 不带任何参数，后端返回建库以来所有预约（含 cancelled/rejected 和全部历史），而 server.mjs:130 明明支持 `?date=` 和 `?equipmentId=`。前端只消费"今天"（renderUpcoming/renderStats）和"本周"（renderFullCalendar）两个窗口，其余数据纯属浪费；一个日常使用的实验室一年即数千条，每次登录全量下发并在客户端反复 filter。附带一致性问题：所有登录用户（含普通 member）都能拿到全量预约的 purpose、requesterName 字段，超出页面实际展示范围。

**建议**：按视图窗口取数：登录后先取本周（后端补一个 `?from=&to=` 范围参数比按天多次请求更合适），周切换时再取对应周。后端同时考虑对 member 角色裁剪返回字段。

### 🟢 低 · 多处硬编码假数据与死控件以真实功能的样子呈现，用户无法分辨

**位置**：`apps/web/index.html:265, apps/web/index.html:203, apps/web/index.html:177`

设备详情抽屉对每台设备都显示写死的"资料完整度 94%"和"共享方式 审批后使用"（index.html:265-266）；台账分页按钮 1/2/3/→ 与"全部实验室/全部状态"下拉是无事件的死按钮（index.html:203），而列表实际是全量渲染；"导入数据/导出清单"点击后弹"导出任务已加入队列"成功 toast（demo-action，app.js:536）但不产生任何文件——成功反馈+无结果比禁用按钮更具误导性。指南文档虽有说明，但界面本身没有任何"示例"标记。

**建议**：统一处理演示元素：要么移除（94%、分页、假下拉），要么明确置灰禁用并加 title="即将上线"；demo-action 的 toast 文案改为"该功能尚未开放"而不是伪造成功结果。另外 renderDirectory 的分页文案在空结果时显示"显示 1-0"（app.js:111），顺手修正。

### 🟢 低 · 新增设备的 icon/thumb 被前端写死，维修数量角标从不更新等小型状态不一致

**位置**：`apps/web/app.js:496-497, apps/web/index.html:71, apps/web/app.js:377`

三个小问题：(1) 设备表单没有图标/配色字段，前端固定提交 `icon: "◇", thumb: "thumb-orange"`（app.js:496-497），后端虽支持任意值（service.mjs:227-228），所有新设备在列表/日历中外观完全相同，削弱了 thumb 存在的意义；(2) 侧边栏"维修与保养"的 `nav-count warning` 角标（index.html:71）从不更新，renderStats 只更新 equipment 角标（app.js:175），设备转维修后角标仍显示 0；(3) 周范围标题 `${weekStart.getMonth()+1} 月 ${weekStart.getDate()} 日 - ${weekEnd.getDate()} 日`（app.js:377）在跨月周显示为"7 月 27 日 - 2 日"。

**建议**：(1) 由后端按名称哈希或类别分配 thumb 色，或在表单加可选配色；(2) renderStats 中同步 `document.querySelector('[data-view="maintenance"] .nav-count').textContent = 维修数`；(3) weekEnd 与 weekStart 月份不同时输出完整"M 月 D 日"。

## 架构与文档一致性

### 🔴 高 · 数据字典与实际建表语句大面积不一致，DATA_DICTIONARY.md 已不能作为数据模型的可信来源

**位置**：`docs/DATA_DICTIONARY.md:1-55 vs apps/api/lib/database.mjs:55-147`

逐表对照结果：(1) users：字典定义 name/email/role(user, custodian, lab_admin, system_admin)/lab_id，实际是 username/display_name/role CHECK IN ('developer','admin','custodian','member')/laboratory_id（database.mjs:72-86）——角色枚举两套完全对不上，且实际表没有 email 字段，但字典称 email 是'登录和通知地址'；实际表还有字典未记载的 password_hash/password_salt/must_change_password 等列。(2) laboratories：字典是 name/building/room/description，实际是 code/name/alias/sort_order（database.mjs:61-70）。(3) 字典的 equipment_models + equipment_instances 两张表在代码中不存在，只有一张 equipment 单表，且缺 specifications JSON、total_quantity、shareable、booking_policy、deleted_at（软删除）等全部治理字段，反而混入了 icon/thumb 两个纯展示字段（database.mjs:107-108）。(4) reservations：字典有 requester_id/approved_by/approved_at/cancelled_at/notes/project_name，实际全部缺失，代之以 requester_name/requester_lab 自由文本和字典没有的 people 字段（database.mjs:113-129）。(5) 状态枚举：字典设备状态含 in_use/service，实际 CHECK 不含（database.mjs:106）；ARCHITECTURE.md:76 预约状态机含 draft，实际 CHECK 无 draft（database.mjs:125）。(6) procurement_records、maintenance_records、audit_logs 三张字典表完全未建；实际存在的 sessions、app_settings 两张表字典未记载。

**建议**：把 DATA_DICTIONARY.md 改为双栏结构：'当前 SQLite 实际 schema'（以 database.mjs 为准逐字段同步）和'目标 PostgreSQL 模型'，并在每张目标表标注落地阶段（对应 PROJECT_PLAN 的 P2-P4）。角色枚举、预约状态枚举这类会被前后端同时引用的值必须先统一冻结一套——这正是 PROJECT_OVERVIEW_FOR_EXTERNAL_REVIEW.md:314 自己提出的 'P0 冻结' 项。

### 🔴 高 · README 开发约定第 3 条'设备档案与设备实例分离'完全未落实，且核心关联字段全部是自由文本，无外键

**位置**：`apps/api/lib/database.mjs:98-111`

README.md:37 明确约定'设备档案与设备实例分离，避免多台同型号设备无法独立排期'，但实际只有一张 equipment 单表，型号、实例、序列号、数量概念都不存在——录入两台同型号光谱仪只能建两条互不相关的档案，或一条档案无法分台排期，约定所要防止的问题现在就存在。更深的问题是关联方式：equipment.lab、equipment.owner 是 TEXT（database.mjs:103-105），reservations.requester_name/requester_lab 也是 TEXT 快照（database.mjs:123-124），与已存在的 laboratories、users 表零外键关联；service.mjs:303 在用户无实验室时直接填字符串'未分配实验室'，而种子用户的 laboratory_id 全部为 NULL（database.mjs:176）。这意味着 ARCHITECTURE.md:50 的关键不变量 4'只有设备保管人…可以审批对应预约'在数据层无法表达——owner 是一个名字字符串，无法可靠对应到 users 行。

**建议**：在还没有真实数据的窗口期（仓库尚无 commit，重建 schema 零成本）优先做三件事：equipment.owner 改为 custodian_id REFERENCES users(id)；equipment.lab 改为 laboratory_id REFERENCES laboratories(id)；reservations 增加 requester_id REFERENCES users(id)（可保留姓名快照列用于展示）。档案/实例拆分可以推迟到 P2，但外键关联必须在写入真实预约前完成，否则审批权限、通知、按实验室统计都建立在字符串匹配上。

### 🔴 高 · '持久化适配器替换为 PostgreSQL'的承诺没有适配器层支撑，迁移实际上是对 service 层的重写

**位置**：`docs/ARCHITECTURE.md:18 vs apps/api/lib/service.mjs`

ARCHITECTURE.md:18 声称'将持久化适配器替换为 PostgreSQL，前端接口无需改变'，但代码中不存在适配器抽象：service.mjs 的每个方法都直接内嵌 SQL 并调用 node:sqlite 的同步 API（database.prepare(...).get/.all/.run）。迁移到 PostgreSQL 需要重写的具体清单：(1) 同步→异步：pg/postgres.js 客户端全是 Promise，service.mjs 全部 12 个方法及 test/service.test.mjs 全部断言要改 async（server.mjs 的 handler 已是 async，调用侧问题不大）；(2) 冲突校验机制整体更换：当前依赖 SQLite 触发器 RAISE(ABORT, 'reservation_conflict')（database.mjs:134-146）+ 错误消息字符串匹配 String(error.message).includes("reservation_conflict")（service.mjs:308）和 includes("UNIQUE constraint failed: equipment.code")（service.mjs:236），PG 下应改为 EXCLUDE USING gist (equipment_id WITH =, tstzrange(start_at,end_at) WITH &&) 排他约束并按 SQLSTATE（23P01/23505）识别错误；(3) SQLite 方言：PRAGMA journal_mode=WAL、INSERT OR IGNORE、BEGIN IMMEDIATE（database.mjs:52-53, 165, 173, 157）；(4) 无迁移机制：schema 靠 CREATE TABLE IF NOT EXISTS 幂等重放，甚至一次性数据清理也藏在建库代码里（database.mjs:159-162 的 real_data_reset_20260726 标记会 DELETE 业务表），没有版本化迁移表。

**建议**：不必现在就引入 ORM，但应立即做两件低成本的事为迁移铺路：(a) 把'冲突已发生'的判定收敛为 database.mjs 导出的单一函数（如 isConflictError(error)），消灭 service 层的错误消息字符串匹配；(b) 把 schema 和种子改成编号迁移文件 + schema_migrations 表，哪怕迁移执行器是自写的 30 行代码。同时修正 ARCHITECTURE.md 的表述：真实的迁移面是'database.mjs 全部 + service.mjs 的 SQL 与同步调用'，唯一真正稳定的是 HTTP API 契约。

### 🟡 中 · README 和 USER_GUIDE 仍宣称'离线演示模式'，但当前 app.js 已删除该模式并强制登录

**位置**：`README.md:65, docs/USER_GUIDE.md:9-12,33,93,163-167 vs apps/web/app.js:618-631`

README.md:65 写'如果 API 未启动，前端会显示离线演示模式，并使用浏览器本地数据'，USER_GUIDE.md 有至少 7 处围绕离线模式的操作说明（含'共享数据已连接'指示器、离线冲突校验说明）。但当前 app.js 的 initializeApp() 做的恰恰相反：启动时主动删除旧演示数据 localStorage.removeItem("cipc-demo-equipment"/"cipc-demo-reservations")（app.js:620-621），/api/auth/session 失败时直接 showLogin()，整个应用只有一条依赖 fetch(`/api${path}`)（app.js:62）的在线路径。PROJECT_OVERVIEW_FOR_EXTERNAL_REVIEW.md 第 4.2/4.3 节描述的'线上静态预览运行在离线演示模式'也随之失效——若线上仍只部署静态文件（文档 10 节称未部署 API），当前 app.js 上线后用户将卡在无法登录的登录页。

**建议**：同一次提交内更新 README.md、USER_GUIDE.md、PROJECT_OVERVIEW_FOR_EXTERNAL_REVIEW.md 中所有离线模式描述；并明确决策：要么线上同步部署 API（deploy/vps 需增加 API 反代与数据持久化），要么线上暂停更新前端。建议在文档头部加'信息基线'日期并在每次行为级改动时刷新（PROJECT_OVERVIEW 已有此机制，README/USER_GUIDE 没有）。

### 🟡 中 · pnpm monorepo 是空壳：workspace 内没有任何一个真正的 package，packages/db、packages/ui 只有 .gitkeep

**位置**：`pnpm-workspace.yaml, packages/db/.gitkeep, packages/ui/.gitkeep`

pnpm-workspace.yaml 声明 apps/* 和 packages/* 为 workspace 包，但 find 确认 apps/api、apps/web、packages/db、packages/ui 四个目录都没有 package.json——workspace 实际收录的包数量为零，所有 scripts 都在根 package.json 里用相对路径直接调用（如 "dev:api": "node apps/api/server.mjs"）。README.md:28-29 推荐目录称 packages/db 是'数据模型与迁移'、packages/ui 是'共享 UI 组件'，而真实的数据模型在 apps/api/lib/database.mjs，UI 无任何共享层。当前零依赖策略下这套结构没有实际代价，但它让 README 的目录说明产生误导，且 pnpm-lock.yaml 只有 114 字节（空 lockfile），monorepo 工具链纯属摆设。

**建议**：二选一并保持诚实：(a) 若近期不引入依赖和多包共享，删除 packages/、pnpm-workspace.yaml，README 目录说明改为反映现状，降低认知噪音；(b) 若保留结构，至少给 apps/api、apps/web 补上最小 package.json 使其成为真实 workspace 成员，packages/db 的定位改为'迁移文件与种子数据的未来归属'并在文档标注'尚未启用'。做 PostgreSQL 迁移时再把 database.mjs 拆入 packages/db 是自然时机。

### 🟡 中 · 审计日志承诺（README 约定第 4 条、ARCHITECTURE Audit 模块）零落地，且越晚补越难回溯

**位置**：`README.md:38, docs/ARCHITECTURE.md:42,69 vs apps/api/lib/service.mjs`

README 开发约定第 4 条'所有状态变更、审批和关键编辑保留操作日志'，ARCHITECTURE.md 把 Audit 列为六大领域模块之一并在 API 初稿列出 GET /api/audit-logs，DATA_DICTIONARY 定义了 audit_logs 表。实际代码中没有 audit_logs 表、没有任何审计写入调用、没有 request_id 生成。当前已存在会产生审计需求的操作：登录（authenticate）、改密（changePassword）、新建设备（createEquipment）、新建预约（createReservation）。PROJECT_OVERVIEW_FOR_EXTERNAL_REVIEW.md:72 自己也标注操作审计为'规划中'，但 README 的措辞是'约定'而非'规划'，两份文档口径不一。

**建议**：在 service 层引入统一的写操作出口（当前所有写操作都已集中在 service.mjs，是插入审计的理想时机），先落一张最简 audit_logs(id, actor_id, entity_type, entity_id, action, payload, created_at) 表并在 createEquipment/createReservation/changePassword 三处写入。不需要等 PostgreSQL——审计写入点的代码结构在两种数据库下相同，晚加意味着已发生的操作永久无审计。

### 🟡 中 · 通知/报表/自动采集的演进余地不足：users 无 email、预约无 requester_id、同步 DB 调用阻塞事件循环

**位置**：`apps/api/lib/database.mjs:72-86,113-129; .env.example; compose.yaml`

对照 README.md:35'先完成设备台账和预约主流程，再扩展通知、报表和自动采集'逐项检查：(1) 通知：根 compose.yaml 预留了 mailpit、.env.example 预留了 SMTP_*，但 users 表没有 email 列（database.mjs:72-86），reservations 没有 requester_id/approved_by 外键——通知系统连'发给谁'都无法从数据回答，这不是加一个 adapter 能解决的，是模型缺口。(2) 报表：按实验室统计设备/预约只能对 equipment.lab、requester_lab 两个自由文本列做字符串分组，同一实验室的不同写法（'光电融合实验室' vs '实验室二'，见 database.mjs:10 的 name/alias 双名制）会直接分裂统计口径。(3) 自动采集：node:sqlite 的 DatabaseSync 是同步阻塞调用，单 Node 进程 + 单写者 SQLite 在传感器持续写入场景下会阻塞所有 API 请求，当前架构没有任何摄取边界预留。另有配置错误：.env.example 的 S3_ENDPOINT=http://localhost:9001 指向的是 MinIO 控制台端口，S3 API 端口是 9000（compose.yaml ports 段），首次接附件功能时会浪费排查时间。

**建议**：通知和报表的余地问题应在 P0/P2 用外键和 email 列解决（与本清单第 2 条同一批 schema 修正），成本极低；自动采集属于 PROJECT_PLAN '后续迭代'，无需现在设计，但应在 ARCHITECTURE.md 明确写下'采集数据不入主库、走独立摄取服务'的边界决定，防止未来图省事直接往 SQLite/主 PG 写时序数据。顺手修正 S3_ENDPOINT 为 9000。

### 🟡 中 · 真实员工姓名与统一初始密码 '123456' 硬编码在源码种子中，与自身文档的敏感数据边界原则矛盾

**位置**：`apps/api/lib/database.mjs:6,19-41`

database.mjs:6 硬编码 initialPassword = "123456"，第 19-41 行硬编码了 20 位真实教职工的姓名与用户名映射（另有测试断言依赖这些真名，service.test.mjs:78-86）。PROJECT_OVERVIEW_FOR_EXTERNAL_REVIEW.md:290 自己列出的 P0 风险第 6 条是'账号、合同、附件和个人信息不应进入当前演示系统'，但个人信息已经进入源码本身——一旦仓库推送到任何远端（当前尚无 commit，还来得及），真名花名册与弱初始密码将进入版本历史且不可清除。改密流程虽已实现（must_change_password + validateNewPassword 禁止 123456），但所有账号在首登前共享同一已知密码。

**建议**：趁仓库还没有第一个 commit：把 userSeeds/laboratorySeeds 移到被 .gitignore 排除的本地种子文件（如 apps/api/data/seed.local.json），仓库内只保留 developer 开发账号和虚构测试数据；初始密码改为启动时生成随机值并输出到控制台，或从环境变量读取。测试断言改用虚构姓名。这是首个 commit 之前必须处理的仓库卫生问题。

### 🟢 低 · 零依赖自写路由/校验在当前规模（12 条无路径参数的路由）仍然合理，但框架化的触发信号已经排队在 P3 门口

**位置**：`apps/api/server.mjs:55-146 vs docs/ARCHITECTURE.md:53-70`

server.mjs 用 161 行 if-chain 实现 12 条路由，配合 service.mjs 的 requiredText 手写校验，在当前规模下清晰、可测试、无供应链风险，判断为仍然合理。但一个值得注意的模式是：ARCHITECTURE.md API 初稿中所有含路径参数的端点（GET /api/equipment/:id、GET .../availability、PATCH /api/reservations/:id/approve|cancel|complete）恰好全部未实现——当前 if-chain 只匹配字面路径，没有任何 :id 提取逻辑。这不是巧合：手写路由让含参端点的边际成本明显更高。而 PROJECT_PLAN P3'预约审批'恰恰要求这批端点。同类信号还有：requireUser 等横切逻辑靠每个 handler 手动调用（server.mjs:105,111,117 等，漏写一行即漏鉴权）、附件上传需要 multipart 解析、审计需要中间件式 request_id 注入。

**建议**：触发条件建议明确写入 ARCHITECTURE.md：出现以下任一情况即引入轻量框架（Hono/Fastify 级别，而非 NestJS）——(1) 开始实现含路径参数的 PATCH 状态迁移端点（P3 审批流）；(2) 需要 multipart 附件上传；(3) 鉴权/审计需要以中间件保证'默认拒绝'而非逐 handler 记得调用。在此之前继续零依赖是正确的省力选择；直接跳到文档推荐的 NestJS + Prisma 全家桶则超出当前团队规模的必要复杂度。

**核实备注（partially）**：核心论断全部属实，仅路由计数有小误差：server.mjs 的 if-chain 实测为 11 条 url.pathname 精确匹配路由（grep 计数 11），加 OPTIONS 预检处理（server.mjs:60-68）才凑到 12；文件确为 161 行。其余全部核实：全文无任何 :id 提取逻辑，ARCHITECTURE.md:55-70 API 初稿中所有含路径参数端点（/api/equipment/:id、availability、/api/reservations/:id/approve|cancel|complete、maintenance、audit-logs）均未实现——甚至 service.mjs:208 已有 getEquipment(id) 方法但无路由暴露。requireUser 靠每个 handler 手动调用属实（server.mjs:86,91,105,111,117,123,129,135——finding 引的 105/111/117 行号准确），requiredText 手写校验属实（service.mjs:23-28）。

### 🟢 低 · 设备状态机纸面存在但无迁移路径：'reserved' 是永远不会被写入的死枚举值，且没有任何状态变更 API

**位置**：`docs/ARCHITECTURE.md:74-76 vs apps/api/lib/database.mjs:106, apps/api/server.mjs`

ARCHITECTURE.md:74 定义设备状态机 available -> reserved -> in_use -> available，equipment 表的 CHECK 也包含 'reserved'（database.mjs:106），但通读全部代码：createReservation 成功后不更新设备状态，也不存在 PATCH /api/equipment/:id 或任何状态迁移端点——'reserved' 是只能通过 createEquipment 时手工指定才能到达的状态，状态机的所有转换均无代码。类似地，预约侧只有 'pending' 一个可达状态（service.mjs:291 硬编码），approve/cancel/complete 全缺。这本身是 MVP 阶段的正常缺口（PROJECT_OVERVIEW 8.4 节已如实列出），列为发现是因为 ARCHITECTURE.md 把它写成现在时的系统行为而非目标。

**建议**：两个低成本动作：(1) 在 ARCHITECTURE.md 状态机一节标注'目标设计，当前仅 available/maintenance/disabled/retired 为手工可达状态'；(2) 实现审批流（P3）时优先决定 equipment.status 与预约的联动语义——设备级 reserved 状态与'同一设备多个未来预约'天然冲突，建议届时从枚举中删掉 reserved，用预约表实时推导占用，避免双写不一致。

## 测试与工程质量

### 🔴 高 · server.mjs 的 HTTP 层（161 行）完全没有测试，且当前结构无法被测试

**位置**：`apps/api/server.mjs:7-11,148`

server.mjs 在模块顶层就打开数据库并 listen（第 7-11 行 createDatabase/createService，第 148 行 server.listen），import 即产生副作用，测试根本无法加载它。因此以下逻辑全部零覆盖：requireUser 的角色门禁（:46-53，/api/users 和 POST /api/equipment 限 developer/admin，:111、:123）、mustChangePassword 强制改密拦截（:48-50）、cookie 解析（:35-40）、CORS 白名单（:14、:56-59）、1MB 请求体上限 413（:25）、INVALID_JSON 400（:29-31）、Set-Cookie 属性（HttpOnly/SameSite，:42-44）、统一错误封装（:141-145）。鉴权和权限是这个系统的安全边界，目前只靠手工点前端验证。

**建议**：零依赖即可测：把路由处理器抽成 `createApp(service)` 工厂（返回 createServer 的 handler），server.mjs 只留「建库 + createApp + listen」入口。测试里 `server.listen(0)` 拿随机端口，用 Node 内置 fetch 走真实 HTTP：登录→拿 cookie→带/不带 cookie 访问 /api/users 断言 401/403/200，POST 非法 JSON 断言 400。一个 ~80 行的 http.test.mjs 就能覆盖所有安全关键分支，不需要任何测试框架。

### 🔴 高 · createReservation 的输入校验分支几乎全部未测（人数边界、时间格式、非法日期、404）

**位置**：`apps/api/lib/service.mjs:259-282`

service.test.mjs 只测了「合法预约 + 时段冲突 + maintenance 拒绝」。未覆盖：(1) people 边界（:279-281）：0、13、1.5、"abc" 均应 400，而且 `Number(input.people)` 会把 `true` 转成 1 被接受、把 `"2"` 字符串接受——这些语义从未被钉住；(2) 日期/时间格式 regex（:270-272）："2026-8-1"、"9:00" 应 400；(3) "2026-13-40" 能通过 regex 但 Date 解析为 NaN，落入 :275-277 返回误导性的 INVALID_TIME_RANGE「结束时间需要晚于开始时间」——这是个未被测试暴露的报错文案 bug；(4) start==end、end<start 未测；(5) equipmentId 不存在的 404（:262）未测；(6) 不可预约状态只测了 maintenance，disabled/retired（:263）未测；(7) actor 覆盖 requesterName 的逻辑（:302-303，server 传登录用户时忽略 body 里的名字）未测。

**建议**：加一个表驱动测试：用数组列出 ~12 组非法输入与期望的 error.code，`for (const c of cases) assert.throws(...)`，30 行覆盖全部校验分支。顺手修复 NaN 日期落入 INVALID_TIME_RANGE 的文案问题（先判 NaN 返回「日期无效」再比较先后）。

### 🔴 高 · 预约状态流转（审批/取消）在服务层根本不存在，冲突触发器的状态过滤分支不可测

**位置**：`apps/api/lib/service.mjs:291`

schema 定义了 6 种预约状态（database.mjs:125），冲突触发器只统计 pending/approved/in_use（database.mjs:136-141），但 service.mjs 所有插入硬编码 'pending'（:291），没有任何 approve/reject/cancel API。后果：(1)「cancelled/rejected 的预约应释放时段」这条触发器分支通过服务层无法触达，永远测不到；(2) 触发器只有 BEFORE INSERT（database.mjs:134），没有对应的 BEFORE UPDATE 触发器——将来一旦加上审批接口，把 rejected 改回 approved 就能绕过冲突检查制造重叠预约；(3) 前端指南里也承认「待审批列表仅用于界面演示」。这是功能缺口而非纯测试缺口，但它决定了状态流转测试无从写起。

**建议**：实现最小的 `updateReservationStatus(id, status, actor)`（合法流转表 + 权限判断），同时给 reservations 补一个对称的 BEFORE UPDATE 防重叠触发器；然后测试三件事：cancel 后同时段可再约、approve 后仍冲突、非法流转（completed→pending）被拒。这也是把 MVP 从「演示」推进到「可用」的最小一步。

### 🟡 中 · 'pnpm check' 的门禁含金量低：node --check 只做语法解析，且遗漏了 scripts/ 三个文件

**位置**：`package.json:17`

`node --check` 仅验证文件能否被解析：未定义变量、import 了不存在的导出、属性名拼错、调用不存在的方法全都放行——对本项目这种无类型、无 lint 的原生 JS，这类错误恰恰是最常见的。check 的实际价值几乎全部来自末尾的 `pnpm test`（而测试只覆盖 service 层）。另外 --check 名单里没有 scripts/dev.mjs、dev-web.mjs、check-env.mjs；`node --test apps/api/test/*.test.mjs`（package.json:16）依赖 shell 通配，glob 无匹配时报错方式怪异。

**建议**：与「零依赖」定位最匹配的升级是 JSDoc + TypeScript 只作 devDependency：加 jsconfig.json（checkJs: true, strict 视情况），check 脚本改为 `tsc --noEmit && node --test apps/api/test/`。tsc 能抓到 --check 抓不到的整类错误（拼错属性、错误参数个数、null 访问），运行时依赖仍为零。同时把 scripts/*.mjs 纳入检查，test 改用目录形式 `node --test apps/api/test/`。

### 🟡 中 · 无任何 commit、无 CI：全部代码处于 untracked 状态，质量门禁没有执行点

**位置**：`.git`

git status 显示仓库零 commit，所有文件 untracked——一次误操作（clean/checkout/rm）即可丢失全部工作，这是当前最大的工程风险。同时没有 .github/workflows，'pnpm check' 只在开发者记得手动跑时才执行，没有任何机制保证 push 的代码是通过测试的。

**建议**：先做 initial commit（.gitignore 已就绪，apps/api/data/*.sqlite 已正确忽略）。CI 用一个 ~15 行的 GitHub Actions 即可：actions/checkout + actions/setup-node@v4 (node 22) + corepack enable + pnpm check。对学习项目这就是全部所需，不必加矩阵、缓存、覆盖率上报。pre-commit 不需要 husky：写一个 3 行的 .githooks/pre-commit 执行 pnpm check，`git config core.hooksPath .githooks`，零依赖。

### 🟡 中 · 认证链路的失败分支未测：会话过期不可测（时间不可注入）、弱密码规则零覆盖

**位置**：`apps/api/lib/service.mjs:12,41-49`

test:90-113 只走了改密 happy path + 删除会话。未覆盖：validateNewPassword 的四条规则（长度 8-128、需含字母+数字、禁用 "123456"，:41-48）、PASSWORD_UNCHANGED（:171）、CURRENT_PASSWORD_INVALID（:169）、is_active=0 用户登录被拒（:133）、用户名大小写不敏感登录（:131）。更结构性的问题：sessionLifetimeMs 硬编码 12h（:12），getSessionUser 直接 `new Date()`（:153），「会话到期后被拒」这条安全关键路径在不改代码的前提下无法测试。

**建议**：给 createService 加一个可选参数 `createService(database, { now = () => new Date() } = {})`，两行改动即可让测试注入假时钟验证过期；弱密码规则用表驱动断言（5 个用例 10 行）。这两处是密码/会话这类安全逻辑最该有回归保护的地方。

**核实备注（partially）**：所有代码事实均核实：test:90-113 仅覆盖改密 happy path + deleteSession；validateNewPassword 四条规则在 service.mjs:41-49、PASSWORD_UNCHANGED :171、CURRENT_PASSWORD_INVALID :169、is_active 检查 :133、username lowercase :131（且 DB 列 COLLATE NOCASE）、sessionLifetimeMs 硬编码 12h :12、getSessionUser 直接 new Date() :153，全部属实且未测。但「会话到期在不改代码的前提下无法测试」说过头了：测试持有 database 句柄，可在 createSession 后直接 `UPDATE sessions SET expires_at = <过去时间>` 再断言 getSessionUser 抛 SESSION_EXPIRED，无需改任何产品代码。时钟注入是更干净的做法，但并非唯一途径。

### 🟡 中 · 冲突检测只测了 2 个几何场景，重叠边界矩阵不完整

**位置**：`apps/api/test/service.test.mjs:46-56`

现有测试覆盖「部分重叠 (10:30-12:00 vs 09:00-11:00)」和「首尾相接 11:00-12:00 允许」。触发器用的是标准区间相交 `NEW.start_at < end_at AND NEW.end_at > start_at`（database.mjs:141-142），但完全相同区间、新预约完全包含旧预约、旧预约完全包含新预约、以及「前端相接」（新预约 end == 旧预约 start）这四个边界都没被钉住。区间逻辑是这类系统最经典的出 bug 位置，一旦有人「优化」触发器条件（比如把 < 改成 <=），现有两条断言可能仍然通过。

**建议**：补一个表驱动的边界矩阵测试：以 09:00-11:00 为基准，列 [相同, 被包含, 包含, 左相接(应过), 右相接(应过), 左搭 1 分钟(应拒), 右搭 1 分钟(应拒)] 共 7 组，~20 行即可把区间语义完整锁定。

**核实备注（partially）**：主体事实核实无误：test:46-56 确实只有部分重叠（10:30-12:00 vs 09:00-11:00）+ 尾相接（11:00-12:00 允许）两个几何场景；触发器条件在 database.mjs:141-142（NEW.start_at < end_at AND NEW.end_at > start_at）；相同区间、双向包含、前相接（新 end == 旧 start）均未测。但举例有误：「把 < 改成 <=」（即 NEW.start_at <= end_at）会被现有测试抓住——尾相接用例 11:00 <= 11:00 变为冲突，assert.doesNotThrow 失败。真正能溜过现有断言的是另一侧的变异（NEW.end_at > start_at 改为 >=），它会错误拒绝未被测试的前相接场景。补边界矩阵的建议依然成立。

### 🟡 中 · 前端 632 行零测试，纯逻辑与 DOM 纠缠导致不可单测；escapeHtml 等安全函数无回归保护

**位置**：`apps/web/app.js:41-50,121-127`

app.js 里存在多个纯函数/纯逻辑：escapeHtml（:48-50，是全站唯一的 XSS 防线，所有 innerHTML 渲染都依赖它）、localDate（:41）、startOfWeek 及日历排布（:121-166）、设备/预约的过滤统计逻辑。它们与 document.querySelector 混在同一文件，node --test 无法加载。escapeHtml 若被改错一个字符，所有用户输入（设备名、预约用途）直接变成注入点，目前没有任何测试会发现。

**建议**：与项目定位相称的做法：把纯函数抽到 apps/web/lib/helpers.mjs（app.js 用 <script type="module"> 引入），对 escapeHtml、startOfWeek、过滤逻辑写 ~40 行 node --test 单测，纳入现有 pnpm test glob。不建议现在上 Playwright/Vitest 组件测试；仓库里已有 .playwright-cli，可保留为发版前的手工冒烟工具。

### 🟢 低 · 测试基建总体健康（:memory: + 可并行），但 close 不在 teardown 中且种子断言脆弱

**位置**：`apps/api/test/service.test.mjs:7,26,74-75`

值得肯定：fixture 用 `createDatabase(":memory:", { seed: false })`（:7），不碰真实 sqlite 文件、各测试独立建库、可并行、无残留数据——这部分设计是对的（实测 7 个测试 1.7s 全绿）。小问题：(1) `database.close()` 写在每个测试体末尾（:26 等），断言一失败就跳过，虽然 :memory: 泄漏无害，但模式不好；(2) 种子测试硬编码 `laboratories==8`、`users==21`（:74-75），每次增删人员都要改两处魔法数字；(3) 两个走真实 scrypt 的种子测试各耗 ~700-900ms，占总时长 95%。

**建议**：(1) fixture 接收 t 参数并 `t.after(() => database.close())`；(2) 种子断言改为对照从 database.mjs 导出的 userSeeds/laboratorySeeds 的 length，消除双份魔法数字；(3) scrypt 耗时对 7 个测试可接受，暂不处理，等测试量上来再考虑给 hashPassword 加可调 cost。

### 🟢 低 · dev.mjs 进程管理三处不健壮：100ms 强杀、子进程 code 0 退出被忽略、相对路径依赖 cwd

**位置**：`scripts/dev.mjs:4-5,13,18`

(1) stop() 发 SIGTERM 后仅 100ms 就 process.exit（:13），而 server.mjs 的优雅关闭要走 server.close→database.close（server.mjs:153-158），WAL 模式下可能被截断，子进程也可能被遗孤；(2) 退出监听条件是 `code !== 0`（:18），若某子进程以 code 0 意外退出（比如端口逻辑变更后提前 return），另一半会静默地继续跑，开发者面对的是「网页开着但 API 没了」；(3) spawn 用相对路径 "apps/api/server.mjs"（:4-5），只有从仓库根目录执行才有效，`node scripts/dev.mjs` 换个 cwd 就找不到文件。

**建议**：(1) stop() 改为等待两个 child 的 exit 事件（Promise.all），2s 超时后再 SIGKILL 兜底；(2) 条件放宽为「任一子进程退出即联动停止」，无论 code；(3) 用 `new URL("../apps/api/server.mjs", import.meta.url)` 解析绝对路径。三处合计 ~15 行改动。

**核实备注（partially）**：三处代码事实均属实：spawn 相对路径 "apps/api/server.mjs" 在 dev.mjs:4-5、stop() 的 setTimeout(process.exit, 100) 在 :13、`code !== 0` 条件在 :18。(2) 与 (3) 的后果描述成立。但 (1) 的风险机制不准确：child.kill("SIGTERM") 后父进程 100ms 退出并不会杀死子进程——server.mjs 已收到 SIGTERM，其优雅关闭（:153-158 server.close→database.close）会作为孤儿进程继续完成，没有任何东西 SIGKILL 它，所以「WAL 可能被截断」基本不成立（WAL 本身也是崩溃安全的）。「子进程被遗孤」字面成立但短暂且无害。真正的问题只是父进程不等子进程退出就返回。

### 🟢 低 · 端口被占用时报错不友好：server.mjs 与 dev-web.mjs 都没有 listen 错误处理

**位置**：`apps/api/server.mjs:148`

server.mjs:148 和 scripts/dev-web.mjs:37 的 listen 都没有注册 'error' 处理器。4000/3000 端口被占时，用户看到的是一整屏 `Error: listen EADDRINUSE` 未捕获异常堆栈，随后 dev.mjs 打出泛化的 "Development service stopped unexpectedly (1)"（dev.mjs:19），既没说是哪个端口、也没提示可用 API_PORT/WEB_PORT 环境变量换端口——对学习项目的使用者这是最高频的启动失败场景。

**建议**：两个文件各加 `server.on("error", (e) => { if (e.code === "EADDRINUSE") { console.error(`端口 ${port} 已被占用，可设置 API_PORT/WEB_PORT 更换端口`); process.exit(1); } throw e; })`，约 5 行/处。

### 🟢 低 · dev-web.mjs 静态文件路径防护的前缀检查缺目录分隔符

**位置**：`scripts/dev-web.mjs:32`

守卫写的是 `!file.startsWith(root)`，而 root（.../apps/web）末尾无分隔符。构造含 `..` 的 URL 使 normalize(join(root, requested)) 落到兄弟目录（如 .../apps/web-secret/x），`".../apps/web-secret".startsWith(".../apps/web")` 为 true，检查被绕过。当前仓库恰好没有 web 前缀的兄弟目录且这是仅本机开发的服务器，所以实际风险低，但这是教科书式的 prefix-check 陷阱，值得在学习项目里修对。

**建议**：改为 `if (file !== root && !file.startsWith(root + sep))`（从 node:path 引入 sep），或用 `relative(root, file)` 判断不以 ".." 开头。一行修复。

### 🟢 低 · listEquipment / listReservations / getEquipment 的查询分支未测

**位置**：`apps/api/lib/service.mjs:191-212,244-257`

未覆盖：listEquipment 的 status 过滤及非法 status 400（:199-202）、query 与 status 组合；getEquipment 404（:208-211）；listReservations 按 equipmentId 过滤（:251-253）及 date+equipmentId 组合。这些是前端每个页面都在调的读路径，SQL 拼接（clauses/values 配对）恰是容易改坏的地方。

**建议**：在现有 fixture 上追加一个 ~15 行的测试：建 2 台设备 + 2 条预约，断言各过滤组合的返回数量与 404 分支。成本极低，收益是锁住所有列表查询的 SQL 拼接。

## 部署与运维

### 🔴 高 · git 仓库零 commit：全部 35 个文件处于 untracked 状态，无任何版本保护

**位置**：`.git (git log: fatal: your current branch 'main' does not have any commits yet)`

git status --porcelain --untracked-files=all 显示 35 个文件全部为 '??'（apps/api/server.mjs、lib/*.mjs、apps/web/*、docs/*、deploy/* 等），git log 报 'does not have any commits yet'。这意味着：任何一次误操作（rm -rf、git clean -fd、IDE 误删、磁盘故障）都会不可逆地丢失全部代码；无法 diff、无法回滚、无法 bisect；VPS 上的 releases/<timestamp> 目录成了事实上唯一的'版本历史'，而它只包含静态前端。好消息是 .gitignore 覆盖已验证到位：git check-ignore 确认 .omx/（.gitignore:15）、.playwright-cli/（:16）、apps/api/data/*.sqlite{,-shm,-wal}（:12-14）、node_modules/（:1）、deploy/vps/.release-id（:17）均被正确忽略，git status 中没有任何应忽略文件泄漏。

**建议**：立即执行首次 commit（git add -A && git commit）。提交前注意：apps/api/lib/database.mjs:6 硬编码初始密码 '123456'、:19-41 含 21 位真实人员姓名拼音账号，这些进入 git 历史后即永久留存，若仓库未来推送到任何远程（含私有托管），需先评估是否将种子数据外置为不入库的 seed 文件。之后建立最小提交纪律：每个可运行的改动点一个 commit。

### 🔴 高 · SQLite 备份策略完全缺失，且当前数据几乎全部滞留在 WAL 文件中，裸拷贝 .sqlite 会丢数据

**位置**：`apps/api/data/ (development.sqlite 4KB vs development.sqlite-wal 259KB)；apps/api/lib/database.mjs:53`

database.mjs:53 开启 PRAGMA journal_mode = WAL。实测 data 目录：development.sqlite 仅 4096 字节，development.sqlite-wal 高达 259592 字节——即几乎全部业务数据（设备、预约、用户改密）都在未 checkpoint 的 WAL 里。docs/USER_GUIDE.md:205 唯一的'备份指导'是'对该文件进行复制备份前，应先停止写入'，如果操作者只复制 .sqlite 单个文件，恢复出来的是近乎空库。deploy/vps/ 下没有任何备份脚本、cron 或文档；docs/DEPLOYMENT_PREP.md:60 '完成备份恢复演练' 与 docs/ACCEPTANCE_CHECKLIST.md:31 均为未勾选状态。SQLite 文件就是全部业务数据，单点、无副本。

**建议**：写一个最小备份脚本（scripts/backup-db.mjs 或 shell）：用 sqlite3 的 '.backup' 命令或 'VACUUM INTO'（node:sqlite 可执行 VACUUM INTO 'path'）生成一致性快照，而非 cp；按日期滚动保留 N 份并复制到异机/对象存储。上线前在文档中写明恢复步骤并演练一次，把 DEPLOYMENT_PREP.md:60 的勾选项落实。

### 🔴 高 · .env.example 与代码严重脱节：代码只读 5 个变量，且没有任何机制加载 .env 文件

**位置**：`.env.example:1-37 对照 apps/api/server.mjs:8-14、scripts/dev-web.mjs:7-8、docs/DEPLOYMENT_PREP.md:34-38`

grep 全仓库确认代码实际读取的环境变量只有 5 个：DATA_FILE、API_PORT、NODE_ENV、CORS_ORIGINS（server.mjs:8,9,13,14）和 WEB_PORT（dev-web.mjs:7）。.env.example 声明的 DATABASE_URL(:14)、AUTH_SECRET/AUTH_ISSUER/AUTH_CLIENT_ID/AUTH_CLIENT_SECRET(:17-20)、S3_*(:23-27)、SMTP_*(:30-32)、APP_URL/API_URL(:3-4)、DEPLOY_*(:35-36) 没有任何代码引用。更关键的是：项目零依赖（无 dotenv），package.json scripts 和 scripts/dev.mjs 均未使用 node --env-file，因此 DEPLOYMENT_PREP.md:36-38 指示的 'cp .env.example .env' 完全是无效操作——.env 里改 API_PORT=5000 不会生效，用户会被误导。另外 .env.example:23 S3_ENDPOINT=http://localhost:9001 指向的是 MinIO 控制台端口，S3 API 端口应为 9000。

**建议**：两选一：(a) 在 package.json 的 dev/dev:api 脚本加 node --env-file=.env --env-file-if-exists（Node 22 原生支持），让 .env 真正生效；(b) 精简 .env.example 为当前真实读取的 5 个变量，把 Postgres/S3/SMTP 等未来变量移到注释或单独的 .env.future.example，并修正 S3_ENDPOINT 端口为 9000。同时在 DEPLOYMENT_PREP.md 更新说明。

### 🟡 中 · 根 compose.yaml 全套服务（postgres/minio/mailpit）与当前应用完全无关，且与 deploy/vps/compose.yaml 同名 project 有冲突风险

**位置**：`compose.yaml:1 与 deploy/vps/compose.yaml:1（均为 name: cipc-labequip）`

当前应用是零依赖 SQLite（node:sqlite），根 compose.yaml 提供的 postgres:17/minio/mailpit 三个服务没有任何代码连接它们（DATABASE_URL、S3_*、SMTP_* 无人读取）——这是为'未来 PG 架构'预置的基础设施，但 README/DEPLOYMENT_PREP 未明确说明'现在跑 pnpm dev 根本不需要 docker'。同时两份 compose 文件的 project name 都是 cipc-labequip（compose.yaml:1、deploy/vps/compose.yaml:1）：若未来在同一台 VPS 上同时使用（例如把根 compose 拿去起 postgres），两个项目会共享 cipc-labequip_default 网络与项目命名空间，在其中一个目录执行 docker compose down 会尝试移除共享网络、docker compose ps 视图互相混淆。另外 DEPLOYMENT_PREP.md:43-50 的启动顺序引用了不存在的 pnpm db:migrate / db:seed 脚本（package.json:11-21 中没有），且 :50 声称'当前仓库尚未创建应用代码'，与现状（apps/api、apps/web 已完成）矛盾，文档已过期。

**建议**：在 README 和 DEPLOYMENT_PREP.md 顶部明确：'MVP 阶段无需 Docker，直接 pnpm dev；根 compose.yaml 仅为 P1+ 迁移 PostgreSQL 预留'。将 deploy/vps/compose.yaml 的 project name 改为 cipc-labequip-web（或给根 compose 改名）以隔离命名空间。删除或标注 DEPLOYMENT_PREP.md:43-50 中不存在的 db:migrate/db:seed 步骤。

### 🟡 中 · 根 compose.yaml 硬编码弱默认密码，且未参数化，与 .env.example 双份维护

**位置**：`compose.yaml:9 (POSTGRES_PASSWORD: cipc_dev)、compose.yaml:27 (MINIO_ROOT_PASSWORD: minio_dev_secret)`

两个密码直接写死在 compose.yaml 中，未使用 ${POSTGRES_PASSWORD:-cipc_dev} 形式或 env_file，导致 .env.example:14 (DATABASE_URL=postgresql://cipc:cipc_dev@...) 和 :26-27 (S3_ACCESS_KEY=minio / S3_SECRET_KEY=minio_dev_secret) 与 compose 各存一份，改其一必漂移。本地开发可接受，但这份文件没有任何'仅限本地、严禁上生产'的注释，而 DEPLOYMENT_PREP.md:57 的'配置后端强随机密钥和生产数据库凭据'仍未勾选——历史经验是这类 dev compose 常被原样 scp 到服务器。

**建议**：改为 environment: POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-cipc_dev} 并让 compose 读取同一份 .env（compose 原生支持 .env 文件插值），消除双份维护；在文件头加注释声明仅供本地开发。生产部署时另建 compose.prod.yaml 且密码来自 secret/环境注入。

### 🟡 中 · 根 compose.yaml 加固缺口：端口绑定 0.0.0.0、镜像用 :latest、mailpit 无 healthcheck

**位置**：`compose.yaml:11-12,28-30,42-44（端口）；compose.yaml:23,41（latest 镜像）；compose.yaml:40-45（mailpit）`

三个问题：(1) 所有端口映射（5432、9000、9001、1025、8025）均未加 127.0.0.1 前缀，若这份文件被搬到有公网 IP 的机器上运行，Postgres（弱密码 cipc_dev）和 MinIO（minio/minio_dev_secret）会直接暴露公网——对照 deploy/vps/compose.yaml:9 已正确使用 '127.0.0.1:8020:80'，说明作者知道这个惯例但根文件没有跟进。(2) minio/minio:latest（:23）和 axllent/mailpit:latest（:41）未固定版本，重新 pull 后行为不可复现（MinIO 2025 年后社区版还移除了大部分 Console 功能，:latest 可能导致 9001 控制台不可用），而 postgres 已正确固定 17-alpine。(3) postgres、minio 都有 healthcheck（:15-19、:33-37），mailpit 没有，服务健康状态口径不一致。

**建议**：端口全部改为 "127.0.0.1:5432:5432" 形式；镜像固定 minor 版本（如 minio/minio:RELEASE.2025-xx、axllent/mailpit:v1.x）；给 mailpit 补 healthcheck（wget -qO- http://127.0.0.1:8025/livez 或 mailpit 自带的 healthcheck 端点）。

### 🟡 中 · API 进程无任何守护/部署定义：无 systemd unit、无 API 容器、nginx 无 /api 反代

**位置**：`deploy/vps/nginx.conf:20-22（只有 try_files，无 /api location）；deploy/vps/compose.yaml:4-18（仅 web 静态容器）；apps/api/server.mjs:148（listen 127.0.0.1）`

deploy/vps/ 只覆盖静态前端：compose.yaml 仅定义 nginx 静态容器，nginx.conf 没有 location /api 反向代理，Caddy（cipc-labequip.caddy:12）把所有流量转给静态 nginx。API 服务器（server.mjs:148 正确地只监听 127.0.0.1）一旦要上 VPS，仓库中没有任何进程守护方案——无 systemd unit 文件、无 API 的 Dockerfile/compose 服务、无 pm2 配置；进程崩溃后无人拉起，SQLite 的 DATA_FILE 放在哪个持久化路径也没有约定。deploy/vps/README.md:3-4 确实说明了 nginx（内部静态容器）与 Caddy（公网入口）的分工，这点不混乱，但后端上线路径完全空白，而 DEPLOYMENT_PREP.md:80 已明确'后端数据库、登录权限和正式业务数据仍未上线'。

**建议**：在 deploy/vps/ 预先落一份 cipc-labequip-api.service（systemd：ExecStart=node server.mjs、Restart=always、Environment=NODE_ENV=production/DATA_FILE=/var/lib/cipc-labequip/data.sqlite、User=专用低权限用户），或在 compose.yaml 增加 api 服务（node:22-alpine + volume 挂载数据目录）；同时给 nginx.conf 补 location /api { proxy_pass http://host 或容器名:4000; proxy_set_header Host/X-Forwarded-For/X-Forwarded-Proto; proxy_read_timeout 合理值; } 并在 README 写明数据目录与备份路径。

### 🟡 中 · Caddy 配置不可复现：依赖仓库外的 security_headers snippet，Cloudflare IP 白名单硬编码会漂移，日志记录的是 CF 边缘 IP

**位置**：`deploy/vps/cipc-labequip.caddy:6 (import security_headers)、:9 (硬编码 CF IP 段)、:14-21 (log)`

三个问题：(1) :6 'import security_headers' 引用的 snippet 定义在 VPS 上的 /etc/caddy/Caddyfile 中，不在仓库里——仅凭仓库无法完整复现公网入口配置，安全响应头内容不可审查、不可回滚。(2) :9 的 @not_cloudflare 白名单硬编码了 22 个 Cloudflare IP 段，Cloudflare 会不定期调整官方 IP 列表（https://www.cloudflare.com/ips/），列表过期后要么误拒合法 CF 边缘节点（用户随机 404），要么漏掉新段（源站防护失效），且无更新机制。(3) 未配置 trusted_proxies（Cloudflare 场景需要 servers { trusted_proxies static <CF段> } 或 cloudflare 插件），:14-21 的 JSON 日志 remote_ip 记录的将是 Cloudflare 边缘 IP 而非真实访客 IP，排障与审计价值大打折扣。gzip/编码方面 :7 'encode zstd gzip' 是正确的。

**建议**：把 security_headers snippet 的内容（或至少副本）纳入 deploy/vps/ 目录并注明 VPS 上的同步方式；用脚本定期从 cloudflare.com/ips-v4 / ips-v6 生成 IP 白名单文件再 import，或改用 caddy-cloudflare-ip 插件；配置 trusted_proxies 恢复真实客户端 IP（CF-Connecting-IP）。README 补一句 nginx.conf/caddy 文件如何被同步到 /opt/cipc-labequip 与 /etc/caddy/sites/（目前无部署脚本，靠手工 scp，容易漂移）。

### 🟡 中 · 种子数据含 21 个真实姓名账号 + 统一初始密码 123456，将随首次 commit 永久进入 git 历史

**位置**：`apps/api/lib/database.mjs:6 (initialPassword = "123456")、:19-41 (userSeeds 真实姓名)`

database.mjs:6 硬编码 initialPassword = "123456"，:19-41 的 userSeeds 包含 21 位真实人员的姓名与用户名。虽然有 must_change_password=1 强制首登改密（:80, :176），但从部署运维角度：(1) 一旦执行首次 commit 并推送，'真实人员名单+已知初始密码' 即成为任何能读仓库者的字典——在改密完成前的窗口期可直接登录；(2) 生产环境若 DATA_FILE 指向新路径（见上一条），会自动重新播种全部 123456 账号，等于每次误配都重新打开这扇门；(3) 人员名单属于内部信息，进入 git 历史后无法撤回。

**建议**：将 userSeeds 移到不入库的 JSON（如 apps/api/data/seed-users.json，配合上面 data/ 整目录忽略），或改为仅在显式 SEED_USERS=1 时播种；初始密码改为部署时随机生成并单独分发（如打印到启动日志或写入一次性文件），至少不要与真实名单同库同文件硬编码。

**核实备注（partially）**：核心问题成立但计数有误：database.mjs:6 `initialPassword = "123456"` 属实；:19-41 userSeeds 共 21 个账号，但第 1 个是 `{ username: "developer", displayName: "开发者账号", role: "developer" }`(:20)，并非真实姓名——真实人员姓名为 20 人（:21-41，全为 custodian），标题'21 个真实姓名账号'应为'20 个真实姓名 + 1 个开发者账号'。其余全部核实：must_change_password 默认 1(:80) 且插入时写死 1(:176)；createDatabase 默认 seed=true，INSERT OR IGNORE(:173) 意味着任何指向新路径的 DATA_FILE 都会完整重播 123456 账号，'误配即重开后门'的机制描述准确。

### 🟢 低 · .gitignore 缺口：apps/api/data/ 目录只忽略三种 sqlite 后缀，备份/导出文件会被误提交

**位置**：`.gitignore:12-14`

git check-ignore 验证 apps/api/data/ 目录本身不被忽略，只有 *.sqlite、*.sqlite-shm、*.sqlite-wal 三个模式（.gitignore:12-14）被覆盖。任何落进该目录的其他文件——如手工备份 development.sqlite.bak、sqlite3 .dump 出的 .sql、导出的 .csv、或 DATA_FILE 指向的其他扩展名（.db）——都会被 git add -A 收进首次 commit，把真实预约/用户数据带进版本历史。当前 git status 干净只是因为目录里恰好只有三个 sqlite 文件。

**建议**：改为忽略整个目录并保留占位：在 .gitignore 用 'apps/api/data/*' + '!apps/api/data/.gitkeep'（需在 data/ 下补一个 .gitkeep）。顺带可加 *.sqlite / *.db 全局模式防止数据库文件出现在其他路径。

### 🟢 低 · DATA_FILE 相对路径按进程 cwd 解析，从非仓库根启动会静默建库到错误位置

**位置**：`apps/api/server.mjs:8；.env.example:10`

server.mjs:8 用 resolve(process.env.DATA_FILE) 解析，而 .env.example:10 给的示例值是相对路径 apps/api/data/development.sqlite。resolve 基于进程 cwd：如果从 /opt/cipc-labequip 之外的目录（如 systemd 默认 WorkingDirectory=/ 或 cron）启动，database.mjs:48 的 mkdirSync(recursive) 会在错误位置静默创建一个全新空库并重新播种 21 个初始密码为 123456 的账号（database.mjs:6, :153-188），表面服务正常，实际数据'消失'——这是 SQLite 运维最经典的事故模式。

**建议**：.env.example 的 DATA_FILE 示例改为绝对路径并加注释说明相对路径基于启动目录；生产 systemd unit 里显式设置 WorkingDirectory 与绝对 DATA_FILE；可在 server.mjs 启动日志已打印 dataFile（:150）的基础上，增加'检测到新建空库'的醒目警告。
