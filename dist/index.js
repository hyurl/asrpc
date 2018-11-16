"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net = require("net");
const path = require("path");
const fs = require("fs-extra");
const events_1 = require("events");
const isSocketResetError = require("is-socket-reset-error");
const util_1 = require("./util");
var oid = 0;
class ServiceInstance {
    constructor() {
        this.timeout = 5000;
        this.services = {};
        this.instances = {};
        this.queue = [];
    }
    register(target) {
        target[util_1.classId] = util_1.getClassId(target);
        this.services[target[util_1.classId]] = target;
    }
    deregister(target) {
        if (target[util_1.classId])
            delete this.services[target[util_1.classId]];
    }
    start() {
        return new Promise((resolve, reject) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            let server = net.createServer(), resolved = false;
            if (this.path) {
                yield fs.ensureDir(path.dirname(this.path));
                if (yield fs.pathExists(this.path)) {
                    yield fs.unlink(this.path);
                }
                server.listen(this.path, () => {
                    (resolved = true) && resolve();
                });
            }
            else {
                server.listen(this.port, this.host, () => {
                    (resolved = true) && resolve();
                });
            }
            this.server = server;
            this.server.once("error", err => {
                !resolved && (resolved = true) && reject(err);
            }).on("error", err => {
                if (this.errorHandler && resolved) {
                    this.errorHandler.call(this, err);
                }
            }).on("connection", socket => {
                socket.on("data", buf => {
                    for (let [event, ...data] of util_1.receive(buf)) {
                        event = isNaN(event) ? event : util_1.RPCEvents[event];
                        socket.emit(event, ...data);
                    }
                }).on("error", err => {
                    if (!isSocketResetError(err) && this.errorHandler) {
                        this.errorHandler.call(this, err);
                    }
                }).on(util_1.RPCEvents[0], (oid, name, id, ...args) => {
                    if (this.services[id]) {
                        this.instances[oid] = new this.services[id](...args);
                        socket.write(util_1.send(util_1.RPCEvents.CONNECTED, oid, id));
                    }
                    else {
                        let err = new Error(`service '${name}' not registered`);
                        socket.write(util_1.send(util_1.RPCEvents.CONNECT_ERROR, oid, err));
                    }
                }).on(util_1.RPCEvents[3], (oid) => {
                    delete this.instances[oid];
                }).on(util_1.RPCEvents[4], (oid, taskId, method, ...args) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                    try {
                        let service = this.instances[oid], res = yield service[method](...args);
                        yield new Promise(resolve => socket.write(util_1.send(util_1.RPCEvents.RESPONSE, oid, taskId, res), () => resolve()));
                    }
                    catch (err) {
                        socket.write(util_1.send(util_1.RPCEvents.ERROR, oid, taskId, err));
                    }
                }));
            });
        }));
    }
    close() {
        return new Promise(resolve => this.server.close(() => {
            this.server.unref();
            resolve();
        }));
    }
    connect(target, ...args) {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                let resolved = false;
                let handler = () => {
                    !resolved && (resolved = true) && resolve();
                    while (this.queue.length) {
                        let msg = this.queue.shift();
                        this.clientSend(...msg);
                    }
                };
                let connect = () => {
                    if (this.path) {
                        this.client = net.createConnection(this.path, handler);
                    }
                    else {
                        this.client = net.createConnection(this.port, this.host, handler);
                    }
                };
                connect();
                this.client.once("error", err => {
                    !resolved && (resolved = true) && reject(err);
                }).on("error", err => {
                    if (isSocketResetError(err)) {
                        this.client.unref();
                        let times = 0;
                        let reconnect = () => {
                            let timer = setTimeout(() => {
                                connect();
                                times++;
                                if (times === 5) {
                                    clearTimeout(timer);
                                }
                                else if (!this.client.destroyed
                                    || this.client.connecting) {
                                    clearTimeout(timer);
                                }
                                else {
                                    reconnect();
                                }
                            }, 50);
                        };
                    }
                    else if (this.errorHandler && resolved) {
                        this.errorHandler.call(this, err);
                    }
                }).on("data", buf => {
                    for (let [event, oid, ...data] of util_1.receive(buf)) {
                        event = isNaN(event) ? event : util_1.RPCEvents[event];
                        this.instances[oid][util_1.eventEmitter].emit(event, ...data);
                    }
                });
            }
            else {
                resolve();
            }
        }).then(() => {
            return new Promise((resolve, reject) => {
                let srv = new target(...args);
                let _oid = oid;
                let clsId = srv[util_1.classId] = target[util_1.classId]
                    || (target[util_1.classId] = util_1.getClassId(target));
                srv[util_1.objectId] = oid;
                srv[util_1.eventEmitter] = new events_1.EventEmitter;
                this.instances[oid] = srv;
                this.clientSend(util_1.RPCEvents.CONNECT, oid, target.name, clsId, ...args);
                srv[util_1.eventEmitter].once(util_1.RPCEvents[1], () => {
                    resolve(util_1.proxify(srv, _oid, this));
                }).once(util_1.RPCEvents[2], (err) => {
                    reject(err);
                }).on(util_1.RPCEvents[5], (taskId, res) => {
                    util_1.tasks[taskId].resolve(res);
                }).on(util_1.RPCEvents[6], (taskId, err) => {
                    util_1.tasks[taskId].reject(err);
                });
                oid++;
                if (oid === Number.MAX_SAFE_INTEGER)
                    oid = 0;
            });
        });
    }
    disconnect(service) {
        return new Promise(resolve => {
            let oid = service[util_1.objectId];
            if (!oid)
                return resolve();
            delete this.instances[oid];
            this.clientSend(util_1.RPCEvents.DISCONNECT, oid, () => resolve());
        });
    }
    onError(handler) {
        this.errorHandler = handler;
    }
    clientSend(...msg) {
        if (this.client && !this.client.destroyed) {
            let cb;
            if (typeof msg[msg.length - 1] == "function") {
                cb = msg.pop();
            }
            else {
                cb = () => { };
            }
            this.client.write(util_1.send.apply(void 0, msg), cb);
        }
        else {
            this.queue.push(msg);
        }
    }
}
exports.ServiceInstance = ServiceInstance;
function createInstance() {
    let ins = new ServiceInstance;
    if (typeof arguments[0] == "object") {
        Object.assign(ins, arguments[0]);
    }
    else if (typeof arguments[0] == "string") {
        ins.path = util_1.absPath(arguments[0]);
    }
    else {
        ins.port = arguments[0];
        ins.host = arguments[1];
    }
    return ins;
}
exports.createInstance = createInstance;
exports.default = createInstance;
//# sourceMappingURL=index.js.map