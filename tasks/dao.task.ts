import { task } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const DAO_ADDRESS = <string>process.env.DAO_ADDRESS;

task("addProposal", "Deposits user tokens")
  .addParam("recipientaddr", "The address of target contract")
  .addParam("calldata", "Proposal call data")
  .addParam("description", "Proposal description")
  .setAction(async ({ recipientaddr: recipientAddress, calldata, description }, hre) => {
    const dao = await hre.ethers.getContractAt("DAO", DAO_ADDRESS);
    await dao.addProposal(recipientAddress, calldata, description);
    console.log(`Proposal "${description}" has been added`);
  });

task("vote", "Adds a vote for or against the proposal")
  .addParam("proposalid", "The proposal id")
  .addParam("isfor", "Is vote for proposal")
  .setAction(async ({ proposalid: proposalId, isfor: isVoteForProposal }, hre) => {
    const dao = await hre.ethers.getContractAt("DAO", DAO_ADDRESS);
    await dao.vote(proposalId, isVoteForProposal);
    console.log(`Voted ${isVoteForProposal ? "for" : "against"} proposal ${proposalId}`);
  });

task("finish", "Finishes voting")
  .addParam("proposalid", "The proposal id")
  .setAction(async ({ proposalid: proposalId }, hre) => {
    const dao = await hre.ethers.getContractAt("DAO", DAO_ADDRESS);
    await dao.finish(proposalId);
    console.log(`Voting for the proposal ${proposalId} has been finished`);
  });
