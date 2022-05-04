//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./Token.sol";

// import "hardhat/console.sol";
// console.log("Changing greeting from '%s' to '%s'", greeting, _greeting);

error InappropriateRound();

contract ACDMPlatform is AccessControl, ReentrancyGuard {

    using SafeERC20 for Token;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    Token public immutable token;
    uint private immutable _tokenDecimalsMultiplier;

    uint public roundDuration;

    address public referralRewardHolder;

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

    // tried to pack into 2 uint256 variables, but the size increased
    struct ReferralReward {
        uint saleRoundL1;
        uint saleRoundL2;
        uint tradeRoundL1;
        uint tradeRoundL2;
    }

    ReferralReward refReward;

    mapping (address => address) public referrers;

    event UserRegistered(address indexed referee, address indexed referrer);
    event RoundStarted(RoundType indexed roundType, uint tokenPrice, uint tokenAmount);
    event RoundStarted(RoundType indexed roundType);
    event SaleTokenBought(address indexed buyer, uint tokenAmount);
    event OrderAdded(uint indexed id, address indexed owner, uint amount, uint price);
    event OrderRemoved(uint indexed id, uint retrnedAmount);
    event OrderRedeemed(uint indexed id, address indexed buyer, uint amount, uint price);
    event RefRewardConfigUpdated(RoundType indexed roundType, uint newLevel1Value, uint newLevel2Value);

    modifier isRound(RoundType roundType) {
        if (currentRound.roundType == roundType && currentRound.endDate > block.timestamp) {
            _;
        } else {
            revert InappropriateRound();
        }
    }

    constructor(address _token, uint _roundDuration, address _referralRewardHolder) {
        token = Token(_token);
        _tokenDecimalsMultiplier = 10 ** token.decimals();
        roundDuration = _roundDuration;

        currentRound.roundType = RoundType.Trade;
        currentRound.salePriceInEth = 0.00001 ether; // can be moved to constructor parameters
        currentRound.tradeEthVolume = 1 ether;

        refReward.saleRoundL1 = 500; // 5%
        refReward.saleRoundL2 = 300; // 3%
        refReward.tradeRoundL1 = 250; // 2.5%
        refReward.tradeRoundL2 = 250; // 2.5%

        referrers[msg.sender] = msg.sender; // register first referrer

        referralRewardHolder = _referralRewardHolder;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function register(address referrer) external {
        require(referrer != address(0), "Not valid referrer address");
        require(referrer != msg.sender, "Not valid referrer address");
        require(referrers[referrer] != address(0), "Referrer should be registered");
        require(referrers[msg.sender] == address(0), "Reference already exists");

        referrers[msg.sender] = referrer;
        emit UserRegistered(msg.sender, referrer);
    }

    function startSaleRound() external {
        if (currentRound.roundType == RoundType.Sale || currentRound.endDate > block.timestamp) {
            revert InappropriateRound();
        }

        // takes initial token price in the first round; uses formula: lastPrice*1,03+0,000004 in the next rounds
        uint lastPrice = currentRound.salePriceInEth;
        uint newTokenPrice = (currentRound.endDate > 0) ? (lastPrice * 103) / 100 + 0.000004 ether : lastPrice;
        uint newTokenAmount = _calcTokenAmount(currentRound.tradeEthVolume, newTokenPrice);

        currentRound.endDate = block.timestamp + roundDuration;
        currentRound.roundType = RoundType.Sale;
        currentRound.saleTokensLeft = newTokenAmount;
        currentRound.salePriceInEth = newTokenPrice;
        currentRound.tradeEthVolume = 0;

        token.mint(address(this), newTokenAmount);

        emit RoundStarted(currentRound.roundType, newTokenPrice, newTokenAmount);
    }

    function buySaleTokens() external payable isRound(RoundType.Sale) nonReentrant {
        require(currentRound.saleTokensLeft > 0, "No tokens left");

        uint amountToBuy = _calcTokenAmount(msg.value, currentRound.salePriceInEth);
        require(amountToBuy > 0, "Not enough ether to buy a token");

        if (amountToBuy > currentRound.saleTokensLeft) {
            amountToBuy = currentRound.saleTokensLeft; // can buy only available tokens
        }

        // todo unchecked
        currentRound.saleTokensLeft -= amountToBuy;
        token.safeTransfer(msg.sender, amountToBuy);

        uint spentEth = amountToBuy * currentRound.salePriceInEth / _tokenDecimalsMultiplier;
        if (msg.value > spentEth) {
            _transferEth(msg.sender, msg.value - spentEth); // gives a change
        }

        // referral program
        address referrerL1 = referrers[msg.sender];
        if (referrerL1 != address(0)) {
            uint rewardL1 = spentEth * refReward.saleRoundL1 / 10000;
            _transferEth(referrerL1, rewardL1);

            uint rewardL2 = spentEth * refReward.saleRoundL2 / 10000;
            _transferEth(referrers[referrerL1], rewardL2);
        }

        emit SaleTokenBought(msg.sender, amountToBuy);
    }

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
        require(order.remainingAmount > 0, "Order doesn't exist or completed");

        uint amount = _calcTokenAmount(msg.value, order.price);
        require(amount > 0, "Not enough ether to buy a token");

        if (amount > order.remainingAmount) {
            amount = order.remainingAmount; // can buy only available tokens
        }

        // todo unchecked
        order.remainingAmount -= amount;

        token.safeTransfer(msg.sender, amount);
        uint spentEth = amount * order.price / _tokenDecimalsMultiplier;
        uint rewardL1 = spentEth * refReward.tradeRoundL1 / 10000;
        uint rewardL2 = spentEth * refReward.tradeRoundL2 / 10000;

        _transferEth(order.owner, spentEth - rewardL1 - rewardL2);
        if (msg.value > spentEth) {
            _transferEth(msg.sender, msg.value - spentEth); // gives a change
        }

        // referral program
        address referrerL1 = referrers[order.owner];
        if (referrerL1 != address(0)) {
            _transferEth(referrerL1, rewardL1);
            _transferEth(referrers[referrerL1], rewardL2);
        } else {
            _transferEth(referralRewardHolder, rewardL1 + rewardL2);
        }

        currentRound.tradeEthVolume += spentEth;

        emit OrderRedeemed(id, msg.sender, amount, order.price);
    }

    function _transferEth(address to, uint amount) private {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Ether transfer failed");
    }

    function _calcTokenAmount(uint volumeInEth, uint priceInEth) private view returns(uint) {
        return volumeInEth * _tokenDecimalsMultiplier / priceInEth;
    }

    // --- ADMIN functions ---
    function withdrawEth(address to, uint amount) external onlyRole(ADMIN_ROLE) {
        require(to != address(0), "Not valid recipient address");
        require(amount > 0 && amount <= address(this).balance, "Insufficient ether amount to transfer");

        _transferEth(to, amount);
    }

    function updateRefRewards(RoundType round, uint level1, uint level2) external onlyRole(DAO_ROLE) {
        if (round == RoundType.Sale) {
            refReward.saleRoundL1 = level1;
            refReward.saleRoundL2 = level2;
        } else {
            refReward.tradeRoundL1 = level1;
            refReward.tradeRoundL2 = level2;
        }
        emit RefRewardConfigUpdated(round, level1, level2);
    }

    function updateRoundDuration(uint newRoundDuration) external onlyRole(ADMIN_ROLE) {
        roundDuration = newRoundDuration;
    }

    function updateReferralRewardHolder(address newReferralRewardHolder) external onlyRole(ADMIN_ROLE) {
        referralRewardHolder = newReferralRewardHolder;
    }
}
