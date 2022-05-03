import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DEFAULT_DECIMALS, deploy, increaseTime, toBigNumber, toDays, toNumber, ZERO_ADDRESS } from "./helpers";

const ACDM_DECIMALS = 6;
const inappropriateRoundError = "InappropriateRound";

const toAcdmBigNumber = (amount: number): BigNumber => toBigNumber(amount, ACDM_DECIMALS);
const calcPrice = (lastPrice: BigNumber): BigNumber => lastPrice.mul(103).div(100).add(toBigNumber(0.000004));
const calcAcdmAmount = (volume: BigNumber, price: BigNumber): BigNumber => volume.mul(10 ** ACDM_DECIMALS).div(price);
const calcAcdmCost = (amount: BigNumber, price: BigNumber): BigNumber => amount.mul(price).div(10 ** ACDM_DECIMALS);

enum RoundType {
  Sale,
  Trade
}

describe("ACDM Platform", () => {

  const roundDuration = toDays(3);
  const initialVolume = toBigNumber(1); // 1 ether
  const saleRound1Price = toBigNumber(0.00001); // 0.00001 ether
  const saleRound1AcdmAmount = calcAcdmAmount(initialVolume, saleRound1Price); // 100 000 acdm
  const saleRound2Price = calcPrice(saleRound1Price);
  const saleRound3Price = calcPrice(saleRound2Price);
  const orderId1 = 1;

  const ethValue1 = toBigNumber(0.7);
  const soldAcdmAmount1 = calcAcdmAmount(ethValue1, saleRound1Price);

  const orderAcdmAmount = toAcdmBigNumber(50000);
  const orderTokenPrice = toBigNumber(0.0001);

  let acdmToken: Contract,
    platform: Contract,
    owner: SignerWithAddress,
    account1: SignerWithAddress,
    account2: SignerWithAddress,
    account3: SignerWithAddress,
    platformAddress: string,
    account1Address: string,
    account2Address: string,
    account3Address: string;

  let clean: any; // snapshot

  before(async () => {
    [owner, account1, account2, account3] = await ethers.getSigners();
    account1Address = account1.address;
    account2Address = account2.address;
    account3Address = account3.address;

    // --- ACDM token deployment ---
    acdmToken = await deploy("Token", ["Academ Coin", "ACDM", ACDM_DECIMALS, 0]);
    await acdmToken.deployed();

    // --- ACDM platform deployment ---
    platform = await deploy("ACDMPlatform", [acdmToken.address, roundDuration]);
    platformAddress = platform.address;
    const minterRole = ethers.utils.id("MINTER_ROLE");
    await acdmToken.grantRole(minterRole, platformAddress);
    const approveAmount = toAcdmBigNumber(100000);
    await acdmToken.connect(account1).approve(platformAddress, approveAmount);
    await acdmToken.connect(account2).approve(platformAddress, approveAmount);
    await acdmToken.connect(account3).approve(platformAddress, approveAmount);

    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  afterEach(async () => {
    await network.provider.request({ method: "evm_revert", params: [clean] });
    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  describe("[startSaleRound]", () => {
    it("Should revert when sale round has been already started", async () => {
      await platform.startSaleRound();
      await expect(platform.startSaleRound()).to.be.revertedWith(inappropriateRoundError);
    });

    it("Should revert when trade round is not over", async () => {
      await platform.startSaleRound();
      await increaseTime(roundDuration);
      await platform.startTradeRound();
      await increaseTime(roundDuration - toDays(1));
      await expect(platform.startSaleRound()).to.be.revertedWith(inappropriateRoundError);
    });

    it("Should start sale round and correct calculate token sale price and amount", async () => {
      // sale round 1
      await expect(platform.startSaleRound())
        .to.emit(platform, "RoundStarted(uint8,uint256,uint256)")
        .withArgs(RoundType.Sale, saleRound1Price, saleRound1AcdmAmount);
      expect(await acdmToken.totalSupply()).to.equal(saleRound1AcdmAmount);
      expect(await acdmToken.balanceOf(platformAddress)).to.equal(saleRound1AcdmAmount);
    });

  });

  describe("[buySaleTokens]", () => {
    beforeEach(async () => {
      await platform.startSaleRound();
    });

    it("Should revert when it is not active sale round", async () => {
      await increaseTime(roundDuration);
      await platform.startTradeRound();
      await expect(platform.buySaleTokens({ value: toBigNumber(0.5) })).to.be.revertedWith(inappropriateRoundError);
    });

    it("Should revert when provided ether value is not enough to buy a token", async () => {
      const value = ethers.utils.parseUnits("0.000000000001", DEFAULT_DECIMALS);
      await expect(platform.buySaleTokens({ value })).to.be.revertedWith("Not enough ether to buy a token");
      expect(await acdmToken.balanceOf(platformAddress)).to.equal(saleRound1AcdmAmount);
    });

    it("Should buy some tokens", async () => {
      const buyTokenTx = platform.connect(account1).buySaleTokens({ value: ethValue1 });

      await expect(buyTokenTx)
        .to.emit(platform, "SaleTokenBought")
        .withArgs(account1Address, soldAcdmAmount1);

      expect(await ethers.provider.getBalance(platformAddress)).to.equal(ethValue1);
      // await expect(await buyTokenTx).to.changeEtherBalance(platform, ethValue1);
      expect(await acdmToken.balanceOf(platformAddress)).to.equal(saleRound1AcdmAmount.sub(soldAcdmAmount1));
      expect(await acdmToken.balanceOf(account1Address)).to.equal(soldAcdmAmount1);
    });

    it("Should buy some tokens (less than amount left) and receive change", async () => {
      const ethValue = toBigNumber(0.000099000005);
      const acdmAmount = calcAcdmAmount(ethValue, saleRound1Price); // 9.9 acdm
      const spentEth = calcAcdmCost(acdmAmount, saleRound1Price); // 0.000099 eth; 0.000000000005 eth should be transferred back to sender
      const tx = platform.connect(account1).buySaleTokens({ value: ethValue });
      await expect(tx)
        .to.emit(platform, "SaleTokenBought")
        .withArgs(account1Address, acdmAmount);

      await expect(await tx).to.changeEtherBalances(
        [account1, platform],
        [toBigNumber(-toNumber(spentEth)), spentEth],
      );
    });

    it("Should buy some tokens (in value of amount left) and receive change", async () => {
      const ethValue = toBigNumber(2.5);
      let acdmAmount = calcAcdmAmount(ethValue, saleRound1Price); // 200 000 acdm, but available are 100 000 acdm
      acdmAmount = saleRound1AcdmAmount;
      const spentEth = calcAcdmCost(acdmAmount, saleRound1Price); // 1 eth eth; 1.5 eth should be transferred back to sender
      const tx = platform.connect(account1).buySaleTokens({ value: ethValue });
      await expect(tx)
        .to.emit(platform, "SaleTokenBought")
        .withArgs(account1Address, acdmAmount);

      await expect(await tx).to.changeEtherBalances(
        [account1, platform],
        [toBigNumber(-toNumber(spentEth)), spentEth],
      );
    });

  });

  describe("[startTradeRound]", () => {
    beforeEach(async () => {
      await platform.startSaleRound();
    });

    it("Should revert when trade round has been already started", async () => {
      await increaseTime(roundDuration);
      await platform.startTradeRound();
      await expect(platform.startTradeRound()).to.be.revertedWith(inappropriateRoundError);
    });

    it("Should revert when sale round is not over and tokens are not sold", async () => {
      await increaseTime(roundDuration - toDays(1));
      await platform.connect(account1).buySaleTokens({ value: toBigNumber(0.7) });
      await expect(platform.startTradeRound()).to.be.revertedWith(inappropriateRoundError);
    });

    it("Should burn extra tokens from sale round and start trade round", async () => {
      await platform.connect(account1).buySaleTokens({ value: ethValue1 });
      await increaseTime(roundDuration);

      await expect(platform.startTradeRound())
        .to.emit(platform, "RoundStarted(uint8)")
        .withArgs(RoundType.Trade);

      expect(await acdmToken.totalSupply()).to.equal(soldAcdmAmount1);
      expect(await acdmToken.balanceOf(platformAddress)).to.equal(0);
    });

    it("Should start trade round when the sale round was completed early (all tokens were sold out)", async () => {
      await platform.connect(account1).buySaleTokens({ value: toBigNumber(2.5) });
      await increaseTime(roundDuration);

      await platform.startTradeRound();
      expect(await acdmToken.totalSupply()).to.equal(saleRound1AcdmAmount);
      expect(await acdmToken.balanceOf(platformAddress)).to.equal(0);
    });

  });

  describe("[addOrder]", () => {
    it("Should revert when it is not active trade round", async () => {
      await expect(platform.addOrder(orderAcdmAmount, orderTokenPrice)).to.be.revertedWith(inappropriateRoundError);

      await platform.startSaleRound();
      await expect(platform.addOrder(orderAcdmAmount, orderTokenPrice)).to.be.revertedWith(inappropriateRoundError);
      await increaseTime(roundDuration);
      await platform.startTradeRound();
      await increaseTime(roundDuration + toDays(1));
      await expect(platform.addOrder(orderAcdmAmount, orderTokenPrice)).to.be.revertedWith(inappropriateRoundError);
    });

    it("Should revert when price is zero", async () => {
      await platform.startSaleRound();
      await increaseTime(roundDuration);
      await platform.startTradeRound();

      await expect(platform.addOrder(orderAcdmAmount, 0)).to.be.revertedWith("Not valid price");
    });

    it("Should revert when amount is zero or not less than sender has", async () => {
      await platform.startSaleRound();
      await platform.connect(account1).buySaleTokens({ value: ethValue1 });
      await increaseTime(roundDuration);
      await platform.startTradeRound();

      await expect(platform.addOrder(orderAcdmAmount, orderTokenPrice)).to.be.revertedWith("Not enough tokens");
      await expect(platform.connect(account1).addOrder(0, orderTokenPrice)).to.be.revertedWith("Not enough tokens");
    });

    it("Should add an order", async () => {
      await platform.startSaleRound();
      await platform.connect(account1).buySaleTokens({ value: ethValue1 });
      await increaseTime(roundDuration);
      await platform.startTradeRound();

      await expect(platform.connect(account1).addOrder(orderAcdmAmount, orderTokenPrice))
        .to.emit(platform, "OrderAdded")
        .withArgs(orderId1, account1Address, orderAcdmAmount, orderTokenPrice);

      expect(await acdmToken.balanceOf(platformAddress)).to.equal(orderAcdmAmount);
      expect(await acdmToken.balanceOf(account1Address)).to.equal(soldAcdmAmount1.sub(orderAcdmAmount));
    });

  });

  describe("[removeOrder]", () => {
    beforeEach(async () => {
      await platform.startSaleRound();
      await platform.connect(account1).buySaleTokens({ value: ethValue1 });
      await increaseTime(roundDuration);
      await platform.startTradeRound();
      await platform.connect(account1).addOrder(orderAcdmAmount, orderTokenPrice);
    });

    it("Should revert when order id is not correct", async () => {
      await expect(platform.removeOrder(orderId1)).to.be.revertedWith("Not valid order id");
      await expect(platform.connect(account1).removeOrder(2)).to.be.revertedWith("Not valid order id");
    });

    it("Should remove the order", async () => {
      await expect(platform.connect(account1).removeOrder(orderId1))
        .to.emit(platform, "OrderRemoved")
        .withArgs(orderId1, orderAcdmAmount);

      expect(await acdmToken.balanceOf(platformAddress)).to.equal(0);
      expect(await acdmToken.balanceOf(account1Address)).to.equal(soldAcdmAmount1);

      await expect(platform.connect(account1).removeOrder(orderId1)).to.be.revertedWith("Not valid order id");
    });

  });

  describe("[redeemOrder]", () => {
    const redeemEthValue = toBigNumber(0.5); // 0.5 eth
    const redeemAcdmAmount = calcAcdmAmount(redeemEthValue, orderTokenPrice);

    beforeEach(async () => {
      await platform.startSaleRound();
      await platform.connect(account1).buySaleTokens({ value: ethValue1 });
      await increaseTime(roundDuration);
      await platform.startTradeRound();
      await platform.connect(account1).addOrder(orderAcdmAmount, orderTokenPrice);
    });

    it("Should revert when it is not active trade round", async () => {
      await increaseTime(roundDuration);
      await platform.startSaleRound();
      await expect(platform.redeemOrder(orderId1, { value: redeemEthValue })).to.be.revertedWith(inappropriateRoundError);

      await increaseTime(roundDuration);
      await platform.startTradeRound();
      await increaseTime(roundDuration + toDays(1));
      await expect(platform.redeemOrder(orderId1, { value: redeemEthValue })).to.be.revertedWith(inappropriateRoundError);
    });

    it("Should revert when order doesn't exist", async () => {
      await expect(platform.redeemOrder(2, { value: redeemEthValue })).to.be.revertedWith("Invalid order id");
    });

    it("Should revert when provided ether value is not enough to buy a token", async () => {
      const value = ethers.utils.parseUnits("0.000000000001", DEFAULT_DECIMALS);
      await expect(platform.redeemOrder(orderId1, { value })).to.be.revertedWith("Not enough ether to buy a token");
    });

    it("Should revert when provided ether value is greater than remaining tokens amount", async () => {
      await expect(platform.redeemOrder(orderId1, { value: toBigNumber(11) })).to.be.revertedWith("Not enough tokens left");
    });

    it("Should partially redeem the order", async () => {
      const redeemOrderTx = platform.connect(account2).redeemOrder(orderId1, { value: redeemEthValue });

      await expect(redeemOrderTx)
        .to.emit(platform, "OrderRedeemed")
        .withArgs(orderId1, account2Address, redeemAcdmAmount, orderTokenPrice);

      await expect(await redeemOrderTx).to.changeEtherBalance(account1, redeemEthValue);
      expect(await acdmToken.balanceOf(platformAddress)).to.equal(orderAcdmAmount.sub(redeemAcdmAmount));
      expect(await acdmToken.balanceOf(account2Address)).to.equal(redeemAcdmAmount);
    });

  });

  describe("[admin]", () => {
    it("Should withdraw contract ether", async () => {
      await platform.startSaleRound();
      await platform.connect(account1).buySaleTokens({ value: ethValue1 });

      await expect(platform.withdrawEth(ZERO_ADDRESS, ethValue1)).to.be.revertedWith("Not valid recipient address");
      await expect(platform.withdrawEth(account3Address, initialVolume)).to.be.revertedWith("Insufficient ether amount to transfer");
      await expect(platform.withdrawEth(account3Address, 0)).to.be.revertedWith("Insufficient ether amount to transfer");

      await expect(await platform.withdrawEth(account3Address, ethValue1)).to.changeEtherBalances(
        [platform, account3],
        [toBigNumber(-toNumber(ethValue1)), ethValue1],
      );
    });

  });

  // describe("end-to-end", () => {
  //   it("Should test multiple rounds", async () => {
  //     // --- [1] sale round ---
  //     await platform.startSaleRound();
  //     await platform.connect(account1).buySaleTokens({ value: ethValue1 });
  //     await increaseTime(roundDuration);
  //
  //     // --- [1] trade round ---
  //     await platform.startTradeRound();
  //
  //
  //     //
  //     // // trade round 1
  //     // await platform.startTradeRound(); // burned saleRound1AcdmAmount - soldTokens = 0.3 ether
  //     // const orderAmount = saleRound1AcdmAmount.div(2); // 500 000
  //     // const orderTokenPrice = saleRound1Price.mul(10); // 0.0001 ether
  //     // await platform.connect(account1).addOrder(orderAmount, orderTokenPrice);
  //     // const redeemCost = toBigNumber(0.5);
  //     // await platform.connect(account2).redeemOrder(orderId1, { value: redeemCost });
  //     // const redeemAmount = calcAcdmAmount(redeemCost, orderTokenPrice);
  //     // const remainingOrderTokensOnPlatformBalance = orderAmount.sub(redeemAmount);
  //     // await increaseTime(roundDuration);
  //     //
  //     // // sale round 2
  //     // const round2Amount = calcAcdmAmount(redeemCost, saleRound2Price);
  //     // await expect(platform.startSaleRound())
  //     //   .to.emit(platform, "RoundStarted(uint8,uint256,uint256)")
  //     //   .withArgs(RoundType.Sale, saleRound2Price, round2Amount);
  //     // expect(await acdmToken.totalSupply()).to.equal(soldTokens).add(round2Amount);
  //     // expect(await acdmToken.balanceOf(platformAddress)).to.equal(remainingOrderTokensOnPlatformBalance.add(round2Amount));
  //   });
  //
  // });

});
