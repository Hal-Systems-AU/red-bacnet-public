'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.decode = exports.encode = void 0;
const baEnum = require("./enum");
const encode = (buffer, func, msgLength) => {
    buffer[0] = baEnum.BVLL_TYPE_BACNET_IP;
    buffer[1] = func;
    buffer[2] = (msgLength & 0xFF00) >> 8;
    buffer[3] = (msgLength & 0x00FF) >> 0;
    return baEnum.BVLC_HEADER_LENGTH;
};
exports.encode = encode;
const decode = (buffer, offset) => {
    let len;
    let linkAddress;
    const func = buffer[1];
    const msgLength = (buffer[2] << 8) | (buffer[3] << 0);

    if (buffer[0] !== baEnum.BVLL_TYPE_BACNET_IP || buffer.length !== msgLength)
        return;
    switch (func) {
        case baEnum.BvlcResultPurpose.BVLC_RESULT:
        case baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU:
        case baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU:
        case baEnum.BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK:
            len = 4;
            break;
        case baEnum.BvlcResultPurpose.FORWARDED_NPDU:
            len = 10;
            // HAL modified. Extract BVLC IP and port from buffer
            if (buffer.length >= 10) {
                const ipParts = [buffer[4], buffer[5], buffer[6], buffer[7]];
                const port = (buffer[8] << 8) | buffer[9];

                // Validate IP octets (0–255 only)
                const isValidIp = ipParts.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255);

                // Validate port (1–65535; BACnet default is 47808)
                const isValidPort = Number.isInteger(port) && port > 0 && port <= 65535;

                // Extra IP rules
                const isBroadcast = ipParts.every(octet => octet === 255); // 255.255.255.255
                const isMulticast = ipParts[0] >= 224 && ipParts[0] <= 239; // 224.0.0.0 – 239.255.255.255
                const isZero = ipParts.every(octet => octet === 0); // 0.0.0.0

                if (isValidIp && isValidPort && !isBroadcast && !isMulticast && !isZero) {
                    const ip = ipParts.join(".");
                    linkAddress = (port === 47808) ? ip : `${ip}:${port}`;
                    // linkAddress = `${ip}:${port}`;
                }
            }
            break;
        case baEnum.BvlcResultPurpose.REGISTER_FOREIGN_DEVICE:
        case baEnum.BvlcResultPurpose.READ_FOREIGN_DEVICE_TABLE:
        case baEnum.BvlcResultPurpose.DELETE_FOREIGN_DEVICE_TABLE_ENTRY:
        case baEnum.BvlcResultPurpose.READ_BROADCAST_DISTRIBUTION_TABLE:
        case baEnum.BvlcResultPurpose.WRITE_BROADCAST_DISTRIBUTION_TABLE:
        case baEnum.BvlcResultPurpose.READ_BROADCAST_DISTRIBUTION_TABLE_ACK:
        case baEnum.BvlcResultPurpose.READ_FOREIGN_DEVICE_TABLE_ACK:
        case baEnum.BvlcResultPurpose.SECURE_BVLL:
            return;
        default:
            return;
    }
    return {
        len: len,
        func: func,
        msgLength: msgLength,
        linkAddress: linkAddress
    };
};
exports.decode = decode;
