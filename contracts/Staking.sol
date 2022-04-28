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
    IERC20 public stakingToken;
    IERC20 public rewardsToken;

    // @dev 64 bit `period` + 64 bit `periodUnit` + 128 bit `rate`
    // `period` Reward period for reward rate, e.g. 3% per week: period = 7 days
    // `periodUnit` Reward period minimal unit, e.g. reward calculated based on actual number of days: periodUnit = 1 day
    // `rate` Reward rate percent * 100, e.g. 300 is 3%
    // @note three variables are stored in one mainly for learning purposes
    uint rewardConfig;

    uint public unstakeFreezePeriod = 3 days;

    struct StakeData {
        uint staked; // total staked amount
        uint lastStakeDate;
        uint availableReward; // reward that is available to claim
        uint lastCalcRewardDate; // latest date when reward was calculated
    }

    mapping(address => StakeData) private _balances;

    event Staked(address indexed stakeholder, uint stakedAmount, uint availableReward);
    event Unstaked(address indexed stakeholder, uint unstakedAmount, uint availableReward);
    event Claimed(address indexed stakeholder, uint reward);
    event RewardConfigUpdated(uint newPeriod, uint newPeriodMinUnit, uint newRate);
    event UnstakeFreezePeriodUpdated(uint newPeriod);

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

    function stake(uint amount) external {
        require(amount > 0, "Not valid amount");

        StakeData storage userStake = _balances[msg.sender];
        _calculateReward(userStake);

        userStake.lastStakeDate = block.timestamp;
        userStake.staked += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, userStake.availableReward);
    }

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

    function claim() external {
        StakeData storage userStake = _balances[msg.sender];
        _calculateReward(userStake);

        require(userStake.availableReward > 0, "Nothing to claim");

        uint reward = userStake.availableReward;
        userStake.availableReward = 0;

        rewardsToken.safeTransfer(msg.sender, reward);
        emit Claimed(msg.sender, reward);
    }

    function getStakedAmountOf(address account) external view returns (uint) {
        return _balances[account].staked;
    }

    function getStakingTokenSupply() external view returns (uint) {
        return stakingToken.totalSupply();
    }

    function updateRewardConfig(uint newPeriod, uint newPeriodMinUnit, uint newRate) external onlyRole(DAO_ROLE) {
        rewardConfig = (((newPeriod << 64) + newPeriodMinUnit) << 128) + newRate;
        emit RewardConfigUpdated(newPeriod, newPeriodMinUnit, newRate);
    }

    function updateUnstakeFreezePeriod(uint newUnstakeFreezePeriod) external onlyRole(DAO_ROLE) {
        unstakeFreezePeriod = newUnstakeFreezePeriod;
        emit UnstakeFreezePeriodUpdated(newUnstakeFreezePeriod);
    }

    function getRewardConfig() public view returns (uint period, uint periodMinUnit, uint rate) {
        uint config = rewardConfig;
        period = config >> 192;
        periodMinUnit = (config << 64) >> 192;
        // rate = config_ & uint256(type(uint128).max);
        rate = (config << 128) >> 128;
    }

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
