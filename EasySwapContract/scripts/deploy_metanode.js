const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);

  const MetaNodeNFT = await ethers.getContractFactory("MetaNodeNFT");
  const contract = await MetaNodeNFT.deploy(deployer.address);
  await contract.deployed();

  console.log("MetaNodeNFT deployed to:", contract.address);
  console.log("owner:", deployer.address);

  // mint a test token to verify
  console.log("\n--- 测试 safeMint ---");
  const tx = await contract.safeMint(deployer.address, "https://example.com/metadata/1.json");
  const receipt = await tx.wait();
  console.log("mint tx:", receipt.transactionHash);

  // read tokenId
  const filter = contract.filters.Transfer(null, null);
  const events = await contract.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
  for (const ev of events) {
    if (ev.args && ev.args.tokenId) {
      console.log("tokenId:", ev.args.tokenId.toString());
    }
  }

  // verify URI
  const uri = await contract.tokenURI(1);
  console.log("tokenURI(1):", uri);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });