'use strict';

// eslint-disable-next-line
const { assert, print } = require('@tests/_test_lib/util.js');
const { describe, beforeAll, afterAll, expect, it } = require('@jest/globals');

const { facetsStrToObj, errMsg } = require('@root/common/func.js');

// ---------------------------------- test ----------------------------------
describe('Func tests', () => {
    beforeAll(() => {
    });

    afterAll(() => {
    });

    it.each([
        ['unit:°C;precision:1', { unit: '°C', precision: '1' }],
        ['unit:°C', { unit: '°C' }],
        ['falseText:Off;trueText:On', { falseText: 'Off', trueText: 'On' }],
        ['falseText: Off ; trueText: On ', { falseText: 'Off', trueText: 'On' }],
        ['range:{1:Reserved;2:Warning}', { range: { 1: 'Reserved', 2: 'Warning' } }],
    ])(facetsStrToObj.name, (str, expected) => {
        expect(facetsStrToObj(str)).toStrictEqual(expected);
    });

    it.each([
        ['func1', 'err name 1', 'err desc 1', { '[func1] err name 1': 'err desc 1' }],
        ['func2', 'err name 2', 'err desc 2', { '[func2] err name 2': 'err desc 2' }],
        ['func3', 'err name 3', 'err desc 3', { '[func3] err name 3': 'err desc 3' }],
    ])(errMsg.name, (funcName, errName, errDesc, expected) => {
        expect(errMsg(funcName, errName, errDesc)).toStrictEqual(expected);
    });
});
