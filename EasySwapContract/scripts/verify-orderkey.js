// 校验前端 computeOrderKey 与合约 LibOrder.hash 是否一致
// 注意：本脚本运行在合约项目的 ethers v5 环境下，前端用的是 v6，两者 API 不同。
const { ethers } = require("ethers")
const hre = require("hardhat")
const { id, keccak256, defaultAbiCoder, solidityPack, parseEther } = ethers.utils

function computeOrderKey(order) {
    const ASSET_TYPEHASH = id("Asset(uint256 tokenId,address collection,uint96 amount)")
    const ORDER_TYPEHASH = id(
        "Order(uint8 side,uint8 saleKind,address maker,Asset nft,uint128 price,uint64 expiry,uint64 salt)" +
        "Asset(uint256 tokenId,address collection,uint96 amount)"
    )
    const assetHash = keccak256(
        defaultAbiCoder.encode(
            ["bytes32", "uint256", "address", "uint96"],
            [ASSET_TYPEHASH, order.nft.tokenId, order.nft.collection, order.nft.amount]
        )
    )
    return keccak256(
        solidityPack(
            ["bytes32", "uint8", "uint8", "address", "bytes32", "uint128", "uint64", "uint64"],
            [ORDER_TYPEHASH, order.side, order.saleKind, order.maker, assetHash, order.price, order.expiry, order.salt]
        )
    )
}

async function main() {
    const LibOrderTest = await hre.ethers.getContractFactory("LibOrderTest")
    const lib = await LibOrderTest.deploy()

    const cases = [
        {
            name: "List / item / 0.5 ETH",
            order: {
                side: 0, saleKind: 1,
                maker: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
                nft: { tokenId: "1", collection: "0x5FbDB2315678afecb367f032d93F642f64180aa3", amount: 1 },
                price: parseEther("0.5"), expiry: 1893456000, salt: 1700000000000,
            },
        },
        {
            name: "Bid / collection bid / 3 件",
            order: {
                side: 1, saleKind: 0,
                maker: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
                nft: { tokenId: "0", collection: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", amount: 3 },
                price: "123456789012345678", expiry: 0, salt: 999,
            },
        },
        {
            name: "大 price（贴近 uint128 上限一半）",
            order: {
                side: 0, saleKind: 1,
                maker: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
                nft: { tokenId: "115792089237316195423570985008687907853", collection: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", amount: 1 },
                price: (2n ** 127n).toString(), expiry: 4102444800, salt: 1,
            },
        },
    ]

    let failed = 0
    for (const c of cases) {
        const chainOrder = {
            side: c.order.side,
            saleKind: c.order.saleKind,
            maker: c.order.maker,
            nft: [c.order.nft.tokenId, c.order.nft.collection, c.order.nft.amount],
            price: c.order.price,
            expiry: c.order.expiry,
            salt: c.order.salt,
        }
        const onChain = await lib.getOrderHash(chainOrder)
        const offChain = computeOrderKey(c.order)
        const ok = onChain.toLowerCase() === offChain.toLowerCase()
        if (!ok) failed++
        console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`)
        console.log(`  合约: ${onChain}`)
        console.log(`  前端: ${offChain}`)
    }
    console.log(failed === 0 ? "\n全部一致 ✅" : `\n${failed} 个不一致 ❌`)
    if (failed) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
