# NFT Marketplace 部署与问题修复总结

> 原始代码：`github.com/MetaNodeAcademy/ProjectBreakdown-NFTMarket` + `github.com/MetaNodeAcademy/nft-market-fe`
> 部署服务器：`43.160.212.151`（腾讯云新加坡，腾讯云 COS 桶 `nft-1324913195`（ap-singapore））

---

## 一、合约部署（EasySwapContract）

### 1.1 Hardhat 配置修复

**问题**：`hardhat.config.js` 强制要求 `SEPOLIA_ALCHEMY_AK`，且 mainnet 私钥为空导致编译报错 `private key too short`。

**修复**：
- 新增 `SEPOLIA_RPC_URL` 支持（兼容 Infura/Alchemy 等多 RPC）
- mainnet 配置改为条件加载（无私钥时跳过）
- 从 `.zshrc` 环境变量读取已有私钥和 Infura endpoint，写入 `.env`

### 1.2 合约部署（Sepolia）

| 合约 | 地址 |
|------|------|
| EasySwapVault (Proxy) | `0x3AD0D396b5CEEA8E941186f7Ede88Aa2f51099bc` |
| EasySwapOrderBook (Proxy) | `0xB6097Da347e172f08B09A8c9416d483592A92B5c` |
| TestERC721 | `0xCEDBcF5cc3Ca0Fc2d936307453FF92198a2bafcA` |

---

## 二、后端部署（EasySwapBackend）

### 2.1 新增 Docker 未装的本地环境适配

**问题**：原 README 要求 Docker 运行 MySQL/Redis。服务器已有 MySQL 8.4 和 Redis，但 Redis 有 `requirepass` 密码认证。

**修复**：
- 创建独立 Redis 实例（端口 6382，无密码，与 pledge 隔离模式一致）
- MySQL 新建数据库 `easyswap` + 用户 `easyuser@127.0.0.1`
- 运行 SQL 迁移脚本（`01_create.sql` + `02_alter_collection_add_banner.sql`）

### 2.2 COS 文件上传失败（Network Error）——核心 Bug

**问题**：`src/service/v1/cos.go` 的 `generateTemporaryCredentials` 用"主密钥冒充临时凭证"，且没有实现腾讯云 STS（Security Token Service）。前端拿到的 `sessionToken` 为空/伪造，腾讯云直接拒绝上传请求。

另外 `config.toml` 里 `[cos]` 所有字段为空，`generateTemporaryCredentials` 检测到后抛出错误，但旧版二进制用了随机生成的占位凭证（`generateTempSecretID()` 等死代码），返回无效 uploadUrl `https://.cos..myqcloud.com`，浏览器直接 Network Error。

**修复**：
- 重写为**服务端代理上传**模式：主密钥留在后端签名，前端 POST 文件给后端 `/api/v1/upload/file`，后端用 `cos-go-sdk-v5` 直传 COS 并返回公开 URL
- 保留旧 `/api/v1/upload/cos-token` 接口不变
- 配置填入真实 COS 凭证（桶 `nft-1324913195`、region `ap-singapore`）

### 2.3 MetaNodeNFT 铸造失败——三重问题

**问题 1：example 私钥不可用**
`config.toml.example` 里的 `owner_private_key` 对应地址 `0x5A7157...`，链上已变成合约（非 EOA），无法用该私钥签名调用 `safeMint`。

**问题 2：没有自己的 MetaNodeNFT 合约**
原项目代码写死了合约地址 `0xBD8d85D9...`，owner 不是我们的部署钱包。

**问题 3：gas_limit 不够**
ERC721URIStorage 的 `_setTokenURI` 把整条 COS URL（116 字符）写进 storage，长 URI 实际需要 ~72 万 gas，配置里 `gas_limit=300000` 直接 out-of-gas。

**修复**：
- 新写 `MetaNodeNFT.sol`（ERC721URIStorage + Ownable + `safeMint`）并部署到 Sepolia：`0x8DE7E4217A1254B1bB1afC8F33Ba5d325BcA4664`
- 后端配置改用 deployer 私钥 + 新合约地址
- `gas_limit` 提升到 `1000000`，`gas_price` 从 20 gwei 降到 2 gwei（Sepolia 网络极低）

### 2.4 铸币数据库写入失败

**问题**：`insertMintedItemToDB` 没填 `creator` 和 `supply` 两个 `NOT NULL` 无默认值的字段，INSERT 报 `Field 'creator' doesn't have a default value`。

**修复**：
- 补填 `creator`（= owner）和 `supply`（= 1）
- 新增 `insertMintedItemImageToDB`：铸币成功后同时写 `ob_item_external_sepolia` 表，存 `image_uri`/`oss_uri`，portfolio 页图片才能显示

### 2.5 铸币请求加 `image` 字段

**问题**：前端 mint 页上传图片拿到 URL，但没有传给后端铸币接口，导致后端无法写入图片信息。

**修复**：
- `MetaNodeMintRequest` 新增 `Image string` 字段
- 前端 mint 页 `axios.post` 时传 `image: imageUrl`

---

## 三、前端部署（nft-market-fe）

### 3.1 构建失败：wagmi/rainbowkit 版本兼容

**问题**：`pnpm install` 后 wagmi 2.19 / rainbowkit 2.2 的锁文件升级拉入了 `@coinbase/cdp-sdk`，它依赖 20+ 个 `@x402/*` 可选子包，全部缺失导致 22 个 webpack `Module not found` 错误。

**修复**：`next.config.ts` 加 webpack alias，所有 `@x402/*` 设为 `false`（本项目只用 mainnet/sepolia 的 http transport，不需要 Coinbase smart account）。

### 3.2 构建失败：App Router 下 `i18n` 配置

**问题**：`next.config.ts` 里的 `i18n: { locales, defaultLocale }` 在 Next.js App Router 下不支持，会导致构建失败。

**修复**：移除 `i18n` 配置（项目里实际没有 i18n 使用）。

### 3.3 basePath 适配：Logo 404

**问题**：`next.config.ts` 设了 `basePath: "/nft"`，但 `nav-bar.tsx` 和 `airdrop/rcc-logo.tsx` 里 `<img src="/logo.png">` 写的是绝对路径 `/logo.png`（实际路径是 `/nft/logo.png`），导致 logo 显示残缺。

**修复**：两处改为 `src="/nft/logo.png"`。

### 3.4 `weiToEth` 精度 bug

**问题**：`app/activity/page.tsx` 的 `weiToEth` 函数用 `Number(value) / 1e16`（应该是 `/ 1e18`），导致 0.001 ETH 显示为 0.00 ETH，且单位拼写为 `"ETH"` 缺空格。

**修复**：改为 `/ 1e18`，大额显示 2 位、小额显示 6 位小数，单位 `" ETH"`。

---

## 四、EasySwapSync 部署

### 4.1 缺失同步服务

**问题**：activity 页面和订单记录表 `ob_activity_sepolia` / `ob_order_sepolia` 为空。订单簿合约的 `LogMake`/`LogMatch`/`LogCancel` 事件需要 EasySwapSync 从链上扫区块同步到数据库。

**修复**：
- 编写 `config_import.toml`（RPC、DB、合约地址对齐）
- 交叉编译 Linux 二进制部署
- 预置 `ob_indexed_status`（`index_type=6`，从 OrderBook 部署区块 `12102871` 开始扫）
- 注册 `easyswap-sync.service`

---

## 五、前端功能补全

### 5.1 Portfolio 页弃用 Alchemy API

**问题**：Portfolio 页用硬编码的 Alchemy API Key 调 `getNFTsForOwner`。该 key 未开通 Sepolia 网络，返回空。

**修复**：改为走后端 `/api/v1/portfolio/items`，字段适配（`owner`、`name`、`image_uri` 等）。

### 5.2 新增出价功能

**问题**：前端只有挂单，没有出价/购买入口。合约 `makeOrders` 支持 `Side.Bid` 但前端无调用。

**修复**：
- `orderBookContract.ts` 新增 `makeBid()` 函数（`side: Bid`，附带等额 ETH）
- token 详情页 `item-detail-view.tsx` 加出价面板：输入金额 → 调 `makeBid`
- 修复 `makeBid` 的 `value` 参数 bug：原始 `priceEth` 十进制字符串改为 BigNumber

### 5.3 新增成交功能

**问题**：出价后卖家无法接受。合约 `matchOrder` 已就绪，前端无入口。

**修复**：
- `orderBookContract.ts` 新增 `matchBid()` 函数
- token 详情页出价信息卡片底部加"接受出价"按钮（仅挂单者可见）
- 成交/出价成功后 3 秒自动刷新页面

### 5.4 新增取消/编辑挂单

**问题**：Portfolio 挂单记录的"编辑"和"取消"按钮是桩代码（`alert('功能开发中...')`）。

**修复**：
- `orderBookContract.ts` 新增 `cancelOrder()` 和 `editOrder()` 函数
- Portfolio 页加编辑弹窗（输入新价格 → 调合约 `editOrders`）
- 取消/编辑后自动刷新列表

### 5.5 Activity 页字段映射修复

**问题**：activity 页前端字段名和后端返回不一致：

| 后端返回 | 前端原代码 |
|---------|-----------|
| `image_uri` | `image_url` |
| `event_type` | `type` |
| `maker` / `taker` | `from` / `to` |
| `item_bid` | 无映射 |

**修复**：全部对齐，`item_bid` / `offer` → "出价"中文化，加 `addressShort` 地址缩写。

### 5.6 Portfolio 出价记录 tab 激活

**问题**：出价记录 tab 显示"此功能正在开发中..."。

**修复**：加 `loadMyBids()` 调 `/api/v1/portfolio/bids`，渲染双向出价卡片。

### 5.7 Portfolio 挂单列表字段对齐

**问题**：改为从 `portfolio/items` 加载后，字段名变成 `name`（非 `item_name`）、`list_price`（非 `price`）、`image_uri`（非 `collection_image_uri`）。

**修复**：模板字段全部对齐新 API 返回结构。

### 5.8 合约地址全局替换

所有前端硬编码的旧合约地址 `0xBD8d85D9...` 替换为新部署的 `0x8DE7E421...`（MetaNodeNFT）和 `0xB6097Da...`（OrderBook）、`0x3AD0D396...`（Vault）。

---

## 六、服务器服务全景

| 服务 | 端口 | systemd unit | 说明 |
|------|------|-------------|------|
| Nginx | 80 | `nginx` | 反代所有服务 |
| MySQL | 3306 | `mysql` | 数据库 |
| Redis (shared) | 6379 | `redis-server` | 共享 Redis（密码保护） |
| dbadmin | 8080 | `dbadmin` | 数据库管理 Web |
| pledge | 8081 | `pledge` | 原有质押服务 |
| redisadmin | 8082 | `redisadmin` | Redis 管理 Web |
| **easyswap-backend** 🆕 | 8083 | `easyswap-backend` | Go API 服务 |
| **easyswap-redis** 🆕 | 6382 | `easyswap-redis` | 隔离 Redis |
| **easyswap-sync** 🆕 | — | `easyswap-sync` | 链上事件同步器 |
| **nft-market-fe** 🆕 | 3000 | `nft-market-fe` | Next.js 前端 |

### Nginx 路由

| 路径 | 目标 | 说明 |
|------|------|------|
| `/db/` `/api/` | `:8080` | dbadmin |
| `/pledge/` | `:8081` | pledge 后端 |
| `/redis/` | `:8082` | redisadmin |
| `/easyswap/` | `:8083` | EasySwap 后端 |
| `/nft` | `:3000` | NFT Marketplace 前端 |
| `/api/v1/` | `:8083` | 前端 API（`^~` 优先级覆盖 `/api/`） |

---

## 七、关键决策记录

1. **MetaNodeNFT 合约**：原合约 owner 是别人控制的 Gnosis Safe（私钥已失效），自部署新合约。
2. **COS 上传**：STS 临时凭证在源码里未实现，改为服务端代理上传（主密钥留后端签名）。
3. **合约 owner 私钥**：使用 deployer 钱包（`0xEeBD...ef6c`）的私钥 `490bd44f...`，该钱包持币 ~2 ETH 用于付 gas。
4. **gas_limit**：从 300000 提到 1000000，因为 ERC721URIStorage 长 URI 存储需要 ~72 万 gas。
5. **前端 basePath**：设为 `/nft` 避免与其他项目路径冲突，所有静态资源需带前缀。
6. **EasySwapSync 起点**：从 OrderBook 合约部署区块 `12102871` 开始扫描，避免从 0 扫描浪费。