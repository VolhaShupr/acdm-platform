import { ethers } from "hardhat";

async function main() {
  const platformContractFactory = await ethers.getContractFactory("ACDMPlatform");
  const platformContract = await platformContractFactory.deploy();

  await platformContract.deployed();

  console.log("ACDM platform contract deployed to:", platformContract.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
