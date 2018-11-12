"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net = require("net");
const path = require("path");
const fs = require("fs-extra");
const events_1 = require("events");
const shortid_1 = require("shortid");
const isSocketResetError = require("is-socket-reset-error");
const util_1 = require("./util");
class ServiceInstance {
    constructor() {
        this.timeout = 5000;
        this.services = {};
        this.instances = {};
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
                        socket.emit(event, ...data);
                    }
                }).on("error", err => {
                    if (!isSocketResetError(err) && this.errorHandler) {
                        this.errorHandler.call(this, err);
                    }
                }).on("rpc-connect", (oid, name, id, ...args) => {
                    if (this.services[id]) {
                        this.instances[oid] = new this.services[id](...args);
                        socket.write(util_1.send("rpc-connected", oid, id));
                    }
                    else {
                        let err = new Error(`service '${name}' not registered`);
                        socket.write(util_1.send("rpc-connect-error", oid, err));
                    }
                }).on("rpc-disconnect", (oid) => {
                    delete this.instances[oid];
                }).on("rpc-request", (oid, taskId, method, ...args) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                    try {
                        let service = this.instances[oid], res = yield service[method](...args);
                        yield new Promise(resolve => socket.write(util_1.send("rpc-response", oid, taskId, res), () => resolve()));
                    }
                    catch (err) {
                        socket.write(util_1.send("rpc-error", oid, taskId, err));
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
                let connect = () => {
                    if (this.path) {
                        this.client = net.createConnection(this.path);
                    }
                    else {
                        this.client = net.createConnection(this.port, this.host);
                    }
                };
                connect();
                this.client.once("connect", () => {
                    (resolved = true) && resolve();
                }).once("error", err => {
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
                let oid = srv[util_1.objectId] = shortid_1.generate();
                let clsId = srv[util_1.classId] = target[util_1.classId]
                    || (target[util_1.classId] = util_1.getClassId(target));
                srv[util_1.eventEmitter] = new events_1.EventEmitter;
                this.instances[oid] = srv;
                this.client.write(util_1.send("rpc-connect", oid, target.name, clsId, ...args));
                srv[util_1.eventEmitter].once("rpc-connected", () => {
                    resolve(util_1.proxify(srv, oid, this));
                }).once("rpc-connect-error", (err) => {
                    reject(err);
                }).on("rpc-response", (taskId, res) => {
                    util_1.tasks[taskId].resolve(res);
                }).on("rpc-error", (taskId, err) => {
                    util_1.tasks[taskId].reject(err);
                });
            });
        });
    }
    disconnect(service) {
        return new Promise(resolve => {
            let oid = service[util_1.objectId];
            if (!oid)
                return resolve();
            delete this.instances[oid];
            this.client.write(util_1.send("rpc-disconnect", oid), () => {
                resolve();
            });
        });
    }
    onError(handler) {
        this.errorHandler = handler;
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