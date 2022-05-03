//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./Token.sol";

// import "hardhat/console.sol";
// console.log("Changing greeting from '%s' to '%s'", greeting, _greeting);

error InappropriateRound();

contract ACDMPlatform is Ownable, ReentrancyGuard {

    using SafeERC20 for Token;

    Token public immutable token;
    uint tokenDecimalsMultiplier;

    uint public roundDuration;

    enum RoundType { Sale, Trade }

    struct Round {
        uint endDate;
        RoundType roundType;
        uint saleTokensLeft;
        uint salePriceInEth;
        uint tradeEthVolume;
    }

    Round currentRound;

    struct Order {
        address owner;
        uint price;
        uint remainingAmount;
    }

    uint private _currentOrderId;

    mapping (uint => Order) private _orders;

    event RoundStarted(RoundType indexed roundType, uint tokenPrice, uint tokenAmount);
    event RoundStarted(RoundType indexed roundType);
    event SaleTokenBought(address indexed buyer, uint tokenAmount);
    event OrderAdded(uint indexed id, address indexed owner, uint amount, uint price);
    event OrderRemoved(uint indexed id, uint retrnedAmount);
    event OrderRedeemed(uint indexed id, address indexed buyer, uint amount, uint price);

    modifier isRound(RoundType roundType) {
        if (currentRound.roundType == roundType && currentRound.endDate > block.timestamp) {
            _;
        } else {
            revert InappropriateRound();
        }
    }

    constructor(address _token, uint _roundDuration) {
        token = Token(_token);
        tokenDecimalsMultiplier = 10 ** token.decimals();
        roundDuration = _roundDuration;

        currentRound.roundType = RoundType.Trade;
        currentRound.salePriceInEth = 0.00001 ether; // todo move to constructor parameters
        currentRound.tradeEthVolume = 1 ether;
    }

    function startSaleRound() external {
        if (currentRound.roundType == RoundType.Sale || currentRound.endDate > block.timestamp) {
            revert InappropriateRound();
        }

        uint lastPrice = currentRound.salePriceInEth;

        // takes initial token price in the first round
        // uses formula: lastPrice*1,03+0,000004 in the next rounds
        uint newTokenPrice = (currentRound.endDate > 0) ? (lastPrice * 103) / 100 + 0.000004 ether : lastPrice;
        currentRound.salePriceInEth = newTokenPrice;
        currentRound.endDate = block.timestamp + roundDuration;
        currentRound.roundType = RoundType.Sale;

        uint newTokenAmount = _calcTokenAmount(currentRound.tradeEthVolume, currentRound.salePriceInEth);
        currentRound.saleTokensLeft = newTokenAmount;
        currentRound.tradeEthVolume = 0;

        token.mint(address(this), newTokenAmount);

        emit RoundStarted(currentRound.roundType, newTokenPrice, newTokenAmount);
    }

    function buySaleTokens() external payable isRound(RoundType.Sale) nonReentrant {
        uint amountToBuy = _calcTokenAmount(msg.value, currentRound.salePriceInEth);
        require(amountToBuy > 0, "Not enough ether to buy a token");

        if (amountToBuy > currentRound.saleTokensLeft) {
            amountToBuy = currentRound.saleTokensLeft; // can buy only available tokens
        }

        // todo unchecked
        currentRound.saleTokensLeft -= amountToBuy;
        token.safeTransfer(msg.sender, amountToBuy);

        uint spentEth = amountToBuy * currentRound.salePriceInEth / tokenDecimalsMultiplier;
        if (msg.value > spentEth) {
            _transferEth(msg.sender, msg.value - spentEth); // gives a change
        }

        emit SaleTokenBought(msg.sender, amountToBuy);
    }

//    function getAvailableTokensAmountForSale() external returns (uint) {
//        return currentRound.endDate > block.timestamp ? currentRound.remainingTokens : 0;
//    }

    function startTradeRound() external {
        if (currentRound.roundType == RoundType.Trade ||
                (currentRound.endDate > block.timestamp && currentRound.saleTokensLeft > 0)) {
            revert InappropriateRound();
        }

        // end sale round
        if (currentRound.saleTokensLeft > 0) {
            token.burn(address(this), currentRound.saleTokensLeft);
            currentRound.saleTokensLeft = 0;
        }

        currentRound.roundType = RoundType.Trade;
        currentRound.endDate = block.timestamp + roundDuration;

        emit RoundStarted(currentRound.roundType);
    }

    function addOrder(uint amount, uint price) external isRound(RoundType.Trade) {
        require(price > 0, "Not valid price");
        require(amount > 0 && token.balanceOf(msg.sender) >= amount, "Not enough tokens");

        _currentOrderId += 1;
        Order storage order = _orders[_currentOrderId];
        order.owner = msg.sender;
        order.remainingAmount = amount;
        order.price = price;

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit OrderAdded(_currentOrderId, msg.sender, amount, price);
    }

    function removeOrder(uint id) external {
        Order storage order = _orders[id];
        require(msg.sender == order.owner, "Not valid order id");

        uint remainingAmount = order.remainingAmount;
        delete _orders[id];

        if (remainingAmount > 0) {
            token.safeTransfer(msg.sender, remainingAmount);
        }
        emit OrderRemoved(id, remainingAmount);
    }

    function redeemOrder(uint id) external payable isRound(RoundType.Trade) nonReentrant {
        Order storage order = _orders[id];
        require(order.price > 0, "Invalid order id");

        uint amount = _calcTokenAmount(msg.value, order.price);
        require(amount > 0, "Not enough ether to buy a token");
        // todo return to the buyer exceeded amount
        require(order.remainingAmount >= amount, "Not enough tokens left");

        order.remainingAmount -= amount;

        token.safeTransfer(msg.sender, amount);
        _transferEth(order.owner, msg.value);

        currentRound.tradeEthVolume += msg.value;

        // todo add partially filled or filled?
        emit OrderRedeemed(id, msg.sender, amount, order.price);
    }

    function withdrawEth(address to, uint amount) external onlyOwner {
        require(to != address(0), "Not valid recipient address");
        require(amount > 0 && amount <= address(this).balance, "Insufficient ether amount to transfer");

        _transferEth(to, amount);
    }

    function _transferEth(address to, uint amount) private {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Ether transfer failed");
    }

    function _calcTokenAmount(uint volumeInEth, uint priceInEth) private view returns(uint) {
        return volumeInEth * tokenDecimalsMultiplier / priceInEth;
    }

}
