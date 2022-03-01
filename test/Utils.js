class Order {
    constructor(isBuyOrder, size, price, maxTradeableWidth, account) {
        this._isBuyOrder = isBuyOrder;
        this._size = size;
        this._price = price;
        this._maxTradeableWidth = maxTradeableWidth;
        this._owner = account;
    }

    GetPreimage() {
        return web3.utils.soliditySha3(
            { t: 'bool', v: this._isBuyOrder },
            { t: 'uint256', v: this._size },
            { t: 'uint256', v: this._price },
            { t: 'uint256', v: this._maxTradeableWidth },
            { t: 'address', v: this._owner });
    }

    Unwrap() {
        return {
            '_isBuyOrder': this._isBuyOrder ? 1 : 0,
            '_size': this._size.toString(),
            '_price': this._price.toString(),
            '_maxTradeableWidth': this._maxTradeableWidth.toString(),
            '_owner': this._owner,
        };
    }
}

class MarketMakerOrder {
    constructor(bidPrice, bidSize, offerPrice, offerSize, owner) {
        this._bidPrice = bidPrice;
        this._bidSize = bidSize;
        this._offerPrice = offerPrice;
        this._offerSize = offerSize;
        this._owner = owner;
    }

    GetPreimage() {
        return web3.utils.soliditySha3(
            { t: 'uint256', v: this._bidPrice },
            { t: 'uint256', v: this._bidSize },
            { t: 'uint256', v: this._offerPrice },
            { t: 'uint256', v: this._offerSize },
            { t: 'address', v: this._owner });
    }

    Unwrap() {
        return {
            '_bidPrice': this._bidPrice.toString(),
            '_bidSize': this._bidSize.toString(),
            '_offerPrice': this._offerPrice.toString(),
            '_offerSize': this._offerSize.toString(),
            '_owner': this._owner
        }
    };
}

exports.Order = Order;
exports.MarketMakerOrder = MarketMakerOrder;