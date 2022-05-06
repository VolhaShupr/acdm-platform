import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";

export const ZERO_ADDRESS = ethers.constants.AddressZero;

export const DEFAULT_DECIMALS = 18;

export const toBigNumber = (amount: number, decimals = DEFAULT_DECIMALS): BigNumber => ethers.utils.parseUnits(amount.toString(), decimals);
export const toNumber = (amount: BigNumber, decimals = DEFAULT_DECIMALS): number => +ethers.utils.formatUnits(amount, decimals);

export const toDays = (n: number): number => n * 24 * 60 * 60;
export const toMins = (n: number): number => n * 60;

export async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

export async function deploy(name: string, args: any[] = []): Promise<Contract> {
  const contractFactory = await ethers.getContractFactory(name);
  const contract = await contractFactory.deploy(...args);
  await contract.deployed();

  return contract;
}
