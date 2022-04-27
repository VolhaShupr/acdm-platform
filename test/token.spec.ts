import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber, Contract } from "ethers";

const standardTokenDecimals = 18;

const toBigNumber = (amount: number, decimals = standardTokenDecimals): BigNumber => ethers.utils.parseUnits(amount.toString(), decimals);

describe("Token", () => {
  const decimals = 6;
  const initialSupply = toBigNumber(100, decimals);

  let acdmToken: Contract;

  let clean: any; // snapshot

  before(async () => {
    const tokenContractFactory = await ethers.getContractFactory("Token");
    acdmToken = await tokenContractFactory.deploy("Academ Coin", "ACDM", decimals, initialSupply);
    await acdmToken.deployed();

    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  afterEach(async () => {
    await network.provider.request({ method: "evm_revert", params: [clean] });
    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  it("Should return token decimals", async () => {
    expect(await acdmToken.decimals()).to.equal(decimals);
  });

  it("Should return token total supply", async () => {
    expect(await acdmToken.totalSupply()).to.equal(initialSupply);
  });

});
