// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./MerkleTreeWithHistory.sol";

interface IVerifier {
    function verifyProof(bytes calldata proof, uint256[6] calldata inputs)
        external
        view
        returns (bool r);
}

contract ClientAndMM is MerkleTreeWithHistory {
    function hash(bytes memory input) public pure returns (bytes32) {
        return bytes32(keccak256(input));
    }

    function HashOrderTest(Order memory _order, bytes32 expectedHash)
        public
        returns (bytes32 hashed)
    {
        hashed = HashOrder(_order);
        emit OrderHashed(_order, hashed, expectedHash);
    }

    // Tornado initialisation variables

    IVerifier public immutable _verifier;

    //using SafeERC20 for IERC20;
    //was IERC20
    IERC20 public _tokenA;
    IERC20 public _tokenB;

    mapping(bytes32 => bool) public _nullifierHashes;
    // we store all commitments just to prevent accidental deposits with the same commitment
    mapping(bytes32 => bool) _registrations;

    mapping(bytes32 => bool) _committedOrders;
    uint256 public _unrevealedOrderCount;
    // track active order commitments in each auction

    mapping(bytes32 => bool) _committedMarkets;
    uint256 public _unrevealedMarketCount;
    // track active MM commitments in each auction
    
    bytes32[] public _IDsToBeAdded;
    uint256 public _currentBatchIDBounty=0;
    uint256 public deferredDepositFee=1;

    Order[] public _revealedBuyOrders;
    // track buy orders in each auction

    Order[] public _revealedSellOrders;
    // track sell orders in each auction

    mapping(bytes32 => bool) _blacklistedNullifiers;
    uint256 _escrowClient;
    uint256 _escrowMM;
    uint256 _relayerFee;
    uint256 _tokenAFairValue;
    uint256 _tokenBFairValue;
    uint256 _settlementBounty;

    Phase public _phase;

    uint256 constant _phaseLength = 100;
    uint256 _lastPhaseUpdate = 0;
    uint256 _wTight = type(uint256).max;
    uint256 _currentAuctionNotional = 0;

    uint256 constant _decimalPrecisionPoints = 10;
    uint256 constant _clearingPricePrecision = 10**_decimalPrecisionPoints;
    // here I have programmed the tick size precision to be less than the price/ volume precision to give some room for error.
    uint256 constant _minTickSizePrecision = _decimalPrecisionPoints - 2;
    uint256 constant _minTickSize = 10**_minTickSizePrecision;
    uint256 _anyWidthValue = type(uint256).max;
    uint256 _marketOrderValue = type(uint256).max;

    enum Phase {
        Inactive,
        Commit,
        Reveal,
        Resolution
    }
    struct Order {
        bool _isBuyOrder;
        uint256 _size;
        // Limit, Market or Withdraw
        uint256 _price;
        uint256 _maxTradeableWidth;
        address _owner;
    }

    struct Market {
        uint256 _bidPrice;
        uint256 _bidSize;
        uint256 _offerPrice;
        uint256 _offerSize;
        address _owner;
    }

    //used to track contract balance check updates to identify any problems with transfers
    uint256 ticker = 0;
    event ContractBalanceCheck(
        uint256 checkNumber,
        uint256 tokenA,
        uint256 tokenB
    );
    event CheckerEvent1(
        uint256 clearingPrice,
        uint256 buyVolume,
        uint256 sellVolume
    );
    event OrderHashed(Order order, bytes32 hashed, bytes32 expectedHash);

    uint32 public constant _merkleTreeHeight = 20;

    constructor(
        IVerifier verifier,
        IHasher hasher,
        IERC20 token_a,
        IERC20 token_b
    ) MerkleTreeWithHistory(_merkleTreeHeight, hasher) {
        _verifier = verifier;
        _tokenA = token_a;
        _tokenB = token_b;

        // set appropriate relayer fee, maybe updatable?
        _relayerFee = 1;

        // set client escrow
        _escrowClient = 1;

        // set MM escrow
        _escrowMM = 10;

        // reward to be paid to player successfully settling orders.
        _settlementBounty = 1;

        // initialise phase as Inactive
        _phase = Phase.Inactive;

        _lastPhaseUpdate = block.number;
    }

    // housekeeping functions needed to transition between phases. In reality we want these
    // automated, or incentive compatible.

    function Move_To_Commit_Phase() external returns (bool) {
        
        require(_phase == Phase.Inactive, "Ongoing Auction");
        _unrevealedOrderCount =0;
        _unrevealedMarketCount=0;
        // set tokenA, tokenB fair value with respect to ETH. Needed to compare escrows and order/market deposit amounts
        _tokenAFairValue = getTknPrice(_tokenA);
        _tokenBFairValue = getTknPrice(_tokenB);
        _phase = Phase.Commit;
        _lastPhaseUpdate = block.number;
        return true;
    }

    function Move_To_Reveal_Phase() external returns (bool) {
        //omit block number checks for tests
        //require(_phase == Phase.Commit && _lastPhaseUpdate-block.number >= _phaseLength, "Not ready to enter Reveal Phase");
        require(_phase == Phase.Commit, "Not ready to enter Reveal Phase");
        _phase = Phase.Reveal;
        _lastPhaseUpdate = block.number;
        return true;
    }

    function Move_To_Resolution_Phase() external returns (bool) {
        
        require(_phase == Phase.Commit && ( _lastPhaseUpdate-block.number >= _phaseLength || (_unrevealedOrderCount==0 && _unrevealedMarketCount==0)), "Not ready to enter Reveal Phase");
        _phase = Phase.Resolution;
        _lastPhaseUpdate = block.number;
        return true;
    }

    // I think this function at the start of every main contract function
    // Specifically Client_Commit, MM_Commit, Client_Reveal, MM_Reveal and Settlement
    // Should effectively automated transitioning between phases


    // should be nonReentrant

    event Deposit(
        bytes32 indexed commitment,
        uint32 leafIndex,
        uint256 timestamp
    );

    function Client_Register(bytes32 _regId) public payable returns (bool) {
        require(
            msg.value >= (_relayerFee),
            "Client register must deposit escrow + relayer fee"
        );
        require(!_registrations[_regId], "Registration ID already taken");

        uint32 insertedIndex = _insert(_regId);
        _registrations[_regId] = true;
	
        emit Deposit(_regId, insertedIndex, block.timestamp);

        return true;
    }
    
    function Client_Register_Deferred(bytes32 _regId) public payable returns (bool) {
        require(
            msg.value >= (_relayerFee + deferredDepositFee),
            "Client register must deposit escrow + relayer fee"
        );
        require(!_registrations[_regId], "Registration ID already taken");

        _IDsToBeAdded.push(_regId);
        
	    _currentBatchIDBounty += deferredDepositFee;
        return true;
    }

    event OrderCommited(bytes32 hashed);

    function Client_Commit(
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        bytes32 _orderHash,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund
    ) external payable returns (bool) {
        require(
            !_nullifierHashes[_nullifierHash],
            "The note has been already spent"
        );
        require(
            !_blacklistedNullifiers[_nullifierHash],
            "The note has been blacklisted"
        );
        require(_phase == Phase.Commit, "Phase should be Commit");
        require(isKnownRoot(_root), "Cannot find your merkle root");
        // Make sure to use a recent one

        require(
            _verifier.verifyProof(
                _proof,
                [
                    uint256(_root),
                    uint256(_nullifierHash),
                    uint256(_orderHash),
                    uint256(uint160(address(_relayer))),
                    _fee,
                    _refund
                ]
            ),
            "Proof failed validation"
        );

        // TODO: Do we want to allow commiting a new order using the same deposit? Eg amending an
        // order before the end of the commit phase without burning a deposit?
        // If so we'll need to rework the lines below - Padraic

        // record nullifier hash
        _nullifierHashes[_nullifierHash] = true;

        // record order commitment
        _committedOrders[_orderHash] = true;
        _unrevealedOrderCount++;

        // pay relayer
        _processClientCommit(payable(msg.sender));

        emit OrderCommited(_orderHash);

        return true;
    }
    
    function Batch_Add_IDs() external payable returns (bool) {
    	uint32 insertedIndex = _bulkInsert(_IDsToBeAdded);
    	for (uint256 i = 0; i < _IDsToBeAdded.length; i++) {
            _registrations[_IDsToBeAdded[i]] = true;
            emit Deposit(_IDsToBeAdded[i], insertedIndex + uint32(i), block.timestamp);
        }

    	_processBatchingIDsPayout();

    	delete _IDsToBeAdded;
	_currentBatchIDBounty=0;    	
    }

    function MM_Commit(bytes32 _marketHash) external payable {
        require(_phase == Phase.Commit, "Phase should be Commit");
        require(msg.value >= _escrowMM, "MM register must deposit escrow");

        // lodge MM escrow

        // record market commitment
        _unrevealedMarketCount++;
        _committedMarkets[_marketHash] = true;
    }

    function HashOrder(Order memory _order) internal pure returns (bytes32) {
        bytes32 hashed = keccak256(
                        abi.encodePacked(
                            _order._isBuyOrder,
                            _order._size,
                            _order._price,
                            _order._maxTradeableWidth,
                            _order._owner
                        )
                    );

        uint256 modded = uint256(hashed) % FIELD_SIZE;

        return bytes32(modded);
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

        require(_phase == Phase.Reveal, "Phase should be Reveal");
        // TODO: See if this is needed. The code below won't work since we're hashing using Pederson in the Tree and not keccak256 - Padraic
        // require(hash(abi.encodePacked(_nullifier, _randomness)) == _regId, "secrets don't match registration ID");
        // this should hash all order information. Ensure abi.encodePacked maps uniquely.

        // TODO: Do we really need to submit the hash?
        require(_committedOrders[_orderHash], "order not committed");
        require(HashOrder(_order) == _orderHash, "order does not match commitment"
        );

        require(_registrations[_regId], "The registration doesn't exist");

        // order is a buy order
        if (_order._isBuyOrder) {
            // order size should be reduced to reflect the escrow

            _processReveal(_tokenA, _order._size);
            _revealedBuyOrders.push(_order);
        } else {
            // order size should be reduced to reflect the escrow
            _processReveal(_tokenB, _order._size);
            _revealedSellOrders.push(_order);
        }

        // remove order commitment
        _committedOrders[_orderHash] = false;
        _unrevealedOrderCount--;
        _registrations[_regId] = false;

        if (_newRegId == 0) {
            _processClientEscrowReturn();
        } else {
            require(
                msg.value >= _relayerFee,
                "re-register must deposit relayer fee"
            );
            require(!_registrations[_regId], "Registration ID already taken");
            _registrations[_newRegId] = true;
            uint32 insertedIndex = _insert(_newRegId);
            emit Deposit(_newRegId, insertedIndex, block.timestamp);
        }
        return true;
    }
    
    // TODO: Most of the code in Client_Reveal* above and below is identical. Encapsulate into a shared function.

    function Client_Reveal_w_Deferred_Insert(
        bytes32 _orderHash,
        Order memory _order,
        uint256 _nullifier,
        uint256 _randomness,
        bytes32 _regId,
        bytes32 _newRegId
    ) external payable returns (bool) {
        HashOrderTest(_order, _orderHash);

        require(_phase == Phase.Reveal, "Phase should be Reveal");
        // TODO: See if this is needed. The code below won't work since we're hashing using Pederson in the Tree and not keccak256 - Padraic
        // require(hash(abi.encodePacked(_nullifier, _randomness)) == _regId, "secrets don't match registration ID");
        // this should hash all order information. Ensure abi.encodePacked maps uniquely.

        // TODO: Do we really need to submit the hash?
        require(_committedOrders[_orderHash], "order not committed");
        require(HashOrder(_order) == _orderHash, "order does not match commitment"
        );

        require(_registrations[_regId], "The registration doesn't exist");

        // order is a buy order
        if (_order._isBuyOrder) {
            // order size should be reduced to reflect the escrow
            _order._size=Math.min(_order._size, _escrowClient*_tokenAFairValue);

            _processReveal(_tokenA, _order._size);
            _revealedBuyOrders.push(_order);
        } else {
            // order size should be reduced to reflect the escrow
            _order._size=Math.min(_order._size, _escrowClient*_tokenBFairValue);

            _processReveal(_tokenB, _order._size);
            _revealedSellOrders.push(_order);
        }

        // remove order commitment
        _committedOrders[_orderHash] = false;
        _registrations[_regId] = false;
        _unrevealedOrderCount--;

        if (_newRegId == 0) {
            _processClientEscrowReturn();
        } else {
            require(
                msg.value >= _relayerFee + deferredDepositFee,
                "re-register must deposit relayer fee, and to defer, the defer deposit fee"
            );
            require(!_registrations[_regId], "Registration ID already taken");

            _IDsToBeAdded.push(_regId);
            _currentBatchIDBounty += deferredDepositFee;            
            
            require(
                msg.value >= (_escrowClient + _relayerFee + deferredDepositFee),
                "Client register must deposit escrow + relayer fee"
            );
            require(!_registrations[_regId], "Registration ID already taken");

            _IDsToBeAdded.push(_regId);
            _currentBatchIDBounty += deferredDepositFee;
        }

        return true;
    }

    function MM_Reveal(bytes32 _marketHash, Market memory _market)
        external
        payable
        returns (bool)
    {
        require(_phase == Phase.Reveal, "Phase should be Reveal");

        // this should hash all market information. Ensure abi.encodePacked maps uniquely.
        require(
            hash(
                abi.encodePacked(
                    _market._bidPrice,
                    _market._bidSize,
                    _market._offerPrice,
                    _market._offerSize,
                    _market._owner
                )
            ) == _marketHash,
            "market does not match commitment"
        );

        require(_committedMarkets[_marketHash], "Market not recorded");

        _market._bidSize=Math.min(_market._bidSize, _escrowMM*_tokenAFairValue);
        _market._offerSize=Math.min(_market._offerSize, _escrowMM*_tokenBFairValue);
        _processReveal(_tokenA, _market._bidSize);
        _processReveal(_tokenB, _market._offerSize);
        _unrevealedMarketCount--;
        // add bid as buy Order. In the paper we treat markets differently for the main Thm. This has marginal gains on just adding all orders, and is more complex

        Order memory _bid;
        _bid._isBuyOrder = true;

        // this should be reduced to reflect escrow
        _bid._size = _market._bidSize;

        _bid._price = _market._bidPrice;

        // set to max Value
        _bid._maxTradeableWidth = 100000 * _clearingPricePrecision;

        _bid._owner = msg.sender;

        _revealedBuyOrders.push(_bid);

        Order memory _offer;
        _offer._isBuyOrder = false;

        // this should be reduced to reflect escrow
        _offer._size = _market._offerSize;

        _offer._price = _market._offerPrice;

        // set to max Value
        _offer._maxTradeableWidth = 100000 * _clearingPricePrecision;

        _offer._owner = msg.sender;

        _revealedSellOrders.push(_offer);

        if (_market._offerPrice - _market._bidPrice < _wTight) {
            _wTight = _market._offerPrice - _market._bidPrice;
        }

        // remove order commitment
        _committedMarkets[_marketHash] = false;

        // return sscrow to MM
        _processMMEscrowReturn();
        return true;
    }

    function Settlement(
        uint256 clearingPrice,
        uint256 volumeSettled,
        int256 imbalance
    ) external payable returns (bool) {
        require(
            msg.value >= (_settlementBounty),
            "Client register must deposit escrow + relayer fee"
        );
        // Deposit bounty

        require(
            _revealedSellOrders.length + _revealedBuyOrders.length > 0,
            "No orders"
        );

        uint256 revealedBuyOrderCount = _revealedBuyOrders.length;
        uint256 revealedSellOrderCount = _revealedSellOrders.length;
        // Compute max(buyOrders.price) and min(sellOrders.price)
        uint256 maxBuyPrice = 0;
        uint256 minSellPrice = type(uint256).max;

        for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
            if (_revealedBuyOrders[i]._price > maxBuyPrice) {
                maxBuyPrice = _revealedBuyOrders[i]._price;
            }
        }
        for (uint256 i = 0; i < revealedSellOrderCount; i++) {
            if (_revealedSellOrders[i]._price < minSellPrice) {
                minSellPrice = _revealedSellOrders[i]._price;
            }
        }

        require(volumeSettled > 0 || (minSellPrice < maxBuyPrice), "req 1"); // TODO: Min sell less than max bid if no trades?

        // Compute buyVolume and sellVolume
        uint256 buyVolume = 0;
        uint256 sellVolume = 0;

        for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
            if (_revealedBuyOrders[i]._price >= clearingPrice) {
                buyVolume += _revealedBuyOrders[i]._size;
            }
        }

        for (uint256 i = 0; i < revealedSellOrderCount; i++) {
            if (_revealedSellOrders[i]._price <= clearingPrice) {
                sellVolume += _revealedSellOrders[i]._size;
            }
        }

        emit CheckerEvent1(clearingPrice, buyVolume, sellVolume);

        require(
            Math.min(
                buyVolume,
                MulByClearingPrice(sellVolume, clearingPrice)
            ) == volumeSettled,
            "req 2"
        );
        require(
            (int256(buyVolume) -
                int256(MulByClearingPrice(sellVolume, clearingPrice))) ==
                imbalance,
            "req 3"
        );

        if (imbalance == 0) {
            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }
        // As the auction is bid at CP, check if next price increment above clears higher volume OR smaller imbalance
        else if (imbalance > 0) {
            uint256 priceToCheck = clearingPrice + _minTickSize;
            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;

            for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
                if (
                    clearingPrice <= _revealedBuyOrders[i]._price &&
                    _revealedBuyOrders[i]._price < priceToCheck
                ) {
                    buyVolumeNew -= _revealedBuyOrders[i]._size;
                }
            }
            for (uint256 i = 0; i < revealedSellOrderCount; i++) {
                if (
                    clearingPrice < _revealedSellOrders[i]._price &&
                    _revealedSellOrders[i]._price <= priceToCheck
                ) {
                    sellVolumeNew += _revealedSellOrders[i]._size;
                }
            }

            sellVolumeNew = MulByClearingPrice(sellVolumeNew, priceToCheck);

            // If the next price clears less volume, or clears the same volume with a larger imbalance, the proposed CP is valid

            require(
                (Math.min(buyVolumeNew, sellVolumeNew) < volumeSettled) ||
                    (Math.min(buyVolumeNew, sellVolumeNew) == volumeSettled &&
                        imbalance <=
                        Abs(int256(buyVolumeNew) - int256(sellVolumeNew))),
                "we're in trouble"
            ); // TODO: Fix data types

            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }
        // As the auction is offered at CP, check if next price increment below clears higher volume OR smaller imbalance
        else if (imbalance < 0) {
            uint256 priceToCheck = clearingPrice - _minTickSize;
            uint256 buyVolumeNew = buyVolume;
            uint256 sellVolumeNew = sellVolume;

            for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
                if (
                    clearingPrice > _revealedBuyOrders[i]._price &&
                    _revealedBuyOrders[i]._price >= priceToCheck
                ) {
                    buyVolumeNew += _revealedBuyOrders[i]._size;
                }
            }
            for (uint256 i = 0; i < revealedSellOrderCount; i++) {
                if (
                    clearingPrice >= _revealedSellOrders[i]._price &&
                    _revealedSellOrders[i]._price > priceToCheck
                ) {
                    sellVolumeNew -= _revealedSellOrders[i]._size;
                }
            }
            sellVolumeNew = MulByClearingPrice(sellVolumeNew, priceToCheck);

            require(
                (Math.min(buyVolumeNew, sellVolumeNew) < volumeSettled) ||
                    (Math.min(buyVolumeNew, sellVolumeNew) == volumeSettled &&
                        Abs(imbalance) <=
                        Abs((int256)(buyVolumeNew) - (int256)(sellVolumeNew)))
            );

            SettleOrders(clearingPrice, buyVolume, sellVolume);
        }

        // Return deposit + reward to caller. Currently just returning deposit as contract does not have a balance necessarily

        _processSettlementPayout();

        // Reaching this part of the contract means order have been settled, so the portoocol can transition to the next Commit phase

        _lastPhaseUpdate = block.number;
        _phase = Phase.Inactive;

        return true;
    }

    function SettleOrders(
        uint256 clearingPrice,
        uint256 buyVolume,
        uint256 sellVolume
    ) private {
        uint256 revealedSellOrderCount = _revealedSellOrders.length;
        uint256 revealedBuyOrderCount = _revealedBuyOrders.length;

        sellVolume = MulByClearingPrice(sellVolume, clearingPrice);

        uint256 _aBalance = _tokenA.balanceOf(address(this));
        uint256 _bBalance = _tokenB.balanceOf(address(this));
        emit ContractBalanceCheck(
            ticker++,
            _tokenA.balanceOf(address(this)),
            _tokenB.balanceOf(address(this))
        );

        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (buyVolume > sellVolume) {
            uint256 proRatePrice = type(uint256).max;

            for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
                if (_revealedBuyOrders[i]._price >= clearingPrice) {
                    proRatePrice = Math.min(
                        proRatePrice,
                        _revealedBuyOrders[i]._price
                    );
                }
            }

            uint256 sizeProRate = 0;

            for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
                if (_revealedBuyOrders[i]._price == proRatePrice) {
                    sizeProRate += _revealedBuyOrders[i]._size;
                }
            }
            for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
                if (_revealedBuyOrders[i]._price == proRatePrice) {
                    // Return tokens not going to be exchanged

                    uint256 transferQty = DivideBy(
                        _revealedBuyOrders[i]._size * (buyVolume - sellVolume),
                        sizeProRate
                    );
                    _processOrderSettlement(
                        _tokenA,
                        Math.min(transferQty, _aBalance),
                        _revealedBuyOrders[i]._owner
                    );

                    if (_aBalance > transferQty) {
                        _aBalance -= transferQty;
                    } else {
                        _aBalance = 0;
                    }
                    _revealedBuyOrders[i]._size -= transferQty;
                }
            }
        }

        // pro-rate buy orders at the min price above (or equal to) the clearing price
        if (sellVolume > buyVolume) {
            uint256 proRatePrice = 0;

            for (uint256 i = 0; i < revealedSellOrderCount; i++) {
                if (_revealedSellOrders[i]._price <= clearingPrice) {
                    proRatePrice = Math.max(
                        proRatePrice,
                        _revealedSellOrders[i]._price
                    );
                }
            }
            uint256 sizeProRate = 0;

            for (uint256 i = 0; i < revealedSellOrderCount; i++) {
                if (_revealedSellOrders[i]._price == proRatePrice) {
                    sizeProRate += _revealedSellOrders[i]._size;
                }
            }
            for (uint256 i = 0; i < revealedSellOrderCount; i++) {
                if (_revealedSellOrders[i]._price == proRatePrice) {
                    // Return tokens not going to be exchanged
                    uint256 transferQty = DivideBy(
                        _revealedSellOrders[i]._size * (sellVolume - buyVolume),
                        MulByClearingPrice(sizeProRate, clearingPrice)
                    );

                    _revealedSellOrders[i]._size -= transferQty;
                    _processOrderSettlement(
                        _tokenB,
                        transferQty,
                        _revealedSellOrders[i]._owner
                    );

                    if (_bBalance > transferQty) {
                        _bBalance -= transferQty;
                    } else {
                        _bBalance = 0;
                    }

                    emit ContractBalanceCheck(
                        ticker++,
                        _tokenA.balanceOf(address(this)),
                        _tokenB.balanceOf(address(this))
                    );
                }
            }
        }

        for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
            // Execute buy order if bid greater than clearing price
            if (
                _revealedBuyOrders[i]._price >= clearingPrice ||
                _revealedBuyOrders[i]._price == _marketOrderValue
            ) {
                uint256 tokenTradeSize = DivideByClearingPrice(
                    _revealedBuyOrders[i]._size,
                    clearingPrice
                ); // order.size / clearingPrice;

                _processOrderSettlement(
                    _tokenB,
                    Math.min(tokenTradeSize, _bBalance),
                    _revealedBuyOrders[i]._owner
                );
                emit ContractBalanceCheck(
                    ticker++,
                    _tokenA.balanceOf(address(this)),
                    _tokenB.balanceOf(address(this))
                );

                if (_bBalance > tokenTradeSize) {
                    _bBalance -= tokenTradeSize;
                } else {
                    _bBalance = 0;
                }
            } else if (_revealedBuyOrders[i]._price < clearingPrice) {
                //return tokens to players not trading

                _processOrderSettlement(
                    _tokenA,
                    Math.min(_revealedBuyOrders[i]._size, _aBalance),
                    _revealedBuyOrders[i]._owner
                );
                emit ContractBalanceCheck(
                    ticker++,
                    _tokenA.balanceOf(address(this)),
                    _tokenB.balanceOf(address(this))
                );
                if (_aBalance > _revealedBuyOrders[i]._size) {
                    _aBalance -= _revealedBuyOrders[i]._size;
                } else {
                    _aBalance = 0;
                }
            }
        }

        for (uint256 i = 0; i < revealedSellOrderCount; i++) {
            // Execute sell order if ask less than clearing price
            if (
                _revealedSellOrders[i]._price <= clearingPrice ||
                _revealedSellOrders[i]._price == _marketOrderValue
            ) {
                uint256 tokenTradeSize = MulByClearingPrice(
                    _revealedSellOrders[i]._size,
                    clearingPrice
                ); // order.size / clearingPrice

                _processOrderSettlement(
                    _tokenA,
                    Math.min(tokenTradeSize, _aBalance),
                    _revealedSellOrders[i]._owner
                );
                emit ContractBalanceCheck(
                    ticker++,
                    _tokenA.balanceOf(address(this)),
                    _tokenB.balanceOf(address(this))
                );
                if (_aBalance > tokenTradeSize) {
                    _aBalance -= tokenTradeSize;
                } else {
                    _aBalance = 0;
                }
            } else if (_revealedSellOrders[i]._price > clearingPrice) {
                //return tokens to players not trading

                _processOrderSettlement(
                    _tokenB,
                    Math.min(_revealedSellOrders[i]._size, _bBalance),
                    _revealedSellOrders[i]._owner
                );
                emit ContractBalanceCheck(
                    ticker++,
                    _tokenA.balanceOf(address(this)),
                    _tokenB.balanceOf(address(this))
                );
                if (_bBalance > _revealedSellOrders[i]._size) {
                    _bBalance -= _revealedSellOrders[i]._size;
                } else {
                    _bBalance = 0;
                }
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

    //proceeding _process... functions perform token/ Eth transfers

    function _processReveal(IERC20 _token, uint256 _amount) internal {
        _token.transferFrom(msg.sender, address(this), _amount);
    }

    function _processOrderSettlement(
        IERC20 _token,
        uint256 _amount,
        address recipient
    ) internal {
        _token.transfer(recipient, _amount);
    }

    function _processClientCommit(address payable _relayer) internal {
        _relayer.transfer(_relayerFee);
    }

    function _processMMEscrowReturn() internal {
        payable(msg.sender).transfer(_escrowMM);
    }

    function _processClientEscrowReturn() internal {
        payable(msg.sender).transfer(_escrowClient);
    }

    // This should be more than _settlementBounty to incentivise settlement

    function _processSettlementPayout() internal {
        payable(msg.sender).transfer(_settlementBounty);
    }
    
    // This should be more than _settlementBounty to incentivise settlement

    function _processBatchingIDsPayout() internal {
        payable(msg.sender).transfer(_currentBatchIDBounty);
    }

    function getTknPrice(IERC20 _tkn) internal returns(uint256){
        // this function should call a price oracle, either internal(e.g based on trade volume, deposits, etc.) or external, (e.g chainlink, uniswap, etc) which upperbounds the price of _tkn in ETH
        return 1000000000;
    }

    // proceeding functions are necessary to perform 'precise' multiplication and division

    function Abs(int256 x) private pure returns (int256) {
        return x >= 0 ? x : -x;
    }

    function MulByClearingPrice(uint256 value, uint256 clearingPrice)
        internal
        pure
        returns (uint256)
    {
        return
            SafeMath.div(
                SafeMath.mul(value, clearingPrice),
                _clearingPricePrecision
            );
    }

    function DivideByClearingPrice(uint256 value, uint256 clearingPrice)
        internal
        pure
        returns (uint256)
    {
        return
            SafeMath.div(
                SafeMath.mul(value, _clearingPricePrecision),
                clearingPrice
            );
    }

    function DivideBy(uint256 numerator, uint256 denominator)
        internal
        pure
        returns (uint256)
    {
        return SafeMath.div(numerator, denominator);
    }

    // proceeding functions return various pieces of information that should be checked
    // BEFORE interacting with the blockchain

    // check if registration ID exists

    function _checkRegIDs(bytes32 _regId)
        public
        view
        returns (bool regIDisPresent)
    {
        return _registrations[_regId];
    }

    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return _nullifierHashes[_nullifierHash];
    }

    function _getContractBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function _getPlayerBalance() public view returns (uint256) {
        return msg.sender.balance;
    }

    function _getMinTickSize() public view returns (uint256) {
        return _minTickSize;
    }

    function _getNumBuyOrders() public view returns (uint256) {
        return _revealedBuyOrders.length;
    }

    function _getNumSellOrders() public view returns (uint256) {
        return _revealedSellOrders.length;
    }

    function _getWidthTight() public view returns (uint256) {
        return _wTight;
    }

    //The proceeding functions should be implemented offline
    // For now, they centralise the calculations being done in the JS test cases.

    uint256 solVolumeSettled;
    int256 solImbalance;

    function _getSolImbalance() public view returns (int256) {
        return solImbalance;
    }

    function _getSolVolumeSettled() public view returns (uint256) {
        return solVolumeSettled;
    }

    // takes a proposed clearing price, and ensures it matches with volume settled and
    //imbalance
    // Does not check if the proposed value maximises volume/ minimises imbalance

    function clearingPriceConvertor(
        uint256 clearingPrice,
        uint256 volumeSettled,
        int256 imbalance
    ) public {
        // Deposit bounty
        require(
            _revealedSellOrders.length + _revealedBuyOrders.length > 0,
            "No orders"
        );

        uint256 revealedBuyOrderCount = _revealedBuyOrders.length;
        uint256 revealedSellOrderCount = _revealedSellOrders.length;
        // Compute max(buyOrders.price) and min(sellOrders.price)
        uint256 maxBuyPrice = 0;
        uint256 minSellPrice = type(uint256).max;

        for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
            if (_revealedBuyOrders[i]._price > maxBuyPrice) {
                maxBuyPrice = _revealedBuyOrders[i]._price;
            }
        }
        for (uint256 i = 0; i < revealedSellOrderCount; i++) {
            if (_revealedSellOrders[i]._price < minSellPrice) {
                minSellPrice = _revealedSellOrders[i]._price;
            }
        }

        // Compute buyVolume and sellVolume
        uint256 buyVolume = 0;
        uint256 sellVolume = 0;

        for (uint256 i = 0; i < revealedBuyOrderCount; i++) {
            if (_revealedBuyOrders[i]._price >= clearingPrice) {
                buyVolume += _revealedBuyOrders[i]._size;
            }
        }

        for (uint256 i = 0; i < revealedSellOrderCount; i++) {
            if (_revealedSellOrders[i]._price <= clearingPrice) {
                sellVolume += _revealedSellOrders[i]._size;
            }
        }
        solVolumeSettled = Math.min(
            buyVolume,
            MulByClearingPrice(sellVolume, clearingPrice)
        );
        solImbalance =
            int256(buyVolume) -
            int256(MulByClearingPrice(sellVolume, clearingPrice));
    }
}
