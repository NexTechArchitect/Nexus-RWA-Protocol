// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ====================================================================
// CHAINLINK CCIP CLIENT STRUCTS
// ====================================================================
library Client {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }
    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        EVMTokenAmount[] destTokenAmounts;
    }
    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        EVMTokenAmount[] tokenAmounts;
        address feeToken;
        bytes extraArgs;
    }
}

interface IRouterClient {
    function getFee(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message) external view returns (uint256 fee);
    function ccipSend(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message) external payable returns (bytes32);
}

// ====================================================================
// CROSS CHAIN BRIDGE
// ====================================================================
/// @title CrossChainBridge
/// @notice Handles securely bridging RWA tokens across multiple chains using Chainlink CCIP.
contract CrossChainBridge is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable i_ccipRouter;
    address public immutable i_rwaToken;

    mapping(uint64 => address) public s_peerBridges;
    mapping(uint64 => bool) public s_supportedChains;

    event TokensBridged(bytes32 indexed messageId, uint64 indexed destinationChain, address indexed receiver, uint256 amount);
    event TokensReceived(bytes32 indexed messageId, uint64 indexed sourceChain, address indexed receiver, uint256 amount);
    event ChainConfigured(uint64 indexed chainSelector, address indexed peerBridge, bool supported);

    error ZeroAddress();
    error ZeroAmount();
    error ChainNotSupported(uint64 chainSelector);
    error InsufficientFee(uint256 required, uint256 provided);
    error UnauthorizedRouter(address caller);
    error UnauthorizedSender(uint64 sourceChain, bytes sender);

    constructor(address router_, address token_) Ownable(msg.sender) {
        if (router_ == address(0) || token_ == address(0)) revert ZeroAddress();
        i_ccipRouter = router_;
        i_rwaToken = token_;
    }

    /// @notice Configures a destination chain and its corresponding peer bridge address
    function setDestinationChain(uint64 chainSelector, address peerBridge, bool supported) external onlyOwner {
        if (peerBridge == address(0) && supported) revert ZeroAddress();
        s_peerBridges[chainSelector] = peerBridge;
        s_supportedChains[chainSelector] = supported;
        emit ChainConfigured(chainSelector, peerBridge, supported);
    }

    function isChainSupported(uint64 chainSelector) external view returns (bool) {
        return s_supportedChains[chainSelector];
    }

    /// @notice Locks tokens on the source chain and triggers CCIP to send them to the destination chain.
    function bridgeTokens(uint64 destinationChain, address receiver, uint256 amount) 
        external 
        payable 
        nonReentrant 
        returns (bytes32 messageId) 
    {
        if (!s_supportedChains[destinationChain]) revert ChainNotSupported(destinationChain);
        if (amount == 0) revert ZeroAmount();

        // Lock tokens inside the Bridge
        IERC20(i_rwaToken).safeTransferFrom(msg.sender, address(this), amount);

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({
            token: i_rwaToken,
            amount: amount
        });

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(s_peerBridges[destinationChain]),
            data: abi.encode(receiver),
            tokenAmounts: tokenAmounts,
            feeToken: address(0), // Pay CCIP fee in native gas token
            extraArgs: ""
        });

        uint256 fee = IRouterClient(i_ccipRouter).getFee(destinationChain, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        messageId = IRouterClient(i_ccipRouter).ccipSend{value: fee}(destinationChain, message);

        // Refund any excess ETH back to user
        if (msg.value > fee) {
            (bool success, ) = msg.sender.call{value: msg.value - fee}("");
            require(success, "Refund failed");
        }

        emit TokensBridged(messageId, destinationChain, receiver, amount);
    }

    /// @notice Called exclusively by the CCIP Router when receiving a cross-chain message.
    function ccipReceive(Client.Any2EVMMessage calldata message) external nonReentrant {
        if (msg.sender != i_ccipRouter) revert UnauthorizedRouter(msg.sender);
        
        uint64 srcChain = message.sourceChainSelector;
        if (!s_supportedChains[srcChain]) revert ChainNotSupported(srcChain);

        address expectedSender = s_peerBridges[srcChain];
        address actualSender = abi.decode(message.sender, (address));
        
        if (expectedSender != actualSender) revert UnauthorizedSender(srcChain, message.sender);

        address receiver = abi.decode(message.data, (address));
        uint256 amountToUnlock = message.destTokenAmounts[0].amount;

        // Unlock tokens and send to user
        IERC20(i_rwaToken).safeTransfer(receiver, amountToUnlock);

        emit TokensReceived(message.messageId, srcChain, receiver, amountToUnlock);
    }
}