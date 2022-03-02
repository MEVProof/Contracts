// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./MerkleTreeWithHistory.sol";

interface IVerifier {
    function verifyProof(bytes calldata proof, uint[6] calldata inputs) external view returns (bool r);
}

contract ClientAndMM is MerkleTreeWithHistory {
    IVerifier public immutable _verifier;
    IERC20 public _tokenA;
    IERC20 public _tokenB;

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


    Phase _phase;


    //Exchange variables from Padraic's code
    uint256 _wTight=type(uint256).max;
    uint256 public constant _minTickSize = 1;
    uint256 constant _clearingPricePrecision = 1000;
    uint256 _currentAuctionNotional=0;
    uint256 constant _anyWidthValue = type(uint256).max;
    uint256 constant _marketOrderValue = type(uint256).max;

    enum Phase {
        Commit, Reveal, Resolution
    }
    struct Order {
        bool _isBuyOrder;
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

    function getMinTickSize() public view returns (uint256) {
         return _minTickSize;
    }

    function hash(
        bytes memory input
        ) public view returns (bytes32) {
         return bytes32(keccak256(input));
    }

    uint32 public constant _merkleTreeHeight = 20;

    constructor(IVerifier verifier, IHasher hasher, IERC20 token_a, IERC20 token_b) MerkleTreeWithHistory(_merkleTreeHeight, hasher){
        _verifier = verifier;
        _tokenA = token_a;
        _tokenB = token_b;

        // set appropriate relayer fee, maybe updatable?
        _relayerFee = 1;

        // set client escrow
        _escrowClient = 1;

        // set MM escrow
        _escrowMM = 10;

        // set tokenA fair value
        _tokenAFairValue = 1;

        // initialise phase as Commit
        _phase = Phase.Commit;
    }

    // should be nonReentrant 

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);

    function Client_Register(bytes32 _regId) public payable returns (bool) {
        require(msg.value >= (_escrowClient + _relayerFee), "Client register must deposit escrow + relayer fee");
        require(!_registrations[_regId], "Registration ID already taken");

        uint32 insertedIndex = _insert(_regId);
        _registrations[_regId] = true;

        emit Deposit(_regId, insertedIndex, block.timestamp);

        return true;
    }

    event ClientCommitment(bytes _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        bytes32 _orderHash,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund);

    function Client_Commit( 
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        bytes32 _orderHash,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund

        ) external payable returns (bool) {
        require(!_nullifierHashes[_nullifierHash], "The note has been already spent");
        require(!_blacklistedNullifiers[_nullifierHash], "The note has been blacklisted");
        require(_phase==Phase.Commit, "Phase should be Commit" );
        require(isKnownRoot(_root), "Cannot find your merkle root"); 
        // Make sure to use a recent one

        emit ClientCommitment(_proof, _root, _nullifierHash, _orderHash, _relayer, _fee, _refund);

  //      return true;

        require(
            _verifier.verifyProof(
                _proof,
                [uint256(_root), 
                uint256(_nullifierHash), 
                uint256(_orderHash), 
                uint256(uint160(address(_relayer))), 
                _fee, 
                _refund]
            ),
            "Invalid withdraw proof"
        );

        // TODO: Do we want to allow commiting a new order using the same deposit? Eg amending an
        // order before the end of the commit phase without burning a deposit?
        // If so we'll need to rework the lines below - Padraic

        // record nullifier hash
        _nullifierHashes[_nullifierHash]= true;

        // record order commitment
        _committedOrders[_orderHash] = true;

        // pay relayer
        _processClientCommit(payable(msg.sender));

        return true;
    }

    // should be nonReentrant 
    
    function MM_Commit( 
        bytes32 _marketHash
        ) external payable {
        require(_phase==Phase.Commit, "Phase should be Commit" );
        require(msg.value >= _escrowMM, "MM register must deposit escrow");
        
        // lodge MM escrow

        // record market commitment
        _committedMarkets[_marketHash] = true; 
    }

    // should be nonReentrant 


    function Move_To_Commit_Phase( 
        ) external returns (bool) {
        _phase = Phase.Commit;
        return true;
    }
    function Move_To_Reveal_Phase( 
        ) external returns (bool) {
        _phase = Phase.Reveal;
        return true;
    }
    function Move_To_Resolution_Phase( 
        ) external returns (bool) {
        _phase = Phase.Resolution;
        return true;
    }

    event OrderHashed(Order order, bytes32 hashed, bytes32 expectedHash);

    function HashOrderTest(Order memory _order, bytes32 expectedHash) public returns (bytes32 hashed) {
        hashed = keccak256(abi.encodePacked(_order._isBuyOrder, _order._size, _order._price, _order._maxTradeableWidth, _order._owner));
        emit OrderHashed(_order, hashed, expectedHash);

        //require(keccak256(abi.encodePacked(_order._isBuyOrder, _order._size, _order._price, _order._maxTradeableWidth, _order._owner)) == _orderHash, "order does not match commitment");

    }
    
    function Client_Reveal( 
        bytes32 _orderHash,
        Order memory _order,
        uint256 _nullifier,
        uint256 _randomness,
        bytes32 _regId,
        bytes32 _newRegId
        ) external payable returns (bool) {


        HashOrderTest(_order, _orderHash);

        require(_phase== Phase.Reveal, "Phase should be Reveal");
        require(hash(abi.encodePacked([_nullifier, _randomness])) == _regId, "secrets don't match registration ID");
        // this should hash all order information. Ensure abi.encodePacked maps uniquely.

        require(_committedOrders[_orderHash], "order not committed");
        require(keccak256(abi.encodePacked(_order._isBuyOrder, _order._size, _order._price, _order._maxTradeableWidth, _order._owner)) == _orderHash, "order does not match commitment");

        require(_registrations[_regId], "The registration doesn't exist");        
        
        // order is a buy order
        if (_order._isBuyOrder) {
            // order size should be reduced to reflect the escrow
            
            _processReveal(_tokenA, _order._size);
            _revealedBuyOrders.push(_order);
        }
        else {
            // order size should be reduced to reflect the escrow
            _processReveal(_tokenB, _order._size);
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
        return true;
    }

    // should be nonReentrant 

    function MM_Reveal( 
        bytes32 _marketHash,
        Market memory _market
        ) external payable returns (bool){

        
        require(_phase== Phase.Reveal, "Phase should be Reveal");

        // this should hash all market information. Ensure abi.encodePacked maps uniquely.
        require(hash(abi.encodePacked(_market._bidPrice, _market._bidSize, _market._offerPrice, _market._offerSize, _market._owner)) == _marketHash, "market does not match commitment"); 

        require(_committedMarkets[_marketHash], "Market not recorded");
        

        _processReveal(_tokenA, _market._bidSize);
        _processReveal(_tokenB, _market._offerSize);
        
        // add bid as buy Order. In the paper we treat markets differently for the main Thm. This has marginal gains on just adding all orders, and is more complex



        Order memory _bid;
        _bid._isBuyOrder= true ;

        // this should be reduced to reflect escrow
        _bid._size=_market._bidSize;

        _bid._price=_market._bidPrice;

        // set to max Value
        _bid._maxTradeableWidth= 100;

        _bid._owner=msg.sender;

        _revealedBuyOrders.push(_bid);
        
        Order memory _offer;
        _offer._isBuyOrder= false;

        // this should be reduced to reflect escrow
        _offer._size=_market._offerSize;

        _offer._price=_market._offerPrice;

        // set to max Value
        _offer._maxTradeableWidth= 100;

        _offer._owner=msg.sender;

        _revealedSellOrders.push(_offer);
        
        if (_market._offerPrice-_market._bidPrice<_wTight) {
            _wTight = _market._offerPrice-_market._bidPrice;
        }
        

        // remove order commitment
        _committedMarkets[_marketHash] = false;

        // return sscrow to MM
        _processMMEscrowReturn();
        return true;
    }


    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return _nullifierHashes[_nullifierHash];
    }
    

    function _processReveal(IERC20 _token, uint256 _amount) internal {
        _token.transferFrom(msg.sender, address(this), _amount);
    }

    function _processOrderSettlement(IERC20 _token, uint256 _amount, address recipient) internal {
        _token.transfer( recipient , _amount);
    }
    
    function _processClientCommit(
        address payable _relayer
        ) internal {
        _relayer.transfer(_relayerFee);
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


    function Abs(int256 x ) private pure returns (int256) {
        return x >= 0 ? x : -x;
    }
    
    function MulByClearingPrice(uint256 value, uint256 clearingPrice) pure internal returns (uint256) {
        return SafeMath.div(SafeMath.mul(SafeMath.mul(value, _clearingPricePrecision), clearingPrice), _clearingPricePrecision);
    }

    function DivideBy(uint256 value, uint256 clearingPrice) pure internal returns (uint256) {
        return SafeMath.div(SafeMath.div(SafeMath.mul(value, _clearingPricePrecision), clearingPrice), _clearingPricePrecision);
    }

    event CheckerEvent1(uint256 clearingPrice, uint256 buyVolume, uint256 sellVolume);

    


    function Settlement(uint256 clearingPrice, uint256 volumeSettled, int256 imbalance) public {
        // Deposit bounty
        require(_revealedSellOrders.length + _revealedBuyOrders.length > 0, "No orders");

        uint256 revealedBuyOrderCount = _revealedBuyOrders.length;
        uint256 revealedSellOrderCount = _revealedSellOrders.length;
        // Compute max(buyOrders.price) and min(sellOrders.price)
        uint256 maxBuyPrice = 0;
        uint256 minSellPrice = type(uint256).max;

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            if (_revealedBuyOrders[i]._price > maxBuyPrice) {
                maxBuyPrice = _revealedBuyOrders[i]._price;
            }
        }
        for (uint i = 0; i < revealedSellOrderCount; i++) {
            if (_revealedSellOrders[i]._price < minSellPrice) {
                minSellPrice = _revealedSellOrders[i]._price;
            }
        }

        

        require(volumeSettled > 0 || (minSellPrice < maxBuyPrice), "req 1"); // TODO: Min sell less than max bid if no trades?

        // Compute buyVolume and sellVolume
        uint256 buyVolume = 0;
        uint256 sellVolume = 0;        

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            if (_revealedBuyOrders[i]._price >= clearingPrice) {
                buyVolume += _revealedBuyOrders[i]._size;
            }
        }

        for (uint i = 0; i < revealedSellOrderCount; i++) {
            if (_revealedSellOrders[i]._price <= clearingPrice) {
                sellVolume += _revealedSellOrders[i]._size;
            }
        }
        
        emit CheckerEvent1(clearingPrice, buyVolume, sellVolume);
        

        require(Math.min(buyVolume, sellVolume* clearingPrice) == volumeSettled, "req 2");        
        require((int256(buyVolume) - int256(sellVolume * clearingPrice)) == imbalance, "req 3"); // TODO: Fix data types, safe cast

        if (imbalance == 0) {
            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // As the auction is bid at CP, check if next price increment above clears higher volume OR smaller imbalance
        else if (imbalance > 0) {
            uint256 priceToCheck = clearingPrice + _minTickSize;

            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (clearingPrice <= _revealedBuyOrders[i]._price && _revealedBuyOrders[i]._price < priceToCheck) {
                    buyVolumeNew -= _revealedBuyOrders[i]._size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (clearingPrice < _revealedSellOrders[i]._price && _revealedSellOrders[i]._price <= priceToCheck) {
                    sellVolumeNew += _revealedSellOrders[i]._size;
                }
            }

            buyVolumeNew *= priceToCheck;

            // If the next price clears less volume, or clears the same volume with a larger imbalance, the proposed CP is valid
            require((Math.min(buyVolumeNew, sellVolumeNew) < volumeSettled) || 
                (Math.min(buyVolumeNew, sellVolumeNew) == volumeSettled && imbalance <= Abs(int256(buyVolumeNew) - int256(sellVolumeNew))), "we're in trouble"); // TODO: Fix data types

            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // As the auction is offered at CP, check if next price increment below clears higher volume OR smaller imbalance
        else if (imbalance < 0) {
            uint256 priceToCheck = clearingPrice - _minTickSize;

            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;        

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (clearingPrice > _revealedBuyOrders[i]._price && _revealedBuyOrders[i]._price >= priceToCheck) {
                    buyVolumeNew += _revealedBuyOrders[i]._size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (clearingPrice >= _revealedSellOrders[i]._price && _revealedSellOrders[i]._price > priceToCheck) {
                    sellVolumeNew -= _revealedSellOrders[i]._size;
                }
            }

            sellVolumeNew *= priceToCheck; // TODO: What is this?

            require((Math.min(buyVolumeNew, sellVolumeNew) < volumeSettled) || 
                (Math.min(buyVolumeNew, sellVolumeNew) == volumeSettled && Abs(imbalance) <= Abs((int256)(buyVolumeNew) - (int256)(sellVolumeNew)))); // TODO: Fix data types

            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // Return deposit + reward to caller
    }


       function SettleOrders(uint256 clearingPrice, uint256 buyVolume, uint256 sellVolume) private {
        
        uint revealedSellOrderCount = _revealedSellOrders.length;
        uint revealedBuyOrderCount = _revealedBuyOrders.length;

        

        
        sellVolume = sellVolume * clearingPrice; 
        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (buyVolume > sellVolume) {
            
            uint256 proRatePrice = type(uint256).max;

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (_revealedBuyOrders[i]._price >= clearingPrice) {
                    proRatePrice = Math.min(proRatePrice, _revealedBuyOrders[i]._price);
                }
            }

            uint256 sizeProRate = 0;

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (_revealedBuyOrders[i]._price == proRatePrice) {
                    sizeProRate += _revealedBuyOrders[i]._size;
                }
            }
            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (_revealedBuyOrders[i]._price == proRatePrice) {
                    
                    // Return tokens not going to be exchanged

                    uint256 transferQty = DivideBy(_revealedBuyOrders[i]._size * (sizeProRate + sellVolume -buyVolume) , sizeProRate);

                    _processOrderSettlement(_tokenA, transferQty, _revealedBuyOrders[i]._owner);

                    _revealedBuyOrders[i]._size -= transferQty;
                } 
            }
        }

        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (sellVolume > buyVolume) { 
            

            uint256 proRatePrice = 0;
            
            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (_revealedSellOrders[i]._price <= clearingPrice) {
                    proRatePrice = Math.max(proRatePrice, _revealedSellOrders[i]._price);
                }
            }

            uint256 sizeProRate = 0;
            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (_revealedSellOrders[i]._price == proRatePrice) {
                    sizeProRate += _revealedSellOrders[i]._size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (_revealedSellOrders[i]._price == proRatePrice) {                    
                    // Return tokens not going to be exchanged

                    
                    uint256 transferQty = DivideBy(_revealedSellOrders[i]._size * (sizeProRate*clearingPrice + buyVolume - sellVolume) , sizeProRate*clearingPrice);
                    
                    // TODO: Handle return codes.
                    _processOrderSettlement(_tokenB, transferQty, _revealedSellOrders[i]._owner);

                    _revealedSellOrders[i]._size -= transferQty;
                } 
            }
        }

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            Order memory order = _revealedBuyOrders[i];
            
            // Execute buy order if bid greater than clearing price
            if (order._price >= clearingPrice || order._price == _marketOrderValue) {
                uint256 tokenTradeSize = DivideBy(order._size, clearingPrice); // order.size / clearingPrice;

                // TODO: Handle return codes.               
                _processOrderSettlement(_tokenB, tokenTradeSize, order._owner);

            } else if (order._price < clearingPrice) {
                _processOrderSettlement(_tokenA, order._size, order._owner);
            }
        }

        for (uint i = 0; i < revealedSellOrderCount; i++) {
            Order memory order = _revealedSellOrders[i];
            
            // Execute sell order if ask less than clearing price
            if (order._price <= clearingPrice || order._price == _marketOrderValue) {
                uint256 tokenTradeSize = order._size* clearingPrice; // order.size / clearingPrice

                // TODO: Handle return codes.
                _processOrderSettlement(_tokenA, tokenTradeSize, order._owner);
            } else if (order._price > clearingPrice) {
                _processOrderSettlement(_tokenB, order._size, order._owner);
            }
        }

        _phase = Phase.Commit;
        _currentAuctionNotional = 0;

        // Possible we can avoid this and reuse the existing memory between auctions without 
        // releasing and reacquiring it each time.
        delete _revealedBuyOrders;
        delete _revealedSellOrders;

        _wTight = _anyWidthValue;

        //_lastPhaseChangeAtBlockHeight = block.number; // TODO block.number == blockheight?
    }

    
}
