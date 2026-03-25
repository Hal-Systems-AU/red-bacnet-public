'use strict';

const { expect } = require('@jest/globals');
const _ = require('lodash');


// ---------------------------------- functions ----------------------------------
function assert(value) {
    expect(value).toBe(true);
}


function print(str) {
    console.log(str);
}

function compareObj(arr1, arr2, keysToIgnore) {
    return _.isEmpty(_.xorWith(arr1, arr2, (a, b) =>
        _.isEqualWith(a, b, (value1, value2, key) => {
            if (keysToIgnore.includes(key)) {
                return true;
            }
            return undefined;
        })
    ));
}

module.exports = {
    assert,
    print,
    compareObj
}