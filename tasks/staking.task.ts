import { task } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const STAKING_ADDRESS = <string>process.env.STAKING_ADDRESS;
const LP_TOKEN_ADDRESS = <string>process.env.LP_TOKEN_ADDRESS;

task("stake", "Stakes tokens")
  .addParam("amount", "The amount of tokens to stake")
  .setAction(async ({ amount }, hre) => {
    const [signer] = await hre.ethers.getSigners();

    const staking = await hre.ethers.getContractAt("Staking", STAKING_ADDRESS);
    const lpToken = await hre.ethers.getContractAt("Token", LP_TOKEN_ADDRESS);

    const decimals = await lpToken.decimals();
    const symbol = await lpToken.symbol();
    const value = hre.ethers.utils.parseUnits(amount, decimals);

    // await lpToken.approve(staking.address, value);
    // console.log(`Approved for staking contract usage ${amount} ${symbol} tokens`);

    await staking.stake(value);

    console.log(`Staked ${amount} ${symbol} tokens from address ${signer.address}`);
  });

task("unstake", "Unstakes tokens")
  .setAction(async (taskArgs, hre) => {
    const [signer] = await hre.ethers.getSigners();
    const staking = await hre.ethers.getContractAt("Staking", STAKING_ADDRESS);

    await staking.unstake();

    console.log(`Unstaked to address ${signer.address}`);
  });

task("claim", "Claims reward tokens")
  .setAction(async (taskArgs, hre) => {
    const [signer] = await hre.ethers.getSigners();
    const staking = await hre.ethers.getContractAt("Staking", STAKING_ADDRESS);

    await staking.claim();

    console.log(`Claimed rewards to address ${signer.address}`);
  });
