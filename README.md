# 7-8 ACDM Platform
Sample contract

[Task description](https://docs.google.com/document/d/18xCTnH9dkKqxR3R1RxAwymShThFGjyvH9HSVbs1xzF0/edit?usp=sharing)

Deployed contracts:
- [XXX Token](https://rinkeby.etherscan.io/token/0xc927c39b5C2f844985289c4E8ebDf463038D4185)
- [LP Token](https://rinkeby.etherscan.io/token/0x7b6228578902468788021b7f27ade71c01e33042?a=0xc1f902fb8301dadc8bfd80bdab5ba3e8813b34e7) (ETH/XXX pair)
- [Staking](https://rinkeby.etherscan.io/address/0x27C1bDf5ca1a258901673aD0a8712CC34F3A8064)
- [DAO](https://rinkeby.etherscan.io/address/0xa9b467e0D68D0318276c8308914dF7552E7A4311)
- [ACDM Token](https://rinkeby.etherscan.io/token/0x2EF04fC1ff507050bE5d84005942Dc0c7fC20CA6)
- [Platform referral reward holder](https://rinkeby.etherscan.io/address/0x83b739eb56818CF6c7211D643508b7197c20BEbC)
- [ACDM Platform](https://rinkeby.etherscan.io/address/0x35c7faf47966bb95ec0b4faa3fe49be526656a95)


```shell
npx hardhat accounts

npx hardhat stake
npx hardhat unstake
npx hardhat claim

npx hardhat addProposal
npx hardhat vote
npx hardhat finish

npx hardhat startSaleRound
npx hardhat startTradeRound
npx hardhat buySaleTokens
npx hardhat addOrder
npx hardhat removeOrder
npx hardhat redeemOrder

npx hardhat run --network rinkeby scripts/deploy.ts
npx hardhat verify --network rinkeby DEPLOYED_CONTRACT_ADDRESS <arg>

npx hardhat test
npx hardhat coverage
npx hardhat size-contracts

npx hardhat help
npx hardhat node
npx hardhat compile
npx hardhat clean
```
