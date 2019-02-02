"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hash = require("object-hash");
const path = require("path");
const os = require("os");
const bsp_1 = require("bsp");
const pick = require("lodash/pick");
const omit = require("lodash/omit");
const assert_1 = require("assert");
exports.classId = Symbol("classId");
exports.objectId = Symbol("objectId");
exports.eventEmitter = Symbol("eventEmitter");
exports.tasks = {};
var RPCEvents;
(function (RPCEvents) {
    RPCEvents[RPCEvents["CONNECT"] = 0] = "CONNECT";
    RPCEvents[RPCEvents["CONNECTED"] = 1] = "CONNECTED";
    RPCEvents[RPCEvents["CONNECT_ERROR"] = 2] = "CONNECT_ERROR";
    RPCEvents[RPCEvents["DISCONNECT"] = 3] = "DISCONNECT";
    RPCEvents[RPCEvents["REQUEST"] = 4] = "REQUEST";
    RPCEvents[RPCEvents["RESPONSE"] = 5] = "RESPONSE";
    RPCEvents[RPCEvents["ERROR"] = 6] = "ERROR";
})(RPCEvents = exports.RPCEvents || (exports.RPCEvents = {}));
const proxified = Symbol("proxified");
var taskId = 0;
function getClassId(target) {
    return String(target["id"] || hash(target).slice(0, 8));
}
exports.getClassId = getClassId;
function proxify(srv, oid, ins) {
    return new Proxy(srv, {
        get: (srv, prop) => {
            if (!(prop in srv) || typeof srv[prop] != "function") {
                return srv[prop];
            }
            else if (!srv[prop][proxified]) {
                let fn = function (...args) {
                    return new Promise((resolve, reject) => {
                        let timer = setTimeout(() => {
                            let num = Math.round(ins.timeout / 1000), unit = num === 1 ? "second" : "seconds";
                            reject(new Error(`RPC request timeout after ${num} ${unit}`));
                        }, ins.timeout);
                        ins["client"].write(bsp_1.send(RPCEvents.REQUEST, oid, taskId, prop, ...args));
                        exports.tasks[taskId] = {
                            resolve: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            },
                            reject: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            }
                        };
                        taskId++;
                        if (taskId === Number.MAX_SAFE_INTEGER)
                            taskId = 0;
                    });
                };
                set(fn, prop, fn);
                set(fn, "name", srv[prop].name);
                set(fn, "length", srv[prop].length);
                set(fn, proxified, true);
                set(fn, "toString", function toString() {
                    return Function.prototype.toString.call(srv[prop]);
                }, true);
                return fn;
            }
            else {
                return srv[prop];
            }
        }
    });
}
exports.proxify = proxify;
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
function set(target, prop, value, writable = false) {
    Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable,
        value
    });
}
function err2obj(err) {
    let props = ["name", "message", "stack"];
    return Object.assign({}, pick(err, props), omit(props));
}
exports.err2obj = err2obj;
function obj2err(obj) {
    let Errors = {
        AssertionError: assert_1.AssertionError,
        Error,
        EvalError,
        RangeError,
        ReferenceError,
        SyntaxError,
        TypeError,
    };
    let err = Object.create((Errors[obj.name] || Error).prototype);
    let props = ["name", "message", "stack"];
    for (let prop in obj) {
        if (props.indexOf(prop) >= 0) {
            set(err, prop, obj[prop], true);
        }
        else {
            err[prop] = obj[prop];
        }
    }
    return err;
}
exports.obj2err = obj2err;
//# sourceMappingURL=util.js.map