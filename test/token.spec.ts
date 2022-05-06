import { expect } from "chai";
import { network } from "hardhat";
import { Contract } from "ethers";
import { deploy, toBigNumber } from "../helpers/helpers";

describe("Token", () => {
  const decimals = 6;
  const initialSupply = toBigNumber(100, decimals);

  let acdmToken: Contract;

  let clean: any; // snapshot

  before(async () => {
    acdmToken = await deploy("Token", ["Academ Coin", "ACDM", decimals, initialSupply]);

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
