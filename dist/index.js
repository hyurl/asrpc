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
        target[util_1.classId] = util_1.getClassId(target);
        this.services[target[util_1.classId]] = target;
    }
    deregister(target) {
        if (target[util_1.classId])
            delete this.services[target[util_1.classId]];
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
                }).on("rpc-connect", (objId, name, id, ...args) => {
                    if (this.services[id]) {
                        this.instances[objId] = new this.services[id](...args);
                        socket.write(util_1.send("rpc-connected", objId, id));
                    }
                    else {
                        let err = new Error(`service '${name}' not registered`);
                        socket.write(util_1.send("rpc-connect-error", objId, util_1.sendError(err)));
                    }
                }).on("rpc-disconnect", (objId) => {
                    delete this.instances[objId];
                }).on("rpc-request", (objId, taskId, method, ...args) => {
                    let service = this.instances[objId];
                    Promise.resolve().then(() => {
                        return service[method](...args);
                    }).then(res => {
                        return new Promise(resolve => {
                            socket.write(util_1.send("rpc-response", objId, taskId, res), () => {
                                resolve();
                            });
                        });
                    }).catch(err => {
                        socket.write(util_1.send("rpc-error", objId, taskId, util_1.sendError(err)));
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
                    for (let [event, objId, ...data] of util_1.receive(buf)) {
                        this.instances[objId][util_1.eventEmitter].emit(event, ...data);
                    }
                });
            }
            else {
                resolve();
            }
        }).then(() => {
            return new Promise((resolve, reject) => {
                let srv = new target(...args);
                let clsId = srv[util_1.classId] = target[util_1.classId] || (target[util_1.classId] = util_1.getClassId(target));
                let objId = srv[util_1.objectId] = shortid_1.generate();
                srv[util_1.eventEmitter] = new events_1.EventEmitter;
                this.instances[objId] = srv;
                this.client.write(util_1.send("rpc-connect", objId, target.name, clsId, ...args));
                srv[util_1.eventEmitter].once("rpc-connected", () => {
                    resolve(util_1.proxify(srv, objId, this));
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
            let objId = srv[util_1.objectId];
            delete this.instances[objId];
            this.client.write(util_1.send("rpc-disconnect", objId), () => {
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
exports.default = createInstance;
//# sourceMappingURL=index.js.map