//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./Token.sol";

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
    // 100 is 1%
    struct ReferralReward {
        uint saleRoundL1;
        uint saleRoundL2;
        uint tradeRoundL1;
        uint tradeRoundL2;
    }

    ReferralReward refReward;

    mapping (address => address) public referrers;

    /**
    * @dev Emitted when user registers in referral program
    * @param referrer Referrer address
    * @param referee Referee address
    */
    event UserRegistered(address indexed referee, address indexed referrer);

    /**
    * @dev Emitted when sale round is started
    * @param round Current round (sale or trade)
    * @param tokenPrice Ether price for one token
    * @param tokenAmount Amount of tokens for sale
    */
    event RoundStarted(RoundType indexed round, uint tokenPrice, uint tokenAmount);

    /**
    * @dev Emitted when trade round is started
    * @param round Current round (sale or trade)
    */
    event RoundStarted(RoundType indexed round);

    /**
    * @dev Emitted when someone buys tokens in the sale round
    * @param buyer Tokens buyer address
    * @param tokenAmount Token amount
    * @param spentEth Spent ether value
    */
    event SaleTokenBought(address indexed buyer, uint tokenAmount, uint spentEth);

    /**
    * @dev Emitted when seller adds a new order
    * @param id New order id
    * @param owner Order creator
    * @param amount Tokens amount to sell
    * @param price Price in ether for one token
    */
    event OrderAdded(uint indexed id, address indexed owner, uint amount, uint price);

    /**
    * @dev Emitted when seller cancels the order
    * @param id Order id to remove
    * @param returnedAmount Amount of left tokens which have been transferred back to the order creator
    */
    event OrderRemoved(uint indexed id, uint returnedAmount);

    /**
    * @dev Emitted when buyer redeems the order
    * @param id Order id to redeem
    * @param buyer Buyer address
    * @param amount Bought tokens amount
    * @param price Price in ether for one token
    */
    event OrderRedeemed(uint indexed id, address indexed buyer, uint amount, uint price);

    /**
    * @dev Emitted when referral reward percents is updated
    * @param round Current round
    * @param newLevel1Value Reward for level 1 referrer, 100 is 1%
    * @param newLevel2Value Reward for level 2 referrer, 100 is 1%
    */
    event RefRewardConfigUpdated(RoundType indexed round, uint newLevel1Value, uint newLevel2Value);

    /// @dev Checks is `round` is active
    modifier isRound(RoundType round) {
        if (currentRound.roundType == round && currentRound.endDate > block.timestamp) {
            _;
        } else {
            revert InappropriateRound();
        }
    }

    /// @dev Initializes the contract by setting a `token`, `roundDuration` and `referralRewardHolder`
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

    /**
    * @dev Registers `msg.sender` in the referral program
    * @param referrer Referrer address
    *
    * Requirements:
    * - `referrer` cannot be the zero address
    * - `referrer` cannot be the same address as `msg.sender`
    * - `referrer` should be already registered
    * - `msg.sender` should not have a reference
    *
    * Emits a {UserRegistered} event
    */
    function register(address referrer) external {
        require(referrer != address(0) && referrer != msg.sender, "Not valid referrer address");
        require(referrers[referrer] != address(0), "Referrer should be registered");
        require(referrers[msg.sender] == address(0), "Reference already exists");

        referrers[msg.sender] = referrer;
        emit UserRegistered(msg.sender, referrer);
    }

    /**
    * @dev Starts a sale round
    * Calculates and mints token amount for sale, sets ether price for one token
    *
    * Requirements:
    * - previous round should be a trade and already ended
    *
    * Emits a {RoundStarted} event
    */
    function startSaleRound() external {
        if (currentRound.roundType == RoundType.Sale || currentRound.endDate > block.timestamp) {
            revert InappropriateRound();
        }

        uint newTokenPrice = currentRound.salePriceInEth; // takes initial token price in the first round;
        if (currentRound.endDate > 0) {
            newTokenPrice = (newTokenPrice * 103) / 100 + 0.000004 ether; // uses formula: lastPrice*1,03+0,000004 in the next rounds
        }

        uint newTokenAmount = _calcTokenAmount(currentRound.tradeEthVolume, newTokenPrice);

        currentRound.endDate = block.timestamp + roundDuration;
        currentRound.roundType = RoundType.Sale;
        currentRound.saleTokensLeft = newTokenAmount;
        currentRound.salePriceInEth = newTokenPrice;
        currentRound.tradeEthVolume = 0;

        token.mint(address(this), newTokenAmount);

        emit RoundStarted(currentRound.roundType, newTokenPrice, newTokenAmount);
    }

    /**
    * @dev Transfers tokens to `msg.sender` for `msg.value`, gives a change
    * Transfers rewards to referrers
    *
    * Requirements:
    * - current round should be a sale
    * - should remain some tokens in the sale round
    * - `msg.value` should be enough for buying min amount of tokens
    *
    * Emits a {SaleTokenBought} event
    */
    function buySaleTokens() external payable isRound(RoundType.Sale) nonReentrant {
        uint tokensLeft = currentRound.saleTokensLeft;
        require(tokensLeft > 0, "No tokens left");

        uint amountToBuy = _calcTokenAmount(msg.value, currentRound.salePriceInEth);
        require(amountToBuy > 0, "Not enough ether to buy a token");

        if (amountToBuy > tokensLeft) {
            amountToBuy = tokensLeft; // can buy only available tokens
        }
        unchecked {
            currentRound.saleTokensLeft -= amountToBuy;
        }

        token.safeTransfer(msg.sender, amountToBuy);

        uint spentEth = _calcTokenCost(amountToBuy, currentRound.salePriceInEth);
        if (msg.value > spentEth) {
            _transferEth(msg.sender, msg.value - spentEth); // gives a change
        }

        // referral program
        address referrerL1 = referrers[msg.sender];
        if (referrerL1 != address(0)) {
            uint rewardL1 = _calcPercent(spentEth, refReward.saleRoundL1);
            _transferEth(referrerL1, rewardL1);

            uint rewardL2 = _calcPercent(spentEth, refReward.saleRoundL2);
            _transferEth(referrers[referrerL1], rewardL2);
        }

        emit SaleTokenBought(msg.sender, amountToBuy, spentEth);
    }

    /**
    * @dev Starts a trade round
    * Burns left from the sale round tokens
    *
    * Requirements:
    * - previous round should be a sale and already ended
    *
    * Emits a {RoundStarted} event
    */
    function startTradeRound() external {
        uint tokensLeft = currentRound.saleTokensLeft; // not sold tokens from the sale round
        if (currentRound.roundType == RoundType.Trade || (currentRound.endDate > block.timestamp && tokensLeft > 0)) {
            revert InappropriateRound();
        }

        if (tokensLeft > 0) {
            token.burn(address(this), tokensLeft);
            currentRound.saleTokensLeft = 0;
        }

        currentRound.roundType = RoundType.Trade;
        currentRound.endDate = block.timestamp + roundDuration;

        emit RoundStarted(currentRound.roundType);
    }

    /**
    * @dev Creates a new order
    * @param amount Tokens amount to sell
    * @param price Ether price for one token
    *
    * Requirements:
    * - current round should be a trade
    * - `amount` and `price` cannot be zero
    * - `msg.value` should have enough tokens to place
    *
    * Emits a {OrderAdded} event
    */
    function addOrder(uint amount, uint price) external isRound(RoundType.Trade) {
        require(price > 0 && amount > 0, "Not valid input price or amount");
        require(token.balanceOf(msg.sender) >= amount, "Not enough tokens");

        _currentOrderId = _currentOrderId + 1;
        Order storage order = _orders[_currentOrderId];
        order.owner = msg.sender;
        order.remainingAmount = amount;
        order.price = price;

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit OrderAdded(_currentOrderId, msg.sender, amount, price);
    }

    /**
    * @dev Cancels the order
    * @param id Order id to remove
    *
    * Requirements:
    * - order should exist with the order creator
    *
    * Emits a {OrderRemoved} event
    */
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

    /**
    * @dev Fills or partially fills the order and transfers tokens to `msg.sender` for `msg.value`, gives a change
    * Transfers rewards to referrers
    * @param id Order id to redeem
    *
    * Requirements:
    * - current round should be a trade
    * - order should exist
    * - should remain some tokens in the order
    * - `msg.value` should be enough for buying min amount of tokens
    *
    * Emits a {OrderRedeemed} event
    */
    function redeemOrder(uint id) external payable isRound(RoundType.Trade) nonReentrant {
        Order storage order = _orders[id];
        require(order.remainingAmount > 0, "Order doesn't exist or filled");

        uint amount = _calcTokenAmount(msg.value, order.price);
        require(amount > 0, "Not enough ether to buy a token");

        if (amount > order.remainingAmount) {
            amount = order.remainingAmount; // can buy only available tokens
        }
        unchecked {
            order.remainingAmount -= amount;
        }

        token.safeTransfer(msg.sender, amount);
        uint spentEth = _calcTokenCost(amount, order.price);
        uint rewardL1 = _calcPercent(spentEth, refReward.tradeRoundL1);
        uint rewardL2 = _calcPercent(spentEth, refReward.tradeRoundL2);

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

    /**
    * @dev Transfers ether in `amount` to recipient address
    * @param to Recipient address
    * @param amount Ether amount to transfer
    */
    function _transferEth(address to, uint amount) private {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Ether transfer failed");
    }

    /**
    * @dev Returns token amount
    * @param volumeInEth Ether total amount
    * @param priceInEth Price in ether for one token
    */
    function _calcTokenAmount(uint volumeInEth, uint priceInEth) private view returns(uint) {
        return volumeInEth * _tokenDecimalsMultiplier / priceInEth;
    }

    /**
    * @dev Returns token ether total amount
    * @param amount Tokens amount
    * @param priceInEth Price in ether for one token
    */
    function _calcTokenCost(uint amount, uint priceInEth) private view returns(uint) {
        return amount * priceInEth / _tokenDecimalsMultiplier;
    }

    /**
    * @dev Returns the share
    * @param amount Tokens amount
    * @param percent Percent value, 100 is 1%
    */
    function _calcPercent(uint amount, uint percent) private pure returns(uint) {
        return amount * percent / 10000;
    }

    // --- ADMIN functions ---
    /**
    * @dev Withdraws contract ether `amount` to recipient address
    * @param to Recipient address
    * @param amount Ether amount to withdraw
    *
    * Requirements:
    * - `to` cannot be the zero address
    * - `amount` and contract balance cannot be the zero
    */
    function withdrawEth(address to, uint amount) external onlyRole(ADMIN_ROLE) {
        require(to != address(0), "Not valid recipient address");
        require(amount > 0 && amount <= address(this).balance, "Insufficient ether amount to transfer");

        _transferEth(to, amount);
    }

    /**
    * @dev Sets new values of referral rewards
    * @param round Current round
    * @param level1 Reward for level 1 referrer, 100 is 1%
    * @param level2 Reward for level 2 referrer, 100 is 1%
    *
    * Emits a {RefRewardConfigUpdated} event
    */
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

    /**
    * @dev Sets a new value of the round duration
    * @param newRoundDuration New round duration
    */
    function updateRoundDuration(uint newRoundDuration) external onlyRole(ADMIN_ROLE) {
        roundDuration = newRoundDuration;
    }

    /**
    * @dev Sets a new address of the referral reward holder account
    * @param newReferralRewardHolder New referral reward holder address
    */
    function updateReferralRewardHolder(address newReferralRewardHolder) external onlyRole(ADMIN_ROLE) {
        referralRewardHolder = newReferralRewardHolder;
    }
}
