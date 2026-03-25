'use strict';

const { fork } = require('child_process');
const path = require('path');

module.exports = async () => {
    console.log("Global setup");

    // startup bacnet server
    const child = fork(path.join(__dirname, 'bacnet_server.js')) // eslint-disable-line
    global.bacnetServer = child;

    // send points to bacnet server
    // child.send();

    child.on('message', (message) => {
        console.log(`BACnet server message: ${message}`);
    });

    child.on('error', (err) => {
        console.error(`BACnet server error: ${err}`);
    });

    child.on('exit', (code, signal) => {
        if (code === null)
            console.log('BACnet server exited');
        else
            console.log(`BACnet server exited with code ${code}, signal ${signal}`);
    });
};
