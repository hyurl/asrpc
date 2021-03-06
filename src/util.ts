import hash = require("object-hash");
import * as path from "path";
import * as os from "os";
import { send } from "bsp";
import pick = require("lodash/pick");
import omit = require("lodash/omit");
import { ServiceClass, ServiceInstance } from "./index";
import { AssertionError } from 'assert';

export const classId = Symbol("classId");
export const objectId = Symbol("objectId");
export const eventEmitter = Symbol("eventEmitter");
export const tasks: {
    [id: number]: {
        resolve: (res) => void,
        reject: (err) => void
    };
} = {};

export enum RPCEvents {
    CONNECT,
    CONNECTED,
    CONNECT_ERROR,
    DISCONNECT,
    REQUEST,
    RESPONSE,
    ERROR,
}

const proxified = Symbol("proxified");
var taskId = 0;

export function getClassId<T>(target: ServiceClass<T>): string {
    return String(target.id || hash(target).slice(0, 8));
}

export function getInstance<T>(target: ServiceClass<T>, ...args: any[]): T {
    if (typeof target.getInstance === "function") {
        return target.getInstance(...args);
    } else {
        try {
            return new target(...args);
        } catch (err) {
            return Object.create(target.prototype);
        }
    }
}

export function proxify(srv: any, oid: number, ins: ServiceInstance): any {
    return new Proxy(srv, {
        get: (srv, prop: string) => {
            if (!(prop in srv) || typeof srv[prop] != "function") {
                return srv[prop];
            } else if (!srv[prop][proxified]) {
                let fn = function (...args) {
                    return new Promise((resolve, reject) => {
                        let _taskId = taskId;
                        let timer = setTimeout(() => {
                            let num = Math.round(ins.timeout / 1000),
                                unit = num === 1 ? "second" : "seconds";

                            reject(new Error(
                                `RPC request timeout after ${num} ${unit}`
                            ));
                        }, ins.timeout);

                        ins["client"].write(
                            send(RPCEvents.REQUEST, oid, _taskId, prop, ...args)
                        );
                        tasks[_taskId] = {
                            resolve: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete tasks[_taskId];
                            },
                            reject: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete tasks[_taskId];
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
            } else {
                return srv[prop];
            }
        }
    });
}

export function absPath(filename: string): string {
    // resolve path to be absolute
    if (!path.isAbsolute(filename)) {
        filename = path.resolve(os.tmpdir(), ".asrpc", filename);
    }

    if (os.platform() == "win32" && !(/\\\\[\?\.]\\pipe\\/.test(filename))) {
        filename = "\\\\?\\pipe\\" + filename;
    }

    return filename;
}

function set(target, prop, value, writable = false) {
    Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable,
        value
    });
}

type ErrorObject = Error & { [x: string]: any };

export function err2obj(err: ErrorObject): ErrorObject {
    let props = ["name", "message", "stack"];
    return Object.assign({}, pick(err, props), omit(props)) as any;
}

export function obj2err(obj: ErrorObject): ErrorObject {
    let Errors = {
        AssertionError,
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
        } else {
            err[prop] = obj[prop];
        }
    }

    return err;
}