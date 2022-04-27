import { ethers } from "hardhat";
import { BigNumber } from "ethers";

const DECIMALS = 18;

async function main() {
  const initialSupply: BigNumber = ethers.utils.parseUnits("111", DECIMALS);
  const tokenContractFactory = await ethers.getContractFactory("Token");
  const tokenContract = await tokenContractFactory.deploy("XXX Coin", "XXX", DECIMALS, initialSupply);

  await tokenContract.deployed();

  console.log("Token contract deployed to:", tokenContract.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
