# NFTMarket 订单、订单簿与撮合详解

> 核对日期：2026-11-10。依据当前工作区 Solidity 合约和前端调用代码进行静态分析。  
> 本文区分“现有实现”“通用原理”“建议设计”。风险项是代码阅读发现的待验证问题，不代表已经完成漏洞复现或安全审计。

## 1. 先区分三个概念

| 概念 | 做什么 | 项目位置 |
|---|---|---|
| 订单 Order | 表达谁愿意以什么价格买卖什么资产 | `LibOrder.Order` |
| 订单簿 OrderBook | 保存订单，并按价格和插入顺序组织查询 | `OrderStorage` |
| 撮合与结算 Match/Settlement | 验证指定订单组合，并转移 NFT 和 ETH | `EasySwapOrderBook._matchOrder`、`EasySwapVault` |

一句话理解：订单是交易意愿，订单簿是组织这些意愿的目录，撮合是让两个意愿达成交易，结算是把资产真正交付给双方。

**本项目的重要特点：挂单不自动成交，撮合也不自动寻找全市场最优订单。**

`makeOrders()` 负责入簿和托管，`matchOrder(sellOrder, buyOrder)` 接受调用者指定的两张订单。合约不会因为新 Bid 的价格高于某个 List，就自动遍历整本订单簿并成交。

因此要区分：

```text
排序查询：给用户找到较好的候选订单
指定订单撮合：验证并执行用户提交的订单组合
连续自动撮合：每次下单立即扫对手盘，当前项目并未完整实现
```

## 2. 订单模型：每个字段到底代表什么

代码：[LibOrder.sol](EasySwapContract/contracts/libraries/LibOrder.sol)。

```solidity
enum Side { List, Bid }
enum SaleKind { FixedPriceForCollection, FixedPriceForItem }

struct Asset {
    uint256 tokenId;
    address collection;
    uint96 amount;
}

struct Order {
    Side side;
    SaleKind saleKind;
    address maker;
    Asset nft;
    Price price;       // 底层 uint128，NFT 单价
    uint64 expiry;
    uint64 salt;
}
```

### 2.1 买卖方向：List 和 Bid

- `List`：卖家愿意卖出 NFT。
- `Bid`：买家愿意花 ETH 买入 NFT。
- `maker`：当前这张订单的创建者。卖单 maker 是卖家，买单 maker 是买家。
- Maker/Taker 是相对于“哪张订单先挂在簿上”而言，不能永久把卖家等同 Maker、买家等同 Taker。

### 2.2 单品出价和合集出价

| 类型 | 条件 | 示例 |
|---|---|---|
| Item List | 指定合集、tokenId | Alice 以 1 ETH 卖出 C 合集的 #42 |
| Item Bid | 指定合集、tokenId | Bob 以 0.9 ETH 买 C 合集的 #42 |
| Collection Bid | 指定合集，接受其中任意合格 token | Bob 以 0.8 ETH/个买入 C 合集的 3 个 NFT |

Collection Bid 不代表“可以买任何合集”。它只应放宽 tokenId，**必须继续约束 collection**。这一点在当前代码中存在重要检查缺口，见第 14 章。

### 2.3 数量不是 ERC-1155 支持证明

当前 `_makeOrderTry()` 对 List 要求 `amount == 1`，Vault 使用 ERC-721 转移接口；Bid 可设置 `amount > 0`，每次卖家接受 Bid 时成交量加 1。

因此，多数量 Collection Bid 可以表达“分多次买入多个 ERC-721”，不等于合约已经支持 ERC-1155 批量资产。

### 2.4 价格、有效期和 salt

- `price` 是 wei 单位的单价，`1 ETH = 10^18 wei`。
- Bid 创建时托管金额为 `price × amount`。
- `expiry == 0` 表示无到期限制；一般有效条件是 `expiry > block.timestamp`。
- `salt` 是订单区分字段，不是密码，也不是签名。相同资产、价格和 maker 可以用不同 salt 生成不同订单键。
- 当前结构没有支付币种字段，不能据此声称支持任意 ERC20 结算。

### 2.5 一笔订单示例

```text
side       = Bid
saleKind   = FixedPriceForCollection
maker      = Bob
collection = C
tokenId    = 合集报价中不作为具体 token 的约束
amount     = 3
price      = 0.8 ETH
expiry     = 截止时间
salt       = 非零随机值

创建时需托管：0.8 × 3 = 2.4 ETH
第一次成交后：filled = 1，剩余 = 2，托管 = 1.6 ETH
```

## 3. OrderKey、签名与权限不要混为一谈

代码使用 `type OrderKey is bytes32`，由 `LibOrder.hash(order)` 计算订单标识。

```text
Asset 字段 → assetHash
Order 类型哈希 + 字段 + assetHash → orderKey
```

修改价格、数量、expiry 或 salt，都可能改变订单键。全零键作为空指针哨兵。

**现有实现需要特别说明：**

1. Asset 哈希使用 `abi.encode`，Order 哈希使用 `abi.encodePacked`。前后端必须采用完全一致的字段类型、宽度和编码顺序。
2. 当前 OrderKey 计算本身没有绑定 chainId 和订单簿地址，链下唯一标识建议使用 `(chainId, exchangeAddress, orderKey)`。
3. `OrderValidator` 虽继承并初始化了 EIP-712，也声明了 EIP-1271 magic value，但当前撮合入口没有签名参数，也未看到 ECDSA recover 或 `isValidSignature()` 验签流程。
4. 当前交易授权主要依赖 `msg.sender`、已上链订单和 Vault 托管。不能把“存在 EIP-712 基类”写成“已完成链下签名订单协议”。

若以后增加离链签名订单，应完整实现 EIP-712 domain、类型编码、签名验证、nonce/cancel、防重放和合约钱包支持。这是扩展设计，不是当前已有能力。

## 4. 订单簿：红黑树 + 同价单向队列

代码：[OrderStorage.sol](EasySwapContract/contracts/OrderStorage.sol)。

```text
orders[orderKey] → { order, next }
priceTrees[collection][side] → 价格树
orderQueues[collection][side][price] → { head, tail }
```

示意：

```text
合集 C
├── List 价格树：0.8 → 1.0 → 1.2 ETH
│   ├── 0.8：S1 → S2 → 空
│   ├── 1.0：S3 → 空
│   └── 1.2：S4 → 空
└── Bid 价格树：0.5 → 0.6 → 0.7 ETH
    ├── 0.5：B1 → 空
    ├── 0.6：B2 → B3 → 空
    └── 0.7：B4 → 空
```

这里箭头表示排序关系，实际树并不是一条链。

- 树存储不同的价格档位，负责找到最低价、最高价、下一档价。
- 同价队列存储订单键，负责保持合约执行时的插入顺序。
- `orders` 保存完整订单与 `next`，负责定位实际订单。

同价先后以链上交易执行及数组插入顺序为准，不以用户在页面点击按钮的时间为准。

## 5. 什么是红黑树，为什么用于价格档

代码：[RedBlackTreeLibrary.sol](EasySwapContract/contracts/libraries/RedBlackTreeLibrary.sol)。

### 5.1 从普通二叉搜索树开始

二叉搜索树要求：左子树比当前节点小，右子树比当前节点大。

```text
       1.0
      /   \
    0.8   1.2
```

这样查询 0.8 时，不用检查所有节点。但如果按递增价格插入普通二叉树，可能退化成链表：

```text
0.5 → 0.6 → 0.7 → 0.8 → 0.9
```

此时查找最差为 O(P)，P 是不同价格档的数量。

### 5.2 红黑树如何避免退化

红黑树是带颜色规则的自平衡二叉搜索树，基本规则包括：

1. 每个节点是红色或黑色。
2. 根节点为黑色。
3. 空叶子视为黑色。
4. 红色节点不能有红色子节点。
5. 从某节点到所有空叶子的路径有相同黑色节点数。

插入和删除后通过“重新着色”和“旋转”恢复规则，使树高度保持在 O(log P)。颜色不是价格涨跌，也不是买卖方向，只是平衡结构的标记。

旋转示意，前后仍满足大小关系：

```text
     x                   y
    / \                 / \
   A   y      →        x   C
      / \             / \
     B   C           A   B
```

### 5.3 在项目中如何使用

| 操作 | 项目调用 | 含义 |
|---|---|---|
| 最低价 | `first()` | List 优先查这一档 |
| 最高价 | `last()` | Bid 优先查这一档 |
| 更高一档 | `next(price)` | 遍历后续 List |
| 更低一档 | `prev(price)` | 遍历后续 Bid |
| 插入/删除价格 | `insert/remove` | 某价格首次出现/最后一单移除 |

本库 `first/last` 从根向左右走，不能直接宣称为 O(1)。插入、删除和搜索通常为 O(log P)，但实际 Gas 还取决于 storage 写入与平衡操作。

红黑树只优化“价格层”，不能消除每个价格档内的订单遍历成本。

## 6. 创建、取消和改单：订单怎样入簿和出簿

### 6.1 创建 `makeOrders()`

调用链：

```text
makeOrders(newOrders)
→ Bid 计算 price × amount
→ _makeOrderTry(order, requiredETH)
→ 检查 maker、价格、salt、expiry、filledAmount
→ List：Vault.depositNFT
→ Bid：Vault.depositETH
→ _addOrder
→ LogMake
→ 退回本次未使用的 msg.value
```

`_addOrder()` 的步骤：

1. 计算 orderKey，拒绝现存重复订单。
2. 若价格档不存在，向红黑树插入 price。
3. 获取对应价格队列。
4. 空队列设置 head 和 tail；非空队列连接到原 tail.next。
5. 保存订单体，设置新 tail。

参数检查不通过时某些路径跳过并返回空键；但外部 NFT 转移、余额不足或重复插入引发的 revert 不一定被局部捕获，可能回滚整笔 `makeOrders()`。**批量创建不保证所有失败都自动跳过。**

### 6.2 取消 `cancelOrders()`

当前仅允许订单 maker 取消自己的未完全成交订单，不存在泛化的“任意授权代理都能撤单”机制。

```text
读取 orders[key]
→ maker == msg.sender
→ filled < amount
→ _removeOrder
→ List 退回 NFT / Bid 退回剩余 ETH
→ filledAmount[key] = uint256 最大值
→ LogCancel
```

取消一个部分成交 Bid：

```text
原订单：3 个，每个 0.8 ETH
已成交：1 个
退款：(3 - 1) × 0.8 = 1.6 ETH
```

到期不自动退款。用户仍需发交易撤单，暂停状态是否允许退出也必须核对。

### 6.3 为什么删除订单可能很贵

队列只保存 `next`，没有 `prev`。删除中间订单时必须从 head 开始寻找前驱：

```text
head → S1 → S2 → S3 → S4
删除 S3：先找到 S2，再令 S2.next = S4
```

同价 K 张订单，删除最差 O(K)。若该档清空，还要执行 O(log P) 的价格树删除。

可选改进是双向链表，以更多存储写入换取已知订单键的 O(1) 摘链。必须结合真实订单数量和 Gas 测量选择。

### 6.4 编辑 `editOrders()`

当前 `_editOrderTry()` 在同一笔交易中：取消旧键、创建新键，并通过 Vault 的 `editNFT/editETH` 迁移资产记账。

- 并不是必须先发“取消交易”，再发“创建交易”。
- collection、tokenId、maker、side、saleKind 要保持一致。
- 价格、数量、expiry、salt 的变化会影响新订单键；具体可改范围以检查代码为准。
- Bid 按旧订单剩余金额和新订单总金额计算差额，多退少补。
- 新订单重新入队，取得新的同价顺序。
- 新订单数量、零价格和到期等值等约束需要与创建入口统一，不能只依赖前端。

## 7. 状态机：不能只看订单是否存在

当前不是独立枚举存储状态，而是组合判断：

```text
orders[key] 是否存在
filledAmount[key]
order.amount
order.expiry
Vault 资产余额
```

建议理解顺序：

```text
不存在且无历史证据 → 不存在/未知
filled == CANCELLED → 已取消
filled >= amount     → 已完全成交
expiry 非零且到期   → 已过期
0 < filled < amount  → 部分成交
filled == 0          → 未成交
```

必须先识别 `CANCELLED`，不能把 uint256 最大值显示成真实成交数量。

历史已取消订单可能已从 `orders` 删除，所以仅凭当前映射也无法完整恢复历史；应结合事件索引或用户保留的订单体。

一个正常的多数量 Bid 生命周期：

```text
创建：filled=0，Vault=2.4 ETH
第一次卖家接受：filled=1，Vault=1.6 ETH
第二次卖家接受：filled=2，Vault=0.8 ETH
第三次卖家接受：filled=3，Vault=0
```

这是卖家接受 Bid 分支的正常路径说明，不代表所有撮合分支对多数量 Bid 都已经正确处理。

## 8. 查询最优订单，不等于强制最优价成交

### 8.1 `getBestPrice()`

只读取价格树的最小/最大值，可能得到仅包含过期或已成交残留订单的价格档。它不是完整的“可执行报价”。

### 8.2 `getBestOrder()`

按价格优先遍历队列，过滤到期订单及不符合 tokenId 的单品 Bid；查询 Item Bid 时也可能返回符合该合集的 Collection Bid。

但当前查询没有统一检查 `filledAmount`，不能只因为函数名含 Best 就认定结果一定能成交。

### 8.3 `getOrders()`

使用价格和订单键进行分页，返回固定长度数组和下一订单键。客户端需要处理不足页时的默认空元素，并结合价格恢复下一页。

订单簿在翻页期间会变动：游标订单可能被撤销、价格档可能消失，因此不能承诺跨多个最新区块查询的稳定快照。需要一致快照时可固定 blockTag 查询，成交前仍要重新模拟。

### 8.4 价格时间优先实际保障了什么

当前入队和查询支持价格优先、同价先入先出；`matchOrder()` 不要求撮合参数必须是最优价或队头。

用户可以直接选择某个价格更高的 Listing，也可以绕过同价先入订单。对于 NFT，不同 tokenId 价值本来就可能不同，因此“合集最低价格”和“想买的 NFT 的最佳价格”也是两回事。

准确表述应为：**本项目提供排序订单簿与指定订单履约，不是强制所有交易遵守连续竞价优先级的撮合引擎。**

## 9. 撮合路径 A：买家购买已有卖单

代码：`_matchOrder()` 中 `msg.sender == buyOrder.maker` 分支。

### 9.1 即时购买，买单不必提前挂入簿

```text
Alice 提前创建 List：C/#42，1 ETH，NFT 进入 Vault
Bob 从页面选中该订单
前端临时构造 buyOrder：maker=Bob，amount=1，price=1 ETH
Bob 调用 matchOrder，附带 1 ETH
```

Bob 的临时买单是结算参数，不要求先 `makeOrders()` 再锁一次资金。

### 9.2 代码执行步骤

1. 计算双方 OrderKey，调用 `_isMatchAvailable()`。
2. 查询 buyOrder 是否已经上链存储。
3. 从存储读取并验证 sellOrder；卖单必须存在。
4. 验证 buyOrder 参数。
5. 成交价 `fillPrice = sellOrder.price`。
6. 买单未入簿时，要求 `msgValue >= fillPrice`。
7. 买单已入簿时，从 Vault 取出 `buyPrice`，移除该 Bid 并把 filled 加 1。
8. 把卖单 filled 设置为卖单数量。
9. 发出 `LogMatch`。
10. 卖家收到 `fillPrice - protocolFee`。
11. 若 `buyPrice > fillPrice`，向买家退差额。
12. Vault 把 NFT 给买家。
13. 外层根据 costValue 处理本次 msg.value 余款。

### 9.3 正常价格相同的金额示例

假设费率配置为 200 基点，即 2%，不是声明实际部署费率。

```text
成交价：1 ETH
协议费：floor(1 ETH × 200 / 10000) = 0.02 ETH
卖家实收：0.98 ETH
买家得到：C/#42
协议费：留在 OrderBook 合约，owner 可按接口提取
Gas：由发交易的 Bob 支付，不属于平台手续费
```

前端 `buyNowWithMulticall()` 将临时买单价格设为卖单价格，并以该价格附带 value，是主要的正常使用路径。

价格不等和已有多数量 Bid 的边界不能简单套用以上路径，见第 14 章。

## 10. 撮合路径 B：卖家接受已有 Bid

代码：`_matchOrder()` 中 `msg.sender == sellOrder.maker` 分支。

### 10.1 正常流程

```text
Bob 创建 Collection Bid：C 合集，0.8 ETH/个，数量 3
→ 2.4 ETH 进入 Vault
Alice 持有 C/#42 并授权 Vault
→ 临时构造 sellOrder
→ Alice 调用 matchOrder，不附带 ETH
```

### 10.2 代码执行步骤

1. 验证方向、非同 maker、资产及成交量。
2. 要求本次 `msgValue == 0`。
3. 检查 sellOrder 是否已经在簿中。
4. 验证 sellOrder，以及存储中的 buyOrder；Bid 必须存在。
5. 成交价 `fillPrice = buyOrder.price`。
6. 卖单已存在时，移除卖单并标为完全成交。
7. Bid 的 filled 加 1。
8. Vault 取出一个单位的 Bid ETH 给 OrderBook。
9. OrderBook 扣协议费后向卖家付款。
10. 已托管卖单从 Vault 交付 NFT；临时卖单由 Vault 直接从卖家转给买家。

卖家不必先将 NFT 挂成 List 才能接受 Bid，但直接转移时仍需拥有 NFT 并授权 Vault。

### 10.3 部分成交与剩余资金

```text
初始托管：2.4 ETH
本次成交：0.8 ETH
协议费（2%）：0.016 ETH
Alice 实收：0.784 ETH
Bid 剩余：2 个
Vault 剩余：1.6 ETH
```

本次撮合只处理一个 ERC-721。剩余 Bid 可继续被其他卖家接受，或由 Bob 撤单退款。

当前对已存在主动卖单的过期校验可能被跳过，且缺少统一限价判断；应区分代码行为和建议规则。

## 11. 原子性、并发和批量撮合

### 11.1 单笔原子性

单笔匹配中任意未捕获的 revert，会撤销该调用中的状态、资产转移和事件日志。即使代码已经执行 `emit LogMatch`，后面 NFT 转移失败，最终 receipt 中也不应保留该成功事件。

因此索引器必须以成功交易和规范链日志为准，不能把前端点击、交易广播或模拟执行当成成交。

### 11.2 两个人同时购买一个 NFT

```text
Bob 和 Carol 同时提交交易
→ 出块时按实际执行顺序串行执行
→ 第一笔交易更新 filled 并转移 NFT
→ 第二笔读取新状态，订单关闭或资产不可用，交易失败
```

不是依赖数据库锁保护链上成交。数据库锁只能保护链下状态，不能阻止其他人直接调用合约。

失败交易仍可能消耗 Gas；`eth_call` 预模拟只能降低失败概率，不能锁定未来执行条件。订单簿也不会天然消除抢先交易或 MEV。

### 11.3 `matchOrders()` 支持部分成功

代码逐笔通过 delegatecall 调用 `matchOrderWithoutPayback()`，保留调用者与存储上下文：

```text
第 0 笔成功 → successes[0] = true
第 1 笔失败 → 回滚该子调用，记录 BatchMatchInnerError
第 2 笔成功 → successes[2] = true
最后统一退回未使用的本次 ETH
```

只要外层最后没有失败，成功子调用可保留。因此代码注释中的“全部成功或全部失败”不能替代真实实现。

若最后退款失败、计数溢出或外层其他步骤 revert，则整笔交易仍可能回滚。

交易 receipt 通常不直接给出 Solidity 函数返回数组；产品应结合成交事件、内部错误事件和回执逐笔展示结果。预模拟返回的数组也不等于实际执行结果。

### 11.4 `multicall()` 是另一层批量语义

- `revertOnFail=true`：某个直接子调用失败，整笔 multicall 回滚。
- `revertOnFail=false`：记录失败并继续其他直接子调用。
- 当前限制一个 multicall 最多包含一个可能消费 msg.value 的直接子调用。

**嵌套边界：**如果一个直接子调用是 `matchOrders()`，而它内部某笔成交失败但自行捕获，`matchOrders()` 整体仍可能成功返回。外层 `revertOnFail=true` 不会自动把内部 `false` 结果升级成整笔失败。

所以“外层严格”不一定等于“内层所有订单原子成交”。需要让内层也有明确的原子模式或显式检查全部结果。

## 12. 事件、数据库和页面怎样联动

```text
合约成交
→ LogMatch + NFT Transfer
→ Sync.handleMatchEvent
→ 更新 Order、Item、Activity 等派生数据
→ Backend 查询
→ 前端刷新 Portfolio 和成交记录
```

推荐索引原始日志键：`(chainId, txHash, logIndex)`，同时保存 blockHash、blockNumber、exchangeAddress。

建议保存：

| 对象 | 必要信息 |
|---|---|
| Order | 完整订单体、键、方向、数量、成交量、取消状态、expiry |
| Fill | 双方订单键、实际 NFT、成交单价、数量、卖家、买家 |
| Payment | gross、fee、sellerNet、refund、支付资产 |
| Raw Event | 原始日志、块哈希、规范链状态、解码版本 |

当前 `LogMatch` 两个键在不同分支中的传入顺序不同：卖家接受时先卖键，买家购买时先买键。解析者应结合事件中的 `side` 等字段确定角色，不要永远按第一个参数当卖家。

页面状态建议分开：

```text
等待签名 → 已广播 → 链上执行成功 → 索引中 → 页面数据更新
                       ↘ 链重组后回退/重新确认
```

把“链上确认”和“API 已刷新”分开，能避免用户看到旧 Listing 后误认为交易没成功而重复购买。

## 13. 如果设计一套更完整的撮合规则

以下是建议设计，不代表当前已经实现。

### 13.1 先定义统一不变量

```text
sell.side == List，buy.side == Bid
sell.maker != buy.maker
sell.collection == buy.collection              // 永远必须成立
buy 为单品出价时：sell.tokenId == buy.tokenId
ERC-721 单次交付量 == 1
0 < fillQuantity <= 双方可成交剩余量
订单未取消、未到期、支付资产一致
价格遵守双方允许的上下限
```

若主动方是临时订单，临时订单的限价也要校验；若产品规定“接受 Bid 就无条件同意其价”，则应明确该语义并在签名前展示，而不是让字段看似有限价却被忽略。

### 13.2 资金守恒

```text
实际收到的本次付款 + 本次释放的托管资金
= 卖家净额 + 平台费 + 其他明确费用 + 买家退款
```

并且：

```text
单笔成交扣款 = fillPrice × fillQuantity
剩余托管 = 原托管 - 本次实际扣款 - 明确退回额
不能拿历史协议费补贴本次退款
```

`costValue` 应代表本次外部 value 实际消耗金额，不能混用“出价上限”“成交价格”“Vault 释放金额”。退款最好集中由一层处理，避免内部退一次、外部再退一次。

### 13.3 单笔结算伪代码

```text
fulfill(sell, buy, fillQuantity):
  validate caller / orders / collection / token / expiry / price
  determine fillPrice from resting order policy
  gross = fillPrice * fillQuantity
  calculate fee and sellerNet
  update filled quantities
  unlink orders only when fully filled
  release exact payment from caller or Vault
  transfer NFT
  pay seller and accrue protocol fee
  refund only actual excess paid by this caller
  emit normalized fill event
```

需要检查所有外部调用和回调，并在同一安全边界内防重入。也可以使用待领取余额减少 ETH 接收者主动 revert 对交易的影响，但需额外设计提现和负债记账。

### 13.4 是否需要连续自动撮合

如果做真正的连续订单簿，新订单进入时扫描对手盘：

```text
while 有剩余需求且仍有可成交对手单:
  找到满足资产条件的最优对手单
  检查限价
  成交一个或多个单位
  减少剩余需求
  达到扫描/成交上限时停止
按 GTC / IOC / FOK 策略处理剩余量
```

- GTC：未成交部分继续挂单。
- IOC：立即成交可成交部分，其余取消。
- FOK：必须全部成交，否则整笔失败。

以上策略当前未作为完整订单类型实现。链上扫描需要设置最大步数，避免过期/不匹配订单过多而导致 Gas 不可控。NFT 不同 token 品质不同，买家通常仍需要指定 token 集合或可接受条件，不能只按合集最低价格盲扫。

## 14. 当前代码的重点核对项

本章描述静态代码观察，不修改合约，也不声称已经复现可利用漏洞。

### 14.1 Collection Bid 分支跳过了合集地址匹配

`_isMatchAvailable()` 当前条件是：

```solidity
buyOrder.saleKind == FixedPriceForCollection ||
(sell.collection == buy.collection && sell.tokenId == buy.tokenId)
```

当第一项为真时，表达式不会再要求双方合集相等。这与“指定合集内任意 token”的业务含义不一致。

建议改为“先要求 collection 相等，再决定是否需要 tokenId 相等”。验证用例：C 合集 Bid + D 合集 NFT 必须失败，且资产余额不变。

### 14.2 成交后的订单不一定从队列移除

- 买家购买分支把卖单 filled 设置为完全成交，但未在该分支移除卖单。
- 卖家接受分支把 Bid filled 加 1，达到原数量后也没有在该位置统一摘链。
- `getOrders/getBestOrder` 没有统一过滤 filled 状态。

因此已完全成交订单可能仍被查询返回，并使价格档、地板价视图受到污染。需要统一“全部成交后摘链”与“查询过滤终态”的规则。

### 14.3 已入簿的多数量 Bid 被买家主动使用时可能失去管理入口

买家购买分支对已存在 Bid 执行 `_removeOrder(buyOrder)`，但只令 filled 加 1，并从 Vault 取出一个 `buyPrice`。

如果 amount 原为 3，成交 1 后还存在剩余托管 ETH，而该 Bid 已从 `orders` 移除，常规撤单依赖 `orders[key]` 读取 maker。需要验证剩余资金如何继续成交或退出，不能假设会自动恢复。

### 14.4 临时买单价格与实际成交价不等的退款记账

未入簿买单检查 `msgValue >= fillPrice`，但函数返回的 costValue 是 buyPrice；内部又可能按 `buyPrice - fillPrice` 退款。

当 buyPrice 与 fillPrice 不同时，实际收到资金、已退款和外层余款计算可能不一致。前端当前使价格相等，只覆盖常见路径，不构成合约边界保护。

验证应覆盖 `buyPrice < fillPrice`、`==`、`>`，以及 msg.value 分别为 fillPrice、buyPrice 和超额三种情况。要求任何成功交易都不能消耗历史协议费补足退款。

### 14.5 到期检查和限价检查不统一

`_validateOrder(order, isSkipExpiry)` 可跳过到期判断。撮合时主动订单已入簿的分支传入存在性布尔值，可能跳过主动订单到期检查；`getOrders` 的 `< now` 与 `getBestOrder` 的 `> now` 在 expiry 等于当前时间时也不一致。

卖家接受 Bid 分支没有统一要求 Bid 价格不低于 sellOrder 的价格；临时买单分支也没有与已入簿买单相同的限价检查。建议明确主动接受语义，并统一所有时间、价格边界。

### 14.6 批量严格模式、验签能力和标准支持需要准确描述

- `matchOrders()` 本身捕获子调用失败；外层 multicall 严格模式不能自动保证所有内层成交都成功。
- 存在 EIP-712 基类不等于已完成签名订单验证。
- 存在 amount 不等于已支持 ERC-1155。
- 存在排序树不等于执行时强制价格时间优先。

前面的学习路线、系统设计和面试材料中如出现这些概括，应以当前真实调用链和本章核对结果为准。

## 15. 用例清单与学习顺序

### 15.1 建议优先验证的用例

| 用例 | 期望 |
|---|---|
| 创建单个 List | NFT 进入 Vault；订单入队 |
| 买家等价即时购买 | NFT 给买家，卖家净额与协议费准确 |
| 卖家直接接受 Bid | 无需先挂 List，但必须授权并持有 NFT |
| C Bid 匹配 D NFT | 失败，不能绕过 collection 检查 |
| 多数量 Bid 接受一次 | filled 加 1，剩余资金与剩余数量一致 |
| 部分成交后撤单 | 仅退剩余托管金额 |
| 买家使用已有多数量 Bid | 剩余订单仍能撤销和退款 |
| 成交后查 BestOrder | 不返回已成交残留订单 |
| 两人同时买同一个 NFT | 最多一人成功，无重复付款 |
| expiry 等于当前时间 | 查询与成交对有效性的定义一致 |
| 临时买价不等于成交价 | 限价、扣款、退款均守恒 |
| 批量一笔失败 | 返回语义与所选原子模式一致 |
| ETH/NFT 接收方拒收 | 子调用或整笔回滚范围明确 |
| 同价中间/最后一单撤销 | 链表、head/tail、价格树一致 |

这些是后续测试设计清单，本次文档整理没有执行或新增合约测试。

### 15.2 按最小单元学习

1. 阅读 `LibOrder`，手写一个 List 和一个 Collection Bid。
2. 计算字段变化如何导致 orderKey 改变。
3. 只看 `_addOrder`，画出三笔同价订单入队过程。
4. 看红黑树 `first/last/next/prev`，解释为何 Bid 和 List 遍历方向相反。
5. 看 `_removeOrder`，手工删除队首、队中、队尾。
6. 跟踪买家等价购买一次，逐步记录每个地址的 ETH/NFT 变化。
7. 跟踪卖家接受多数量 Bid 一次，再跟踪撤单。
8. 对比批量内部失败与外层 revert 的差异。
9. 最后根据第 14 章设计边界测试，区分正常路径与缺陷路径。

### 15.3 面试时可以怎样概括

> 项目采用链上订单存储和 Vault 托管。价格档用红黑树排序，同价订单用单向队列保存插入顺序。用户可以创建 List、单品 Bid 或合集 Bid。成交由用户指定两张订单触发，买家购买卖单时按卖单价格成交，卖家接受 Bid 时按 Bid 价格成交。合约负责更新成交量、托管资金释放、费用和 NFT 交付。排序查询和指定订单履约是两件事，当前并不是自动遍历全盘口的连续撮合引擎。多数量订单、批量失败、到期边界和退款守恒需要专项验证。

## 16. 代码导航

- [订单结构与哈希](EasySwapContract/contracts/libraries/LibOrder.sol)
- [订单入口与撮合](EasySwapContract/contracts/EasySwapOrderBook.sol)
- [价格树与订单队列](EasySwapContract/contracts/OrderStorage.sol)
- [红黑树库](EasySwapContract/contracts/libraries/RedBlackTreeLibrary.sol)
- [参数检查与成交量](EasySwapContract/contracts/OrderValidator.sol)
- [Vault 托管](EasySwapContract/contracts/EasySwapVault.sol)
- [费率设置](EasySwapContract/contracts/ProtocolManager.sol)
- [费用精度](EasySwapContract/contracts/libraries/LibPayInfo.sol)
- [前端购买构造](nft-market-fe/contracts/service/orderBookContract.ts)
- [事件索引](EasySwapSync/service/orderbookindexer/service.go)
- [现有合约测试](EasySwapContract/test/TestEasySwap.js)
