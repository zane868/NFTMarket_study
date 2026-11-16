import { ethers } from "ethers";
import EasySwapOrderBookABI from '../abis/EasySwapOrderBook.sol/EasySwapOrderBook.json';
import { parseEther } from "ethers";
import { TX_MESSAGE_EVENT, type TxMessageDetail } from "@/lib/tx-message";

// 定义枚举类型 - 与合约保持一致
export enum Side {
    List = 0,
    Bid = 1
}

export enum SaleKind {
    FixedPriceForCollection = 0,
    FixedPriceForItem = 1
}

// 定义接口类型 - 与合约结构保持一致
export interface Asset {
    tokenId: string | number;
    collection: string;
    amount: number; // 对应合约中的uint96
}

export interface Order {
    side: Side;
    saleKind: SaleKind;
    maker: string;
    nft: Asset;
    price: bigint;  // 对应合约中的Price(uint128)
    expiry: number; // 对应合约中的uint64
    salt: number;   // 对应合约中的uint64
}

// 合约地址（Sepolia）
// 注意：OrderBook 与 Vault 不是同一个地址。
const ORDERBOOK_CONTRACT_ADDRESS = "0xB6097Da347e172f08B09A8c9416d483592A92B5c";
export const VAULT_CONTRACT_ADDRESS = "0x3AD0D396b5CEEA8E941186f7Ede88Aa2f51099bc";

function emitTxMessage(detail: TxMessageDetail) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(TX_MESSAGE_EVENT, { detail }));
}

async function resolveChainId(signer: ethers.Signer): Promise<number> {
    try {
        const network = await signer.provider?.getNetwork();
        return Number(network?.chainId || 11155111);
    } catch {
        return 11155111;
    }
}

/**
 * 授权NFT给Vault合约
 * @param signer ethers signer 实例
 * @param nftContractAddress NFT合约地址
 * @param tokenId 可选的特定token ID，不传则授权全部
 */
export async function approveNFT(
    signer: ethers.Signer,
    nftContractAddress: string,
    tokenId?: string | number
) {
    try {
        // ERC721标准接口
        const nftContract = new ethers.Contract(
            nftContractAddress,
            [
                'function approve(address to, uint256 tokenId) external',
                'function setApprovalForAll(address operator, bool approved) external',
                'function getApproved(uint256 tokenId) external view returns (address)',
                'function isApprovedForAll(address owner, address operator) external view returns (bool)',
                'function ownerOf(uint256 tokenId) external view returns (address)'
            ],
            signer
        );

        if (tokenId !== undefined) {
            // 授权特定token
            const tx = await nftContract.approve(VAULT_CONTRACT_ADDRESS, tokenId);
            await tx.wait();
            return tx.hash;
        } else {
            // 授权全部tokens
            const tx = await nftContract.setApprovalForAll(VAULT_CONTRACT_ADDRESS, true);
            await tx.wait();
            return tx.hash;
        }
    } catch (error: any) {
        throw new Error(`NFT授权失败: ${error.message}`);
    }
}

/**
 * 检查NFT是否已授权
 * @param signer ethers signer 实例
 * @param nftContractAddress NFT合约地址
 * @param owner NFT拥有者地址
 * @param tokenId 可选的特定token ID
 */
export async function checkNFTApproval(
    signer: ethers.Signer,
    nftContractAddress: string,
    owner: string,
    tokenId?: string | number
): Promise<boolean> {
    try {
        const nftContract = new ethers.Contract(
            nftContractAddress,
            [
                'function getApproved(uint256 tokenId) external view returns (address)',
                'function isApprovedForAll(address owner, address operator) external view returns (bool)'
            ],
            signer
        );

        // 检查全部授权
        const isApprovedForAll = await nftContract.isApprovedForAll(owner, VAULT_CONTRACT_ADDRESS);
        if (isApprovedForAll) {
            return true;
        }

        // 如果指定了tokenId，检查特定token的授权
        if (tokenId !== undefined) {
            const approvedAddress = await nftContract.getApproved(tokenId);
            return approvedAddress.toLowerCase() === VAULT_CONTRACT_ADDRESS.toLowerCase();
        }

        return false;
    } catch (error: any) {
        console.error('检查NFT授权失败:', error);
        return false;
    }
}

/**
 * 获取订单合约实例
 * @param signer ethers signer 实例
 */
function getOrderBookContract(signer: ethers.Signer) {
    const contract = new ethers.Contract(
        ORDERBOOK_CONTRACT_ADDRESS,
        EasySwapOrderBookABI.abi,
        signer
    );
    return contract;
}

/**
 * 创建NFT订单
 * @param signer ethers signer 实例
 * @param orders 订单数组
 * @param options 交易选项
 */
export async function makeOrders(
    signer: ethers.Signer,
    orders: Order[],
    options: {
        value?: string;  // 如果是买单需要支付ETH
        autoApprove?: boolean; // 是否自动授权NFT
    } = {}
) {
    const chainId = await resolveChainId(signer);
    try {
        const contract = getOrderBookContract(signer);
        const signerAddress = await signer.getAddress();
        
        // 验证订单数据
        for (const order of orders) {
            if (!ethers.isAddress(order.maker)) {
                throw new Error('无效的maker地址');
            }
            if (!ethers.isAddress(order.nft.collection)) {
                throw new Error('无效的NFT合约地址');
            }
            if (order.maker.toLowerCase() !== signerAddress.toLowerCase()) {
                throw new Error('Order maker必须是当前签名者');
            }
            if (order.price <= 0) {
                throw new Error('价格必须大于0');
            }
            if (order.salt === 0) {
                throw new Error('Salt不能为0');
            }
            if (order.expiry !== 0 && order.expiry <= Math.floor(Date.now() / 1000)) {
                throw new Error('过期时间必须大于当前时间');
            }
        }

        // 如果是挂单(List)，检查并授权NFT
        const listOrders = orders.filter(order => order.side === Side.List);
        if (listOrders.length > 0 && options.autoApprove) {
            for (const order of listOrders) {
                const isApproved = await checkNFTApproval(
                    signer,
                    order.nft.collection,
                    order.maker,
                    order.nft.tokenId
                );
                
                if (!isApproved) {
                    console.log(`正在授权NFT: ${order.nft.collection} #${order.nft.tokenId}`);
                    await approveNFT(signer, order.nft.collection, order.nft.tokenId);
                }
            }
        }

        // 调用合约方法
        // 处理value参数：如果是字符串（ETH值），转换为bigint（wei）
        const value = options.value ? parseEther(options.value) : parseEther('0');
        const tx = await contract.makeOrders(orders, {
            value: value,
        });
        emitTxMessage({
            type: "pending",
            title: "交易提交中",
            description: "订单交易已发送，等待链上确认...",
            txHash: tx.hash,
            chainId,
        });

        // 等待交易确认
        const receipt = await tx.wait();
        emitTxMessage({
            type: "success",
            title: "交易成功",
            description: "订单已上链确认",
            txHash: receipt.hash,
            chainId,
        });

        // 从事件中获取订单ID
        const orderKeys = receipt.logs
            ?.filter((log: any) => {
                try {
                    const parsed = contract.interface.parseLog(log);
                    return parsed?.name === 'LogMake';
                } catch {
                    return false;
                }
            })
            ?.map((log: any) => {
                const parsed = contract.interface.parseLog(log);
                return parsed?.args.orderKey;
            });

        return {
            orderKeys,
            transactionHash: receipt.hash
        };

    } catch (error: any) {
        emitTxMessage({
            type: "error",
            title: "交易失败",
            description: error?.message || "未知错误",
            chainId,
        });
        throw new Error(`创建订单失败: ${error.message}`);
    }
}

// ---------------------------------------------------------------------------
// 订单 key 计算（与 LibOrder.hash 保持一致，用于查询 filledAmount）
// ---------------------------------------------------------------------------

/**
 * 把合约返回的只读结构体（ethers 的 Result）转成普通对象。
 *
 * ethers v6 的返回值是 frozen 的 Result/数组，直接传给写函数的参数位置时，
 * populateTransaction 摊平 tuple 会尝试 `obj[0] = ...`，于是抛
 * "Cannot assign to read only property '0' of object '[object Object]'"。
 */
export function toPlainOrder(order: any): Order {
    return {
        side: Number(order.side) as Side,
        saleKind: Number(order.saleKind) as SaleKind,
        maker: order.maker,
        nft: {
            tokenId: order.nft.tokenId.toString(),
            collection: order.nft.collection,
            amount: Number(order.nft.amount),
        },
        price: BigInt(order.price.toString()),
        expiry: Number(order.expiry),
        salt: Number(order.salt),
    };
}

const ASSET_TYPEHASH = ethers.id(
    "Asset(uint256 tokenId,address collection,uint96 amount)"
);
const ORDER_TYPEHASH = ethers.id(
    "Order(uint8 side,uint8 saleKind,address maker,Asset nft,uint128 price,uint64 expiry,uint64 salt)" +
        "Asset(uint256 tokenId,address collection,uint96 amount)"
);

/**
 * 复现合约里的 OrderKey = keccak256(abi.encodePacked(...))。
 * 注意：这不是 EIP-712 类型化哈希，而是 LibOrder 的自定义打包哈希，
 * 所以 side / saleKind 按 1 字节打包，price 16 字节，expiry / salt 各 8 字节。
 */
export function computeOrderKey(order: {
    side: Side;
    saleKind: SaleKind;
    maker: string;
    nft: { tokenId: string | number; collection: string; amount: number | bigint };
    price: bigint | string | number;
    expiry: number | bigint;
    salt: number | bigint;
}): string {
    const assetHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "uint256", "address", "uint96"],
            [ASSET_TYPEHASH, order.nft.tokenId, order.nft.collection, order.nft.amount]
        )
    );

    return ethers.solidityPackedKeccak256(
        ["bytes32", "uint8", "uint8", "address", "bytes32", "uint128", "uint64", "uint64"],
        [
            ORDER_TYPEHASH,
            order.side,
            order.saleKind,
            order.maker,
            assetHash,
            order.price,
            order.expiry,
            order.salt,
        ]
    );
}

/**
 * 查找该 NFT 当前真正可成交的卖单。
 *
 * 为什么不直接用 getBestOrder：`OrderStorage.getBestOrder()` 只过滤方向、
 * saleKind、tokenId 和过期时间，**不检查 filledAmount**。所以某个价格档的
 * 最便宜订单一成交，getBestOrder 仍会返回它，此时 matchOrder 会因
 * "HD: order closed" 而 revert。
 *
 * 这里改为：用 getOrders 取一批候选 → 计算 orderKey → 逐个查 filledAmount
 * → 返回第一个「未成交且未过期且不是自己挂的」订单。
 */
export async function findMatchableListing(
    signer: ethers.Signer,
    collection: string,
    tokenId: string | number,
    count: number = 10
) {
    const contract = getOrderBookContract(signer);
    const buyer = (await signer.getAddress()).toLowerCase();
    const now = Math.floor(Date.now() / 1000);

    const result = await contract.getOrders(
        collection,
        tokenId,
        Side.List,
        SaleKind.FixedPriceForItem,
        count,
        0,
        ethers.ZeroHash
    );
    const candidates: any[] = Array.from(result[0] || []);

    for (const order of candidates) {
        // getOrders 返回定长数组，尾部是零值填充，用 maker 判空
        if (!order?.maker || order.maker === ethers.ZeroAddress) continue;
        if (order.maker.toLowerCase() === buyer) continue; // 不能买自己的挂单
        if (BigInt(order.price) === BigInt(0)) continue;

        const expiry = Number(order.expiry);
        if (expiry !== 0 && expiry < now) continue;

        const orderKey = computeOrderKey({
            side: Number(order.side) as Side,
            saleKind: Number(order.saleKind) as SaleKind,
            maker: order.maker,
            nft: {
                tokenId: order.nft.tokenId,
                collection: order.nft.collection,
                amount: order.nft.amount,
            },
            price: order.price,
            expiry,
            salt: order.salt,
        });

        const filled = await contract.filledAmount(orderKey);
        if (BigInt(filled) < BigInt(order.nft.amount)) {
            // 必须转成普通对象：ethers 返回的 Result 是 frozen 的，
            // 直接放进 matchOrder 参数会触发只读属性赋值错误。
            return toPlainOrder(order);
        }
    }

    return null;
}

/**
 * 立即购买：买家按卖单价直接吃掉一张挂单。
 *
 * 合约侧走的是 `_matchOrder` 的第二个分支（msg.sender == buyOrder.maker），
 * 买家需要临时构造一张 Bid 订单，但它不用事先挂到订单簿上——钱随本次
 * 交易以 msg.value 带入，成交价取卖单价，多付部分会退回。
 *
 * 价格直接取卖单价，所以 buyPrice == fillPrice，不会触发差价退款。
 */
export async function buyNow(
    signer: ethers.Signer,
    params: {
        collection: string;
        tokenId: string | number;
        expirySeconds?: number;
    }
): Promise<{ transactionHash: string; sellOrder: any; buyOrder: Order }> {
    const chainId = await resolveChainId(signer);
    try {
        const contract = getOrderBookContract(signer);
        const signerAddress = await signer.getAddress();
        const expirySeconds = params.expirySeconds ?? 30 * 24 * 60 * 60; // 默认 30 天

        const sellOrder = await findMatchableListing(
            signer,
            params.collection,
            params.tokenId
        );
        if (!sellOrder) {
            throw new Error("当前没有可购买的挂单（可能已成交、已取消或已过期）");
        }
        if (sellOrder.maker.toLowerCase() === signerAddress.toLowerCase()) {
            throw new Error("不能购买自己的挂单");
        }

        const price = BigInt(sellOrder.price.toString());

        // 临时买单：不入簿，仅用于本次撮合，价格与卖单一致
        const buyOrder: Order = {
            side: Side.Bid,
            saleKind: SaleKind.FixedPriceForItem,
            maker: signerAddress,
            nft: {
                tokenId: sellOrder.nft.tokenId.toString(),
                collection: sellOrder.nft.collection,
                amount: Number(sellOrder.nft.amount),
            },
            price,
            expiry: Math.floor(Date.now() / 1000) + expirySeconds,
            salt: Date.now(),
        };

        const tx = await contract.matchOrder(sellOrder, buyOrder, {
            value: price,
        });

        emitTxMessage({
            type: "pending",
            title: "购买中",
            description: "购买交易已发送，等待链上确认...",
            txHash: tx.hash,
            chainId,
        });

        const receipt = await tx.wait();
        emitTxMessage({
            type: "success",
            title: "购买成功",
            description: "NFT 已转入你的钱包，ETH 已转给卖家",
            txHash: receipt.hash,
            chainId,
        });

        return { transactionHash: receipt.hash, sellOrder, buyOrder };
    } catch (error: any) {
        const message = normalizeBuyError(error);
        emitTxMessage({
            type: "error",
            title: "购买失败",
            description: message,
            chainId,
        });
        throw new Error(`购买失败: ${message}`);
    }
}

/** 把合约 revert 信息翻译成用户能看懂的话 */
function normalizeBuyError(error: any): string {
    const raw = error?.shortMessage || error?.reason || error?.message || "未知错误";
    if (raw.includes("user rejected")) return "用户取消了交易";
    if (raw.includes("insufficient funds")) return "ETH 余额不足";
    if (raw.includes("HD: order closed")) return "该挂单已被成交，请刷新后重试";
    if (raw.includes("HD: value < fill price")) return "支付金额不足";
    if (raw.includes("HD: same maker")) return "不能购买自己的挂单";
    if (raw.includes("OVa: expired")) return "该挂单已过期";
    if (raw.includes("OVa: canceled")) return "该挂单已取消";
    if (raw.includes("HD: asset mismatch")) return "订单资产不匹配";
    return raw;
}


/**
 * 创建出价（Bid）订单：买家为某个 NFT 出价，ETH 会锁进 Vault。
 * @param signer        ethers signer
 * @param collection    NFT 合约地址
 * @param tokenId       token ID
 * @param priceEth      出价金额（ETH，十进制字符串）
 * @param expirySeconds 过期时间（秒），默认 7 天
 */
export async function makeBid(
    signer: ethers.Signer,
    collection: string,
    tokenId: string | number,
    priceEth: string,
    expirySeconds?: number
) {
    const chainId = await resolveChainId(signer);
    const expiry = expirySeconds || Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const price = parseEther(priceEth);

    const order: Order = {
        side: Side.Bid,
        saleKind: SaleKind.FixedPriceForItem,
        maker: await signer.getAddress(),
        nft: {
            tokenId,
            collection,
            amount: 1,
        },
        price,
        expiry,
        salt: Date.now(),
    };

    try {
        const result = await makeOrders(signer, [order], {
            value: priceEth,
            autoApprove: false,
        });
        return result;
    } catch (error: any) {
        emitTxMessage({
            type: "error",
            title: "出价失败",
            description: error?.message || "未知错误",
            chainId,
        });
        throw error;
    }
}

/**
 * 接受出价（matchOrder）：卖家用自己的挂单匹配买家的出价。
 * NFT 从卖家转到买家，ETH 从买家转到卖家。
 */
export async function matchBid(
    signer: ethers.Signer,
    sellOrder: {
        maker: string;
        nft: { tokenId: string | number; collection: string; amount: number };
        price: string;
        expiry: number;
        salt: number;
    },
    buyOrder: {
        maker: string;
        nft: { tokenId: string | number; collection: string; amount: number };
        price: string;
        expiry: number;
        salt: number;
    }
) {
    const chainId = await resolveChainId(signer);
    try {
        const contract = getOrderBookContract(signer);

        const sell = {
            side: Side.List,
            saleKind: SaleKind.FixedPriceForItem,
            maker: sellOrder.maker,
            nft: {
                tokenId: sellOrder.nft.tokenId,
                collection: sellOrder.nft.collection,
                amount: sellOrder.nft.amount,
            },
            price: sellOrder.price,
            expiry: sellOrder.expiry,
            salt: sellOrder.salt,
        };

        const buy = {
            side: Side.Bid,
            saleKind: SaleKind.FixedPriceForItem,
            maker: buyOrder.maker,
            nft: {
                tokenId: buyOrder.nft.tokenId,
                collection: buyOrder.nft.collection,
                amount: buyOrder.nft.amount,
            },
            price: buyOrder.price,
            expiry: buyOrder.expiry,
            salt: buyOrder.salt,
        };

        const tx = await contract.matchOrder(sell, buy);
        emitTxMessage({
            type: "pending",
            title: "接受出价中",
            description: "成交交易已发送，等待链上确认...",
            txHash: tx.hash,
            chainId,
        });

        const receipt = await tx.wait();
        emitTxMessage({
            type: "success",
            title: "成交成功",
            description: "NFT 已转移给买家，ETH 已转给卖家",
            txHash: receipt.hash,
            chainId,
        });

        return {
            transactionHash: receipt.hash,
            status: receipt.status === 1 ? "confirmed" : "failed",
        };
    } catch (error: any) {
        emitTxMessage({
            type: "error",
            title: "成交失败",
            description: error?.message || "未知错误",
            chainId,
        });
        throw error;
    }
}

/**
 * 取消挂单（cancelOrder）：释放 Vault 中锁定的 NFT/ETH。
 * @param orderKey 订单哈希（bytes32）
 */
export async function cancelOrder(signer: ethers.Signer, orderKey: string) {
    const chainId = await resolveChainId(signer);
    try {
        const contract = getOrderBookContract(signer);
        const tx = await contract.cancelOrders([orderKey]);
        emitTxMessage({
            type: "pending",
            title: "撤单中",
            description: "撤单交易已发送，等待链上确认...",
            txHash: tx.hash,
            chainId,
        });
        const receipt = await tx.wait();
        emitTxMessage({
            type: "success",
            title: "撤单成功",
            description: "NFT 已退回钱包",
            txHash: receipt.hash,
            chainId,
        });
        return {
            transactionHash: receipt.hash,
            status: receipt.status === 1 ? "confirmed" : "failed",
        };
    } catch (error: any) {
        emitTxMessage({
            type: "error",
            title: "撤单失败",
            description: error?.message || "未知错误",
            chainId,
        });
        throw error;
    }
}

/**
 * 编辑挂单（editOrder）：取消旧订单 + 创建新订单，一步完成。
 */
export async function editOrder(
    signer: ethers.Signer,
    oldOrderKey: string,
    newPriceEth: string,
    collection: string,
    tokenId: string | number,
    maker: string,
    oldExpiry: number,
    oldSalt: number,
) {
    const chainId = await resolveChainId(signer);
    try {
        const contract = getOrderBookContract(signer);
        const price = parseEther(newPriceEth);
        const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

        const newOrder = {
            side: Side.List,
            saleKind: SaleKind.FixedPriceForItem,
            maker,
            nft: { tokenId, collection, amount: 1 },
            price,
            expiry,
            salt: Date.now(),
        };

        const detail = { oldOrderKey, newOrder };
        const tx = await contract.editOrders([detail]);
        emitTxMessage({
            type: "pending",
            title: "修改价格中",
            description: "改价交易已发送，等待链上确认...",
            txHash: tx.hash,
            chainId,
        });
        const receipt = await tx.wait();
        emitTxMessage({
            type: "success",
            title: "改价成功",
            description: "挂单价格已更新",
            txHash: receipt.hash,
            chainId,
        });
        return {
            transactionHash: receipt.hash,
            status: receipt.status === 1 ? "confirmed" : "failed",
        };
    } catch (error: any) {
        emitTxMessage({
            type: "error",
            title: "改价失败",
            description: error?.message || "未知错误",
            chainId,
        });
        throw error;
    }
}

export default class OrderBookContract {
    private contract: ethers.Contract | null;
    private signer: ethers.Signer | null;

    constructor(signer?: ethers.Signer) {
        this.contract = null;
        this.signer = signer || null;
    }

    /**
     * 设置 signer
     * @param signer ethers signer 实例
     */
    setSigner(signer: ethers.Signer) {
        this.signer = signer;
        this.contract = getOrderBookContract(signer);
    }

    private ensureInitialized() {
        if (!this.signer || !this.contract) {
            throw new Error('OrderBookContract 未初始化，请先调用 setSigner()');
        }
    }

    public async getOrders(params: {
        collection: string,
        tokenId: number,
        side: number,      // 0: buy, 1: sell
        saleKind: number,  // 通常是固定价格或拍卖
        count: number,     // 想要获取的订单数量
        price?: bigint,
        firstOrderKey?: string
    }) {
        this.ensureInitialized();
        const zeroBytes32 = '0x' + '0'.repeat(64);

        const orders = await this.contract!.getOrders(
            params.collection,
            params.tokenId,
            params.side,
            params.saleKind,
            params.count,
            params.price || BigInt(0),    // 如果不需要价格过滤，传null
            params.firstOrderKey || zeroBytes32  // 如果是第一次查询，传null
        );
        
        // 处理返回的订单数据
        const formattedOrders = orders.resultOrders.map((order: any) => {
            return {
                maker: order.maker,
                nftContract: order.nft.collection,
                tokenId: order.nft.tokenId.toString(),
                price: ethers.formatEther(order.price),
                side: order.side,
                expiry: new Date(Number(order.expiry) * 1000).toLocaleString(),
                // 其他字段根据实际返回数据结构添加
            };
        });

        return {
            orders: formattedOrders,
            nextOrderKey: orders.nextOrderKey  // 用于分页查询
        };
    }

    async createOrder(orders: any[]) {
        this.ensureInitialized();
        const tx = await this.contract!.makeOrders(orders);
        return tx;
    }
}