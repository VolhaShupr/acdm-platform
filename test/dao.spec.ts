import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DEFAULT_DECIMALS, deploy, increaseTime, toBigNumber, toDays, ZERO_ADDRESS } from "../helpers/helpers";

interface Proposal {
  recipientAddress: string;
  callData: string;
  description: string;
}

enum ProposalResult {
  Success,
  ExecutionError,
  NotEnoughVotesReject,
  VotedAgainstReject
}

describe("DAO", () => {
  const tokenInitialBalance = toBigNumber(100);
  const accountBalance = toBigNumber(30);
  const depositAmount = toBigNumber(25);
  const quorumPercentage = 40; // 40%
  const debatingPeriod = toDays(3); // 3 days
  const proposalId = 1;

  // staking config
  const rewardRate = 300; // 3 %
  const rewardPeriod = toDays(7); // 7 days
  const rewardPeriodMinUnit = toDays(1); // 1 day
  const unstakeFreezePeriod = toDays(1); // 1 day
  const newUnstakeFreezePeriod = toDays(8); // 8 days

  let proposal: Proposal;

  let dao: Contract,
    stakingToken: Contract,
    rewardToken: Contract,
    staking: Contract,
    owner: SignerWithAddress,
    chairPerson: SignerWithAddress,
    voter1: SignerWithAddress,
    voter2: SignerWithAddress,
    voter3: SignerWithAddress,
    daoAddress: string,
    stakingAddress: string,
    chairAddress: string,
    voter1Address: string,
    voter2Address: string,
    voter3Address: string;

  let clean: any; // snapshot

  before(async () => {
    [owner, chairPerson, voter1, voter2, voter3] = await ethers.getSigners();
    chairAddress = chairPerson.address;
    voter1Address = voter1.address;
    voter2Address = voter2.address;
    voter3Address = voter3.address;

    // --- Staking token deployment ---
    stakingToken = await deploy("Token", ["Voting Token", "VTT", DEFAULT_DECIMALS, tokenInitialBalance]);
    await stakingToken.transfer(voter1Address, accountBalance);
    await stakingToken.transfer(voter2Address, accountBalance);
    await stakingToken.transfer(voter3Address, accountBalance);

    // --- Reward token deployment ---
    rewardToken = await deploy("Token", ["XXX Coin", "XXX", DEFAULT_DECIMALS, tokenInitialBalance]);

    // --- Staking contract deployment ---
    staking = await deploy("Staking", [stakingToken.address, rewardToken.address, rewardPeriod, rewardPeriodMinUnit, rewardRate, unstakeFreezePeriod]);
    stakingAddress = staking.address;
    await stakingToken.connect(voter1).approve(stakingAddress, accountBalance);
    await stakingToken.connect(voter2).approve(stakingAddress, accountBalance);
    await stakingToken.connect(voter3).approve(stakingAddress, accountBalance);

    // --- DAO deployment ---
    dao = await deploy("DAO", [chairAddress, quorumPercentage, debatingPeriod]);
    daoAddress = dao.address;

    const adminRole = ethers.utils.id("ADMIN_ROLE");
    await staking.grantRole(adminRole, owner.address);
    await staking.setDAO(daoAddress);
    await dao.setStakingContract(stakingAddress);

    // stake some amount
    await staking.connect(voter1).stake(depositAmount);

    // --- prepare proposal ---
    const targetContractInterface = staking.interface;
    const callData = targetContractInterface.encodeFunctionData("updateUnstakeFreezePeriod", [newUnstakeFreezePeriod]);
    proposal = {
      recipientAddress: staking.address,
      callData,
      description: "Let's update staked tokens freeze period to 8 days",
    };

    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  afterEach(async () => {
    await network.provider.request({ method: "evm_revert", params: [clean] });
    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  describe("[addProposal]", () => {
    it("Should revert when chair person is not the same as sender", async () => {
      await expect(dao.connect(voter1).addProposal(
        proposal.recipientAddress, proposal.callData, proposal.description,
      )).to.be.revertedWith("Not enough permissions");
    });

    it("Should revert when proposal recipient is zero address", async () => {
      await expect(dao.connect(chairPerson).addProposal(
        ZERO_ADDRESS, proposal.callData, proposal.description,
      )).to.be.revertedWith("Not valid target address");
    });

    it("Should add a proposal", async () => {
      await expect(dao.connect(chairPerson).addProposal(proposal.recipientAddress, proposal.callData, proposal.description))
        .to.emit(dao, "ProposalAdded")
        .withArgs(proposalId, proposal.recipientAddress, proposal.description);
    });
  });

  describe("[vote]", () => {
    beforeEach(async () => {
      await dao.connect(chairPerson).addProposal(proposal.recipientAddress, proposal.callData, proposal.description);
    });

    it("Should revert when user didn't stake", async () => {
      await expect(dao.connect(voter2).vote(proposalId, true)).to.be.revertedWith("Voters should stake some amount first");
    });

    it("Should revert when proposal doesn't exist", async () => {
      await expect(dao.connect(voter1).vote(2, false)).to.be.revertedWith("Proposal is not active or doesn't exist");
    });

    it("Should revert when user has already voted for the proposal", async () => {
      await dao.connect(voter1).vote(proposalId, true);
      await expect(dao.connect(voter1).vote(proposalId, false)).to.be.revertedWith("Already voted");
    });

    it("Should add a user votes to the proposal", async () => {
      const isVoteFor = true;
      await expect(dao.connect(voter1).vote(proposalId, isVoteFor))
        .to.emit(dao, "Voted")
        .withArgs(proposalId, voter1Address, depositAmount, isVoteFor);
    });
  });

  describe("[finish]", () => {
    beforeEach(async () => {
      await dao.connect(chairPerson).addProposal(proposal.recipientAddress, proposal.callData, proposal.description);
      const isVoteFor = false;
      await dao.connect(voter1).vote(proposalId, isVoteFor);
    });

    it("Should revert when proposal doesn't exist", async () => {
      await expect(dao.finish(2)).to.be.revertedWith("Proposal is not active or doesn't exist");
    });

    it("Should revert when voting period is not over yet", async () => {
      await expect(dao.finish(proposalId)).to.be.revertedWith("Voting cannot be finished now");
    });

    it("Should unsuccessfully finish the voting when the number of votes is less than quorum", async () => {
      await increaseTime(debatingPeriod + 1);

      await expect(dao.finish(proposalId))
        .to.emit(dao, "VotingFinished")
        .withArgs(proposalId, ProposalResult.NotEnoughVotesReject);
    });

    it("Should unsuccessfully finish the voting when the number of votes for proposal is less than against", async () => {
      const isVoteFor = true;
      await staking.connect(voter2).stake(depositAmount);
      await dao.connect(voter2).vote(proposalId, isVoteFor);
      await increaseTime(debatingPeriod + 1);

      await expect(dao.finish(proposalId))
        .to.emit(dao, "VotingFinished")
        .withArgs(proposalId, ProposalResult.VotedAgainstReject);
    });

    it("Should unsuccessfully finish the voting when proposal has been not executed", async () => {
      const isVoteFor = true;
      await staking.connect(voter2).stake(depositAmount.add(5));

      await dao.connect(voter2).vote(proposalId, isVoteFor);
      await increaseTime(debatingPeriod + 1);

      await expect(dao.finish(proposalId))
        .to.emit(dao, "VotingFinished")
        .withArgs(proposalId, ProposalResult.ExecutionError);
    });

    it("Should successfully finish the voting and execute the proposal", async () => {
      const role = ethers.utils.id("DAO_ROLE");
      await staking.grantRole(role, daoAddress);

      const isVoteFor = true;
      await staking.connect(voter2).stake(depositAmount.add(5));
      await dao.connect(voter2).vote(proposalId, isVoteFor);
      await increaseTime(debatingPeriod + 1);

      await expect(dao.finish(proposalId))
        .to.emit(dao, "VotingFinished")
        .withArgs(proposalId, ProposalResult.Success);

      // checks that proposal has been executed
      expect(await staking.unstakeFreezePeriod()).to.equal(newUnstakeFreezePeriod);
    });
  });

  describe("After the voting has been finished", () => {
    beforeEach(async () => {
      // const daoRole = ethers.utils.id("DAO_ROLE");
      // await stakingToken.grantRole(daoRole, daoAddress);
      await dao.connect(chairPerson).addProposal(proposal.recipientAddress, proposal.callData, proposal.description);

      const isVoteFor = true;
      // await dao.connect(voter1).deposit(depositAmount);
      await dao.connect(voter1).vote(proposalId, isVoteFor);
      // await dao.connect(voter2).deposit(depositAmount);
      await staking.connect(voter2).stake(depositAmount);
      await dao.connect(voter2).vote(proposalId, isVoteFor);

      await increaseTime(debatingPeriod + 1);
      await dao.finish(proposalId);
    });

    it("[vote] Should revert when proposal has been already finished", async () => {
      // await dao.connect(voter3).deposit(depositAmount);
      await staking.connect(voter3).stake(depositAmount);
      await expect(dao.connect(voter3).vote(proposalId, false)).to.be.revertedWith("Proposal is not active or doesn't exist");
    });

    it("[finish] Should revert when proposal has been already finished", async () => {
      await expect(dao.finish(proposalId)).to.be.revertedWith("Proposal is not active or doesn't exist");
    });

  });

  describe("admin", () => {
    it("[updateDebatePeriod] Should set a new debating period", async () => {
      const newDebatePeriod = 5 * 24 * 60 * 60; // 5 days;

      await dao.updateDebatePeriod(newDebatePeriod);
      expect(await dao.debatePeriod()).to.equal(newDebatePeriod);
    });

    it("[updateQuorumPercentage] Should set a new quorum value", async () => {
      const newQuorumPercentage = 0; // 0%;

      await dao.updateQuorumPercentage(newQuorumPercentage);
      expect(await dao.quorumPercentage()).to.equal(newQuorumPercentage);

      // nobody voted
      await dao.connect(chairPerson).addProposal(proposal.recipientAddress, proposal.callData, proposal.description);
      await increaseTime(debatingPeriod + 1);
      await expect(dao.finish(proposalId))
        .to.emit(dao, "VotingFinished")
        .withArgs(proposalId, ProposalResult.NotEnoughVotesReject);
    });

    it("[updateChairPerson] Should set a new debating period", async () => {
      const newChairPerson = voter3Address;

      await dao.updateChairPerson(newChairPerson);
      expect(await dao.chairPerson()).to.equal(newChairPerson);
    });
  });

  describe("Unstake", () => {
    beforeEach(async () => {
      await dao.connect(chairPerson).addProposal(proposal.recipientAddress, proposal.callData, proposal.description);
      await dao.connect(voter1).vote(proposalId, true);
      await staking.connect(voter2).stake(depositAmount);
    });

    it("Should revert when user participates in still active votings in case of changing debate period to a shorter one", async () => {
      // user votes when debate period is 3 days
      await dao.connect(voter2).vote(proposalId, true);

      // change debate period to 2 days and add new proposal
      const newDebatePeriod = toDays(2);
      await dao.updateDebatePeriod(newDebatePeriod);
      await dao.connect(chairPerson).addProposal(proposal.recipientAddress, proposal.callData, proposal.description);

      // user votes for another proposal when debate period is 2 days
      await dao.connect(voter2).vote(proposalId + 1, true);

      await increaseTime(newDebatePeriod + 4 * 60 * 60);
      await expect(staking.connect(voter2).unstake()).to.be.revertedWith("Stakers with active dao votings cannot unstake");
    });

    it("Should revert if user participates in active votings", async () => {
      // tokens have been unlocked for unstake but there is still active voting
      await increaseTime(toDays(2));
      await expect(staking.connect(voter1).unstake()).to.be.revertedWith("Stakers with active dao votings cannot unstake");
    });

  });

});
