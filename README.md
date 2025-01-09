# About
RED-BACnet is a BACnet IP driver designed for Node-RED, enabling interaction with BACnet devices.

Features include:
- discovering devices
- discovering points
- bulk reading points
- bulk writing points

## Installation
### Install using Node-RED Palette Manager
```md
1. Click the 'Hamburger' icon at the top right corner.
2. Select the 'Manage palette' option.
3. Click the 'Install' tab and type '@halsystems/red-bacnet' into the search field.
4. Click to install.
```

### Install using NPM
```bash
cd "${HOME}"/.node-red
npm install --production @halsystems/red-bacnet
```
### Example
See <a href="https://flows.nodered.org/flow/45a1c893a2acd0dc9df7c7b91b82bfe6" target="_blank">here</a>

## Contributions
This package is based on two projects:
- ts-node-bacstack (v1.0.0-beta.2): A direct dependency for this package. (https://github.com/HILA-TECH/ts-node-bacstack)
- node-bacstack: The original JavaScript implementation that laid the groundwork for BACnet communication in Node.js environments. (https://github.com/fh1ch/node-bacstack)

## License
MIT
Copyright (c) 2024-present [HAL Systems](https://www.halsystems.com.au/)