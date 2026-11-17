# EasySwap NFT Market 产品需求与项目总结（PRD）

> 版本：v1.0（代码研究稿）  
> 编写日期：2026-11-05  
> 研究对象：`/Users/jiandong/github_space/ProjectBreakdown-NFTMarket/`  
> 参考模板：`/Users/jiandong/github_space/Pledge_study/Pledge_PRD.md`

## 编写约定

- 本文先描述产品行为、业务边界和验收条件，再映射到合约、后端、同步服务和前端实现。
- “已实现”表示可以从仓库代码、接口、测试或部署脚本中确认；“待补齐”表示代码中没有形成完整闭环，不能当作线上承诺。
- 订单、资产转移和成交结果以链上合约为准；数据库用于查询、搜索、排序、缓存和运营展示。
- 当前项目主要围绕 Ethereum/Sepolia 和 ETH 计价展开，同时保留多链字段和扩展接口。具体生产网络、货币、确认数和费用参数需单独配置。
- 本文是基于静态代码和项目文档的学习总结，不替代安全审计、经济模型评审或正式发布规格。

## 章节进度

| 章节 | 主题 | 状态 |
|---|---|---|
| 1 | 业务名词解释 | 已完成，待评审 |
| 2 | 产品定位与业务边界 | 已完成，待评审 |
| 3 | 用户角色与使用场景 | 已完成，待评审 |
| 4 | 资产、订单与数据模型 | 已完成，待评审 |
| 5 | 产品全流程与状态机 | 已完成，待评审 |
| 6 | 合集、NFT 与元数据管理 | 已完成，待评审 |
| 7 | 挂单、出价与订单簿规则 | 已完成，待评审 |
| 8 | 撮合、购买与资产结算 | 已完成，待评审 |
| 9 | 订单取消、编辑与过期 | 已完成，待评审 |
| 10 | 风险、权限与异常处理 | 已完成，待评审 |
| 11 | 用户端页面与交互 | 已完成，待评审 |
| 12 | 管理后台与运营流程 | 已完成，待评审 |
| 13 | 链上链下职责、数据与接口 | 已完成，待评审 |
| 14 | 铸造、导入与文件存储 | 已完成，待评审 |
| 15 | 非功能需求与运行保障 | 已完成，待评审 |
| 16 | 验收场景与交付里程碑 | 已完成，待评审 |
| 17 | 实现差异与产品决策清单 | 已完成，待评审 |

## 1. 业务名词解释

### 1.1 参与角色与资产

| 名词 | 含义 | 项目映射 |
|---|---|---|
| NFT / Item | 唯一或半同质化的链上数字资产 | `collection_address + token_id`；合约同时保留 `amount` 以兼容 ERC-1155 |
| Collection | NFT 合集或发行合约 | `ob_collection_*`，由合约地址唯一识别 |
| Maker | 创建订单的一方 | List 中是卖家，Bid 中是买家 |
| Taker | 接受或匹配订单的一方 | 由撮合交易的另一方承担 |
| List | 卖出 NFT 的订单 | NFT 先转入 `EasySwapVault`，等待成交 |
| Bid / Offer | 买入 NFT 的出价订单 | ETH 先进入 `EasySwapVault`，等待卖家接受 |
| Item Bid | 针对单个 token 的出价 | `SaleKind.FixedPriceForItem` |
| Collection Bid | 针对合集内任一 NFT 的出价 | `SaleKind.FixedPriceForCollection` |
| OrderBook | 按价格和时间排序的订单簿 | 每个 collection、side 使用红黑树和同价 FIFO 链表 |
| Vault | 订单资产托管合约 | `EasySwapVault`，隔离保存 NFT 和 ETH |
| Protocol Fee | 平台协议费 | `ProtocolManager` 管理费率、受益地址和提取 |
| Activity | 链上活动记录 | Mint、Transfer、List、Buy、Sell、Cancel、Offer 等 |
| 订单键 | 订单唯一标识 | EIP-712 订单结构哈希 `OrderKey` |
| 原生 ETH | 当前主要结算货币 | 前端展示和合约 Bid `msg.value` 均使用 ETH；ERC20 支付尚未形成完整产品闭环 |

### 1.2 价格、数量与时间

- `price` 是单个 NFT 的单位价格，合约使用 `uint128` 包装的价格类型；Bid 所需 ETH 为 `price × nft.amount`。
- ERC-721 通常 `amount = 1`；数据模型保留数量字段，兼容 ERC-1155 的批量数量。
- `expiry = 0` 表示不过期；非零订单必须晚于当前区块时间创建。
- 订单状态至少包括有效、部分成交、完全成交、已取消、已过期；链上订单存储以 `filledAmount` 和订单是否存在共同判断。
- 价格优先：Bid 最高价优先，List 最低价优先；同一价格按进入队列时间优先。
- 订单创建、取消、编辑、撮合和资产转移都是独立链上交易；页面按钮不能代表交易已经确认。

### 1.3 常见混淆

- List 不是“展示一条记录”：创建时 NFT 会被托管到 Vault，卖家失去直接转移该 NFT 的可用余额。
- Bid 不是口头报价：创建时 ETH 必须随交易存入 Vault；取消或成交后再退回或转给卖家。
- 订单过期不会自动从链上删除；查询和撮合时需要过滤，清理和数据库状态由同步服务完成。
- Collection Bid 不是指定某一个 token 的出价；卖家接受时需要用符合条件的 NFT 成交。
- 数据库中的 floor price、成交价和订单状态是同步结果，区块链最终状态发生分叉或回滚时必须修正。

## 2. 产品定位与业务边界

### 2.1 产品定位

EasySwap 是一个以订单簿为核心的 NFT 去中心化交易市场。用户连接钱包后，可以浏览合集和 NFT、创建卖单或买单、取消和编辑订单、直接购买 NFT、接受出价，并查看个人资产和交易活动。

系统由四层组成：

1. **链上结算层**：`EasySwapOrderBook` 验证订单、托管资产、维护订单簿并执行撮合；`EasySwapVault` 负责资产隔离；`OrderStorage`、`OrderValidator`、`ProtocolManager` 提供模块化能力。
2. **同步与索引层**：`EasySwapSync` 订阅链上 LogMake、LogMatch、LogCancel、Approval 等事件，写入 MySQL，并通过 Redis 做缓存、过滤和任务协调。
3. **API 与运营层**：`EasySwapBackend` 提供用户登录、合集、NFT、订单、活动、Portfolio、铸造、元数据和管理接口。
4. **用户端**：Next.js 前端提供市场、合集详情、NFT 详情、活动、Portfolio、Mint 和钱包交互页面。

### 2.2 核心价值

- 对卖家：提供公开的价格发现、挂单、接受出价和资产托管。
- 对买家：可以按单品或合集出价，也可以直接吃掉最低卖单。
- 对平台：订单、成交和资产转移透明可验证，链下服务提升检索和用户体验。
- 对开发者：订单结构使用 EIP-712，合约可升级，订单簿模块与数据同步模块可复用到其他链上资产市场。

### 2.3 范围与非目标

**首期范围**：

- ERC-721 交易闭环；订单结构兼容数量字段和 ERC-1155 扩展。
- ETH 计价的 List、Item Bid、Collection Bid。
- 限价订单、批量创建/取消/编辑、订单撮合和 multicall。
- 合集、NFT、持有人、属性、成交历史、地板价和 Portfolio 查询。
- 链上事件同步、元数据导入、COS 图片上传、管理员合约管理。

**暂不作为已完成能力**：

- AMM、流动性池、NFT 碎片化或借贷。
- 完整的 ERC20 支付、跨链桥、法币支付和自动做市。
- 无管理员参与的完全自动化市场治理。
- 生产级反洗钱、版权仲裁、税务和法务流程。

### 2.4 完成标准

- 用户可以从连接钱包开始，完成“授权 NFT → 创建 List → 买家支付 ETH → 撮合 → NFT 与 ETH 转移”的闭环。
- 用户可以完成“创建 Bid → 卖家接受 → NFT 转移 → Bid 资金结算”和取消退款闭环。
- 链上事件在可接受延迟内进入数据库，合集、NFT、订单、活动和 Portfolio 查询结果与链上状态一致。
- 订单簿能够按价格优先、同价时间优先返回有效订单；过期和已成交订单不会继续被展示为可成交订单。
- 失败交易、暂停、节点异常、数据库重启和链重组均有可观察和恢复路径。

## 3. 用户角色与使用场景

### 3.1 卖家

卖家持有 NFT，希望以固定价格出售。典型流程是连接钱包、授权 Vault、选择 NFT 和价格、创建 List、等待买家成交或主动取消。卖家还可以查看自己的挂单、成交记录和 NFT 资产。

验收重点：

- 未授权、NFT 不属于当前账户、数量不足、价格为零或 salt 重复时，前端明确提示并阻止提交。
- 创建成功后 NFT 的链上持有人或托管状态与订单状态一致。
- 取消成功后 NFT 回到卖家钱包，订单不能再次撮合。

### 3.2 买家

买家可以直接购买最低价 List，或创建 Item Bid、Collection Bid。买家需要准备足额 ETH，接受出价时由卖家触发撮合交易。

验收重点：

- Bid 创建时足额 ETH 进入 Vault；金额不足时交易回滚。
- 购买前校验订单仍有效、未过期、未成交、NFT 仍可交付。
- 成交后买家获得 NFT，卖家获得成交价扣除协议费后的 ETH。

### 3.3 NFT 收藏者与浏览用户

未连接钱包的用户可以浏览市场、合集排名、NFT 详情、属性、成交历史和活动；连接钱包后可以进入 Portfolio、查看个人挂单和出价。

### 3.4 合集创建者与内容运营者

合集创建者负责 NFT 合约和元数据；运营者负责导入合约、刷新元数据、管理展示信息、维护图片和处理异常数据。项目当前提供管理员接口，但管理员角色细分和审批流程仍需定义。

### 3.5 用户故事优先级

| 优先级 | 用户故事 |
|---|---|
| P0 | 浏览合集与 NFT；创建/取消 List；创建/取消 Bid；直接买入；卖家接受 Bid |
| P0 | 查看个人 NFT、挂单、出价、活动和成交历史 |
| P1 | 合集 Bid、批量订单、编辑订单、批量 Mint、元数据刷新 |
| P1 | 合集排名、地板价变化、属性价格和多链聚合 |
| P2 | AMM、更多 ERC 标准、跨链、治理和高级订单策略 |

## 4. 资产、订单与数据模型

### 4.1 链上对象

- `Order`：`side`、`saleKind`、`maker`、`nft(collection, tokenId, amount)`、`price`、`expiry`、`salt`。
- `OrderKey`：对 EIP-712 结构编码后生成的唯一哈希。
- `DBOrder`：订单主体和同价格队列中的 `next` 指针。
- `filledAmount`：订单成交数量；特殊最大值表示取消。
- `priceTrees`：按 collection 和 side 组织的红黑树。
- `orderQueues`：每个价格档的 FIFO 队列。
- `Vault` 资产：List 对应托管 NFT，Bid 对应托管 ETH。

### 4.2 链下核心表

| 表 | 主要字段 | 用途 |
|---|---|---|
| `ob_collection_<chain>` | chain_id、address、symbol、name、creator、owner_amount、item_amount、floor_price、volume_total、image_uri | 合集展示、排名和统计 |
| `ob_item_<chain>` | collection_address、token_id、owner、creator、supply、list_price、sale_price、metadata | NFT 详情和搜索 |
| `ob_order_<chain>` | order_id、order_status、order_type、maker、taker、price、expiry、quantity_remaining、currency_address | 订单查询、Portfolio 和状态展示 |
| `ob_activity_<chain>` | activity_type、maker、taker、collection、token_id、price、block_number、tx_hash、event_time | 活动流和历史成交 |
| traits / external 表 | 属性、外部元数据、图片和导入状态 | 属性筛选、图片缓存和元数据补全 |

订单和活动以 `tx_hash + collection + token_id + activity_type` 等组合约束避免重复写入。

### 4.3 数据归属原则

- NFT 所有权、订单托管余额和成交结果以链上状态为准。
- 数据库可维护名称、图片、属性、排序和缓存，但不得覆盖链上资产归属。
- 用户地址、合集地址、交易哈希、订单哈希必须做大小写规范化和校验和处理。
- 多链查询必须携带 `chain_id` 或标准链名称，不能只用地址作为全局主键。

## 5. 产品全流程与状态机

### 5.1 正常卖单流程

```text
浏览 NFT → 连接钱包 → approve/setApprovalForAll
→ makeOrders(List) → NFT 进入 Vault
→ 有效订单展示 → 买家 match / market buy
→ LogMatch → NFT 给买家、ETH 给卖家、收取协议费
→ 同步服务更新订单、Item、Activity、floor price
```

### 5.2 正常出价流程

```text
选择单品或合集 → 填写价格和数量 → makeOrders(Bid, msg.value)
→ ETH 进入 Vault → 等待卖家接受
→ matchOrder / matchOrders → NFT 给买家、ETH 给卖家
→ 未成交部分可 cancelOrders 取回 ETH
```

### 5.3 状态转换

| 对象 | 状态 | 进入条件 | 结束条件 |
|---|---|---|---|
| List | Draft/待提交 | 用户填写订单 | 钱包签名并上链 |
| List | Open | 创建交易确认 | 成交、取消或过期 |
| Bid | Open | ETH 托管成功 | 成交、取消或过期 |
| Order | Partially Filled | 成交量小于订单数量 | 完全成交、取消或过期 |
| Order | Filled | `filledAmount == amount` | 终态 |
| Order | Cancelled | Maker 或授权流程取消 | 终态 |
| Order | Expired | 当前时间超过 expiry | 不可撮合，链上记录可保留 |
| Activity | Pending/Confirmed/Reorged | 同步服务接收日志 | 确认、回滚或重放 |

### 5.4 失败流程

- 钱包拒签：前端恢复可操作状态，不写入成功订单。
- 链上回滚：数据库不能把交易标记为成交；同步服务按交易回执和重组处理回滚。
- NFT 已转移或授权失效：撮合失败，订单保留为不可成交或由用户取消。
- 订单过期：查询层过滤，不能因为链下缓存延迟继续展示为可购买。
- 索引服务中断：API 返回最近确认数据，并显示同步延迟；恢复后从检查点继续同步。

## 6. 合集、NFT 与元数据管理

### 6.1 合集发现

市场首页提供合集排名、交易量、地板价、最高 Bid、拥有者数量、发行量、封面图和外部链接。支持按链、时间段和排名数量查询。

### 6.2 NFT 详情

NFT 详情至少展示图片、名称、tokenId、合集、当前拥有者、当前最低挂单、最高 Bid、最近成交价、成交历史、属性及属性价格。用户可以跳转区块浏览器查看链上合约和 token。

### 6.3 元数据来源和刷新

同步服务从 ERC-721/ERC-1155 合约读取 `tokenURI`，解析 HTTP/IPFS/JSON 数据并提取图片；后端提供单个和批量刷新接口。元数据读取失败时要保留错误状态和重试次数，不得覆盖已有有效数据。

### 6.4 合约导入

管理员可以新增、编辑、启用、禁用 NFT 合约，并发起整合集合或指定 token 的同步任务。导入过程需要识别 token 标准、读取 name/symbol/ownerOf/tokenURI，并记录任务状态和历史。

## 7. 挂单、出价与订单簿规则

### 7.1 创建 List

前置条件：订单 maker 必须是当前钱包；价格大于零；salt 不为零；expiry 为零或晚于当前时间；NFT 合约地址和 tokenId 有效；Vault 已获得 NFT 授权。

创建后：合约把 NFT 转入 Vault，将订单写入 collection + List 的价格红黑树和 FIFO 队列，并发出 `LogMake`。批量创建允许一次提交多笔订单，但单笔失败处理方式必须在产品上明确；当前实现提供跳过/内部错误事件，需要前端展示每笔结果。

### 7.2 创建 Item Bid

买家指定 collection、tokenId、数量、价格和 expiry，随交易附带 `price × amount` ETH。Bid 进入 Bid 价格树，最高价优先。

### 7.3 创建 Collection Bid

买家只指定 collection 和价格，允许卖家用集合内符合条件的 NFT 接受。撮合时必须防止把单品 Bid 错当成 Collection Bid，并明确 NFT 数量、稀有属性和卖家授权检查。

### 7.4 价格优先和时间优先

- List：最低价优先；相同价格按队列先后。
- Bid：最高价优先；相同价格按队列先后。
- 订单查询按价格档分页，分页游标由 `price + firstOrderKey` 组成。
- 过期订单不应出现在“可成交”列表，但历史订单可查询。

### 7.5 数量和部分成交

ERC-721 单笔数量通常为 1；兼容批量资产时，成交量不得超过剩余数量。每次成交更新 `filledAmount`，并在完全成交时从有效订单集合移除或标记终态。

## 8. 撮合、购买与资产结算

### 8.1 直接购买

前端从最低有效 List 生成购买请求，调用订单簿的匹配或 multicall 服务。买家支付成交价和可能的协议费，合约在非重入保护下完成 NFT、卖家收益和平台费的原子转移。

### 8.2 接受 Bid

卖家选择一个有效 Bid，确认 NFT 已授权给 Vault，调用匹配函数。合约验证双方订单的 collection、tokenId、数量和价格关系，随后把 NFT 交给 Bid maker，并把托管 ETH 分给卖家和协议费受益地址。

### 8.3 批量撮合

`matchOrders` 和 `multicall` 用于批量成交、批量取消或组合操作。批量调用需要返回每个子操作的成功/失败位置，不能只用整笔交易成功来推断所有订单成功。当前合约提供 `BatchMatchInnerError`、`MulticallInnerError` 和 `LogSkipOrder` 事件，前端和同步服务应解析这些事件。

### 8.4 结算公式

```text
成交总价 = 单价 × 成交数量
协议费 = 成交总价 × 协议费率
卖家净收入 = 成交总价 - 协议费
买家总支出 = 成交总价 + 买方承担的费用（若启用）
```

费用率、舍入方向、最小成交金额、平台费承担方和失败退款边界必须由部署参数与产品配置共同确定。当前代码可确认有 ProtocolManager 和 ETH 提取能力，完整费用展示和治理规则仍需发布前定稿。

### 8.5 成交后的数据更新

同步服务收到 `LogMatch` 后，更新订单剩余数量、NFT owner、list/sale price、合集 floor price、活动记录和 Portfolio。先写入可重放的原始事件，再更新派生表，以便重组和补偿。

## 9. 订单取消、编辑与过期

### 9.1 取消

订单 maker 可以取消自己的 List 或 Bid；取消时更新取消标记、从价格队列移除或使其不可成交，并触发 `LogCancel`。Bid 取消后，托管 ETH 应退回 maker；List 取消后，NFT 应退回 maker。

### 9.2 编辑

编辑采用“取消旧订单 + 创建新订单”的语义，旧订单键不能复用，新订单必须使用新 salt 或不同结构哈希。前端需展示两笔链上操作的中间状态，并避免用户在旧订单取消确认前重复提交。

### 9.3 过期

过期是由区块时间判断的逻辑状态，不依赖定时器。撮合函数必须拒绝过期订单；查询接口区分“全部历史订单”和“当前有效订单”。同步服务可以异步标记过期，但不能把数据库标记当成链上权限。

### 9.4 退款和异常

任何取消、未成交、撮合失败的资金处理都必须可追踪到订单键和交易哈希。合约没有“人工修改订单余额”的后门；管理员提取 ETH、修改 Vault 或暂停市场需要高权限审计和操作记录。

## 10. 风险、权限与异常处理

### 10.1 合约风险控制

- `ReentrancyGuardUpgradeable` 防止重入。
- `PausableUpgradeable` 支持 owner 暂停和恢复。
- `OwnableUpgradeable` 控制 Vault、协议费和紧急操作。
- EIP-712/EIP-1271 支持外部签名和合约钱包校验。
- Vault 隔离资产，订单簿不直接长期持有用户 NFT/ETH。
- 可升级合约必须锁定实现版本、升级权限、存储布局和多签策略。

### 10.2 关键异常

| 异常 | 用户结果 | 系统处理 |
|---|---|---|
| 授权不足 | 不能创建或撮合 | 重新授权并显示目标合约 |
| 余额不足 | 交易回滚 | 读取余额和估算 Gas 后提示 |
| NFT 已转移 | 撮合失败 | 标记不可成交，要求取消或刷新 |
| 订单已取消/成交 | 撮合失败 | 重新拉取订单簿 |
| 订单过期 | 不可成交 | 允许查看历史并清理展示 |
| Vault/合约暂停 | 写操作受限 | 展示暂停原因和恢复状态 |
| RPC 或索引延迟 | 数据暂时不一致 | 显示最后同步区块，支持重试 |
| 链重组 | 派生数据可能回退 | 按 tx hash、block number 回滚并重放 |

### 10.3 权限模型

- 用户：只能操作自己创建的订单和自己拥有的 NFT/资金。
- OrderBook owner：配置 Vault、费率、暂停和升级相关操作。
- Backend 登录用户：通过钱包签名 nonce 登录，API token 存在 Redis。
- Admin API：当前路由启用了认证，但细粒度管理员中间件仍标记为待实现。
- Sync worker：拥有链上读取、数据库写入和缓存操作权限，不应拥有用户资金签名权限。

## 11. 用户端页面与交互

### 11.1 钱包与网络

前端使用 Wagmi、RainbowKit、Ethers/Viem。连接钱包时显示地址、网络和余额；网络不支持时提示切换。登录采用后端 nonce/message + 钱包签名，不应把私钥或签名明文写入日志。

### 11.2 市场与合集列表

`/collections` 展示合集卡片、排名、地板价、交易量和趋势；支持加载、空状态、错误状态和分页。点击合集进入 `/collections/[name]`，展示合集信息、NFT 网格或表格、最低挂单和最高出价。

### 11.3 NFT 详情

`/collections/[name]/[tokenId]` 展示图片、属性、持有人、挂单、Bid、成交历史、合约信息和区块浏览器链接。已连接钱包时显示 Buy、List、Make Bid、Accept Bid、Cancel 等符合权限的操作。

### 11.4 Portfolio

`/portfolio` 聚合用户的合集、NFT、挂单和 Bid。Portfolio 支持选择多个 NFT 批量挂单；每笔交易展示签名、提交、确认、失败和刷新状态。

### 11.5 Activity、Mint 与 Airdrop

`/activity` 展示多链活动流；`/mint` 提供项目方或授权用户的铸造入口；`/airdrop` 属于前端页面能力，具体空投规则和链上合约需要独立定义，不能默认视为市场核心能力。

### 11.6 交互文案和状态

所有链上操作至少区分：准备中、等待钱包签名、已提交、等待确认、成功、失败、已过期、需要刷新。错误信息应包含可操作建议、交易哈希和区块浏览器链接。

## 12. 管理后台与运营流程

### 12.1 合约管理

管理员可以按 chain_id 查看、新增、编辑、启用、禁用和同步 NFT 合约。保存前校验地址格式、链支持情况和重复地址；禁用合约不得继续导入新数据，但历史数据仍可查询。

### 12.2 NFT 导入任务

支持整合集合同步、指定 token 同步、查询任务状态和同步历史。任务应记录发起人、目标链、合约地址、开始/结束时间、成功数、失败数、错误摘要和可重试动作。

### 12.3 元数据与图片

管理员可批量刷新元数据；COS 上传接口生成临时凭证或上传策略，限制文件类型、大小和用户目录前缀。回调必须校验签名、文件 key 和用户身份，避免越权覆盖其他用户文件。

### 12.4 运营监控

后台应展示最新同步区块、RPC 状态、Redis/MySQL 状态、事件积压、失败任务、数据库与链上订单数量差异、floor price 更新延迟和异常交易。

## 13. 链上链下职责、数据与接口

### 13.1 职责边界

| 领域 | 链上 | 链下 |
|---|---|---|
| 资产归属 | NFT、ETH 托管和转移 | 展示余额和历史快照 |
| 订单有效性 | 订单结构、签名、expiry、filled、cancel | 搜索、分页、排序和聚合 |
| 成交 | 原子撮合、费用、事件 | 解析事件、更新派生表 |
| 元数据 | tokenURI 和合约只读方法 | HTTP/IPFS 解析、图片缓存和属性索引 |
| 权限 | owner、pause、Vault、协议费 | 登录、Admin API、任务权限 |

### 13.2 用户 API

主要路由：

- `/api/v1/user/*`：登录消息、签名状态和登录。
- `/api/v1/collections/*`：合集、NFT、Bid、挂单、属性、历史成交和 Mint。
- `/api/v1/activities`：活动流和多链过滤。
- `/api/v1/portfolio/*`：用户合集、NFT、Listings、Bids 和导入。
- `/api/v1/bid-orders`：订单查询。
- `/api/v1/upload/*`：COS 临时凭证、上传策略和回调。
- `/api/v1/metanode/*`：MetaNode NFT 铸造和查询。

### 13.3 管理 API

`/api/v1/admin/contracts` 管理合约；`/admin/nft-import` 管理同步任务；`/admin/system` 提供统计和元数据刷新。当前注释表明 AdminMiddleware 仍待补齐，生产环境必须加入管理员角色和审计日志。

### 13.4 同步一致性

同步服务按链和合约订阅事件，使用 block number、transaction hash 和日志索引建立幂等键。需要保存同步检查点，处理 RPC 断连、重复日志、链重组和历史补扫。数据库派生状态更新失败时，应支持按原始事件重放。

### 13.5 部署结构

- Hardhat 合约项目：编译、测试、Sepolia 部署、验证和升级脚本。
- Go Backend：Gin API、DAO、服务层、Redis/MySQL、Swagger 文档。
- Go Sync：区块链客户端、订单簿索引、元数据导入和定时维护。
- Next.js Frontend：钱包、页面、API 客户端和合约调用。
- Docker Compose：本地 MySQL 与 Redis；配置文件需通过环境变量或密钥管理注入。

## 14. 铸造、导入与文件存储

### 14.1 Mint

后端提供合集 Mint、MetaNode 单个 Mint 和批量 Mint 接口。请求应校验接收地址、数量、名称、元数据和授权身份，并等待链上回执后返回 tokenId、交易哈希和状态。当前代码中部分 Mint 流程包含模拟或配置化逻辑，需在生产发布前确认实际签名账户和合约调用。

### 14.2 Portfolio 导入

用户可以手动导入链上 NFT 到 Portfolio 展示。导入只改变链下索引或展示数据，不得伪造链上 owner、成交记录和资产数量；后台应通过 RPC 再次校验所有权。

### 14.3 COS 文件上传

上传流程为：获取临时凭证/策略 → 前端直传 → 后端回调确认 → 生成可访问 URI → 写入元数据。限制扩展名、MIME、大小和用户目录；图片 URL 要避免 SSRF、恶意 SVG 和不受控重定向。

## 15. 非功能需求与运行保障

### 15.1 资金与权限正确性

- 所有资金和 NFT 转移必须由链上原子交易完成。
- 订单簿函数保持非重入、暂停和权限检查。
- 升级、Vault、费率和 ETH 提取必须由多签或等效审批控制。
- 合约发布前执行单元测试、覆盖率、静态分析、存储布局检查和第三方安全审计。

### 15.2 数值和时间

前端不得用 JS 浮点数直接处理 wei；统一使用 bigint/BigNumber 和明确格式化规则。价格、数量、协议费、剩余数量和时间戳在前后端保持整数语义。expiry 依赖区块时间，页面显示应注明可能存在区块时间偏差。

### 15.3 性能和可观测性

- 常用排名和图片接口使用 Redis 缓存，并设置失效和主动刷新策略。
- 列表接口使用分页和索引，避免一次返回全量订单或活动。
- API 记录 request id、用户地址、链、耗时和错误码；禁止记录私钥、完整签名和敏感上传凭证。
- 同步服务监控最新区块、落后区块数、RPC 错误、事件处理耗时、重试次数和数据库写入失败。

### 15.4 环境和发布

本地启动需要 Node/pnpm、Go、MySQL、Redis、RPC endpoint 和合约地址配置。合约部署、Backend、Sync、Frontend 应分开发布，配置与代码分离；生产发布需要数据库迁移、回滚方案、合约地址白名单和前端网络配置校验。

## 16. 验收场景与交付里程碑

### 16.1 核心验收集

| 编号 | 场景 | 关键结果 |
|---|---|---|
| A01 | 浏览合集和 NFT | 列表、详情、图片、属性和活动可查询 |
| A02 | 创建 List | 授权后 NFT 进入 Vault，订单进入有效订单簿 |
| A03 | 直接购买 | 买家支付 ETH，NFT 给买家，卖家收到净额 |
| A04 | 创建 Item Bid | 足额 ETH 托管，Bid 可查询 |
| A05 | 接受 Bid | NFT 转给 Bid maker，ETH 按费用规则结算 |
| A06 | Collection Bid | 合集 Bid 只能与符合条件的 NFT 撮合 |
| A07 | 取消订单 | 订单不可再成交，NFT/ETH 退回正确账户 |
| A08 | 部分成交 | 剩余数量和队列状态正确 |
| A09 | 过期订单 | 不可撮合，历史可查，前端不显示为可交易 |
| A10 | 链重组/重复日志 | 数据可回滚、幂等和重放 |
| A11 | 管理员同步 | 任务状态、失败原因和重试记录完整 |
| A12 | 暂停和恢复 | 写操作按规则停止，恢复后可继续 |

### 16.2 验证层次

1. Solidity 单元测试与集成测试：订单校验、授权、成交、费用、批量操作、暂停、升级。
2. Go 单元测试：DAO、API 参数、签名登录、同步事件解析、重试、过滤器和链重组。
3. 前端验证：钱包连接、交易状态、错误恢复、页面空态、移动端和多链切换。
4. 测试网验收：真实 RPC、合约部署、Vault 资产转移、事件延迟和数据库一致性。
5. 安全验证：Slither、覆盖率、依赖扫描、密钥检查、权限矩阵和升级演练。

### 16.3 交付里程碑

- **M1 合约基础**：订单结构、Vault、创建/取消/撮合、费用和暂停测试通过。
- **M2 索引与 API**：事件同步、数据库迁移、合集/NFT/订单/活动接口可用。
- **M3 前端交易闭环**：List、Bid、Buy、Accept Bid、Cancel 和 Portfolio 完成。
- **M4 运营能力**：合约导入、元数据刷新、COS、统计、任务重试和审计日志完成。
- **M5 发布准备**：安全审计、测试网回归、性能压测、监控告警和生产回滚方案完成。

## 17. 文档实现差异与产品决策清单

### 17.1 已知实现差异

1. README 宣称支持完整订单簿能力，但部分交易分支、批量错误处理和费用承担规则需要以测试和部署参数进一步确认。
2. 后端路由已经提供 Admin API，但管理员专用中间件在代码中仍标注为待实现。
3. 项目包含 Mint、Airdrop、MetaNode 和 Portfolio 导入能力；这些能力与核心交易闭环的授权、合约地址和真实性边界尚未完全统一。
4. 数据表按链分表，接口同时支持多链参数；链 ID、链名称和表名映射需要形成统一配置，避免跨链数据串写。
5. Sync 已实现订单事件、Approval、floor price 和元数据维护，但完整链重组恢复和所有派生表的原子更新仍需专项验收。
6. 前端同时使用 Ethers、Viem 和 Wagmi，需统一 Provider、Signer、chainId 和 BigInt 格式化，减少交易状态不一致。
7. 合约为可升级模式；升级管理员、代理地址、存储布局和多签流程未在仓库文档中完整说明。

### 17.2 待决策项

| 编号 | 决策项 | 需要确认的内容 |
|---|---|---|
| D01 | 生产网络 | Ethereum、L2 或其他链；确认数和 RPC 供应商 |
| D02 | 支付资产 | 是否只支持原生 ETH，是否增加 WETH/ERC20 |
| D03 | 费用模型 | 协议费率、承担方、最小费用、舍入和提取权限 |
| D04 | 订单签名 | 是否允许离链签名订单、EIP-1271 合约钱包和签名过期 |
| D05 | 批量失败语义 | 子调用失败时整笔回滚、跳过还是部分成功 |
| D06 | ERC-1155 | 首期是否正式支持，数量和批量转移如何展示 |
| D07 | Collection Bid | 接受条件、稀有属性限制、卖家选择和价格保护 |
| D08 | 过期清理 | 是否由任务自动清理，历史订单保留周期 |
| D09 | 管理权限 | Admin、运营、同步任务、升级和提币的角色拆分 |
| D10 | 元数据治理 | 来源可信度、恶意 URI、图片审核和刷新频率 |
| D11 | Mint/Airdrop | 授权地址、支付方式、供应量、空投规则和审计边界 |
| D12 | 链重组策略 | 最小确认数、回滚窗口、补扫范围和用户可见状态 |

### 17.3 发布前必须补充的文档

- 合约函数、事件、错误码和升级存储布局说明。
- 费用、退款、部分成交、Collection Bid 和 ERC-1155 的产品规则。
- API OpenAPI 文档与链上字段映射；当前 Swagger 文件应与实际路由同步。
- 同步服务的检查点、重组、幂等、补扫和告警手册。
- 管理员权限矩阵、提币审批、密钥轮换和应急暂停流程。
- 用户端交易状态、失败重试、订单过期和数据延迟的统一文案。

## 附录 A：主要代码依据

- `EasySwapContract/contracts/EasySwapOrderBook.sol`
- `EasySwapContract/contracts/OrderStorage.sol`
- `EasySwapContract/contracts/OrderValidator.sol`
- `EasySwapContract/contracts/ProtocolManager.sol`
- `EasySwapContract/contracts/EasySwapVault.sol`
- `EasySwapContract/contracts/libraries/LibOrder.sol`
- `EasySwapContract/test/TestEasySwap.js`
- `EasySwapBackend/src/api/router/v1.go`
- `EasySwapBackend/src/service/v1/*.go`
- `EasySwapSync/service/orderbookindexer/service.go`
- `EasySwapSync/db/migrations/01_create.sql`
- `nft-market-fe/app/**/page.tsx`、`api/*.ts`、`contracts/service/orderBookContract.ts`
- 各子项目 `README.md`、部署脚本和 Docker Compose 配置

## 附录 B：评审记录模板

| 项目 | 内容 |
|---|---|
| 评审章节 | 例如：7.2 创建 Item Bid |
| 评审人 | 产品 / 合约 / 后端 / 前端 / 安全 |
| 结论 | 通过 / 需修改 / 暂缓 |
| 代码依据 | 文件、函数、测试或交易哈希 |
| 差异 | 产品规则与当前实现的差异 |
| 决策 | 参数、权限、费用或交互决定 |
| 验收证据 | 测试结果、日志、截图或链上链接 |
| 后续负责人 | 姓名、截止日期和跟进事项 |
