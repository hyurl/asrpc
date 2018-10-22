"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const shortid_1 = require("shortid");
const hash = require("object-hash");
const assert_1 = require("assert");
const path = require("path");
const os = require("os");
const proxified = Symbol("proxified");
exports.serviceId = Symbol("serviceId");
exports.eventEmitter = Symbol("eventEmitter");
function getId(target) {
    return hash(target).slice(0, 8);
}
exports.getId = getId;
function send(event, uniqid, ...data) {
    return Buffer.from(JSON.stringify([event, uniqid, ...data]) + "\r\n\r\n");
}
exports.send = send;
function receive(buf) {
    let pack = buf.toString().split("\r\n\r\n"), parts = [];
    for (let part of pack) {
        if (part)
            parts.push(JSON.parse(part));
    }
    return parts;
}
exports.receive = receive;
function sendError(err) {
    let isError = err instanceof Error, res = !isError ? null : {
        name: err.name,
        message: err.message,
        stack: err.stack
    };
    if (isError) {
        for (let x in err) {
            res[x] = err[x];
        }
    }
    return res || err;
}
exports.sendError = sendError;
function receiveError(err) {
    if (err.name && "message" in err && "stack" in err) {
        let constructor;
        switch (err.name) {
            case EvalError.name:
                constructor = EvalError;
                break;
            case RangeError.name:
                constructor = RangeError;
                break;
            case ReferenceError.name:
                constructor = ReferenceError;
                break;
            case SyntaxError.name:
                constructor = SyntaxError;
                break;
            case TypeError.name:
                constructor = TypeError;
                break;
            default:
                constructor = err.name.includes("AssertionError")
                    ? assert_1.AssertionError
                    : Error;
                break;
        }
        let _err = Object.create(constructor.prototype, {
            name: {
                configurable: true,
                writable: true,
                enumerable: false,
                value: err.name
            },
            message: {
                configurable: true,
                writable: true,
                enumerable: false,
                value: err.message
            },
            stack: {
                configurable: true,
                writable: true,
                enumerable: false,
                value: err.stack
            }
        });
        for (let x in err) {
            if (x != "name" && x != "message" && x != "stack") {
                _err[x] = err[x];
            }
        }
        err = _err;
    }
    return err;
}
exports.receiveError = receiveError;
exports.tasks = {};
function proxify(srv, srvId, ins) {
    return new Proxy(srv, {
        get: (srv, prop) => {
            if (!(prop in srv.constructor.prototype) || typeof srv[prop] != "function") {
                return srv[prop];
            }
            else if (!srv[prop][proxified]) {
                let fn = function (...args) {
                    return new Promise((resolve, reject) => {
                        let taskId = shortid_1.generate();
                        let timer = setTimeout(() => {
                            let num = Math.round(ins.timeout / 1000), unit = num === 1 ? "second" : "seconds";
                            reject(new Error(`rpc request timeout after ${num} ${unit}`));
                        }, ins.timeout);
                        ins["client"].write(send("rpc-request", srvId, taskId, prop, ...args));
                        exports.tasks[taskId] = {
                            success: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            },
                            error: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            }
                        };
                    });
                };
                set(fn, "name", srv[prop].name);
                set(fn, "length", srv[prop].length);
                set(fn, proxified, true);
                set(fn, "toString", function toString() {
                    return Function.prototype.toString.call(srv[prop]);
                }, true);
                return srv.constructor.prototype[prop] = fn;
            }
            else {
                return srv[prop];
            }
        }
    });
}
exports.proxify = proxify;
function set(target, prop, value, writable = false) {
    Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable,
        value
    });
}
function isSocketResetError(err) {
    return err instanceof Error
        && (err["code"] == "ECONNRESET"
            || /socket.*(ended|closed)/.test(err.message));
}
exports.isSocketResetError = isSocketResetError;
function absPath(filename) {
    if (!path.isAbsolute(filename)) {
        filename = path.resolve(os.tmpdir(), ".asrpc", filename);
    }
    if (os.platform() == "win32" && !(/\\\\[\?\.]\\pipe\\/.test(filename))) {
        filename = "\\\\?\\pipe\\" + filename;
    }
    return filename;
}
exports.absPath = absPath;
//# sourceMappingURL=util.js.map