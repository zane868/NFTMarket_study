# NFT Market 项目面试指南

> 来源：`/Users/jiandong/Downloads/NFT Market 项目面试指南.pdf`  
> 处理方式：按章节整理为 Markdown，清理 PDF 文字提取中的乱码与断行。  
> 说明：文档中的“面试回答”是参考表达，需要结合自己实际负责的代码和项目经历调整。

## 前置准备

1. 对 NFT 和 NFT Market 有基本了解。
2. 最好先看完项目相关课程或录播，包括：
   - 项目架构分享；
   - 核心模块功能；
   - 源码讲解。
3. 面试回答不能只背项目原文，应补充自己的技术理解，并根据岗位方向调整重点。

## 第 0 章：NFT 基础

### 0.1 ERC-721 的核心接口

#### 查询

```solidity
// 查询 owner 拥有的 NFT 数量
function balanceOf(address owner) external view returns (uint256);

// 查询 tokenId 的当前拥有者
function ownerOf(uint256 tokenId) external view returns (address);

// 可选扩展：查询 NFT 合集名称和标识
function name() external view returns (string memory);
function symbol() external view returns (string memory);

// 可选扩展：查询指定 NFT 的元数据 URI
function tokenURI(uint256 tokenId) external view returns (string memory);
```

#### 授权

```solidity
// 授权某个地址操作指定 tokenId
function approve(address approved, uint256 tokenId) external;

// 授权或取消授权某个 operator 操作全部 NFT
function setApprovalForAll(address operator, bool approved) external;

// 查询指定 tokenId 的授权地址
function getApproved(uint256 tokenId) external view returns (address);

// 查询 owner 是否授权 operator 操作全部 NFT
function isApprovedForAll(
    address owner,
    address operator
) external view returns (bool);
```

#### 转移

```solidity
// 安全转移，并携带额外数据
function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId,
    bytes calldata data
) external;

// 安全转移
function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId
) external;

// 普通转移
function transferFrom(
    address from,
    address to,
    uint256 tokenId
) external;
```

### 0.2 NFT 的核心认知

1. NFT 的核心是**所有权**，主要通过 `ownerOf` 和 `balanceOf` 体现。
   - `ownerOf(tokenId)`：查询指定 tokenId 的当前拥有者。
   - `balanceOf(owner)`：查询指定地址拥有的 NFT 数量。
2. `name`、`symbol` 和 `tokenURI` 属于 ERC-721 Metadata 扩展接口，不是最小 ERC-721 接口的必需项。
3. NFT 交易的不是 `tokenURI`，而是 NFT 所有权。交易完成后，变化的是 `ownerOf(tokenId)` 返回的地址。
4. 实际项目通常会实现 `name`、`symbol` 和 `tokenURI`：
   - `name` 和 `symbol` 用于标识一个 NFT 合集；
   - `tokenURI(tokenId)` 提供该 token 的链下元数据链接，通常包含图片、属性等信息。
5. 不同 NFT 合约可能拥有相同的 `name`、`symbol`，甚至使用相同的 `tokenURI`。交易时必须确认官方合约地址（Contract Address，简称 CA），不能只根据名称判断项目真伪。

### 0.3 授权与转移

NFT 围绕所有权提供两类核心操作：

- 授权（Approval）；
- 转移（Transfer）。

#### `approve`

```solidity
approve(to, tokenId)
```

表示当前 NFT 所有者允许 `to` 转移指定的 `tokenId`。

#### `setApprovalForAll`

```solidity
setApprovalForAll(operator, true)
```

表示当前 NFT 所有者允许 `operator` 操作该 NFT 合约下的全部 NFT。交易市场、批量管理工具通常使用这种方式。

#### `transferFrom` 与 `safeTransferFrom`

- `transferFrom(from, to, tokenId)`：基础转移函数，通常由 owner 或被授权地址调用。
- `safeTransferFrom(from, to, tokenId)`：在转移时检查接收方合约是否实现 `onERC721Received`，可以减少 NFT 被转入不支持 ERC-721 的合约而永久锁死的风险。

### 0.4 NFT Market 中的交易流程

```text
用户持有 NFT
→ 用户调用 approve 或 setApprovalForAll 授权市场/Vault
→ 卖家创建 Listing
→ 买家发起购买或卖家接受 Bid
→ 市场合约完成订单校验
→ 合约调用 transferFrom 或 safeTransferFrom
→ NFT 所有权从卖家转移到买家
```

这个过程中，`tokenURI` 通常不会发生变化，真正变化的是 NFT 的所有者地址。

## 第 1 章：NFT 数据模型与交易模式

### 1.1 NFT 数据模型

| 对象 | 含义 |
|---|---|
| Collection | NFT 合集，一组 NFT 的发行合约或项目集合 |
| Item | 某个具体 NFT，是市场交易的基本单位 |
| Ownership | 钱包地址与 NFT 之间的持有关系 |
| Wallet | 用户的钱包地址，也是 NFT 的最终持有者和订单 Maker |
| Order | 用户出售或购买 NFT 的意愿，可以包含挂单、出价和购买信息 |
| Activity | NFT 相关事件记录，如转移、挂单、成交和取消 |

### 1.2 链下订单簿（Off-chain Order Book）

链下订单模式中，用户在链下服务创建订单并签名，订单和签名保存到服务器或数据库中。

撮合流程：

```text
Maker 创建订单
→ Maker 链下签名
→ 订单进入订单服务
→ Taker 查询订单
→ Taker 将订单和签名提交到链上
→ 合约验证签名并完成结算
```

优点：

- 创建挂单不需要上链，节省 Gas；
- 订单生成速度快；
- 便于撮合、排序和跨平台分发；
- 适合高频交易和聚合市场。

代价：

- 依赖链下订单服务；
- 需要处理订单过期、余额变化、授权失效和订单撤销；
- 链下服务不可用时，用户很难发现订单。

### 1.3 链上订单簿（On-chain Order Book）

链上订单模式中，用户直接把订单写入智能合约，订单数据保存在链上。资产通常在创建订单时进入 Vault，或者被授权给市场合约在成交时转移。

撮合流程：

```text
Maker 调用合约创建订单
→ 合约记录订单并处理资产托管
→ Taker 查询链上订单
→ Taker 调用撮合函数
→ 合约验证并完成资产交换
```

优点：

- 订单数据透明、可验证；
- 不依赖单一中心化订单服务；
- 任何人都可以读取订单并发起撮合；
- 适合纯链上 DEX 逻辑。

代价：

- 创建、取消和修改订单都可能消耗 Gas；
- 订单簿数据量大时，链上存储成本高；
- 资产托管和合约权限风险更集中。

### 1.4 订单簿与 AMM

#### 订单簿模型

- Maker：创建订单的一方，通常是卖家或挂单方。
- Taker：接受订单的一方，通常是买家。
- 定价：由订单直接指定价格。
- 撮合：买单和卖单一对一匹配。
- 优点：价格灵活，可以实现复杂交易策略。

#### AMM 模型

- Maker：AMM 池子，由流动性提供者组成。
- Taker：与池子交易的用户。
- 定价：由池子资产数量和 bonding curve 等算法决定。
- 撮合：用户与池子交易，不需要等待特定卖家。
- 优点：持续提供流动性，适合标准化资产。

NFT 市场通常以订单簿为主；AMM 更适合流动性较强、价格可以由曲线表达的 NFT 资产。

### 1.5 项目服务架构概览

一个完整的 NFT Market 通常包含：

1. **API 服务**：向 C 端提供 NFT 列表、详情、交易、挂单、购买和转移接口。
2. **交易同步服务**：监听 NFT Market 合约事件，例如 `MatchOrder`、`CancelOrder`，并同步到数据库。
3. **NFT 导入服务**：通过 RPC 或第三方 API 获取 NFT 元数据、所有权、图片和属性，写入本地数据库。
4. **订单中继服务**：从 LooksRare、X2Y2 等其他市场获取订单，实现跨平台订单聚合和流动性聚合。
5. **定时任务模块**：更新 Collection 排名、地板价、历史交易量和活跃用户统计。

## 第 2 章：项目通用理解与背景

### 2.1 如何介绍这个 NFT Market 项目

NFT Market 是一个基于区块链的 NFT 去中心化交易平台，核心目标是让用户完成 NFT 的挂单、购买、出价、成交和转移，同时把链上交易数据同步到链下数据库，改善搜索、展示和查询体验。

核心功能包括：

1. **链上订单簿 DEX**：挂单和订单状态写入链上，撮合逻辑由智能合约执行。
2. **资产托管 Vault**：托管挂单 NFT 和 Bid 中锁定的 ETH，成交或取消时按订单状态转移资产。
3. **链上事件同步**：监听 `LogMake`、`LogMatch`、`LogCancel` 等事件，并更新数据库。
4. **RESTful API**：提供合集、NFT、订单、活动、成交历史和 Portfolio 查询。
5. **前端交易页面**：用户通过钱包完成授权、挂单、出价、购买、接受 Bid 和取消订单。
6. **运营和数据服务**：维护排名、地板价、元数据、图片和跨市场订单数据。

### 2.2 如何解释“去中心化”

先说明链上合约的构成：

#### OrderBook 合约

负责完整的订单簿交易逻辑，通常包含：

- `OrderStorage`：订单存储和价格排序；
- `OrderValidator`：订单参数、签名、过期和成交量校验；
- `ProtocolManager`：协议费率和协议费提取；
- 版税或费用管理模块；
- 撮合和资产结算逻辑。

#### Vault 合约

负责资金和 NFT 资产托管。只有 OrderBook 合约可以调用 Vault 的存取资产接口，从而减少外部账户直接操作托管资产的风险。

因此，订单数据和资产管理由链上合约负责。即使链下 API 暂时不可用，用户仍可以通过区块链读取订单和调用撮合函数，形成公开透明的交易逻辑。

### 2.3 链上订单与链下订单的区别

| 维度 | 链下订单 | 链上订单 |
|---|---|---|
| 订单存储 | 服务端、数据库或订单中继 | 智能合约 |
| 创建成本 | 通常只需要签名 | 需要链上交易和 Gas |
| 撮合方式 | Taker 提交订单和签名到合约 | Taker 直接调用合约撮合 |
| 对链下服务依赖 | 高 | 较低 |
| 透明度 | 依赖服务方公开订单 | 全链可查 |
| 订单撤销 | 签名失效、nonce 或链上取消 | 链上取消 |
| 适用场景 | 聚合市场、高频交易 | 纯 DEX、强透明度场景 |

### 2.4 项目整体架构

项目可以分为链上和链下两大部分。

#### 链上部分

- OrderBook：订单创建、取消、编辑、撮合和费用处理；
- Vault：NFT 和 ETH 托管、提取和退款；
- NFT 合约：发行 NFT、维护 owner、授权和转移；
- 事件：为链下同步提供可靠的事实来源。

#### 链下部分

- 事件监听：监听 `LogMake`、`LogMatch`、`LogCancel` 等事件；
- API 服务：为前端提供 NFT、订单、成交和 Portfolio 查询；
- 定时任务：更新 Collection 排名、地板价和历史统计；
- 元数据导入：读取 `tokenURI`，解析图片、属性和外部链接；
- 订单中继：聚合其他市场的订单和流动性。

### 2.5 项目个人贡献的表达模板

可以根据实际情况从以下方向选择，不要虚构没有做过的工作：

- 链上数据同步：合约事件监听、区块确认、重试和链重组处理；
- API 服务：RESTful 接口、分页、过滤、排序和鉴权；
- 缓存设计：使用 Redis 缓存热点 NFT、排名、订单和图片数据；
- 合约实现：订单结构、交易函数、事件定义、Vault 资产转移；
- 性能优化：数据库索引、读写分离、异步任务和接口缓存；
- 前端交互：钱包连接、签名、交易状态和失败恢复。

### 2.6 技术栈及选择理由

| 技术 | 用途 | 选择理由 |
|---|---|---|
| Golang | API、同步和任务服务 | 性能好、并发模型清晰、适合 RPC 和数据处理 |
| Gin | HTTP API | 路由和中间件简单，适合 RESTful 服务 |
| GORM | 数据库访问 | 降低 CRUD 开发成本，支持事务和模型映射 |
| MySQL | 持久化链上派生数据 | 保存 NFT、订单、活动和统计数据 |
| Redis | 缓存和临时状态 | 缓存热点查询、登录 token、任务状态和同步临时数据 |
| Solidity | NFT 和交易合约 | 执行公开、可验证的资产和订单逻辑 |
| Ethers.js / Web3.js | 链交互 | 调用合约、解析事件和发送交易 |
| Hardhat | 合约开发测试 | 支持本地链、测试、部署和升级插件 |
| Next.js | 用户端 | 支持页面路由、服务端渲染和钱包交互 |

## 第 3 章：NFT 在市场中的完整生命周期

NFT 的基本生命周期为：

```text
Mint（铸造）
→ Approve（授权）
→ List（上架）
→ Buy / Bid（购买或出价）
→ Transfer（转移）
→ Cancel / Withdraw（取消或撤单）
```

### 3.1 NFT 导入与展示

1. NFT 导入服务指定要同步的 Collection。
2. 通过 RPC 或第三方服务获取链上数据。
   - Alchemy；
   - Infura；
   - Moralis；
   - NFTScan；
   - 其他节点或 NFT API。
3. 直接调用合约的 `tokenURI(tokenId)` 获取元数据 URI。
4. 解析 JSON，获取图片、属性、名称和外部链接。
5. 把 Collection、Item、Owner、Metadata 和图片信息写入数据库。
6. 前端请求 Backend API，展示 NFT 详情。

### 3.2 NFT 上架

```text
卖家选择 NFT 和价格
→ 前端检查 owner 和授权
→ 调用 approve / setApprovalForAll
→ 调用市场合约 makeOrders
→ NFT 进入 Vault 或保留在卖家钱包
→ Sync 服务监听挂单事件
→ Backend 更新订单表
→ 前端显示 Listing
```

挂单信息通常包括：

- Collection 地址；
- Token ID；
- 数量；
- 价格；
- 支付币种；
- 有效期；
- Maker；
- 订单哈希；
- 订单状态。

### 3.3 NFT 被购买

```text
买家浏览 NFT
→ 选择有效 Listing
→ 前端构造 MatchOrder 参数
→ 钱包签名并提交交易
→ 合约检查订单、价格和资产
→ NFT 转给买家
→ ETH 转给卖家并扣除协议费
→ 合约发出 Match 事件
→ Sync 更新数据库
→ 前端刷新状态
```

### 3.4 NFT 挂单被撤销

```text
卖家点击取消订单
→ 前端构造 CancelOrder 参数
→ 钱包签名并提交交易
→ 合约验证 maker 和订单状态
→ Vault 退回 NFT 或剩余资金
→ 合约发出 Cancel 事件
→ Sync 更新订单状态
→ 前端显示已取消
```

### 3.5 项目数据量级示例

原面试材料给出的示例量级：

- 单个 Collection：超过 10,000 个 Item；
- Collection 数量：上千个；
- NFT Item 数量：千万到上亿；
- 累计成交量：超过 10,000 ETH；
- 示例平台手续费：2%。

这些数字属于面试场景中的规模假设，实际项目应以监控和生产数据为准。

## 第 4 章：NFT 相关面试问题

### 4.1 什么是 NFT？它和 ERC-20 有什么不同？

NFT 是 Non-Fungible Token，即非同质化代币。每个 NFT 通常由合约地址和 tokenId 唯一标识，代表某个独立的数字资产或权益。

ERC-20 的特点：

- 同一种代币可以互换；
- 每个单位通常没有独立身份；
- 余额按数量记录；
- 适合货币、积分和同质化资产。

NFT 的特点：

- 每个 tokenId 具有独立身份；
- 不同 tokenId 可能拥有不同属性和价值；
- 转移的是特定资产的所有权；
- 适合艺术品、游戏道具、门票、域名和会员凭证。

### 4.2 ERC-721 和 ERC-1155 的区别

| 维度 | ERC-721 | ERC-1155 |
|---|---|---|
| 资产类型 | 非同质化资产 | 可同时表达同质化和非同质化资产 |
| 数量 | 一个 tokenId 通常对应 1 个单位 | 一个 tokenId 可以有多个单位 |
| 批量操作 | 原生批量能力较弱 | 支持批量转移和批量查询 |
| Gas 效率 | 单个 NFT 语义清晰 | 批量资产操作更高效 |
| 典型场景 | 艺术品、头像、域名 | 游戏道具、门票、批量物品 |

如果订单簿要正式支持 ERC-1155，需要重新定义：

- 订单数量；
- 部分成交；
- Vault 余额；
- 批量转移；
- 价格是单位价格还是整单价格。

### 4.3 NFT Market 如何实现授权与交易

NFT 授权通常通过两种方式实现：

```solidity
approve(marketOrVault, tokenId)
setApprovalForAll(marketOrVault, true)
```

在 EasySwap 这类“订单簿 + 撮合合约 + Vault”架构中，交易流程通常是：

#### Step 1：授权 Vault 或市场合约

卖家首次上架前，需要授权 Vault 或 OrderBook 代为转移 NFT。

#### Step 2：创建订单

- 卖家调用 `makeOrders()`，合约将 NFT 从卖家转移到 Vault；
- 买家创建 Bid 时，把 ETH 存入 Vault；
- 订单信息写入订单簿。

#### Step 3：撮合订单

调用：

```solidity
matchOrder(sellOrder, buyOrder)
```

合约需要校验：

- 两个订单的方向是否正确；
- Collection 是否匹配；
- Token ID 是否匹配，或 Bid 是否为 Collection Bid；
- 订单是否过期；
- 订单是否已经成交或取消；
- 价格是否满足；
- 数量和托管余额是否足够。

然后完成：

```text
ETH：买家 → 卖家（扣除协议费）
NFT：Vault → 买家
```

#### 谁支付撮合 Gas？

谁发起结算交易，谁支付 Gas：

- 买家主动购买卖单：买家支付 Gas；
- 卖家主动接受买单：卖家支付 Gas；
- 批量撮合：发起批量交易的一方支付 Gas。

## 第 5 章：智能合约实现与安全

### 5.1 合约开发中的安全规范

#### 使用 OpenZeppelin 模块

常用模块包括：

- `Ownable`：权限控制；
- `Pausable`：紧急暂停；
- `ReentrancyGuard`：防止重入；
- `Initializable`：可升级合约初始化；
- `UUPSUpgradeable`：升级实现。

#### 防止重入

涉及 ETH 或 NFT 转移的函数使用 `nonReentrant`，并遵循：

```text
Checks
→ Effects
→ Interactions
```

即先校验，再更新状态，最后与外部合约交互。

#### 精确控制权限

- 关键配置函数使用 `onlyOwner` 或角色权限；
- Vault 的资产函数只允许 OrderBook 调用；
- 升级权限由多签或受限管理员管理；
- 初始化函数使用 `initializer`，防止重复初始化。

#### 处理整数边界

Solidity 0.8 及以上默认检查溢出和下溢，但仍需要检查：

- 价格乘数量是否溢出；
- 费用计算是否超过总价；
- 部分成交数量是否超过订单数量；
- 退款金额是否超过托管余额；
- `uint128`、`uint256` 转换是否安全。

#### 限制 delegatecall

如果批量撮合使用 `delegatecall`，需要确保内部函数不能被外部直接调用。可以使用 `onlyDelegateCall` 之类的保护逻辑，检查当前调用上下文是否来自 delegatecall。

### 5.2 NFT Market 合约的主要风险

#### 重入攻击

攻击者可能通过恶意 NFT 接收回调或 ETH 接收回调重新进入交易函数。

防范：

- 使用 `nonReentrant`；
- 先更新订单状态再转账；
- 对外部调用保持最小化；
- 使用安全转账库。

#### 重复成交

同一订单被多个用户同时撮合，可能发生双重成交。

防范：

- 使用 `filledAmount` 或状态标记；
- 在结算前检查订单状态；
- 在状态更新后再进行资产转移；
- 为订单使用唯一哈希。

#### 伪造订单或签名重放

防范：

- 使用 EIP-712 typed data；
- 绑定 chainId 和 exchange 地址；
- 使用 nonce 和 salt；
- 支持 EIP-1271 合约钱包签名验证；
- 支持 maker 主动取消订单。

#### 权限过大

平台 owner 如果可以直接取走用户资产，会形成严重中心化风险。

防范：

- Vault 只接受 OrderBook 调用；
- 提币权限使用多签；
- 将协议费和用户托管资产分离；
- 升级、暂停、费率和提币分别授权；
- 所有管理员操作写入审计日志。

#### 资产和订单状态不一致

订单可能已经成交，但数据库仍显示有效；也可能 NFT 已转移，Listing 仍然存在。

防范：

- 撮合前重新读取链上状态；
- 使用事件幂等；
- 设置确认区块数；
- 处理链重组；
- 定期做链上余额和数据库对账。

### 5.3 合约测试与审计

建议分三层：

1. **单元测试**
   - 正常创建订单；
   - 订单取消；
   - Item Bid 和 Collection Bid；
   - 部分成交；
   - 过期订单；
   - 无授权、余额不足和价格不匹配；
   - 重入模拟。
2. **静态分析**
   - Slither；
   - Solidity 编译器警告；
   - 依赖漏洞扫描；
   - 存储布局检查。
3. **第三方审计**
   - 主网上线前审计交易逻辑；
   - 审计 Vault 和资金流动；
   - 审计权限、升级和提币；
   - 审计费用、版税和批量调用。

### 5.4 合约升级

可升级合约需要重点注意：

- 状态变量顺序不能随意改变；
- 不能删除或重排已有存储变量；
- 继承结构必须保持兼容；
- 新实现的 ABI 和代理入口要一致；
- 升级前后要验证数据保持不变；
- 升级管理员必须使用多签；
- 应保留 `storage gap` 为未来升级预留空间。

常用 Hardhat Upgrades API：

```typescript
deployProxy();
upgradeProxy();
validateImplementation();
validateUpgrade();
deployImplementation();
prepareUpgrade();
```

升级测试需要验证：

```text
部署 V1
→ 创建订单和托管资产
→ 升级到 V2
→ 读取原有订单、余额和状态
→ 验证旧订单仍能正确取消或成交
```

### 5.5 Hardhat 与 Remix

#### Hardhat

适合完整项目开发：

- 插件丰富；
- 支持 Ethers.js、Waffle 和本地网络；
- 支持 OpenZeppelin 升级插件；
- 适合自动化测试和部署；
- 方便调试 Gas、交易回执和事件。

#### Remix

适合：

- 快速验证小合约逻辑；
- 交互调用 ABI；
- 新人学习部署流程；
- 进行简单的测试网操作。

大型项目通常使用 Hardhat 作为主力工具，Remix 作为辅助验证工具。

## 第 6 章：链上链下数据同步

### 6.1 链上事件如何同步到后端

通过独立的 Sync 服务监听指定链、指定合约和指定事件。

以订单簿为例，需要同步：

- `LogMake`：创建订单；
- `LogCancel`：取消订单；
- `LogMatch`：订单撮合；
- NFT `Transfer`：所有权转移；
- Approval：授权变化。

推荐流程：

```text
读取同步配置
→ 获取最新区块
→ 计算安全同步高度
→ 使用 eth_getLogs 按地址和 topics 拉取日志
→ 解码事件
→ 写入原始事件表
→ 更新 Order / Item / Collection / Activity
→ 提交 checkpoint
```

服务可以使用可恢复的 goroutine 和 `context.Context` 管理生命周期，并使用 GORM 操作 MySQL。

### 6.2 为什么选择“轮询 + eth_getLogs”

#### 轮询的优势

- `eth_getLogs` 支持按合约地址、事件 topics 和区块范围过滤；
- 可以批量拉取事件；
- 适合历史补扫和服务重启后的恢复；
- 容易实现确认区块数和回滚策略；
- 不依赖长连接持续稳定存在。

#### WebSocket 的优势与问题

WebSocket 适合低延迟实时通知，但需要处理：

- 连接断开；
- 重连后漏事件；
- 节点连接数限制；
- 订阅状态丢失；
- 服务重启后的历史补偿。

实践中可以采用：

```text
HTTP 轮询负责可靠同步
+ WebSocket 负责实时提示
```

不能只依赖 WebSocket 作为唯一事实来源。

### 6.3 链重组与数据不一致

#### 方案一：延迟确认

只同步当前链头之前若干个区块的数据。

例如：

```text
最新区块：100
确认延迟：6
实际同步到：94
```

确认区块数应配置化，不同链需要不同参数。

#### 方案二：幂等数据结构

所有事件使用唯一键：

```text
chain_id + contract_address + tx_hash + log_index
```

重复收到事件时，数据库唯一约束或 upsert 保证不会重复处理。

#### 方案三：区块哈希对比

维护最近 M 个区块的映射：

```text
blockNumber → blockHash
```

同步时重新读取这些区块的哈希。如果本地哈希和链上哈希不同，则说明发生了 Reorg，需要回滚受影响区块并重新扫描。

#### 方案四：临时缓存未最终确认数据

将尚未达到 finality 的数据先写入 Redis 或临时表，确认后再写入正式派生表。发生重组时，只回滚临时数据。

### 6.4 如何避免写一半失败

#### 同步进度延后更新

完成一个区块内的全部事件处理，并成功提交事务后，再更新同步高度。不能先把区块标记为已同步，再慢慢写业务数据。

#### 使用唯一索引

网络抖动、服务重试和进程重启都可能导致事件重复处理。唯一索引可以避免：

- 重复写入 Activity；
- 重复更新成交；
- 重复计算积分或统计；
- 重复改变订单状态。

#### 多表写入使用事务

例如同一个成交事件需要同时：

- 写入 Activity；
- 更新 Order；
- 更新 Item owner；
- 更新 Collection volume。

这些操作应在同一个数据库事务中完成，任一操作失败则全部回滚。

## 第 7 章：后端服务与性能优化

### 7.1 API 设计

Backend 采用 RESTful API 架构：

- 使用 Gin 构建 HTTP 服务；
- 按 Collection、Item、Order、Activity、Portfolio 等资源设计路由；
- 使用 `/api/v1/...` 进行版本化；
- Handler 负责参数和响应；
- Service 负责业务逻辑；
- DAO 负责数据库读写；
- `svcCtx` 注入系统上下文和基础设施。

RESTful 的优势：

- 与前端集成清晰；
- 路由和资源容易理解；
- 可以使用 Cache API 中间件；
- 可以配合 Auth 中间件和 Token 鉴权；
- 易于通过 Swagger/OpenAPI 管理接口。

### 7.2 Redis 缓存

缓存可以通过统一的 `xkv.Store` 封装，并使用 Cache API 中间件自动缓存响应。

适合缓存：

- Collection 地板价；
- 热门 NFT 详情；
- 排名接口；
- 活动流；
- 用户 Listings 和 Bids；
- 高频访问的 Item 图片；
- 登录 nonce 和用户 token；
- 同步任务状态。

缓存策略：

- 设置合理 TTL；
- 对热点数据主动失效；
- 订单成交后主动刷新相关缓存；
- 关键状态携带 block number 或 version；
- 防止缓存雪崩、击穿和穿透。

### 7.3 数据库优化

#### SQL 和索引

针对高频查询建立合适索引，并使用 `EXPLAIN` 分析慢查询。

例如 Activity 经常按照 Collection、Token ID 和类型查询，可以考虑：

```sql
(collection_address, token_id, activity_type)
```

注意最左匹配原则和索引区分度。

#### 读写分离

主库负责写入，从库承担读请求，降低主库压力。需要注意同步延迟对用户可见状态的影响。

#### 分库分表

数据量大时可以按链或业务维度拆分：

```text
eth_activity
eth_collection
eth_item
eth_order

bsc_activity
bsc_collection
bsc_item
bsc_order
```

还可以按冷热数据拆分：

- 热数据：当前订单、当前 owner、地板价；
- 冷数据：历史活动、旧元数据、已完成订单。

### 7.4 异步任务和消息队列

不需要同步返回的操作可以异步化：

- 刷新 Collection Metadata；
- 更新 NFT 图片；
- 计算地板价；
- 更新排名；
- 检查订单过期；
- 更新活动统计。

消息队列可以削峰填谷，避免高峰期大量同步任务直接压垮 API 或数据库。

### 7.5 负载均衡和水平扩展

- 使用 Nginx 或云负载均衡器分发请求；
- API 服务尽量无状态化；
- Token、缓存和任务状态放在共享存储中；
- 按 CPU、请求数、P95 延迟自动扩容；
- Sync 服务按链或合约分片运行；
- 数据库和 Redis 进行主从或集群部署。

### 7.6 压测和监控

需要监控：

- API P50/P95/P99 延迟；
- HTTP 错误率；
- RPC 错误和重试次数；
- 数据库连接池和慢查询；
- Redis 命中率；
- Sync lag；
- 事件处理失败数；
- 订单和链上状态不一致数。

常用工具：

- Prometheus；
- Grafana；
- 日志聚合系统；
- 压测工具；
- 链上交易和 RPC 监控。

## 第 8 章：交易撮合与资产安全

### 8.1 链上撮合还是链下撮合、链上结算

项目采用的是：

> 链上订单簿 + 链上撮合 + 链上结算。

实现方式：

- Maker 通过合约创建订单；
- NFT 或 ETH 进入 Vault；
- OrderBook 保存订单状态；
- 任何人都可以查询订单；
- 任意一方调用撮合函数；
- 合约完成资产划转和状态更新。

选择链上撮合的理由：

- 订单和成交记录全链可查；
- 资产由合约托管，减少链下伪造；
- 撮合规则公开透明；
- 适合高价值 NFT 和 DeFi 组合；
- 不依赖单一中心化撮合服务器。

需要注意：链上撮合并不能完全消除前置交易、Gas 竞争和 MEV，需要通过订单有效期、价格保护、批量交易和更合理的提交策略降低影响。

### 8.2 订单簿实现

订单簿实现要点：

1. 订单结构包含 maker、价格、资产、有效期和 salt；
2. 使用价格树和同价队列实现价格优先、时间优先；
3. 每个 Collection 分别维护 List 和 Bid 的价格结构；
4. 撮合时检查订单状态、资产、价格和余额；
5. 支持单笔和批量撮合；
6. 成交后更新 `filledAmount` 和剩余数量。

### 8.3 卖家出售 NFT

```text
卖家调用 makeOrders 创建 List
→ 买家查询到卖单
→ 前端构造匹配的 Bid/taker order
→ 检查 Collection、Token ID 和价格
→ 调用 matchOrder
→ 完成 NFT 购买
```

### 8.4 买家提交 Offer

```text
买家调用 makeOrders 创建 Bid
→ 写入期望价格、Collection、Token ID 和数量
→ 卖家查看有效 Bid
→ 卖家构造匹配的 List order
→ 调用 matchOrder
→ 完成 NFT 出售
```

前端可以帮助用户构造合约参数，但交易最终仍由用户钱包签名确认。高级用户也可以自己构造交易参数并直接调用合约。

### 8.5 Vault 资产托管

Vault 的职责：

- 卖家挂单时托管 NFT；
- 买家挂 Bid 时托管 ETH；
- 成交后向买家转 NFT，向卖家转 ETH；
- 取消订单时按订单退回剩余资产；
- 编辑订单时处理资产迁移、差额补缴和多余退款；
- 限制只有 OrderBook 可以调用核心存取函数。

资产映射通常按 `orderKey` 保存：

```text
orderKey → NFT tokenId
orderKey → ETH balance
```

## 第 9 章：行业背景与趋势理解

### 9.1 如何看待 NFT 市场的未来

NFT 的发展可以从三个方向理解：资产化、应用化和协议化。

#### 资产化

NFT 不再只是图片，而是可以代表：

- 数字商品；
- 门票；
- 身份；
- 游戏道具；
- 版权或授权凭证；
- 现实资产或收益权的链上凭证。

#### 应用化

NFT 会和具体业务结合：

- NFT 门票与线下活动绑定；
- 链游装备和角色资产；
- 音乐版权确权和分发；
- 品牌会员和数字藏品；
- 数字身份和社区权限。

#### 协议化

NFT 交易会从单一平台产品走向底层协议和可组合基础设施：

- 订单协议；
- 资产托管协议；
- 聚合交易协议；
- NFT 借贷协议；
- NFT 租赁和收益协议。

可以进一步思考：

- NFT + RWA；
- NFT + AI；
- NFT + 游戏；
- NFT + 社交身份；
- NFT + DeFi。

### 9.2 NFT 与 DeFi、GameFi 的结合

#### NFT 与 DeFi

1. **NFT 抵押借贷**：用 NFT 抵押换取流动性资产，核心难点是估值和清算。
2. **NFT AMM**：通过 bonding curve 建立 NFT 流动性池，降低等待对手方的时间。
3. **收益凭证和资产包裹**：NFT 表示收益权、保险产品、期权或组合金融工具。
4. **NFT 分割与份额化**：将高价值 NFT 变成可拆分、可交易的权益份额。

#### NFT 与 GameFi

1. **资产所有权**：玩家真正持有角色、装备和道具。
2. **资产可组合**：可以使用 NFT 作为角色或容器，结合 ERC-6551 等账户模型。
3. **经济系统透明**：发行量、流通和消耗规则在链上可验证。
4. **Play to Own**：玩家获得可转移的游戏资产，而不是只拥有中心化数据库中的记录。
5. **链上升级**：NFT 可以通过合约实现等级、技能和属性变化。

### 9.3 NFT 项目的主要技术挑战

#### 1. 链上链下数据一致性

链上事件复杂且可能发生重组，链下需要实时构建活动、订单、持有者和统计数据。难点包括：

- 事件幂等；
- 确认区块；
- 链重组回滚；
- 多表事务；
- 补扫和故障恢复。

#### 2. 性能和可扩展性

热门 Collection 会产生大量订单、活动和属性查询，需要解决：

- 订单簿查询；
- 热门 NFT 查询；
- 大表分页；
- 属性筛选；
- 排名统计；
- 批量元数据导入。

常见手段：

- Redis 缓存；
- 数据库索引；
- 读写分离；
- 分库分表；
- 异步任务；
- 消息队列；
- 多级缓存。

#### 3. 安全性与资产托管

自建 Vault 和 OrderBook 时，需要重点处理：

- 重入；
- 授权；
- 资产转移；
- 重复成交；
- 签名重放；
- 管理员权限；
- 升级风险；
- 费用和版税；
- 恶意 NFT 回调。

## 第 10 章：面试回答组织方法

### 10.1 推荐回答结构

回答一个技术问题时，可以按以下顺序：

```text
先说结论
→ 解释业务背景
→ 说明架构和核心流程
→ 给出关键代码/数据结构
→ 说明遇到的问题
→ 说明解决方案和权衡
→ 说明验证方式
```

### 10.2 示例：如何回答“项目难点”

可以这样组织：

> 项目的主要难点是链上链下数据一致性、订单撮合安全和大规模查询性能。链上部分由 OrderBook 和 Vault 保证订单与资产结算，链下由 Sync 服务监听事件并写入数据库。为了避免链重组和重复事件，我使用确认区块、`txHash + logIndex` 唯一约束、checkpoint 和事务更新。查询侧使用 MySQL 索引、Redis 缓存和异步任务降低数据库压力。合约部分重点覆盖订单过期、重复成交、无授权、余额不足和重入测试。

### 10.3 面试前检查清单

- [ ] 能解释 ERC-721 的 owner、approve、transfer 和 tokenURI。
- [ ] 能解释 List、Bid、Collection Bid 的区别。
- [ ] 能画出 OrderBook 和 Vault 的关系。
- [ ] 能解释 NFT 和 ETH 在成交前后分别在哪里。
- [ ] 能说明谁支付撮合 Gas。
- [ ] 能说明链上订单和链下订单的优缺点。
- [ ] 能解释 `LogMake`、`LogMatch`、`LogCancel` 的用途。
- [ ] 能解释确认区块、幂等、checkpoint 和链重组。
- [ ] 能说明 RESTful API、Redis、MySQL 和 GORM 的职责。
- [ ] 能解释重入、权限、签名重放和升级风险。
- [ ] 能用一次真实代码链路说明自己的贡献。
- [ ] 不把没有实际实现的功能说成已上线能力。

## 附录：与当前 EasySwap 项目的代码对照

| 面试主题 | 当前项目参考位置 |
|---|---|
| 订单结构 | `EasySwapContract/contracts/libraries/LibOrder.sol` |
| 订单创建、取消、编辑和撮合 | `EasySwapContract/contracts/EasySwapOrderBook.sol` |
| 订单存储和价格排序 | `EasySwapContract/contracts/OrderStorage.sol` |
| 订单校验和成交数量 | `EasySwapContract/contracts/OrderValidator.sol` |
| 协议费率 | `EasySwapContract/contracts/ProtocolManager.sol` |
| NFT/ETH 托管 | `EasySwapContract/contracts/EasySwapVault.sol` |
| 合约测试 | `EasySwapContract/test/TestEasySwap.js` |
| API 路由 | `EasySwapBackend/src/api/router/v1.go` |
| 后端业务服务 | `EasySwapBackend/src/service/v1/` |
| 数据访问 | `EasySwapBackend/src/dao/` |
| 链上事件同步 | `EasySwapSync/service/orderbookindexer/service.go` |
| 数据库迁移 | `EasySwapSync/db/migrations/` |
| 前端交易调用 | `nft-market-fe/contracts/service/orderBookContract.ts` |

> 这份指南适合作为面试准备材料。回答时应以当前代码实际实现为准，并主动区分“已经实现”“项目设计中”“未来可以扩展”三种状态。
