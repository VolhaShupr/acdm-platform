//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./DAO.sol";

contract Staking is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    DAO public dao;
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardsToken;

    // @dev 64 bit `period` + 64 bit `periodUnit` + 128 bit `rate`
    // `period` Reward period for reward rate, e.g. 3% per week: period = 7 days
    // `periodUnit` Reward period minimal unit, e.g. reward calculated based on actual number of days: periodUnit = 1 day
    // `rate` Reward rate percent * 100, e.g. 300 is 3%
    // three variables are stored in one mainly for learning purposes
    uint rewardConfig;

    uint public unstakeFreezePeriod = 3 days;

    struct StakeData {
        uint staked; // total staked amount
        uint lastStakeDate;
        uint availableReward; // reward that is available to claim
        uint lastCalcRewardDate; // latest date when reward was calculated
    }

    mapping(address => StakeData) private _balances;

    /**
    * @dev Emitted when user stakes tokens
    * @param stakeholder Stakeholder address
    * @param stakedAmount Staked amount
    * @param availableReward Available for claiming reward amount
    */
    event Staked(address indexed stakeholder, uint stakedAmount, uint availableReward);

    /**
    * @dev Emitted when user unstakes tokens
    * @param stakeholder Stakeholder address
    * @param unstakedAmount Unstaked amount
    * @param availableReward Available for claiming reward amount
    */
    event Unstaked(address indexed stakeholder, uint unstakedAmount, uint availableReward);

    /**
    * @dev Emitted when user claims reward tokens
    * @param stakeholder Stakeholder address
    * @param reward Claimed amount of reward
    */
    event Claimed(address indexed stakeholder, uint reward);

    /**
    * @dev Emitted when reward config has been updated
    * @param newPeriod New reward period value
    * @param newPeriodMinUnit Minimal period for which reward can be calculated
    * @param newRate New rate for given period, 100 is 1%
    */
    event RewardConfigUpdated(uint newPeriod, uint newPeriodMinUnit, uint newRate);

    /**
    * @dev Emitted when stake freeze period has been updated
    * @param newPeriod new freeze period, during which it is not allowed to unstake
    */
    event UnstakeFreezePeriodUpdated(uint newPeriod);

    /// @dev Initializes the contract by setting a `stakingToken`, `rewardsToken`, `unstakeFreezePeriod` and reward config
    constructor(
        address _stakingToken,
        address _rewardsToken,
        uint rewardPeriod,
        uint rewardPeriodMinUint,
        uint rewardRate,
        uint unstakeLockPeriod
    ) {
        stakingToken = IERC20(_stakingToken);
        rewardsToken = IERC20(_rewardsToken);
        rewardConfig = (((rewardPeriod << 64) + rewardPeriodMinUint) << 128) + rewardRate;
        unstakeFreezePeriod = unstakeLockPeriod;

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
    * @dev Sets dao contract
    * @param _dao Dao contract address
    */
    function setDAO(address _dao) external onlyRole(ADMIN_ROLE) {
        dao = DAO(_dao);
    }

    /**
    * @dev Transfers `msg.sender` tokens to the contract
    * @param amount Amount to stake
    *
    * Requirements:
    * - `amount` cannot be the zero
    *
    * Emits a {Staked} event
    */
    function stake(uint amount) external {
        require(amount > 0, "Not valid amount");

        StakeData storage userStake = _balances[msg.sender];
        _calculateReward(userStake);

        userStake.lastStakeDate = block.timestamp;
        userStake.staked += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, userStake.availableReward);
    }

    /**
    * @dev Transfers back tokens to `msg.sender` from the contract
    *
    * Requirements:
    * - `msg.sender` should stake some amount first
    * - unstake is possible after `unstakeFreezePeriod`
    * - `msg.sender` should not have active dao votings
    *
    * Emits a {Unstaked} event
    */
    function unstake() external {
        StakeData storage userStake = _balances[msg.sender];
        uint amount = userStake.staked;
        require(amount > 0, "Nothing to unstake");
        require((block.timestamp - userStake.lastStakeDate) > unstakeFreezePeriod, "Tokens are locked");
        require(!dao.hasActiveVotings(msg.sender), "Stakers with active dao votings cannot unstake");

        _calculateReward(userStake);

        userStake.staked = 0;

        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, userStake.availableReward);
    }

    /**
    * @dev Transfers reward tokens to `msg.sender`
    *
    * Requirements:
    * - `msg.sender` should have reward tokens to claim
    *
    * Emits a {Claimed} event
    */
    function claim() external {
        StakeData storage userStake = _balances[msg.sender];
        _calculateReward(userStake);

        require(userStake.availableReward > 0, "Nothing to claim");

        uint reward = userStake.availableReward;
        userStake.availableReward = 0;

        rewardsToken.safeTransfer(msg.sender, reward);
        emit Claimed(msg.sender, reward);
    }

    /**
    * @dev Returns staked amount of `account`
    * @param account Address
    */
    function getStakedAmountOf(address account) external view returns (uint) {
        return _balances[account].staked;
    }

    /**
    * @dev Returns staking token total supply
    */
    function getStakingTokenSupply() external view returns (uint) {
        return stakingToken.totalSupply();
    }

    /**
    * @dev Sets new values of the reward configs
    * @param newPeriod New reward period value
    * @param newPeriodMinUnit Minimal period for which reward can be calculated
    * @param newRate New rate for given period, 100 is 1%
    */
    function updateRewardConfig(uint newPeriod, uint newPeriodMinUnit, uint newRate) external onlyRole(DAO_ROLE) {
        rewardConfig = (((newPeriod << 64) + newPeriodMinUnit) << 128) + newRate;
        emit RewardConfigUpdated(newPeriod, newPeriodMinUnit, newRate);
    }

    /**
    * @dev Sets a new value of the reward unstake freeze period
    * @param newUnstakeFreezePeriod New unstake freeze period in seconds
    */
    function updateUnstakeFreezePeriod(uint newUnstakeFreezePeriod) external onlyRole(DAO_ROLE) {
        unstakeFreezePeriod = newUnstakeFreezePeriod;
        emit UnstakeFreezePeriodUpdated(newUnstakeFreezePeriod);
    }

    /**
    * @dev Returns reward config values: period, min unit of period and rate
    */
    function getRewardConfig() public view returns (uint period, uint periodMinUnit, uint rate) {
        uint config = rewardConfig;
        period = config >> 192;
        periodMinUnit = (config << 64) >> 192;
        // rate = config_ & uint256(type(uint128).max);
        rate = (config << 128) >> 128;
    }

    /**
    * @dev Calculates user reward, based on staked amount and reward config, and sets it to the storage
    * @param userStake User stake data
    */
    function _calculateReward(StakeData storage userStake) private {
        uint reward;
        if (userStake.staked > 0) {
            (uint period, uint periodMinUnit, uint rate) = getRewardConfig();

            uint timePassed = (block.timestamp - userStake.lastCalcRewardDate) / periodMinUnit;
            reward = (userStake.staked * rate * timePassed * periodMinUnit / period) / 10000;
        }

        userStake.availableReward += reward;
        userStake.lastCalcRewardDate = block.timestamp;
    }

}
