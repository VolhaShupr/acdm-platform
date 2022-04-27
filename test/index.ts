import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const ZERO_ADDRESS = ethers.constants.AddressZero;
const standardTokenDecimals = 18;
const acdmTokenDecimals = 6;

const toBigNumber = (amount: number, decimals = standardTokenDecimals): BigNumber => ethers.utils.parseUnits(amount.toString(), decimals);

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("ACDM Platform", () => {

  const acdmTokenInitialSupply = toBigNumber(100, acdmTokenDecimals);
  const tokenInitialSupply = toBigNumber(100);

  let acdmToken: Contract,
    xxxToken: Contract,
    lpToken: Contract,
    platform: Contract,
    owner: SignerWithAddress,
    delegate: SignerWithAddress,
    account1: SignerWithAddress;

  let clean: any; // snapshot

  before(async () => {
    [owner, delegate, account1] = await ethers.getSigners();

    // --- ACDM token deployment ---
    const tokenContractFactory = await ethers.getContractFactory("Token");
    acdmToken = await tokenContractFactory.deploy("Academ Coin", "ACDM", acdmTokenDecimals, acdmTokenInitialSupply);
    await acdmToken.deployed();

    // --- XXX token deployment ---
    xxxToken = await tokenContractFactory.deploy("XXX Coin", "XXX", standardTokenDecimals, tokenInitialSupply);
    await xxxToken.deployed();

    // --- LP token deployment ---
    lpToken = await tokenContractFactory.deploy("Uniswap V2", "UNI-V2", standardTokenDecimals, tokenInitialSupply);
    await lpToken.deployed();

    // --- ACDM platform deployment ---
    const platformContractFactory = await ethers.getContractFactory("ACDMPlatform");
    platform = await platformContractFactory.deploy();
    await platform.deployed();

    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  afterEach(async () => {
    await network.provider.request({ method: "evm_revert", params: [clean] });
    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  // describe("token", () => {
  //   it("Should return token decimals", async () => {
  //     expect(await acdmToken.decimals()).to.equal(acdmTokenDecimals);
  //   });
  //
  //   it("Should return token total supply", async () => {
  //     expect(await acdmToken.totalSupply()).to.equal(acdmTokenInitialSupply);
  //   });
  // });



});
