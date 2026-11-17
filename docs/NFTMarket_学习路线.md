# NFTMarket 项目整体学习路线

## 1. 学习目标

目标不是先看完所有代码，而是能够完整解释一笔 NFT 交易：

本学习路线同时整合了 [NFT Market 项目面试指南](NFT%20Market%20项目面试指南.md)。每个阶段都要完成两件事：

1. 能看懂对应代码并跑通实际链路；
2. 能用面试语言解释设计原因、技术权衡和自己的贡献。

```text
用户钱包
  → 前端构造交易
  → OrderBook 合约验证订单
  → Vault 托管或转移资产
  → 合约完成 NFT 与 ETH 结算
  → 发出链上事件
  → EasySwapSync 同步事件
  → Backend 提供查询接口
  → 前端显示订单和成交结果
```

掌握这条链路后，再扩展到多链、ERC-1155、订单聚合和高级交易功能。

## 2. 项目地图

```text
NFTMarket
├── EasySwapContract   智能合约、订单簿、Vault、测试和部署
├── EasySwapBase       链、NFT、数据库、订单管理等基础库
├── EasySwapSync       区块链事件同步、元数据导入和统计维护
├── EasySwapBackend    Go API、Service、DAO、登录和管理接口
├── nft-market-fe      Next.js 前端、钱包和交易交互
├── NFTMartket.md      项目说明
├── NFTMarket_PRD.md   产品需求与项目总结
└── NFTMarket_Exchange_Design.html
                         交易市场与订单簿系统设计
```

## 3. 第一阶段：先理解业务流程

先阅读：

- [README.md](README.md)
- [NFTMartket.md](NFTMartket.md)
- [NFTMarket_PRD.md](NFTMarket_PRD.md)
- [NFTMarket_Exchange_Design.html](NFTMarket_Exchange_Design.html)

### 3.1 卖单流程

```text
卖家拥有 NFT
→ 授权 Vault
→ 创建 List
→ NFT 进入 Vault
→ 买家提交 ETH
→ 合约撮合
→ NFT 给买家
→ ETH 给卖家
→ 事件进入数据库
→ 前端显示成交
```

### 3.2 出价流程

```text
买家创建 Bid
→ ETH 锁入 Vault
→ 卖家接受 Bid
→ NFT 给买家
→ ETH 给卖家
```

### 3.3 首先回答这些问题

- List 和 Bid 有什么区别？
- Item Bid 和 Collection Bid 有什么区别？
- NFT 挂单后到底在哪里？
- Bid 创建后 ETH 在哪里？
- 订单取消时资产如何退回？
- 订单过期后是否自动发生链上交易？
- 平台协议费从哪里扣除？
- 数据库为什么不是资产所有权的最终依据？

## 4. 第二阶段：学习智能合约

目录：

```text
EasySwapContract/contracts/
```

建议阅读顺序：

### 4.1 `LibOrder.sol`

先理解订单结构：

```solidity
Order {
    side;
    saleKind;
    maker;
    nft;
    price;
    expiry;
    salt;
}
```

重点：

- `OrderKey` 如何生成；
- 为什么使用订单哈希；
- `salt` 如何避免订单重复；
- Item Bid 和 Collection Bid 如何区分；
- `collection + tokenId` 如何识别 NFT。

### 4.2 `EasySwapOrderBook.sol`

重点函数：

```solidity
makeOrders()
cancelOrders()
editOrders()
matchOrder()
matchOrders()
multicall()
```

创建订单要理解：

```text
订单校验
→ 资产进入 Vault
→ 订单写入订单簿
→ 发出 LogMake
```

撮合订单要理解：

```text
检查订单有效性
→ 检查资产匹配
→ 计算成交价
→ 计算协议费
→ 转移 NFT
→ 转移 ETH
→ 更新 filledAmount
→ 发出 LogMatch
```

### 4.3 `EasySwapVault.sol`

重点函数：

- `depositETH`
- `withdrawETH`
- `depositNFT`
- `withdrawNFT`
- `editETH`
- `editNFT`

需要能够回答：

> 订单创建后，NFT 由谁托管？
>
> Bid 的 ETH 按什么维度记录？
>
> 只有谁可以从 Vault 取出资产？

### 4.4 `OrderStorage.sol`

订单簿结构：

```text
Collection
├── List
│   ├── 价格红黑树
│   └── 同价格 FIFO 队列
└── Bid
    ├── 价格红黑树
    └── 同价格 FIFO 队列
```

排序规则：

- List：最低价优先；
- Bid：最高价优先；
- 同价格：先创建的订单优先。

### 4.5 `OrderValidator.sol` 和 `ProtocolManager.sol`

重点理解：

- EIP-712 签名；
- 订单过期；
- `filledAmount`；
- 取消标记；
- 协议费率；
- owner 权限；
- `pause/unpause`；
- 协议费提取。

## 5. 第三阶段：运行和测试合约

进入合约目录：

```bash
cd EasySwapContract
npm install
npx hardhat compile
npx hardhat test
```

建议边看测试边回答：

- 创建 List 时 NFT 是否进入 Vault？
- 创建 Bid 时是否必须附带足额 ETH？
- 取消 Bid 后 ETH 是否退回？
- 买家买入挂单时成交价以谁为准？
- 卖家接受 Bid 时是否需要支付 ETH？
- 协议费如何计算？
- 批量撮合失败时是全部回滚还是部分成功？

## 6. 第四阶段：学习 EasySwapSync

目录：

```text
EasySwapSync/
```

重点文件：

```text
service/orderbookindexer/service.go
db/migrations/01_create.sql
service/service.go
model/model.go
```

核心链路：

```text
新区块
→ 读取日志
→ 解析 LogMake / LogMatch / LogCancel / Approval
→ 写入原始事件
→ 更新订单表
→ 更新 NFT 表
→ 更新合集统计
→ 更新 floor price
→ Backend 查询
```

重点掌握三个概念。

### 6.1 幂等

同一个事件重复收到，不能重复写入。

建议唯一键：

```text
chain_id + tx_hash + log_index
```

### 6.2 链重组

链重组时：

```text
撤销受影响区块的派生数据
→ 从 checkpoint 重新扫描
→ 重建订单和成交状态
```

### 6.3 链上链下边界

数据库负责：

- 搜索；
- 分页；
- 排名；
- 统计；
- 展示。

链上合约负责最终确认：

- NFT 所有者；
- 订单是否真实成交；
- ETH 是否转移；
- 订单是否被取消；
- 资产是否仍在 Vault。

## 7. 第五阶段：学习 Backend

目录：

```text
EasySwapBackend/
```

建议阅读顺序：

```text
src/api/router/v1.go
→ src/api/v1/*.go
→ src/service/v1/*.go
→ src/dao/*.go
→ src/types/v1/*.go
```

主要路由：

- `/api/v1/user/*`：钱包签名登录；
- `/api/v1/collections/*`：合集、NFT、Bid、挂单和历史成交；
- `/api/v1/activities`：活动流；
- `/api/v1/portfolio/*`：用户资产、挂单和出价；
- `/api/v1/bid-orders`：Bid 查询；
- `/api/v1/upload/*`：COS 上传；
- `/api/v1/metanode/*`：MetaNode NFT；
- `/api/v1/admin/*`：合约、同步任务和系统管理。

重点理解：

```text
Router
→ Handler
→ Service
→ DAO
→ MySQL / Redis
```

## 8. 第六阶段：学习前端

前端目录：

```text
nft-market-fe/
```

建议阅读页面：

1. `app/collections/page.tsx`
2. `app/collections/[name]/page.tsx`
3. `app/collections/[name]/[tokenId]/`
4. `app/portfolio/page.tsx`
5. `app/activity/page.tsx`
6. `contracts/service/orderBookContract.ts`
7. `api/*.ts`
8. `hooks/*`

重点观察三类代码：

### 8.1 数据查询

```text
api/collections.ts
api/portfolio.ts
api/activity.ts
```

### 8.2 钱包和链连接

```text
config/wagmi.ts
hooks/useEthersSigner.ts
hooks/useGlobalState.ts
```

### 8.3 合约操作

```text
contracts/service/orderBookContract.ts
```

一次 Buy 操作通常经历：

```text
读取订单
→ 检查钱包和网络
→ 检查余额和授权
→ 估算 Gas
→ 构造 calldata
→ 钱包签名
→ 提交交易
→ 等待 receipt
→ 等待索引服务更新
→ 刷新页面
```

## 9. 四个建议练习

### 练习 1：画订单状态机

```text
OPEN
├── PARTIAL
├── FILLED
├── CANCELLED
└── EXPIRED
```

为每个状态写明：

- 谁可以触发；
- 是否发生资产转移；
- 是否需要链上交易；
- 数据库如何更新。

### 练习 2：计算一笔成交

假设：

```text
NFT 成交价：1 ETH
协议费：2%
```

结果：

```text
平台协议费：0.02 ETH
卖家收入：0.98 ETH
买家支出：1 ETH + Gas
```

然后在 `EasySwapOrderBook._matchOrder()` 中找到对应实现。

### 练习 3：跟踪一条事件

从：

```solidity
emit LogMatch(...)
```

追踪到：

```text
EasySwapSync.handleMatchEvent()
→ DAO 更新订单
→ 更新 NFT
→ 更新 Activity
→ 前端显示成交
```

### 练习 4：跑通本地链路

先运行合约测试：

```bash
cd EasySwapContract
npm install
npx hardhat compile
npx hardhat test
```

再准备 MySQL 和 Redis：

```bash
docker compose -f EasySwapSync/docker-compose.yml up -d
```

根据 README 配置：

- MySQL；
- Redis；
- RPC endpoint；
- 合约地址；
- Backend 配置；
- Sync 配置。

最后启动前端：

```bash
cd nft-market-fe
pnpm install
pnpm dev
```

## 10. 推荐十天计划

| 天数 | 学习内容 | 产出 |
|---|---|---|
| 第 1 天 | README、PRD、系统设计 | 画出项目架构图 |
| 第 2 天 | `LibOrder`、`OrderValidator` | 写出订单字段解释 |
| 第 3 天 | `EasySwapOrderBook` | 写出创建、取消、撮合流程 |
| 第 4 天 | `EasySwapVault`、`OrderStorage` | 画出资产和订单簿结构 |
| 第 5 天 | Hardhat 测试和部署脚本 | 跑通合约测试 |
| 第 6 天 | EasySwapSync | 跟踪 `LogMatch` 事件 |
| 第 7 天 | 数据库表和链重组 | 解释索引一致性 |
| 第 8 天 | Backend Router、Service、DAO | 画出 API 调用链 |
| 第 9 天 | Frontend 页面和钱包调用 | 跟踪一次 Buy 操作 |
| 第 10 天 | 完整交易链路 | 写出项目问题清单 |

## 11. 学习记录表

| 问题 | 代码位置 | 当前结论 |
|---|---|---|
| NFT 挂单后在哪里？ | `EasySwapVault.sol` | 进入 Vault 托管 |
| Bid 的 ETH 在哪里？ | `depositETH()` | 按 orderKey 托管 |
| 谁能取消订单？ | `cancelOrders()` | maker 或授权方 |
| 成交价格谁决定？ | `_matchOrder()` | List/Bid 组合决定 |
| 平台怎么赚钱？ | `protocolShare` | 成交时扣协议费 |
| 页面数据从哪来？ | `EasySwapSync` + Backend | 链上事件同步到数据库 |
| 数据库是不是最终真相？ | 链上合约 | 不是，合约才是最终依据 |

## 12. 最终掌握标准

当你能够完整解释下面这条链路，就基本掌握了项目主体：

```text
用户点击 Buy
→ 前端构造交易
→ 合约验证订单
→ Vault 取出 NFT/ETH
→ 合约完成结算
→ 发出事件
→ Sync 同步
→ Backend 查询
→ 页面显示成交
```

进一步学习时，再扩展到：

- 多链；
- ERC-1155；
- Trait Bid；
- 外部市场订单聚合；
- AMM；
- NFT 租赁；
- NFT 抵押和金融化。

## 13. 面试指南整合学习模块

这一章把面试指南中的知识点映射回学习路线。学习时不要把面试问答当成独立背诵材料，而要为每个问题找到对应的代码、数据结构和交易证据。

### 13.1 基础概念模块

对应面试指南：第 0 章、第 1 章和第 4 章。

必须掌握：

- ERC-721 的 `ownerOf`、`balanceOf`、`approve`、`setApprovalForAll`、`transferFrom` 和 `safeTransferFrom`；
- NFT 交易的是所有权，不是 `tokenURI`；
- Collection、Item、Wallet、Ownership、Order、Activity 的关系；
- ERC-721 和 ERC-1155 的数量、批量操作和部分成交差异；
- 链上订单簿、链下订单簿和 AMM 的优缺点。

代码验证：

```text
EasySwapContract/contracts/libraries/LibOrder.sol
EasySwapContract/contracts/EasySwapVault.sol
nft-market-fe/contracts/abis/
```

面试输出：能够用 2 分钟解释 NFT 的唯一性、授权方式，以及用户为什么要先授权 Vault/市场合约。

### 13.2 项目介绍与系统架构模块

对应面试指南：第 2 章。

建议使用下面的回答顺序：

```text
项目定位
→ 核心业务
→ 链上合约
→ 链下服务
→ 前端体验
→ 数据一致性和性能方案
```

项目介绍模板：

> 这是一个基于区块链的 NFT 订单簿交易市场。用户可以浏览合集和 NFT、创建 List 或 Bid、完成撮合，并在链上完成 NFT 与 ETH 的原子结算。OrderBook 负责订单校验、存储、撮合和费用，Vault 负责资产托管，EasySwapSync 监听链上事件并更新数据库，Backend 提供查询和管理 API，前端负责钱包连接和交易交互。

必须能够画出：

```text
Next.js 前端
    ↓
Go Backend API ← Redis / MySQL
    ↑
EasySwapSync ← 区块链事件
    ↑
OrderBook + Vault 合约
```

### 13.3 NFT 生命周期模块

对应面试指南：第 3 章。

学习输出必须覆盖：

```text
Mint
→ Import / Metadata
→ Approve
→ List
→ Bid / Buy
→ Match
→ Transfer
→ Cancel / Withdraw
```

每一步都记录四项内容：

| 步骤 | 链上变化 | 链下变化 | 代码位置 |
|---|---|---|---|
| Import | 读取 tokenURI、ownerOf | 写入 Item 和 Metadata | Sync / Backend |
| Approve | 更新授权关系 | 前端显示授权状态 | ERC-721 + 前端合约调用 |
| List | NFT 进入 Vault 或授权市场转移 | 写入订单和 Activity | `makeOrders()` |
| Buy/Accept Bid | NFT 和 ETH 原子交换 | 更新订单、Item、Collection | `matchOrder()` |
| Cancel | 订单失效，资产退款 | 更新订单状态 | `cancelOrders()` |

面试时必须说明：数据库里的订单状态不能替代链上状态，链上合约才是资产和成交的最终依据。

### 13.4 合约安全与升级模块

对应面试指南：第 5 章。

学习时建立下面的安全矩阵：

| 风险 | 代码/机制 | 验证方式 |
|---|---|---|
| 重入 | `ReentrancyGuard`、先更新状态再转账 | 恶意回调测试 |
| 重复成交 | `filledAmount`、订单哈希 | 并发撮合测试 |
| 签名重放 | EIP-712、chainId、nonce、salt | 跨链/跨合约测试 |
| 权限过大 | `Ownable`、Vault 调用限制、多签 | 权限矩阵测试 |
| 整数边界 | Solidity 0.8 检查、价格和数量校验 | 边界输入测试 |
| delegatecall 风险 | `onlyDelegateCall` | 直接调用内部入口测试 |
| 升级破坏存储 | storage gap、布局检查 | V1→V2 升级测试 |

面试回答不能只说“使用了 OpenZeppelin”，还要解释：

- 为什么需要 `Pausable`；
- 为什么 Vault 不能允许任意地址提款；
- 为什么成交前要更新订单状态；
- 为什么升级合约必须检查 storage layout；
- 为什么协议费和用户托管资产要分开管理。

### 13.5 链上链下同步模块

对应面试指南：第 6 章。

必须掌握以下回答：

1. 为什么使用 `eth_getLogs` 轮询，而不是只依赖 WebSocket？
2. 如何通过确认区块降低链重组影响？
3. 如何用 `txHash + logIndex` 保证事件幂等？
4. 如何检测 block hash 变化？
5. 如何避免区块只写了一半却被标记为已同步？
6. 如何在 Activity、Order、Item 多表更新时保证事务一致性？

推荐回答模板：

> Sync 服务按链和合约轮询 `eth_getLogs`，以事件唯一键保证幂等；只处理达到确认数的区块，并维护 checkpoint。每个区块的原始事件和派生表更新放在事务中，发生链重组时根据 block hash 检测并回滚受影响区块，再重新扫描。

代码验证：

```text
EasySwapSync/service/orderbookindexer/service.go
EasySwapSync/db/migrations/
EasySwapBase/stores/gdb/orderbookmodel/
```

### 13.6 Backend 与性能模块

对应面试指南：第 7 章。

需要把“技术选型”与实际问题对应起来：

| 问题 | 方案 | 学习位置 |
|---|---|---|
| API 资源多 | Gin + RESTful + `/api/v1` | `EasySwapBackend/src/api/router/v1.go` |
| 热点查询慢 | Redis + Cache API | Backend middleware / xkv |
| 活动表很大 | 联合索引、分页、冷热分离 | DAO / migrations |
| 元数据刷新耗时 | 异步任务和重试 | Sync / Backend admin |
| 多链数据隔离 | chain_id、分表或分区 | model / config |
| 高峰流量 | 无状态 API、负载均衡、水平扩展 | 部署设计 |
| 难以定位故障 | Prometheus、Grafana、request id | 运行保障 |

面试时避免泛泛而谈“用了 Redis 优化性能”，要说明：缓存了什么、TTL 多久、什么时候失效、订单成交后如何刷新。

### 13.7 撮合与资产安全模块

对应面试指南：第 8 章。

把两种交易完整讲出来：

#### 买家购买卖单

```text
卖家创建 List
→ NFT 进入 Vault
→ 买家读取最低有效价格
→ 买家构造匹配订单
→ matchOrder
→ Vault 给买家 NFT
→ 合约给卖家 ETH（扣除费用）
```

#### 卖家接受买单

```text
买家创建 Bid
→ ETH 进入 Vault
→ 卖家读取有效 Bid
→ 卖家构造匹配订单
→ matchOrder
→ Vault 给买家 NFT
→ Vault 给卖家 ETH
```

需要解释：

- 谁发起撮合谁支付 Gas；
- 为什么成交必须原子化；
- 订单为什么要按价格和时间排序；
- Collection Bid 如何匹配不同 tokenId；
- 取消订单时 Vault 如何退款；
- 批量撮合失败时是全部回滚还是部分成功。

### 13.8 行业理解模块

对应面试指南：第 9 章。

不要只把 NFT 解释成图片交易。可以从三个方向回答：

- **资产化**：数字商品、门票、身份、游戏道具、收益凭证；
- **应用化**：品牌会员、链游、活动、版权和现实业务；
- **协议化**：订单、托管、聚合、借贷、租赁和收益协议。

进一步扩展：

- NFT + RWA；
- NFT + AI；
- NFT + DeFi；
- NFT + GameFi；
- NFT + 社交身份。

### 13.9 面试回答方法

对应面试指南：第 10 章。

所有技术问题都可以按以下结构回答：

```text
先说结论
→ 解释业务背景
→ 说明架构和核心流程
→ 指出关键代码或数据结构
→ 说明遇到的难点
→ 说明方案和技术权衡
→ 说明如何测试和验证
```

“项目难点”回答模板：

> 项目的主要难点是链上链下数据一致性、订单撮合安全和大规模查询性能。链上部分由 OrderBook 和 Vault 保证订单与资产结算，链下由 Sync 服务监听事件并写入数据库。为了避免链重组和重复事件，使用确认区块、事件唯一键、checkpoint 和事务更新。查询侧使用 MySQL 索引、Redis 缓存和异步任务降低数据库压力。合约测试覆盖订单过期、重复成交、无授权、余额不足和重入场景。

### 13.10 面试前最终检查清单

- [ ] 能解释 ERC-721 的 owner、approve、transfer 和 tokenURI。
- [ ] 能解释 List、Bid、Collection Bid 的区别。
- [ ] 能画出 OrderBook、Vault、Sync、Backend 和前端的关系。
- [ ] 能说明 NFT 和 ETH 在成交前后分别在哪里。
- [ ] 能说明谁支付撮合 Gas。
- [ ] 能说明链上订单与链下订单的优缺点。
- [ ] 能解释 `LogMake`、`LogMatch`、`LogCancel` 的作用。
- [ ] 能解释确认区块、幂等、checkpoint 和链重组。
- [ ] 能说明 RESTful API、Redis、MySQL 和 GORM 的职责。
- [ ] 能解释重入、权限、签名重放和升级风险。
- [ ] 能结合真实代码说明自己的贡献。
- [ ] 能区分“已实现”“项目设计中”和“未来可扩展”。
