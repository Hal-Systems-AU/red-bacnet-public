'use strict'
require('./_alias.js');

const { print } = require('@root/common/core/util.js')
let bacnet = require('@root/ext/node-bacstack/dist/index.js')
const { EVENT_CLOSE } = require('@root/common/core/constant.js')

module.exports = function (RED) {
    class BacnetClient {
        constructor(config) {
            RED.nodes.createNode(this, config);

            // bacnet config
            this.name = config.name;
            this.apduTimeout = config.apduTimeout;
            this.interface = config.interface;
            this.port = config.port;
            this.broadcastAddress = config.broadcastAddress;

            // bacnet client status
            this.instance = null;

            // init client
            try {
                this.instance = new bacnet.Client({
                    apduTimeout: this.apduTimeout,
                    interface: this.interface,
                    port: this.port,
                    broadcastAddress: this.broadcastAddress
                });
            } catch (error) {
                // @ts-ignore
                this.warn(`Failed to initiate BACnet Client ${this.name}. ${error}`);
            }

            // close client on node red stop / redeploy
            // @ts-ignore
            this.on(EVENT_CLOSE, () => {
                print('Stopping BACnet Client', true);
                this.instance.close();
            })
        }
    }

    // Register the node type with Node-RED
    RED.nodes.registerType("bacnet client", BacnetClient);
}
