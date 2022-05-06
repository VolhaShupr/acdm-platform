import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { deploy, toBigNumber, toMins, ZERO_ADDRESS } from "../helpers/helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as dotenv from "dotenv";
dotenv.config();

const tokenOutAddress = process.env.XXX_TOKEN_ADDRESS as string;

describe("ReferralRewardHolder", () => {
  const ethValue = toBigNumber(0.01);

  let rewardContract: Contract,
    tokenOut: Contract,
    uniswapRouter: Contract,
    owner: SignerWithAddress,
    dao: SignerWithAddress,
    platform: SignerWithAddress,
    ownerAddress: string;

  let clean: any; // snapshot

  before(async () => {
    [owner, dao, platform] = await ethers.getSigners();
    ownerAddress = owner.address;

    uniswapRouter = await ethers.getContractAt("IUniswapV2Router02", "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D");
    tokenOut = await ethers.getContractAt("Token", tokenOutAddress);
    rewardContract = await deploy("ReferralRewardHolder");

    const daoRole = ethers.utils.id("DAO_ROLE");
    await rewardContract.grantRole(daoRole, dao.address);

    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  afterEach(async () => {
    await network.provider.request({ method: "evm_revert", params: [clean] });
    clean = await network.provider.request({ method: "evm_snapshot", params: [] });
  });

  it("Should transfer contract ether to the specified recipient", async () => {
    await expect(rewardContract.connect(dao).withdrawEth(ZERO_ADDRESS)).to.be.revertedWith("Not valid recipient address");
    await expect(rewardContract.connect(dao).withdrawEth(ownerAddress)).to.be.revertedWith("Nothing to withdraw");

    await platform.sendTransaction({ to: rewardContract.address, value: ethValue }); // sends some ether to the contract

    await expect(await rewardContract.connect(dao).withdrawEth(ownerAddress)).to.changeEtherBalance(owner, ethValue);
    expect(await ethers.provider.getBalance(rewardContract.address)).to.equal(0);
  });

  it("Should swap contract eth to XXX token and burn it", async () => {
    const deadlineFromNow = toMins(1);
    await expect(rewardContract.connect(dao).swapEthToTokenAndBurn(tokenOutAddress, deadlineFromNow)).to.be.revertedWith("Nothing to swap");

    const initialTokenSupply = await tokenOut.totalSupply();
    const wethAddress = await uniswapRouter.WETH();
    const tokenOutMinAmounts = await uniswapRouter.getAmountsOut(ethValue, [wethAddress, tokenOutAddress]);
    const tokenOutAmount = tokenOutMinAmounts[tokenOutMinAmounts.length - 1];
    await platform.sendTransaction({ to: rewardContract.address, value: ethValue }); // sends some ether to the contract

    await expect(rewardContract.connect(dao).swapEthToTokenAndBurn(tokenOutAddress, deadlineFromNow))
      .to.emit(rewardContract, "Swapped")
      .withArgs(wethAddress, tokenOutAddress, ethValue, tokenOutAmount);

    expect(await tokenOut.totalSupply()).to.equal(initialTokenSupply.sub(tokenOutAmount));
    expect(await tokenOut.balanceOf(rewardContract.address)).to.equal(0);
  });

});
