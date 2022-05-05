import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";

import "./tasks";

dotenv.config();

const { RINKEBY_API_URL, PRIVATE_KEY1, PRIVATE_KEY2, PRIVATE_KEY3, ETHERSCAN_API_KEY, DEBUG } = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.13",
    settings: {
      optimizer: {
        enabled: !DEBUG,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: RINKEBY_API_URL as string,
        blockNumber: 10623714,
      },
    },
    rinkeby: {
      url: RINKEBY_API_URL,
      accounts: [`0x${PRIVATE_KEY1}`, `0x${PRIVATE_KEY2}`, `0x${PRIVATE_KEY3}`],
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
  },
};

export default config;
