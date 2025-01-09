'use strict'

module.exports = {
    EG_BACNET_DEVICES: [{
        "deviceName": "BMS",
        "deviceId": 1,
        "network": null,
        "ipAddress": "192.168.1.100",
        "macAddress": null,
        "segmentation": 0,
        "maxApdu": 1476,
        "vendorId": 36
    }],

    EG_BACNET_POINTS: [{
        "deviceName": "BMS",
        "pointName": "VAV_1_ZoneTemp",
        "bacType": 2,
        "bacInstance": 96,
        "bacProp": 85,
        "facets": "unit:°C;precision:1"
    }],

    EG_BACNET_WRITE_POINTS: {
        'Device_1.Zone_Temp_SP': 21.5,
        'Device_2.Zone_Temp_SP': 21.5,
    },
}