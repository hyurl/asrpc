"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net = require("net");
const path = require("path");
const fs = require("fs-extra");
const events_1 = require("events");
const shortid_1 = require("shortid");
const util_1 = require("./util");
class ServiceInstance {
    constructor() {
        this.timeout = 5000;
        this.services = {};
        this.instances = {};
    }
    register(target) {
        this.services[util_1.getId(target)] = target;
    }
    deregister(target) {
        delete this.services[util_1.getId(target)];
    }
    start() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let server = net.createServer();
            if (this.path) {
                yield fs.ensureDir(path.dirname(this.path));
                if (yield fs.pathExists(this.path)) {
                    yield fs.unlink(this.path);
                }
                server.listen(this.path);
            }
            else {
                server.listen(this.port, this.host);
            }
            this.server = server;
            this.server.on("connection", socket => {
                socket.on("data", buf => {
                    for (let [event, ...data] of util_1.receive(buf)) {
                        socket.emit(event, ...data);
                    }
                }).on("error", err => {
                    if (!util_1.isSocketResetError(err)) {
                        console.error(err);
                    }
                }).on("rpc-connect", (srvId, name, id, ...args) => {
                    if (this.services[id]) {
                        this.instances[srvId] = new this.services[id](...args);
                        socket.write(util_1.send("rpc-connected", srvId, id));
                    }
                    else {
                        let err = new Error(`service '${name}' not registered`);
                        socket.write(util_1.send("rpc-connect-error", srvId, util_1.sendError(err)));
                    }
                }).on("rpc-disconnect", (srvId) => {
                    delete this.instances[srvId];
                }).on("rpc-request", (srvId, taskId, method, ...args) => {
                    let service = this.instances[srvId];
                    Promise.resolve().then(() => {
                        return service[method](...args);
                    }).then(res => {
                        return new Promise(resolve => {
                            socket.write(util_1.send("rpc-response", srvId, taskId, res), () => {
                                resolve();
                            });
                        });
                    }).catch(err => {
                        socket.write(util_1.send("rpc-error", srvId, taskId, util_1.sendError(err)));
                    });
                });
            });
            return this;
        });
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
                    resolve();
                }).once("error", err => {
                    reject(err);
                }).on("error", err => {
                    if (util_1.isSocketResetError(err)) {
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
                }).on("data", buf => {
                    for (let [event, srvId, ...data] of util_1.receive(buf)) {
                        this.instances[srvId][util_1.eventEmitter].emit(event, ...data);
                    }
                });
            }
            else {
                resolve();
            }
        }).then(() => {
            return new Promise((resolve, reject) => {
                let srv = new target;
                let srvId = srv[util_1.serviceId] = shortid_1.generate();
                srv[util_1.eventEmitter] = new events_1.EventEmitter;
                this.instances[srvId] = srv;
                this.client.write(util_1.send("rpc-connect", srvId, target.name, util_1.getId(target), ...args));
                srv[util_1.eventEmitter].once("rpc-connected", () => {
                    resolve(util_1.proxify(srv, srvId, this));
                }).once("rpc-connect-error", (err) => {
                    reject(util_1.receiveError(err));
                }).on("rpc-response", (taskId, res) => {
                    util_1.tasks[taskId].success(res);
                }).on("rpc-error", (taskId, err) => {
                    util_1.tasks[taskId].error(util_1.receiveError(err));
                });
            });
        });
    }
    disconnect(srv) {
        return new Promise(resolve => {
            let srvId = srv[util_1.serviceId];
            delete this.instances[srvId];
            this.client.write(util_1.send("rpc-disconnect", srvId), () => {
                resolve();
            });
        });
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
//# sourceMappingURL=index.js.map