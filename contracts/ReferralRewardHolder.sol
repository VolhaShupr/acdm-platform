// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./Token.sol";

interface IUniswapV2Router02 {

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);

    function WETH() external pure returns (address);

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

contract ReferralRewardHolder is AccessControl {

    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    IUniswapV2Router02 public constant uniswapV2Router02 = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

    event Transferred(address to, uint amount);
    event Swapped(address tokenIn, address tokenOut, uint amountIn, uint amountOut);

    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @dev Receives ether to contract balance
    receive() external payable { }

    /**
    * @dev Withdraws ether to recipient address
    * @param to Recipient address
    *
    * Requirements:
    * - `to` cannot be the zero address
    * - contract balance cannot be the zero
    *
    * Emits a {Transferred} event
    */
    function withdrawEth(address to) external onlyRole(DAO_ROLE) {
        require(to != address(0), "Not valid recipient address");
        require(address(this).balance > 0, "Nothing to withdraw");

        (bool success, ) = to.call{value: address(this).balance}("");
        require(success, "Ether transfer failed");

        emit Transferred(to, address(this).balance);
    }

    /**
    * @dev Swaps contract ether to token via uniswap router and then burns these tokens
    * @param tokenOut Output token address
    * @param deadlineFromNow Period after which the swap transaction will revert
    *
    * Requirements:
    * - contract balance cannot be the zero
    *
    * Emits a {Swapped} event
    */
    function swapEthToTokenAndBurn(address tokenOut, uint deadlineFromNow) external onlyRole(DAO_ROLE) {
        uint deadline = block.timestamp + deadlineFromNow;
        uint amountIn = address(this).balance;
        require(amountIn > 0, "Nothing to swap");

        address[] memory path = new address[](2);
        path[0] = uniswapV2Router02.WETH();
        path[1] = tokenOut;

        uint[] memory amountsOutMin = uniswapV2Router02.getAmountsOut(amountIn, path); // obtains the minimum amount from a swap
        uint amountOutMin = amountsOutMin[path.length -1];

        uint[] memory amounts = uniswapV2Router02.swapExactETHForTokens{value: amountIn}(amountOutMin, path, address(this), deadline);
        uint amountOut = amounts[path.length -1];

        Token(tokenOut).burn(address(this), amountOut);

        emit Swapped(path[0], path[1], amountIn, amountOut);
    }

}
