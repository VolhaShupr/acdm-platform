import { DEFAULT_DECIMALS, deploy, toBigNumber, toDays, toMins } from "../helpers/helpers";
import * as dotenv from "dotenv";
dotenv.config();

const { LP_TOKEN_ADDRESS, XXX_TOKEN_ADDRESS, CHAIR_ADDRESS, ACDM_TOKEN_ADDRESS, REFERRAL_REWARD_HOLDER_ADDRESS } = process.env;

interface DeployConfig {
  [name: string]: {
    name: string,
    args: any[],
  }
}

const config: DeployConfig = {
  xxxToken: {
    name: "Token",
    // name, symbol, decimals, initial supply
    args: ["XXX Coin", "XXX", DEFAULT_DECIMALS, toBigNumber(111)],
  },
  acdmToken: {
    name: "Token",
    // name, symbol, decimals, initial supply
    args: ["Academ Coin", "ACDM", 6, 0],
  },
  staking: {
    name: "Staking",
    // staking token (LP), rewardToken (XXX), reward period, reward period min unit, reward rade, unstake unfreeze period
    args: [LP_TOKEN_ADDRESS, XXX_TOKEN_ADDRESS, toDays(3), toDays(1), 300, toMins(20)],
  },
  dao: {
    name: "DAO",
    // chair person address, quorum percentage, debating duration
    args: [CHAIR_ADDRESS, 20, toMins(10)],
  },
  refRewardHolder: {
    name: "ReferralRewardHolder",
    args: [],
  },
  platform: {
    name: "ACDMPlatform",
    // ACDM Token address, round duration, referral reward holder address
    args: [ACDM_TOKEN_ADDRESS, toDays(3), REFERRAL_REWARD_HOLDER_ADDRESS],
  },
};

async function main() {
  const { name, args } = config.platform; // insert necessary config name
  const contract = await deploy(name, args);

  console.log(`${name} contract deployed to:`, contract.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
