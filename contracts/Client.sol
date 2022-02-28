// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";






contract ClientAndMM{
    
    // Tornado initialisation variables
    //using SafeERC20 for IERC20;
    //was IERC20
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
    uint256 constant _minTickSize = 1;
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


    function hash(
        bytes memory input
        ) public view returns (bytes32) {
         return bytes32(keccak256(input));
    }

    constructor(IERC20 token_a, IERC20 token_b){

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

    function Client_Register(bytes32 _regId) public payable returns (bool) {
        require(msg.value >= (_escrowClient + _relayerFee), "Client register must deposit escrow + relayer fee");
        require(!_registrations[_regId], "Registration ID already taken");
        _registrations[_regId] = true;
        return true;
    }

    // should be nonReentrant 
    function verifyProof(
        bytes32 proof,
        uint256[6] memory input
        ) public view returns (bool) {
        return true;
    }

    function Client_Commit( 
        bytes32 _orderHash,
        bytes32 _proof,
        bytes32 _root,
        bytes32 _nullifierHash
        ) external payable returns (bool) {
        require(!_nullifierHashes[_nullifierHash], "The note has been already spent");
        require(!_blacklistedNullifiers[_nullifierHash], "The note has been blacklisted");
        require(_phase==Phase.Commit, "Phase should be Commit" );
        //require(isKnownRoot(_root), "Cannot find your merkle root"); 
        // Make sure to use a recent one
        require(
            verifyProof(
                _proof,
                [uint256(_root), 
                uint256(_nullifierHash), 
                uint256(_orderHash), 
                uint256(uint160(msg.sender)), 
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
        require(hash(abi.encodePacked([_market._bidPrice,_market._bidSize,_market._offerPrice,_market._offerSize])) == _marketHash, "market does not match commitment"); 

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
        _bid._maxTradeableWidth= 1;

        _bid._owner=msg.sender;

        _revealedBuyOrders.push(_bid);
        
        Order memory _sell;
        _sell._isBuyOrder= false;

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
        return true;
    }


    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return _nullifierHashes[_nullifierHash];
    }
    

    function _processReveal(IERC20 _token, uint256 _amount) internal {
        _token.transferFrom(msg.sender, address(this), _amount);
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


    function Abs(int x) private pure returns (int) {
        return x >= 0 ? x : -x;
    }
    
    function MulByClearingPrice(uint256 value, uint256 clearingPrice) pure internal returns (uint256) {
        return SafeMath.div(SafeMath.mul(SafeMath.mul(value, _clearingPricePrecision), clearingPrice), _clearingPricePrecision);
    }

    function DivByClearingPrice(uint256 value, uint256 clearingPrice) pure internal returns (uint256) {
        return SafeMath.div(SafeMath.div(SafeMath.mul(value, _clearingPricePrecision), clearingPrice), _clearingPricePrecision);
    }

    function Settlement(uint256 clearingPrice, uint256 volumeSettled, int256 imbalance) public {
        // Deposit bounty
        require(_revealedSellOrders.length + _revealedBuyOrders.length > 0, "No orders");

        // Produce working set of revealed orders
        Order[] memory revealedSellOrders = new Order[](_revealedSellOrders.length); // Cannot create dynamic array here
        Order[] memory revealedBuyOrders = new Order[](_revealedBuyOrders.length); // Cannot create dynamic array here

        uint revealedSellOrderCount = 0;
        uint revealedBuyOrderCount = 0;

        for (uint i = 0; i < _revealedSellOrders.length; i++){
            if (_revealedSellOrders[i]._maxTradeableWidth > _wTight || _revealedSellOrders[i]._maxTradeableWidth == _anyWidthValue) {
                revealedSellOrders[revealedSellOrderCount++] = (_revealedSellOrders[i]); // Push not available
            }
        }

        for (uint i = 0; i < _revealedBuyOrders.length; i++){
            if (_revealedBuyOrders[i]._maxTradeableWidth > _wTight || _revealedBuyOrders[i]._maxTradeableWidth == _anyWidthValue) {
                revealedBuyOrders[revealedBuyOrderCount++] = (_revealedBuyOrders[i]); // Push not available
            }
        }

        // Compute max(buyOrders.price) and min(sellOrders.price)
        uint256 maxBuyPrice = 0;
        uint256 minSellPrice = type(uint256).max;

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            if (revealedBuyOrders[i]._price > maxBuyPrice) {
                maxBuyPrice = revealedBuyOrders[i]._price;
            }
        }
        for (uint i = 0; i < revealedSellOrderCount; i++) {
            if (revealedSellOrders[i]._price < minSellPrice) {
                minSellPrice = revealedSellOrders[i]._price;
            }
        }

        require(volumeSettled > 0 || (minSellPrice < maxBuyPrice), "req 1"); // TODO: Min sell less than max bid if no trades?

        // Compute buyVolume and sellVolume
        uint256 buyVolume = 0;
        uint256 sellVolume = 0;        

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            if (revealedBuyOrders[i]._price >= clearingPrice) {
                buyVolume += revealedBuyOrders[i]._size;
            }
        }

        for (uint i = 0; i < revealedSellOrderCount; i++) {
            if (revealedSellOrders[i]._price <= clearingPrice) {
                sellVolume += revealedSellOrders[i]._size;
            }
        }

        require(Math.min(buyVolume, MulByClearingPrice(sellVolume, clearingPrice)) == volumeSettled, "req 2");        
        require((int256)(buyVolume) - (int256) (MulByClearingPrice(sellVolume, clearingPrice)) == imbalance, "req 3"); // TODO: Fix data types, safe cast

        if (imbalance == 0) {
            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // As the auction is bid at CP, check if next price increment above clears higher volume OR smaller imbalance
        else if (imbalance > 0) {
            uint256 priceToCheck = clearingPrice + (_minTickSize * _clearingPricePrecision);

            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (clearingPrice <= revealedBuyOrders[i]._price && revealedBuyOrders[i]._price < priceToCheck) {
                    buyVolumeNew -= revealedBuyOrders[i]._size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (clearingPrice < revealedSellOrders[i]._price && revealedSellOrders[i]._price <= priceToCheck) {
                    sellVolumeNew += revealedSellOrders[i]._size;
                }
            }

            buyVolumeNew *= priceToCheck;

            // If the next price clears less volume, or clears the same volume with a larger imbalance, the proposed CP is valid
            require((Math.min(buyVolumeNew, sellVolumeNew) < volumeSettled) || 
                (Math.min(buyVolumeNew, sellVolumeNew) == volumeSettled && imbalance <= Abs((int256)(buyVolumeNew) - (int256)(sellVolumeNew)))); // TODO: Fix data types

            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // As the auction is offered at CP, check if next price increment below clears higher volume OR smaller imbalance
        else if (imbalance < 0) {
            uint256 priceToCheck = clearingPrice - _minTickSize;

            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;        

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (clearingPrice > revealedBuyOrders[i]._price && revealedBuyOrders[i]._price >= priceToCheck) {
                    buyVolumeNew += revealedBuyOrders[i]._size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (clearingPrice >= revealedSellOrders[i]._price && revealedSellOrders[i]._price > priceToCheck) {
                    sellVolumeNew -= revealedSellOrders[i]._size;
                }
            }

            buyVolumeNew *= priceToCheck; // TODO: What is this?

            require((Math.min(buyVolumeNew, sellVolumeNew) < volumeSettled) || 
                (Math.min(buyVolumeNew, sellVolumeNew) == volumeSettled && Abs(imbalance) <= Abs((int256)(buyVolumeNew) - (int256)(sellVolumeNew)))); // TODO: Fix data types

            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // Return deposit + reward to caller
    }


       function SettleOrders(uint256 clearingPrice, uint256 buyVolume, uint256 sellVolume) private {
        // TODO: No need to recompute the working sets
        // Produce working set of revealed orders
        Order[] memory revealedSellOrders = new Order[](_revealedSellOrders.length); // Cannot create dynamic array here
        Order[] memory revealedBuyOrders = new Order[](_revealedBuyOrders.length); // Cannot create dynamic array here

        uint revealedSellOrderCount = 0;
        uint revealedBuyOrderCount = 0;

        for (uint i = 0; i < _revealedSellOrders.length; i++){
            if (_revealedSellOrders[i]._maxTradeableWidth > _wTight || _revealedSellOrders[i]._maxTradeableWidth == _anyWidthValue) {
                revealedSellOrders[revealedSellOrderCount++] = (_revealedSellOrders[i]); // Push not available
            }
        }

        for (uint i = 0; i < _revealedBuyOrders.length; i++){
            if (_revealedBuyOrders[i]._maxTradeableWidth > _wTight || _revealedBuyOrders[i]._maxTradeableWidth == _anyWidthValue) {
                revealedBuyOrders[revealedBuyOrderCount++] = (_revealedBuyOrders[i]); // Push not available
            }
        }

        buyVolume = MulByClearingPrice(buyVolume, clearingPrice); // Convert sell volume to equivalent in A_tkn

        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (buyVolume > sellVolume) { 
            uint256 proRate = type(uint256).max;

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (revealedBuyOrders[i]._price >= clearingPrice) {
                    proRate = Math.min(proRate, revealedBuyOrders[i]._price);
                }
            }

            uint256 sizeProRate = 0;
            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (revealedBuyOrders[i]._price == proRate) {
                    sizeProRate += revealedBuyOrders[i]._size;
                }
            }

            sizeProRate = MulByClearingPrice(sizeProRate, clearingPrice);

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                Order memory order = revealedBuyOrders[i];
                if (order._price == proRate) {
                    
                    // Return tokens not going to be exchanged

                    uint256 transferQty = order._size * (1 - (buyVolume-sellVolume) / sizeProRate);
                    
                    // TODO: Handle return codes. Open question of what to do here since we can't just halt the process if one user can't receive transfers
                    (payable(order._owner)).call{value:transferQty}("");

                    order._size -= transferQty;
                }
            }
        }

        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (sellVolume > buyVolume) { 
            uint256 proRate = 0;

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (revealedSellOrders[i]._price <= clearingPrice) {
                    proRate = Math.min(proRate, revealedSellOrders[i]._price);
                }
            }

            uint256 sizeProRate = 0;
            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (revealedSellOrders[i]._price == proRate) {
                    sizeProRate += revealedSellOrders[i]._size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                Order memory order = revealedSellOrders[i];

                if (order._price == proRate) {                    
                    // Return tokens not going to be exchanged

                    uint256 transferQty = order._size * (1 - (sellVolume - buyVolume) / sizeProRate);
                    
                    // TODO: Handle return codes.
                    _tokenB.transfer(order._owner, transferQty);

                    order._size -= transferQty;
                }
            }
        }

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            Order memory order = revealedBuyOrders[i];
            
            // Execute buy order if bid greater than clearing price
            if (order._price >= clearingPrice || order._price == _marketOrderValue) {
                uint256 tokenTradeSize = MulByClearingPrice(order._size, clearingPrice); // order.size * clearingPrice;

                // TODO: Handle return codes.               
                _tokenB.transfer(order._owner, tokenTradeSize);

            } else {
                // TODO: Handle return codes.
                (payable(order._owner)).call{value:order._size}("");  
            }
        }

        for (uint i = 0; i < revealedSellOrderCount; i++) {
            Order memory order = revealedSellOrders[i];
            
            // Execute sell order if ask less than clearing price
            if (order._price <= clearingPrice || order._price == _marketOrderValue) {
                uint256 tokenTradeSize = DivByClearingPrice(order._size, clearingPrice); // order.size / clearingPrice

                // TODO: Handle return codes.
                (payable(order._owner)).call{value:tokenTradeSize}("");
            } else {
                // TODO: Handle return codes.
                _tokenB.transfer(order._owner, order._size);
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
