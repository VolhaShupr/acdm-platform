import { task } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const PLATFORM_ADDRESS = <string>process.env.PLATFORM_ADDRESS;

task("startSaleRound", "Starts sale round")
  .setAction(async (_, hre) => {
    const platform = await hre.ethers.getContractAt("ACDMPlatform", PLATFORM_ADDRESS);
    await platform.startSaleRound();
    console.log("Sale round has been started");
  });

task("buySaleTokens", "Buys tokens during the sale round")
  .addParam("value", "The amount of ether")
  .setAction(async ({ value }, hre) => {
    const platform = await hre.ethers.getContractAt("ACDMPlatform", PLATFORM_ADDRESS);
    const valueWei = hre.ethers.utils.parseEther(value);
    await platform.buySaleTokens({ value: valueWei });
    console.log("Tokens have been bought");
  });

task("startTradeRound", "Starts trade round")
  .setAction(async (_, hre) => {
    const platform = await hre.ethers.getContractAt("ACDMPlatform", PLATFORM_ADDRESS);
    await platform.startTradeRound();
    console.log("Trade round has been started");
  });

task("addOrder", "Adds order for selling tokens")
  .addParam("amount", "The amount of acdm tokens")
  .addParam("price", "Price for one token in ether")
  .setAction(async ({ amount, price }, hre) => {
    const platform = await hre.ethers.getContractAt("ACDMPlatform", PLATFORM_ADDRESS);
    const value = hre.ethers.utils.parseUnits(amount, 6);
    const priceWei = hre.ethers.utils.parseEther(price);
    await platform.addOrder(value, priceWei);
    console.log("Order has been placed");
  });

task("removeOrder", "Removes the order")
  .addParam("orderid", "Order Id to cancel")
  .setAction(async ({ orderid }, hre) => {
    const platform = await hre.ethers.getContractAt("ACDMPlatform", PLATFORM_ADDRESS);
    await platform.removeOrder(orderid);
    console.log("Order has been removed");
  });

task("redeemOrder", "Redeems the order")
  .addParam("orderid", "Order Id to redeem")
  .addParam("value", "The amount of ether")
  .setAction(async ({ orderid, value }, hre) => {
    const platform = await hre.ethers.getContractAt("ACDMPlatform", PLATFORM_ADDRESS);
    const valueWei = hre.ethers.utils.parseEther(value);
    await platform.redeemOrder(orderid, { value: valueWei });
    console.log("Order has been removed");
  });
