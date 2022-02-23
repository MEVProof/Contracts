// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";



contract VerifierFudge {
  function verifyProof(
    bytes calldata proof,
    uint256[6] memory input
  ) public view returns (bool) {
    return true;
  }
}

contract HasherFudge {
  function hash(
    bytes calldata input
  ) public view returns (bytes32) {
    return bytes32(keccak256(input));
  }
}


contract ClientAndMM{
    
    // Tornado initialisation variables
    //using SafeERC20 for IERC20;
    //was IERC20
    IERC20 public _tokenA;
    IERC20 public _tokenB;

    // was Hasher
    HasherFudge public _hasher;

    
    // was IVerifier
    VerifierFudge public verifier;


    mapping(bytes32 => bool) public _nullifierHashes;
    // we store all commitments just to prevent accidental deposits with the same commitment
    mapping(bytes32 => bool) _registrations;

    mapping(bytes32 => bool) _committedOrders;
    // track active order commitments in each auction

    mapping(bytes32 => bool) _committedMarkets;
    // track active MM commitments in each auction

    Order[] _revealedBuyOrders;
    // track buy orders in each auction

    Order[] _revealedSellOrders;
    // track sell orders in each auction

    mapping(bytes32 => bool) _blacklistedNullifiers;
    uint256 _escrowClient;
    uint256 _escrowMM;
    uint256 _relayerFee;
    uint256 _tokenAFairValue;
    

    event DepositCreated(bytes32 regId);
    enum Direction {
        Buy,
        Sell
    }

    Phase _phase;

    enum Phase {
        Commit, Reveal, Resolution
    }
    struct Order {
        Direction _direction;
        uint256 _size;
        // Limit, Market or Withdraw
        uint256 _price;
        uint256 _maxTradeableWidth;
        address _owner;
    }

    struct Market{
        uint256 _bidPrice;
        uint256 _bidSize;
        uint256 _offerPrice;
        uint256 _offerSize;
        address _owner;
    }


    

    constructor(){
      
      // set appropriate relayer fee, maybe updatable?
      _relayerFee = 1;

      // set client escrow
      _escrowClient = 1;

      // set MM escrow
      //_escrowMM = 1000;

      // set tokenA fair value
      _tokenAFairValue = 1;

      // initialise phase as Commit
      _phase = Phase.Commit;

    }

    // should be nonReentrant 

    function Client_Register(bytes32 _regId) public payable returns (bool) {
        require(msg.value >= (_escrowClient + _relayerFee), "Client register must deposit escrow + relayer fee");

        require(!_registrations[_regId], "Registration ID already taken");

        _registrations[_regId] = true;

        emit DepositCreated(_regId);

        return true;
    }

    // should be nonReentrant 
    
    function Client_Commit( 
        bytes32 _orderHash,
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address _relayer
        ) external payable {
        require(!_nullifierHashes[_nullifierHash], "The note has been already spent");
        require(!_blacklistedNullifiers[_nullifierHash], "The note has been blacklisted");
        require(_phase==Phase.Commit, "Phase should be Commit" );
        //require(isKnownRoot(_root), "Cannot find your merkle root"); 
        // Make sure to use a recent one
        require(
            verifier.verifyProof(
                _proof,
                [uint256(_root), 
                uint256(_nullifierHash), 
                uint256(_orderHash), 
                uint256(uint160(_relayer)), 
                _relayerFee, 
                _escrowClient]
            ),
            "Invalid withdraw proof"
        );
        // record nullifier hash
        _nullifierHashes[_nullifierHash]= true;

        // record order commitment
        _committedOrders[_orderHash] = true;

        // pay relayer
        _processClientCommit(payable(_relayer));
    }

    // should be nonReentrant 
    
    function MM_Commit( 
        bytes32 _marketHash
        ) external payable {
        require(msg.value == _escrowMM, "MM register must deposit escrow");
        require(_phase==Phase.Commit, "Phase should be Commit" );
        // lodge MM escrow

        // record market commitment
        _committedMarkets[_marketHash] = true; 
    }

    // should be nonReentrant 

    function Client_Reveal( 
        bytes32 _orderHash,
        Order memory _order,
        bytes32 _nullifier,
        bytes32 _randomness,
        bytes32 _regId,
        bytes32 _newRegId
        ) external payable{

        require(_phase== Phase.Reveal, "Phase should be Reveal");

        require(_hasher.hash(abi.encodePacked([_nullifier, _randomness])) == _regId, "secrets don't match registration ID");

        require(_registrations[_regId], "The registration doesn't exist");

        // this should hash all order information. Ensure abi.encodePacked maps uniquely.
        require(_hasher.hash(abi.encodePacked([uint256(_order._direction), _order._size, _order._price, _order._maxTradeableWidth])) == bytes32(_orderHash), "order does not match commitment"); 

        require(_committedOrders[_orderHash], "order not committed");
        
        // order is a buy order
        if (_order._direction == Direction.Buy) {
            // order size should be reduced to reflect the escrow
            _revealedBuyOrders.push(_order);
        }

        // order is a sell 
        if (_order._direction == Direction.Sell) {
            // order size should be reduced to reflect the escrow
            _revealedSellOrders.push(_order);
        }

        // remove order commitment
        _committedOrders[_orderHash] = false;

        _registrations[_regId] = false;

        if (_newRegId == 0) {
            _processClientEscrowReturn();
        } else {
            require(msg.value == _relayerFee, "re-register must deposit relayer fee");
            _registrations[_newRegId] = true;
        }
    }

    // should be nonReentrant 

    function MM_Reveal( 
        bytes32 _marketHash,
        Market memory _market,
        bytes32 _nullifier,
        bytes32 _randomness,
        bytes32 _regId,
        bytes32 _newRegId
        ) external payable{

        
        require(_phase== Phase.Reveal, "Phase should be Reveal");

        // this should hash all market information. Ensure abi.encodePacked maps uniquely.
        require(_hasher.hash(abi.encodePacked([_market._bidPrice,_market._bidSize,_market._offerPrice,_market._offerSize])) == bytes32(_marketHash), "market does not match commitment"); 

        require(_committedMarkets[_marketHash], "Market not recorded");
        require(_tokenA.balanceOf(msg.sender)>= _market._bidSize, "Not enough bid tokens");
        require(_tokenB.balanceOf(msg.sender)>= _market._offerSize, "Not enough offer tokens");

        _processMMmarketDeposits(_tokenA, _market._bidSize);
        _processMMmarketDeposits(_tokenB, _market._offerSize);
        
        // add bid as buy Order. In the paper we treat markets differently for the main Thm. This has marginal gains on just adding all orders, and is more complex

        Order memory _bid;
        _bid._direction= Direction.Buy;

        // this should be reduced to reflect escrow
        _bid._size=_market._bidSize;

        _bid._price=_market._bidPrice;

        // set to max Value
        _bid._maxTradeableWidth= 1;

        _bid._owner=msg.sender;

        _revealedBuyOrders.push(_bid);
        
        Order memory _sell;
        _sell._direction= Direction.Sell;

        // this should be reduced to reflect escrow
        _sell._size=_market._offerSize;

        _sell._price=_market._offerPrice;

        // set to max Value
        _sell._maxTradeableWidth= 1;

        _sell._owner=msg.sender;

        _revealedBuyOrders.push(_sell);
        

        // remove order commitment
        _committedMarkets[_marketHash] = false;

        // return sscrow to MM
        _processMMEscrowReturn();
    }


    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return _nullifierHashes[_nullifierHash];
    }
    

    


    function _processClientCommit(
        address payable _relayer
        ) internal {
        _relayer.transfer(_relayerFee);
    }
    function _processMMmarketDeposits(IERC20 _token, uint256 _amount) internal {
        _token.transferFrom(msg.sender, address(this), _amount);
    }
    
    function _checkRegIDs(bytes32 _regId) public view returns (bool regIDisPresent) {
        return _registrations[_regId];
    }


    function _processMMEscrowReturn() internal {
        payable(msg.sender).transfer(_escrowMM);
    }
    function _processClientEscrowReturn() internal {
        payable(msg.sender).transfer(_escrowClient);
    }

    function _getContractBalance() public view returns (uint256){
        return address(this).balance;
    }

    function _getPlayerBalance() public view returns (uint256){
        return msg.sender.balance;
    }

    
}
