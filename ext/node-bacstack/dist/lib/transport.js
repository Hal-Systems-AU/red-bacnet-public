"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transport = void 0;
const dgram_1 = require("dgram");
const events_1 = require("events");
const DEFAULT_BACNET_PORT = 47808;
const GLOBAL_BROADCAST_ADDRESS = "255.255.255.255";
const UDP_TYPE = "udp4";

// HAL modified
// to allow UDP listening on broadcast address
class Transport extends events_1.EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._server = null;
        this._broadcastServer = null;

        this._server = (0, dgram_1.createSocket)({
            type: UDP_TYPE,
            reuseAddr: true,
        });
        this._setupSocket(this._server);

        if (
            this._settings.broadcastAddress &&
            this._settings.broadcastAddress !== GLOBAL_BROADCAST_ADDRESS &&
            this._settings.broadcastAddress !== this._settings.interface
        ) {
            this._broadcastServer = (0, dgram_1.createSocket)({
                type: UDP_TYPE,
                reuseAddr: true,
            });
            this._setupSocket(this._broadcastServer);
        }
    }

    _setupSocket(socket) {
        socket.on("message", (msg, rinfo) => {
            const port = rinfo.port || DEFAULT_BACNET_PORT;
            if (port === DEFAULT_BACNET_PORT) {
                this.emit("message", msg, rinfo.address);
            } else {
                this.emit("message", msg, `${rinfo.address}:${port}`);
            }
        });
        socket.on("error", (err) => this.emit("error", err));
    }

    getBroadcastAddress() {
        return this._settings.broadcastAddress;
    }

    getMaxPayload() {
        return 1482;
    }

    send(buffer, offset, receiver) {
        const target = receiver || this.getBroadcastAddress();
        if (!target) {
            this.emit(
                "error",
                new Error("No receiver specified and no broadcast address configured"),
            );
            return;
        }

        const [address, port] = target.split(":");
        this._server.send(
            buffer,
            0,
            offset,
            port || this._settings.port || DEFAULT_BACNET_PORT,
            address,
            (err) => {
                if (err) {
                    this.emit("error", err);
                }
            },
        );
    }

    open() {
        this._server.on("error", (err) => this.emit("error", err));
        this._server.bind(this._settings.port, this._settings.interface, () => {
            this._server.setBroadcast(true);
        });

        if (this._broadcastServer) {
            this._broadcastServer.on("error", (err) => {
                this.emit("error", err);
                this._broadcastServer.close();
                this._broadcastServer = null;
            });
            this._broadcastServer.bind(
                this._settings.port,
                this._settings.broadcastAddress,
                () => {
                    this._broadcastServer.setBroadcast(true);
                }
            );
        }
    }

    close() {
        if (this._server) {
            this._server.removeAllListeners();
            this._server.close();
        }
        if (this._broadcastServer) {
            this._broadcastServer.removeAllListeners();
            this._broadcastServer.close();
        }
    }
}
exports.Transport = Transport;
