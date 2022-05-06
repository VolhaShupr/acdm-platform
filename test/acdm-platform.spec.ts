import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DEFAULT_DECIMALS, deploy, increaseTime, toBigNumber, toDays, toNumber, ZERO_ADDRESS } from "../helpers/helpers";

const ACDM_DECIMALS = 6;
const inappropriateRoundError = "InappropriateRound";

const toAcdmBigNumber = (amount: number): BigNumber => toBigNumber(amount, ACDM_DECIMALS);
const calcPrice = (lastPrice: BigNumber): BigNumber => lastPrice.mul(103).div(100).add(toBigNumber(0.000004));
const calcAcdmAmount = (volume: BigNumber, price: BigNumber): BigNumber => volume.mul(10 ** ACDM_DECIMALS).div(price);
const calcAcdmCost = (amount: BigNumber, price: BigNumber): BigNumber => amount.mul(price).div(10 ** ACDM_DECIMALS);
const calcPercent = (amount: BigNumber, percent: number, multiplier = 100): BigNumber => amount.mul(percent).div(100 * multiplier);

enum RoundType {
  Sale,
  Trade
}

const Reward = {
  saleL1: 500,
  saleL2: 300,
  tradeL1: 250,
  tradeL2: 250,
};

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

  const redeemEthValue = toBigNumber(0.5); // 0.5 eth
  const redeemAcdmAmount = calcAcdmAmount(redeemEthValue, orderTokenPrice); // 5000 acdm

  let acdmToken: Contract,
    platform: Contract,
    owner: SignerWithAddress,
    account1: SignerWithAddress,
    account2: SignerWithAddress,
    account3: SignerWithAddress,
    referralRewardAccount: SignerWithAddress,
    platformAddress: string,
    ownerAddress: string,
    account1Address: string,
    account2Address: string,
    account3Address: string;

  let clean: any; // snapshot

  before(async () => {
    [owner, account1, account2, account3, referralRewardAccount] = await ethers.getSigners();
    ownerAddress = owner.address;
    account1Address = account1.address;
    account2Address = account2.address;
    account3Address = account3.address;

    // --- ACDM token deployment ---
    acdmToken = await deploy("Token", ["Academ Coin", "ACDM", ACDM_DECIMALS, 0]);

    // --- ACDM platform deployment ---
    platform = await deploy("ACDMPlatform", [acdmToken.address, roundDuration, referralRewardAccount.address]);
    platformAddress = platform.address;
    const minterRole = ethers.utils.id("MINTER_ROLE");
    await acdmToken.grantRole(minterRole, platformAddress);
    const approveAmount = toAcdmBigNumber(100000);
    await acdmToken.connect(account1).approve(platformAddress, approveAmount);
    await acdmToken.connect(account2).approve(platformAddress, approveAmount);
    await acdmToken.connect(account3).approve(platformAddress, approveAmount);

    const adminRole = ethers.utils.id("ADMIN_ROLE");
    await platform.grantRole(adminRole, ownerAddress);

    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  afterEach(async () => {
    await network.provider.request({ method: "evm_revert", params: [clean] });
    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  describe("[register]", () => {
    it("Should revert when referrer is zero address", async () => {
      await expect(platform.register(ZERO_ADDRESS)).to.be.revertedWith("Not valid referrer address");
    });

    it("Should revert when referrer has the same address as a sender", async () => {
      await expect(platform.connect(account1).register(account1Address)).to.be.revertedWith("Not valid referrer address");
    });

    it("Should revert when referrer has been not registered", async () => {
      await expect(platform.connect(account1).register(account2Address)).to.be.revertedWith("Referrer should be registered");
    });

    it("Should revert when reference already exists", async () => {
      await platform.connect(account1).register(ownerAddress);
      await platform.connect(account2).register(ownerAddress);
      await expect(platform.connect(account1).register(account2Address)).to.be.revertedWith("Reference already exists");
    });

    it("Should start sale round and correct calculate token sale price and amount", async () => {
      await expect(platform.connect(account1).register(ownerAddress))
        .to.emit(platform, "UserRegistered")
        .withArgs(account1Address, ownerAddress);
      await expect(platform.connect(account2).register(account1Address))
        .to.emit(platform, "UserRegistered")
        .withArgs(account2Address, account1Address);
    });

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

    it("Should revert when no tokens left", async () => {
      await platform.connect(account1).buySaleTokens({ value: toBigNumber(1) });
      await expect(platform.connect(account2).buySaleTokens({ value: ethValue1 })).to.be.revertedWith("No tokens left");
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
      // register referrers
      await platform.connect(account1).register(ownerAddress);

      const ethValue = toBigNumber(0.000099000005);
      const acdmAmount = calcAcdmAmount(ethValue, saleRound1Price); // 9.9 acdm
      const spentEth = calcAcdmCost(acdmAmount, saleRound1Price); // 0.000099 eth; 0.000000000005 eth should be transferred back to sender
      const reward = calcPercent(spentEth, Reward.saleL1 + Reward.saleL2); // all 5 + 3% goes to contract owner as a root referrer
      const tx = platform.connect(account1).buySaleTokens({ value: ethValue });

      await expect(tx)
        .to.emit(platform, "SaleTokenBought")
        .withArgs(account1Address, acdmAmount);

      await expect(await tx).to.changeEtherBalances(
        [account1, platform, owner],
        [toBigNumber(-toNumber(spentEth)), spentEth.sub(reward), reward],
      );
    });

    it("Should buy some tokens (in value of amount left) and receive change", async () => {
      // register referrers
      await platform.connect(account3).register(ownerAddress);
      await platform.connect(account2).register(account3Address);
      await platform.connect(account1).register(account2Address);

      const ethValue = toBigNumber(2.5);
      let acdmAmount = calcAcdmAmount(ethValue, saleRound1Price); // 200 000 acdm, but available are 100 000 acdm
      acdmAmount = saleRound1AcdmAmount;
      const spentEth = calcAcdmCost(acdmAmount, saleRound1Price); // 1 eth ; 1.5 eth should be transferred back to sender
      const l1Reward = calcPercent(spentEth, Reward.saleL1); // 0.05 eth goes to acc2
      const l2Reward = calcPercent(spentEth, Reward.saleL2); // 0.03 eth goes to acc3
      const tx = platform.connect(account1).buySaleTokens({ value: ethValue });

      await expect(tx)
        .to.emit(platform, "SaleTokenBought")
        .withArgs(account1Address, acdmAmount);

      await expect(await tx).to.changeEtherBalances(
        [account1, platform, account2, account3],
        [toBigNumber(-toNumber(spentEth)), spentEth.sub(l1Reward).sub(l2Reward), l1Reward, l2Reward],
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

      await expect(platform.addOrder(orderAcdmAmount, 0)).to.be.revertedWith("Not valid input price or amount");
    });

    it("Should revert when amount is zero or not less than sender has", async () => {
      await platform.startSaleRound();
      await platform.connect(account1).buySaleTokens({ value: ethValue1 });
      await increaseTime(roundDuration);
      await platform.startTradeRound();

      await expect(platform.addOrder(orderAcdmAmount, orderTokenPrice)).to.be.revertedWith("Not enough tokens");
      await expect(platform.connect(account1).addOrder(0, orderTokenPrice)).to.be.revertedWith("Not valid input price or amount");
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
      await expect(platform.redeemOrder(2, { value: redeemEthValue })).to.be.revertedWith("Order doesn't exist or filled");
    });

    it("Should revert when no tokens left in the order", async () => {
      await platform.connect(account1).redeemOrder(orderId1, { value: toBigNumber(10) });
      await expect(platform.connect(account2).redeemOrder(orderId1, { value: redeemEthValue })).to.be.revertedWith("Order doesn't exist or filled");
    });

    it("Should revert when provided ether value is not enough to buy a token", async () => {
      const value = ethers.utils.parseUnits("0.000000000001", DEFAULT_DECIMALS);
      await expect(platform.redeemOrder(orderId1, { value })).to.be.revertedWith("Not enough ether to buy a token");
    });

    it("Should partially redeem the order", async () => {
      const redeemOrderTx = platform.connect(account2).redeemOrder(orderId1, { value: redeemEthValue });
      const referralReward = calcPercent(redeemEthValue, Reward.tradeL1 + Reward.tradeL2);

      await expect(redeemOrderTx)
        .to.emit(platform, "OrderRedeemed")
        .withArgs(orderId1, account2Address, redeemAcdmAmount, orderTokenPrice);

      await expect(await redeemOrderTx).to.changeEtherBalances(
        [account2, account1, referralRewardAccount], // [buyer, seller,`special account for reward`]
        [toBigNumber(-toNumber(redeemEthValue)), redeemEthValue.sub(referralReward), referralReward],
      );
      expect(await acdmToken.balanceOf(platformAddress)).to.equal(orderAcdmAmount.sub(redeemAcdmAmount));
      expect(await acdmToken.balanceOf(account2Address)).to.equal(redeemAcdmAmount);
    });

    it("Should fill the order and receive change", async () => {
      // register referrers
      await platform.connect(account3).register(ownerAddress);
      await platform.connect(account2).register(account3Address);
      await platform.connect(account1).register(account2Address);

      const ethValue = toBigNumber(8);
      let acdmAmount = calcAcdmAmount(ethValue, orderTokenPrice); // 80 000 acdm, but in order 50 000 acdm are available
      acdmAmount = orderAcdmAmount; // max available tokens: 50 000 acdm
      const spentEth = calcAcdmCost(acdmAmount, orderTokenPrice); // 5 eth ; 3 eth should be transferred back to sender
      const l1Reward = calcPercent(spentEth, Reward.tradeL1); // 0.05 eth goes to acc2
      const l2Reward = calcPercent(spentEth, Reward.tradeL2); // 0.03 eth goes to acc3
      const tx = platform.connect(account2).redeemOrder(orderId1, { value: ethValue });

      await expect(tx)
        .to.emit(platform, "OrderRedeemed")
        .withArgs(orderId1, account2Address, acdmAmount, orderTokenPrice);

      await expect(await tx).to.changeEtherBalances(
        [account2, account1, account3, platform], // 95% -> acc1; 2,5% -> acc2; 2,5% -> acc3
        [l1Reward.sub(spentEth), spentEth.sub(l1Reward).sub(l2Reward), l2Reward, 0],
      );
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

    it("[updateSaleRoundRefRewards] Should set new referral reward percent for sale and trade rounds", async () => {
      const l1 = 300; // 3%
      const l2 = 200; // 2%

      const daoRole = ethers.utils.id("DAO_ROLE");
      await platform.grantRole(daoRole, ownerAddress);

      await expect(platform.updateRefRewards(RoundType.Sale, l1, l2))
        .to.emit(platform, "RefRewardConfigUpdated")
        .withArgs(RoundType.Sale, l1, l2);

      await expect(platform.updateRefRewards(RoundType.Trade, l1, l2))
        .to.emit(platform, "RefRewardConfigUpdated")
        .withArgs(RoundType.Trade, l1, l2);
    });

    it("[updateRoundDuration] Should set a new round duration", async () => {
      const newRoundDuration = 5 * 24 * 60 * 60; // 5 days;

      await platform.updateRoundDuration(newRoundDuration);
      expect(await platform.roundDuration()).to.equal(newRoundDuration);
    });

    it("[updateReferralRewardHolder] Should set a new referral reward address", async () => {
      const newReferralRewardHolder = ownerAddress;

      await platform.updateReferralRewardHolder(newReferralRewardHolder);
      expect(await platform.referralRewardHolder()).to.equal(newReferralRewardHolder);
    });

  });

  describe("additional", () => {
    it("Should test token price and trade volume in multiple rounds", async () => {
      // --- [1] sale round --- 1 eth / 0.00001 eth = 100 000 acdm
      await platform.startSaleRound();
      await platform.connect(account1).buySaleTokens({ value: ethValue1 }); // 70 000 acdm * 0.00001 eth
      await platform.connect(account1).buySaleTokens({ value: toBigNumber(0.2) }); // 20 000 acdm * 0.00001 eth
      await increaseTime(roundDuration);

      // --- [1] trade round ---
      let TR1tradeVolume = toBigNumber(0);
      await platform.startTradeRound();
      await platform.connect(account1).addOrder(orderAcdmAmount, orderTokenPrice); // 50 000 acdm * 0.0001 eth
      await platform.connect(account2).redeemOrder(orderId1, { value: redeemEthValue }); // 5000 acdm * * 0.0001 eth
      TR1tradeVolume = TR1tradeVolume.add(redeemEthValue); // 0.5 eth

      await platform.connect(account3).redeemOrder(orderId1, { value: toBigNumber(5) });
      const TR1redeemCost2 = calcAcdmCost(orderAcdmAmount.sub(redeemAcdmAmount), orderTokenPrice); // 4.5 eth
      TR1tradeVolume = TR1tradeVolume.add(TR1redeemCost2); // 5 eth

      const TR1orderAcdmAmount2 = toAcdmBigNumber(10000);
      const TR1orderTokenPrice2 = toBigNumber(0.001);
      await platform.connect(account1).addOrder(TR1orderAcdmAmount2, TR1orderTokenPrice2); // 10 000 acdm * 0.001 eth
      await increaseTime(roundDuration);

      // --- [2] sale round --- 5 eth / 0.0000143 eth = 349650,349650 acdm
      const SR2Amount = calcAcdmAmount(TR1tradeVolume, saleRound2Price);
      await expect(platform.startSaleRound())
        .to.emit(platform, "RoundStarted(uint8,uint256,uint256)")
        .withArgs(RoundType.Sale, saleRound2Price, SR2Amount);
      await increaseTime(roundDuration);

      // --- [2] trade round ---
      await platform.startTradeRound();
      await increaseTime(roundDuration);

      // --- [3] sale round --- 0 eth / 0.000018729 eth = 0 acdm
      await expect(platform.startSaleRound())
        .to.emit(platform, "RoundStarted(uint8,uint256,uint256)")
        .withArgs(RoundType.Sale, saleRound3Price, 0);
    });
  });

});
