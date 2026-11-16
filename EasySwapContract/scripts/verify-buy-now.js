// 端到端验证前端购买流程的前提假设：
// 1. getOrders 返回的是定长数组（尾部零值填充），前端按 maker 判空
// 2. getBestOrder 确实不过滤 filledAmount —— 已成交的最低价订单仍会被返回（坑）
// 3. 用 computeOrderKey 计算 key 后查 filledAmount，能正确识别"不可买"与"可买"
// 4. matchOrder 由买家直接调用可成功，NFT 从 Vault 转给买家
const { ethers, upgrades } = require("hardhat")
const { toBn } = require("evm-bn")
const { Side, SaleKind } = require("../test/common")
const { id, keccak256, defaultAbiCoder, solidityPack } = ethers.utils

function computeOrderKey(order) {
    const ASSET_TYPEHASH = id("Asset(uint256 tokenId,address collection,uint96 amount)")
    const ORDER_TYPEHASH = id(
        "Order(uint8 side,uint8 saleKind,address maker,Asset nft,uint128 price,uint64 expiry,uint64 salt)" +
        "Asset(uint256 tokenId,address collection,uint96 amount)"
    )
    const assetHash = keccak256(
        defaultAbiCoder.encode(
            ["bytes32", "uint256", "address", "uint96"],
            [ASSET_TYPEHASH, order.nft[0], order.nft[1], order.nft[2]]
        )
    )
    return keccak256(
        solidityPack(
            ["bytes32", "uint8", "uint8", "address", "bytes32", "uint128", "uint64", "uint64"],
            [ORDER_TYPEHASH, order.side, order.saleKind, order.maker, assetHash, order.price, order.expiry, order.salt]
        )
    )
}

// 与前端 findMatchableListing 等价的逻辑
async function findMatchableListing(esDex, collection, tokenId, buyer, count = 10) {
    const now = Math.floor(Date.now() / 1000)
    const [orders] = await esDex.getOrders(
        collection, tokenId, Side.List, SaleKind.FixedPriceForItem,
        count, 0, ethers.constants.HashZero
    )
    for (const o of orders) {
        if (!o.maker || o.maker === ethers.constants.AddressZero) continue
        if (o.maker.toLowerCase() === buyer.toLowerCase()) continue
        if (BigInt(o.price.toString()) === 0n) continue
        const expiry = Number(o.expiry)
        if (expiry !== 0 && expiry < now) continue
        const key = computeOrderKey({
            side: o.side, saleKind: o.saleKind, maker: o.maker,
            nft: [o.nft.tokenId, o.nft.collection, o.nft.amount],
            price: o.price, expiry, salt: o.salt,
        })
        const filled = await esDex.filledAmount(key)
        if (BigInt(filled.toString()) < BigInt(o.nft.amount.toString())) return o
    }
    return null
}

async function main() {
    const [owner, buyer] = await ethers.getSigners()

    const Vault = await ethers.getContractFactory("EasySwapVault")
    const Dex = await ethers.getContractFactory("EasySwapOrderBook")
    const ERC721 = await ethers.getContractFactory("TestERC721")

    const vault = await upgrades.deployProxy(Vault, { initializer: "initialize" })
    const erc721 = await ERC721.deploy()
    const dex = await upgrades.deployProxy(Dex, [200, vault.address, "EasySwapOrderBook", "1"], {
        initializer: "initialize",
    })
    await vault.setOrderBook(dex.address)

    const collection = erc721.address
    await erc721.mint(owner.address, 1)
    await erc721.setApprovalForAll(vault.address, true)

    const now = Math.floor(Date.now() / 1000) + 100000
    // 两张卖单：tokenId=1 挂 0.01 和 0.02，0.01 是更优价
    const cheap = {
        side: Side.List, saleKind: SaleKind.FixedPriceForItem, maker: owner.address,
        nft: [1, collection, 1], price: toBn("0.01"), expiry: now, salt: 11,
    }
    await dex.connect(owner).makeOrders([cheap])

    // --- 假设 1：getOrders 是定长数组，尾部零值填充 ---
    const [orders] = await dex.getOrders(
        collection, 1, Side.List, SaleKind.FixedPriceForItem, 5, 0, ethers.constants.HashZero
    )
    console.log("getOrders 条数:", orders.length,
        "| 有效订单:", orders.filter((o) => o.maker !== ethers.constants.AddressZero).length)
    console.log("  第一条 maker:", orders[0].maker, "price:", orders[0].price.toString())
    console.log("  尾部填充项 maker:", orders[4].maker, "price:", orders[4].price.toString())

    // --- 假设 2/3：成交后 getBestOrder 仍返回旧单，但 filledAmount 能识别 ---
    const buyOrder = {
        side: Side.Bid, saleKind: SaleKind.FixedPriceForItem, maker: buyer.address,
        nft: [1, collection, 1], price: toBn("0.01"), expiry: now, salt: 99,
    }
    await dex.connect(buyer).matchOrder(cheap, buyOrder, { value: toBn("0.01") })
    console.log("\n买家已成交, NFT owner:", await erc721.ownerOf(1))

    const best = await dex.getBestOrder(collection, 1, Side.List, SaleKind.FixedPriceForItem)
    console.log("成交后 getBestOrder 仍返回:", best.maker, "price:", best.price.toString(),
        "  <-- 未过滤 filledAmount 的表现")

    const matchable = await findMatchableListing(dex, collection, 1, buyer.address)
    console.log("前端 findMatchableListing 结果:", matchable ? "找到可买订单" : "null（正确跳过已成交单）")

    // --- 假设 4：在另一个 tokenId 上挂新单，前端能正确找到并成交 ---
    await erc721.mint(owner.address, 2)
    const fresh = { ...cheap, nft: [2, collection, 1], price: toBn("0.03"), salt: 12 }
    await dex.connect(owner).makeOrders([fresh])
    const found = await findMatchableListing(dex, collection, 2, buyer.address)
    console.log("新挂单后找到:", found ? `price=${found.price}` : "null")

    if (found) {
        const buy2 = { ...buyOrder, nft: [2, collection, 1], price: found.price, salt: 100 }
        await dex.connect(buyer).matchOrder(found, buy2, { value: found.price })
        console.log("买家再次成交, NFT owner:", await erc721.ownerOf(2),
            "(应为", buyer.address, ")")
    }

    // --- 附带：不能买自己的挂单，合约层是否拦住 ---
    await erc721.mint(owner.address, 3)
    const own = { ...cheap, nft: [3, collection, 1], salt: 21 }
    await dex.connect(owner).makeOrders([own])
    const selfBuy = { ...buyOrder, nft: [3, collection, 1], salt: 200 }
    try {
        await dex.connect(owner).matchOrder(own, selfBuy, { value: own.price })
        console.log("\n自购: 合约未拦截 ❌")
    } catch (e) {
        console.log("\n自购被拦截:", (e.message || "").split("\n")[0])
    }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
