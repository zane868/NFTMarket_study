# EasySwapSync 链上事件同步流程

> 代码位置：`EasySwapSync/service/orderbookindexer/service.go`
> 独立进程，systemd unit `easyswap-sync`，配置 `/opt/easyswap-sync/config_import.toml`

---

## 一、整体架构

```mermaid
flowchart TB
    subgraph chain["以太坊 Sepolia"]
        OB["EasySwapOrderBook<br/>0xB6097Da3…"]
        VA["EasySwapVault<br/>0x3AD0D396…"]
        NFT["MetaNodeNFT<br/>0x8DE7E421…"]
    end

    subgraph sync["EasySwapSync 进程"]
        direction TB
        MA["main.go"]
        DA["cmd/daemon.go<br/>读配置 · 信号处理"]
        SV["service/service.go<br/>组装 DB / Redis / chainclient"]
        IDX["orderbookindexer.Service<br/>★ 事件同步"]
        OM["ordermanager.OrderManager<br/>过期标记 · 地板价 · 挂单数"]
    end

    subgraph store["存储"]
        MY[("MySQL easyswap<br/>ob_order_* / ob_item_*<br/>ob_activity_* / ob_indexed_status")]
        RD[("Redis<br/>价格队列 · 缓存")]
    end

    subgraph api["EasySwap Backend :8083"]
        BE["/api/v1/portfolio/*<br/>/api/v1/activities"]
    end

    FE["前端 /nft"]

    MA --> DA --> SV
    SV --> IDX
    SV --> OM
    OB -- "FilterLogs (eth_getLogs)" --> IDX
    IDX -- "写订单/活动/item" --> MY
    IDX -- "投递价格事件" --> RD
    OM --> RD
    OM --> MY
    MY --> BE --> FE
    RD -. "监听" .-> OM
```

---

## 二、启动与并发模型

```mermaid
flowchart TB
    A["codex: easyswap-sync daemon -c config_import.toml"] --> B["cmd/daemon.go"]
    B --> C["config.UnmarshalCmdConfig()<br/>解析 TOML"]
    C --> D["xzap.SetUp()<br/>初始化日志"]
    D --> E["service.New()"]
    E --> E1["model.NewDB()"]
    E --> E2["xkv.NewStore()<br/>Redis"]
    E --> E3["chainclient.New()<br/>EVM RPC 客户端"]
    E --> E4["orderbookindexer.New()<br/>解析内嵌 ABI"]
    E --> E5["ordermanager.New()"]

    E1 & E2 & E3 & E4 & E5 --> F["service.Start()"]

    F --> G1["collectionFilter<br/>PreloadCollections()<br/>同步执行，失败即退出"]
    G1 --> H1["GoSafe: SyncOrderBookEventLoop<br/>★ 扫块主循环"]
    G1 --> H2["GoSafe: UpKeepingCollectionFloorChangeLoop<br/>每日地板价维护"]
    G1 --> H3["GoSafe: OrderManager.Start()"]
    H3 --> I1["ListenNewListingLoop<br/>新订单入 Redis 队列"]
    H3 --> I2["orderExpiryProcess<br/>时间轮，每秒检查过期"]
    H3 --> I3["floorPriceProcess"]
    H3 --> I4["listCountProcess"]

    H1 -. "阻塞主协程" .-> J["select 等待 SIGINT/SIGTERM<br/>或 onSyncExit"]
    J --> K["cancel() 优雅退出"]
```

---

## 三、扫块主循环（核心）

```mermaid
flowchart TB
    S(["SyncOrderBookEventLoop 启动"]) --> S1["SELECT last_indexed_block<br/>FROM ob_indexed_status<br/>WHERE chain_id=11155111 AND index_type=6"]
    S1 --> S2["lastSyncBlock = 断点值"]

    S2 --> L{"for 循环<br/>ctx.Done() ?"}
    L -- "已取消" --> END(["退出"])
    L -- "继续" --> A1["currentBlockNum =<br/>chainClient.BlockNumber()"]

    A1 --> A2["safeEndBlock =<br/>currentBlockNum − MultiChainMaxBlockDifference<br/>(sepolia = 8)"]

    A2 --> A3{"lastSyncBlock > safeEndBlock ?"}
    A3 -- "是（已追平）" --> A4["sleep 10s<br/>SleepInterval"]
    A4 --> L

    A3 -- "否" --> B1["availableBlocks =<br/>safeEndBlock − lastSyncBlock + 1"]

    B1 --> B2{"availableBlocks >=<br/>MinSyncBlocks (500) ?"}
    B2 -- "是（落后多）" --> B3["endBlock =<br/>startBlock + SyncBlockPeriod(1000)<br/>但不超过 safeEndBlock"]
    B2 -- "否（接近链头）" --> B4["endBlock = safeEndBlock"]

    B3 --> C1["FilterQuery{<br/>FromBlock: startBlock,<br/>ToBlock: endBlock,<br/>Addresses: [DexAddress]<br/>}"]
    B4 --> C1

    C1 --> C2["chainClient.FilterLogs()<br/>eth_getLogs"]

    C2 --> C3{"成功?"}
    C3 -- "RPC 报错" --> C4{"范围 > 1 块?"}
    C4 -- "是" --> C5["收缩到单块重试"]
    C5 --> C2
    C4 -- "否" --> C6["sleep 10s"] --> L

    C3 -- "成功" --> D1["遍历 logs"]

    D1 --> D2{"Topics[0] 匹配"}
    D2 --> E1["LogMakeTopic<br/>handleMakeEvent"]
    D2 --> E2["LogCancelTopic<br/>handleCancelEvent"]
    D2 --> E3["LogMatchTopic<br/>handleMatchEvent"]
    D2 --> E4["ERC721ApprovalTopic<br/>handleApprovalEvent"]
    D2 --> E5["default: 忽略"]

    E1 & E2 & E3 & E4 --> F1["lastSyncBlock = endBlock + 1"]
    F1 --> F2["UPDATE ob_indexed_status<br/>SET last_indexed_block = ?"]
    F2 --> F3["log: start_block / end_block"]
    F3 --> L
```

**参数含义**

| 常量 | 值 | 作用 |
|---|---|---|
| `SleepInterval` | 10s | 追平链头后的轮询间隔 |
| `MultiChainMaxBlockDifference["sepolia"]` | 8 | 等 8 个区块确认，防重组 |
| `MinSyncBlocks` | 500 | 低于此值走「实时」模式，一轮只扫到链头 |
| `SyncBlockPeriod` | 1000 | 落后时每批最多扫 1000 块 |
| `EventIndexType` | 6 | `ob_indexed_status.index_type` 的取值 |

---

## 四、单个事件的处理流程

```mermaid
flowchart TB
    subgraph common["所有处理器共有的前置步骤"]
        P1["checkAndHandleFork(blockNumber, txHash)"] --> P2{"ob_activity 中<br/>同 tx_hash 但<br/>block_number 不同?"}
        P2 -- "否" --> P3["继续解析"]
        P2 -- "是（发生重组）" --> P4["rollbackOrderStatus(txHash)<br/>按活动类型反向恢复订单/item"]
        P4 --> P5["DELETE ob_activity<br/>WHERE tx_hash = ?"]
        P5 --> P3
        P3 --> P6["parsedAbi.UnpackIntoInterface<br/>解析 log.Data"]
        P7["indexed 字段从 Topics[1..3] 手工读取"]
    end

    common --> M1

    subgraph make["handleMakeEvent (挂单)"]
        M1["side = Topics[1]<br/>saleKind = Topics[2]<br/>maker = Topics[3]"] --> M2["确定 orderType<br/>侧=Bid → ItemBid/CollectionBid<br/>侧=List → Listing"]
        M2 --> M3["INSERT ob_order_* (OnConflict DoNothing)"]
        M3 --> M4["INSERT ob_item_* (OnConflict DoNothing)"]
        M4 --> M5["createItemExternal()<br/>拉 tokenURI 写元数据"]
        M5 --> M6{"side == List ?"}
        M6 -- "是" --> M7["syncItemOnListing()<br/>更新 list_price / list_time / owner"]
        M7 --> M8["maintainCollectionAndItem()<br/>维护 collection 与地板价"]
        M6 -- "否" --> M9["跳过 item 上架维护"]
        M8 & M9 --> M10["BlockTimeByNumber()<br/>额外一次 RPC 取区块时间"]
        M10 --> M11["INSERT ob_activity_*<br/>activity_type = Listing(3)"]
        M11 --> M12["Redis: AddUpdatePriceEvent"]
    end

    subgraph match["handleMatchEvent (成交)"]
        T1["makeOrderId = Topics[1]<br/>takeOrderId = Topics[2]"] --> T2["按 side 判断谁是卖单方<br/>确定 owner / from / to / sellOrderId"]
        T2 --> T3["UPDATE ob_order_*<br/>order_status = Filled"]
        T3 --> T4["UPDATE ob_item_*<br/>owner = 买家"]
        T4 --> T5["INSERT ob_activity_*<br/>activity_type = Sale(7)"]
        T5 --> T6["syncItemOnMatchOrCancel()<br/>list_price 清零"]
    end

    subgraph cancel["handleCancelEvent (撤单)"]
        C1["orderId = Topics[1]"] --> C2["UPDATE ob_order_*<br/>order_status = Cancelled(3)"]
        C2 --> C3["SELECT 该订单详情"]
        C3 --> C4["INSERT ob_activity_*<br/>activity_type = CancelListing(4)<br/>/ CancelItemBid(17) / CancelCollectionBid(16)"]
        C4 --> C5{"order_type == Listing ?"}
        C5 -- "是" --> C6["syncItemOnMatchOrCancel()<br/>list_price 清 0"]
        C5 -- "否" --> C7["不动 item"]
    end

    subgraph appr["handleApprovalEvent (授权)"]
        A1["记录 ERC721 Approval 事件"] --> A2["检查授权状态<br/>供前端判断能否挂单"]
    end
```

> **注意**：`handleCancelEvent` 只把 `order_status` 改成 cancelled，**不会**从 Vault 取回 NFT —— 那是链上 `cancelOrders` 事务本身完成的，同步服务只是事后记录。若订单只是**过期**而没有实际撤单，`NFTBalance` 仍留在 Vault，这就是 `#4`/`#5` 卡住的原因。

---

## 五、数据流：链上 → DB → 前端

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户钱包
    participant OB as OrderBook 合约
    participant VA as Vault 合约
    participant SY as EasySwapSync
    participant DB as MySQL
    participant BE as Backend :8083
    participant FE as 前端 /nft

    U->>OB: makeOrders([List 订单])
    OB->>VA: depositNFT(orderKey, ...)
    VA-->>VA: NFT 转入 Vault 托管
    OB-->>OB: emit LogMake(...)

    Note over SY: 每 10s 轮询，等 8 个区块确认
    SY->>OB: eth_getLogs(DexAddress, start..end)
    OB-->>SY: logs[] (LogMake)
    SY->>SY: checkAndHandleFork()
    SY->>SY: ABI 解析 event
    SY->>DB: INSERT ob_order_sepolia
    SY->>DB: INSERT ob_item_sepolia
    SY->>OB: tokenURI(tokenId) ← 额外 RPC
    SY->>DB: INSERT ob_item_external_sepolia
    SY->>DB: UPDATE list_price / list_time
    SY->>OB: eth_getBlockByNumber ← 取 blockTime
    SY->>DB: INSERT ob_activity_sepolia
    SY->>DB: UPDATE ob_indexed_status
    SY->>DB: Redis 投递价格事件

    FE->>BE: GET /portfolio/items
    BE->>DB: SELECT ... list_order_id
    DB-->>BE: rows
    BE-->>FE: JSON

    Note over FE: 前端显示延迟 ≈<br/>10s 轮询 + 8 块确认<br/>实测 10~30 秒
```

---

## 六、断点与容错

```mermaid
flowchart LR
    subgraph bp["断点持久化"]
        B1["ob_indexed_status<br/>chain_id=11155111<br/>index_type=6<br/>last_indexed_block"] --> B2["每批处理完立即 UPDATE"]
        B2 --> B3["重启后从断点继续<br/>不重扫全链"]
    end

    subgraph fa["容错"]
        F1["RPC 失败"] --> F2["范围收缩到单块重试"]
        F2 --> F3["仍失败 → sleep 10s 后重来"]
        F3 --> F4["不推进断点，数据不丢"]
    end

    subgraph rc["重组处理"]
        R1["LogMake/Cancel/Match<br/>都先调 checkAndHandleFork"] --> R2["同 tx_hash 出现在<br/>不同 block_number"]
        R2 --> R3["rollbackOrderStatus()<br/>Sale → order 恢复 active<br/>quantity_remaining + 1<br/>item.owner 回退"]
        R3 --> R4["DELETE 已失效的 activity"]
    end
```

---

## 七、涉及的数据库表

| 表 | 写入时机 | 关键字段 |
|---|---|---|
| `ob_order_sepolia` | LogMake 插入；Match/Cancel 更新 | `order_id`(orderKey)、`order_status`、`order_type` |
| `ob_item_sepolia` | LogMake 插入；Match 更新 owner | `owner`、`list_price`、`supply` |
| `ob_item_external_sepolia` | LogMake 后拉 tokenURI | `image_uri`、`oss_uri`、`meta_data_uri` |
| `ob_activity_sepolia` | 四类事件都写 | `activity_type`、`tx_hash`、`event_time` |
| `ob_collection_sepolia` | 维护地板价 | `floor_price` |
| `ob_collection_floor_price_sepolia` | 每日定时任务 | `price`、`event_time` |
| `ob_indexed_status` | 每批结束 | `last_indexed_block`（断点） |

**`activity_type` 取值**

| 值 | 含义 | 值 | 含义 |
|---:|---|---:|---|
| 1 | Buy | 7 | **Sale** |
| 2 | Mint | 8 | Transfer |
| 3 | **Listing** | 9 | CollectionBid |
| 4 | **CancelListing** | 10 | **ItemBid** |
| 5 | CancelOffer | 16 | CancelCollectionBid |
| 6 | MakeOffer | 17 | **CancelItemBid** |

---

## 八、为什么挂单后要等 10~30 秒

```mermaid
flowchart LR
    A["用户签名<br/>挂单交易"] --> B["上链"]
    B --> C["等 8 个区块确认<br/>MultiChainMaxBlockDifference"]
    C --> D["最多 10 秒轮询间隔<br/>SleepInterval"]
    D --> E["eth_getLogs"]
    E --> F["解析 + 写库<br/>多次 RPC / INSERT"]
    F --> G["前端刷新可见"]

    style C fill:#ffe0b2
    style D fill:#ffe0b2
    style F fill:#ffe0b2
```

三个叠加因素：

1. **8 个区块确认** —— 防重组，`safeEndBlock = current - 8`
2. **10 秒轮询** —— 追平后每次都 sleep
3. **接近链头时一次只扫到 `safeEndBlock`** —— 不会跨大步追赶

---

## 九、文件索引

| 路径 | 职责 |
|---|---|
| `EasySwapSync/main.go` | 程序入口 |
| `EasySwapSync/cmd/daemon.go` | `daemon` 子命令、信号处理、优雅退出 |
| `EasySwapSync/cmd/root.go` | cobra 根命令 |
| `EasySwapSync/service/service.go` | 依赖组装、`Start()` 拉起四条循环 |
| **`EasySwapSync/service/orderbookindexer/service.go`** | **核心 1665 行：扫块 + 四个事件处理器** |
| `EasySwapSync/service/config/config.go` | TOML 配置结构 |
| `EasySwapSync/service/collectionfilter/filter.go` | 启动时预载需要索引的 collection |
| `EasySwapBase/ordermanager/service.go` | `OrderManager.Start()` 四个子循环 |
| `EasySwapBase/ordermanager/expiredorder.go` | 时间轮，每秒检查订单过期 |
| `EasySwapBase/stores/gdb/orderbookmodel/multi/` | 表名映射与 model 定义 |
