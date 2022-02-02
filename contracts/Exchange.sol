// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;


contract Exchange {

    enum Phase {
        Commit
    }

    enum Direction {
        Buy,
        Sell
    }

    struct Order {
        Direction direction;
        uint256 size;
        // Market or Withdraw
        uint256 price;
        uint256 maxTradeableWidth;
        address owner;
    }

    struct CommitmentArgs {
        uint256 size;
        // Market or Withdraw
        uint256 price;
        uint256 maxTradeableWidth;
    }

    struct RevealArgs {
        Order order;
    }

    struct ZKInfo {
        uint _reserved;
    }

    struct ZKProof {
        uint _reserved;
    }

    struct ZKSecret {
        uint _reserved;
    }

    uint256 constant _anyWidthValue = type(uint256).max;
    uint256 constant _marketOrderValue = type(uint256).max;

    address _operator;
    uint256 _minTickSize = 1;

    Phase _phase;
    uint256 _lastPhaseChangeAtBlockHeight;
    uint256 _currentAuctionNotional;

    Order[] _revealedSellOrders;
    Order[] _revealedBuyOrders;


    // Tightness of the spread
    uint256 _wTight;

    constructor(){
        _operator = msg.sender;
    }


    function CommitClient(CommitmentArgs calldata commitment, ZKProof calldata proof) public {

    }

    function RevealClient(RevealArgs calldata reveal) public {
        //_revealedOrders.push(reveal.order);
    }

    function Minimum(uint256 a, uint256 b) pure private returns (uint256) {
        return a < b ? a : b;
    }

    function Maximum(uint256 a, uint256 b) pure private returns (uint256) {
        return a > b ? a : b;
    }

    function Abs(int x) private pure returns (int) {
        return x >= 0 ? x : -x;
    }

    function Settlement(uint256 clearingPrice, uint256 volumeSettled, int256 imbalance) public {
        // Deposit bounty

        // Produce working set of revealed orders
        Order[] memory revealedSellOrders = new Order[](_revealedSellOrders.length); // Cannot create dynamic array here
        Order[] memory revealedBuyOrders = new Order[](_revealedBuyOrders.length); // Cannot create dynamic array here

        uint revealedSellOrderCount = 0;
        uint revealedBuyOrderCount = 0;

        for (uint i = 0; i < _revealedSellOrders.length; i++){
            if (_revealedSellOrders[i].maxTradeableWidth > _wTight || _revealedSellOrders[i].maxTradeableWidth == _anyWidthValue) {
                revealedSellOrders[revealedSellOrderCount++] = (_revealedSellOrders[i]); // Push not available
            }
        }

        for (uint i = 0; i < _revealedBuyOrders.length; i++){
            if (_revealedBuyOrders[i].maxTradeableWidth > _wTight || _revealedBuyOrders[i].maxTradeableWidth == _anyWidthValue) {
                revealedBuyOrders[revealedBuyOrderCount++] = (_revealedBuyOrders[i]); // Push not available
            }
        }

        // Compute max(buyOrders.price) and min(sellOrders.price)
        uint256 maxBuyPrice = 0;
        uint256 minSellPrice = type(uint256).max;

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            if (revealedBuyOrders[i].price > maxBuyPrice) {
                maxBuyPrice = revealedBuyOrders[i].price;
            }
        }
        for (uint i = 0; i < revealedSellOrderCount; i++) {
            if (revealedSellOrders[i].price < minSellPrice) {
                minSellPrice = revealedSellOrders[i].price;
            }
        }

        require(volumeSettled > 0 || (minSellPrice < maxBuyPrice)); // TODO: Min sell less than max bid if no trades?

        // Compute buyVolume and sellVolume
        uint256 buyVolume = 0;
        uint256 sellVolume = 0;        

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            if (revealedBuyOrders[i].price >= clearingPrice) {
                buyVolume += revealedBuyOrders[i].size;
            }
        }

        for (uint i = 0; i < revealedSellOrderCount; i++) {
            if (revealedSellOrders[i].price <= clearingPrice) {
                sellVolume += revealedSellOrders[i].size;
            }
        }

        require(Minimum(buyVolume, sellVolume * clearingPrice) == volumeSettled);
        require(buyVolume - (sellVolume * clearingPrice) == imbalance); // TODO: Fix data types

        if (imbalance == 0){
            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // As the auction is bid at CP, check if next price increment above clears higher volume OR smaller imbalance
        if (imbalance > 0) {
            uint256 priceToCheck = clearingPrice + _minTickSize;

            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (clearingPrice <= revealedBuyOrders[i].price && revealedBuyOrders[i].price < priceToCheck) {
                    buyVolumeNew -= revealedBuyOrders[i].size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (clearingPrice < revealedSellOrders[i].price && revealedSellOrders[i].price <= priceToCheck) {
                    sellVolumeNew += revealedSellOrders[i].size;
                }
            }

            buyVolumeNew *= priceToCheck;

            // If the next price clears less volume, or clears the same volume with a larger imbalance, the proposed CP is valid
            require((Minimum(buyVolumeNew, sellVolumeNew) < volumeSettled) || 
                (Minimum(buyVolumeNew, sellVolumeNew) == volumeSettled && imbalance <= Abs(buyVolumeNew - sellVolumeNew))); // TODO: Fix data types

            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // As the auction is offered at CP, check if next price increment below clears higher volume OR smaller imbalance
        if (imbalance < 0) {
            uint256 priceToCheck = clearingPrice - _minTickSize;

            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;        

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (clearingPrice > revealedBuyOrders[i].price && revealedBuyOrders[i].price >= priceToCheck) {
                    buyVolumeNew += revealedBuyOrders[i].size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (clearingPrice >= revealedSellOrders[i].price && revealedSellOrders[i].price > priceToCheck) {
                    sellVolumeNew -= revealedSellOrders[i].size;
                }
            }

            buyVolumeNew *= priceToCheck; // TODO: What is this?

            require((Minimum(buyVolumeNew, sellVolumeNew) < volumeSettled) || 
                (Minimum(buyVolumeNew, sellVolumeNew) == volumeSettled && imbalance <= Abs(buyVolumeNew - sellVolumeNew))); // TODO: Fix data types

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
            if (_revealedSellOrders[i].maxTradeableWidth > _wTight || _revealedSellOrders[i].maxTradeableWidth == _anyWidthValue) {
                revealedSellOrders[revealedSellOrderCount++] = (_revealedSellOrders[i]); // Push not available
            }
        }

        for (uint i = 0; i < _revealedBuyOrders.length; i++){
            if (_revealedBuyOrders[i].maxTradeableWidth > _wTight || _revealedBuyOrders[i].maxTradeableWidth == _anyWidthValue) {
                revealedBuyOrders[revealedBuyOrderCount++] = (_revealedBuyOrders[i]); // Push not available
            }
        }

        buyVolume *= clearingPrice; // Convert sell volume to equivalent in A_tkn

        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (buyVolume > sellVolume) { 
            uint256 proRate = type(uint256).max;

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (revealedBuyOrders[i].price >= clearingPrice) {
                    proRate = Minimum(proRate, revealedBuyOrders[i].price);
                }
            }

            uint256 sizeProRate = 0;
            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                if (revealedBuyOrders[i].price == proRate) {
                    sizeProRate += revealedBuyOrders[i].size;
                }
            }

            for (uint i = 0; i < revealedBuyOrderCount; i++) {
                Order memory order = revealedBuyOrders[i];
                if (order.price == proRate) {
                    
                    // Return tokens not going to be exchanged

                    uint256 transferQty = order.size * (1 - (buyVolume-sellVolume) / sizeProRate);
                    
                    // TODO: Handle return codes. Open question of what to do here since we can't just halt the process if one user can't receive transfers
                    (payable(order.owner)).call{value:transferQty}("");

                    order.size -= transferQty;
                }
            }
        }

        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (sellVolume > buyVolume) { 
            uint256 proRate = 0;

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (revealedSellOrders[i].price <= clearingPrice) {
                    proRate = Maximum(proRate, revealedSellOrders[i].price);
                }
            }

            uint256 sizeProRate = 0;
            for (uint i = 0; i < revealedSellOrderCount; i++) {
                if (revealedSellOrders[i].price == proRate) {
                    sizeProRate += revealedSellOrders[i].size;
                }
            }

            for (uint i = 0; i < revealedSellOrderCount; i++) {
                Order memory order = revealedSellOrders[i];

                if (order.price == proRate) {                    
                    // Return tokens not going to be exchanged

                    uint256 transferQty = order.size * (1 - (sellVolume - buyVolume) / sizeProRate);
                    
                    // TODO: Should be returning B_tkn instead of ETH/A_tkn
                    // TODO: Handle return codes.
                    (payable(order.owner)).call{value:transferQty}("");

                    order.size -= transferQty;
                }
            }
        }

        for (uint i = 0; i < revealedBuyOrderCount; i++) {
            Order memory order = revealedBuyOrders[i];
            
            // Execute buy order if bid greater than clearing price
            if (order.price >= clearingPrice || order.price == _marketOrderValue) {
                uint256 tokenTradeSize = order.size * clearingPrice;

                // TODO: Should be sending B_tkn instead of ETH/A_tkn
                // TODO: Handle return codes.
                (payable(order.owner)).call{value:tokenTradeSize}("");
            } else {
                // TODO: Handle return codes.
                (payable(order.owner)).call{value:order.size}("");  
            }
        }

        for (uint i = 0; i < revealedSellOrderCount; i++) {
            Order memory order = revealedSellOrders[i];
            
            // Execute sell order if ask less than clearing price
            if (order.price <= clearingPrice || order.price == _marketOrderValue) {
                uint256 tokenTradeSize = order.size * clearingPrice;

                // TODO: Handle return codes.
                (payable(order.owner)).call{value:tokenTradeSize}("");
            } else {
                // TODO: Should be returning B_tkn instead of ETH/A_tkn
                // TODO: Handle return codes.
                (payable(order.owner)).call{value:order.size}("");  
            }
        }

        _phase = Phase.Commit;
        _currentAuctionNotional = 0;

        // Possible we can avoid this and reuse the existing memory between auctions without 
        // releasing and reacquiring it each time.
        delete _revealedBuyOrders;
        delete _revealedSellOrders;

        _wTight = _anyWidthValue;

        _lastPhaseChangeAtBlockHeight = block.number; // TODO block.number == blockheight
    }

    function EndPhase() public {
        require(msg.sender == _operator);
    }

    function Resolve() public {
        require(msg.sender == _operator);
    }
}