import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DEFAULT_DECIMALS, deploy, increaseTime, toBigNumber, toDays, toMins } from "../helpers/helpers";

describe("Staking", () => {
  const tokenInitialBalance = toBigNumber(100);
  const stakeValue1 = toBigNumber(10);
  const stakeValue2 = toBigNumber(20);
  const stakeValue3 = toBigNumber(30);

  // staking config
  const rewardRate = 300; // 3 %
  const rewardPeriod = toDays(7); // 7 days
  const rewardPeriodMinUnit = toDays(1); // 1 day
  const unstakeFreezePeriod = toDays(3); // 3 days

  // dao config
  const quorumPercentage = 40; // 40%
  const debatingPeriod = toDays(3); // 3 days

  let rewardToken: Contract,
    stakingToken: Contract,
    staking: Contract,
    dao: Contract,
    owner: SignerWithAddress,
    chairPerson: SignerWithAddress,
    ownerAddress: string,
    chairAddress: string;

  let clean: any; // snapshot

  function calcReward(
    amount: BigNumber,
    passedTime: number,
    period = rewardPeriod,
    periodMinUnit = rewardPeriodMinUnit,
    rate = rewardRate,
  ): BigNumber {
    const passedTimeUnits = Math.floor(passedTime / periodMinUnit);
    return amount.mul(rate).mul(passedTimeUnits).mul(periodMinUnit).div(period).div(10000);
  }

  before(async () => {
    [owner, chairPerson] = await ethers.getSigners();
    ownerAddress = owner.address;
    chairAddress = chairPerson.address;

    // --- Staking token deployment ---
    stakingToken = await deploy("Token", ["Uniswap V2", "UNI-V2", DEFAULT_DECIMALS, tokenInitialBalance]);

    // --- Reward token deployment ---
    rewardToken = await deploy("Token", ["XXX Coin", "XXX", DEFAULT_DECIMALS, tokenInitialBalance]);
    const minterRole = ethers.utils.id("MINTER_ROLE");
    await rewardToken.grantRole(minterRole, ownerAddress);

    // --- DAO deployment ---
    dao = await deploy("DAO", [chairAddress, quorumPercentage, debatingPeriod]);

    // --- Staking deployment ---
    staking = await deploy("Staking", [stakingToken.address, rewardToken.address, rewardPeriod, rewardPeriodMinUnit, rewardRate, unstakeFreezePeriod]);
    const adminRole = ethers.utils.id("ADMIN_ROLE");
    await staking.grantRole(adminRole, ownerAddress);
    await staking.setDAO(dao.address);
    await rewardToken.mint(staking.address, tokenInitialBalance);
    await stakingToken.approve(staking.address, tokenInitialBalance);

    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  afterEach(async () => {
    await network.provider.request({ method: "evm_revert", params: [clean] });
    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  describe("[stake]", () => {
    it("Should revert if amount is zero", async () => {
      await expect(staking.stake(0)).to.be.revertedWith("Not valid amount");
    });

    it("Should stake specified amounts of tokens", async () => {
      let stakingTokenOwnerBalance = tokenInitialBalance;

      await expect(staking.stake(stakeValue1))
        .to.emit(staking, "Staked")
        .withArgs(ownerAddress, stakeValue1, 0);

      stakingTokenOwnerBalance = stakingTokenOwnerBalance.sub(stakeValue1);
      expect(await stakingToken.balanceOf(ownerAddress)).to.equal(stakingTokenOwnerBalance);

      // 6 days later
      let passedTime = toDays(6) + toMins(10);
      await increaseTime(passedTime);

      let availableReward = calcReward(stakeValue1, passedTime);
      await expect(staking.stake(stakeValue2))
        .to.emit(staking, "Staked")
        .withArgs(ownerAddress, stakeValue2, availableReward);

      stakingTokenOwnerBalance = stakingTokenOwnerBalance.sub(stakeValue2);
      expect(await stakingToken.balanceOf(ownerAddress)).to.equal(stakingTokenOwnerBalance);

      // another 2 days later
      passedTime = toDays(2) + toMins(100);
      await increaseTime(passedTime);

      availableReward = availableReward.add(calcReward(stakeValue1.add(stakeValue2), passedTime));
      await expect(staking.stake(stakeValue3))
        .to.emit(staking, "Staked")
        .withArgs(ownerAddress, stakeValue3, availableReward);

      stakingTokenOwnerBalance = stakingTokenOwnerBalance.sub(stakeValue3);
      expect(await stakingToken.balanceOf(ownerAddress)).to.equal(stakingTokenOwnerBalance);
    });

  });

  describe("[unstake]", () => {
    it("Should revert if staked amount is zero", async () => {
      await expect(staking.unstake()).to.be.revertedWith("Nothing to unstake");
    });

    it("Should revert if staked amount is locked", async () => {
      await staking.stake(stakeValue1);
      await increaseTime(toDays(2));
      await expect(staking.unstake()).to.be.revertedWith("Tokens are locked");
    });

    it("Should unstake sender's tokens and transfer them to sender's account", async () => {
      await staking.stake(stakeValue1);

      await increaseTime(unstakeFreezePeriod);

      const availableReward = calcReward(stakeValue1, unstakeFreezePeriod);
      await expect(staking.unstake())
        .to.emit(staking, "Unstaked")
        .withArgs(ownerAddress, stakeValue1, availableReward);

      expect(await stakingToken.balanceOf(ownerAddress)).to.equal(tokenInitialBalance);
    });

    it("Should unstake sender's tokens in case of multiple stakes and transfer them to sender's account", async () => {
      await staking.stake(stakeValue1);

      // 6 days later
      let passedTime = toDays(6) + toMins(10);
      await increaseTime(passedTime);
      let availableReward = calcReward(stakeValue1, passedTime);
      await staking.stake(stakeValue2);

      // another 2 days later
      passedTime = toDays(2) + toMins(100);
      await increaseTime(passedTime);
      availableReward = availableReward.add(calcReward(stakeValue1.add(stakeValue2), passedTime));
      await staking.stake(stakeValue3);

      // another 3 days later
      passedTime = toDays(3) + toMins(100);
      await increaseTime(passedTime);

      let totalStaked = stakeValue1.add(stakeValue2).add(stakeValue3);
      availableReward = availableReward.add(calcReward(totalStaked, passedTime));
      await expect(staking.unstake())
        .to.emit(staking, "Unstaked")
        .withArgs(ownerAddress, totalStaked, availableReward);

      expect(await stakingToken.balanceOf(ownerAddress)).to.equal(tokenInitialBalance);
      totalStaked = toBigNumber(0);

      // another 10 days later
      await increaseTime(toDays(10));
      await expect(staking.stake(stakeValue1))
        .to.emit(staking, "Staked")
        .withArgs(ownerAddress, stakeValue1, availableReward);
    });
  });

  describe("[claim]", () => {
    it("Should revert if there are no rewards to claim", async () => {
      await expect(staking.claim()).to.be.revertedWith("Nothing to claim");
    });

    it("Should claim rewards and transfer reward tokens to sender's account", async () => {
      await staking.stake(stakeValue1);

      // 6 days later
      let passedTime = toDays(6) + toMins(10);
      await increaseTime(passedTime);
      let availableReward = calcReward(stakeValue1, passedTime);
      await staking.stake(stakeValue2);

      // another 2 days later
      passedTime = toDays(2) + toMins(100);
      await increaseTime(passedTime);

      let totalStaked = stakeValue1.add(stakeValue2);
      availableReward = availableReward.add(calcReward(totalStaked, passedTime));
      await expect(staking.claim())
        .to.emit(staking, "Claimed")
        .withArgs(ownerAddress, availableReward);

      expect(await rewardToken.balanceOf(staking.address)).to.equal(tokenInitialBalance.sub(availableReward));
      expect(await rewardToken.balanceOf(ownerAddress)).to.equal(tokenInitialBalance.add(availableReward));
      availableReward = toBigNumber(0);

      await increaseTime(toMins(240));
      await expect(staking.claim()).to.be.revertedWith("Nothing to claim");

      // another 4 days later
      passedTime = toDays(4) + toMins(10);
      await increaseTime(passedTime);
      availableReward = availableReward.add(calcReward(totalStaked, passedTime));
      await staking.unstake();
      totalStaked = toBigNumber(0);

      // another 3 days later
      passedTime = toDays(3) + toMins(10);
      await increaseTime(passedTime);

      await expect(staking.claim())
        .to.emit(staking, "Claimed")
        .withArgs(ownerAddress, availableReward);
      availableReward = toBigNumber(0);
    });
  });

  describe("[admin]", () => {
    beforeEach(async () => {
      const role = ethers.utils.id("DAO_ROLE");
      await staking.grantRole(role, ownerAddress);
    });

    it("[updateRewardConfig] Should update reward rate, period and period unit", async () => {
      const newRewardRate = 50; // 0.5%
      const newRewardPeriod = toDays(10);
      const newRewardPeriodMinUnit = toDays(10);

      await expect(staking.updateRewardConfig(newRewardPeriod, newRewardPeriodMinUnit, newRewardRate))
        .to.emit(staking, "RewardConfigUpdated")
        .withArgs(newRewardPeriod, newRewardPeriodMinUnit, newRewardRate);

      const config = await staking.getRewardConfig();
      expect(config.rate).to.equal(newRewardRate);
      expect(config.period).to.equal(newRewardPeriod);
      expect(config.periodMinUnit).to.equal(newRewardPeriodMinUnit);
    });

    it("[updateRewardConfig] Should stake with a new reward period", async () => {
      const newRewardRate = 50; // 0.5%
      const newRewardPeriod = toDays(10);
      const newRewardPeriodMinUnit = toDays(10);
      await staking.updateRewardConfig(newRewardPeriod, newRewardPeriodMinUnit, newRewardRate);

      await staking.stake(stakeValue1);

      // 6 days later
      let passedTime = toDays(6) + toMins(10);
      await increaseTime(passedTime);
      await expect(staking.stake(stakeValue2))
        .to.emit(staking, "Staked")
        .withArgs(ownerAddress, stakeValue2, 0);

      // another 5 days later
      passedTime = toDays(5) + toMins(100);
      await increaseTime(passedTime);

      // availableReward is 0
      const availableReward = calcReward(stakeValue1.add(stakeValue2), passedTime, newRewardPeriod, newRewardPeriodMinUnit, newRewardRate);
      await expect(staking.stake(stakeValue3))
        .to.emit(staking, "Staked")
        .withArgs(ownerAddress, stakeValue3, availableReward);
    });

    it("[updateUnstakeFreezePeriod] Should update unstake freeze period", async () => {
      const newUnstakeFreezePeriod = toDays(5); // 5 days

      await expect(staking.updateUnstakeFreezePeriod(newUnstakeFreezePeriod))
        .to.emit(staking, "UnstakeFreezePeriodUpdated")
        .withArgs(newUnstakeFreezePeriod);
      expect(await staking.unstakeFreezePeriod()).to.equal(newUnstakeFreezePeriod);
    });
  });

  it("[getStakedAmountOf] Should return staked token amount of sender", async () => {
    await staking.stake(stakeValue1);
    expect(await staking.getStakedAmountOf(ownerAddress)).to.equal(stakeValue1);
  });

  it("[getStakingTokenSupply] Should return staking token total supply", async () => {
    expect(await staking.getStakingTokenSupply()).to.equal(tokenInitialBalance);
  });

});
