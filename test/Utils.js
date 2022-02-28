class OrderJS {
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

exports.Order = OrderJS;