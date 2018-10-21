import uuid = require("uuid/v4")
import { ServiceClass, Service, ServiceInstance } from "./index";

const proxified = Symbol("proxified");
export const serviceId = Symbol("serviceId");

export function findId<T extends Service>(target: ServiceClass<T>): string {
    let str = target.toString(),
        re = /this(\.id|\['id'\]|\["id"\])\s*=\s*["'`](.*)["'`]\s*[;\r\n]/,
        matches = str.match(re);

    if (matches) {
        return matches[2];
    } else {
        throw new SyntaxError("no 'id' detected in the given service class");
    }
}

export function send(event: string, uuid: string, ...data: any[]) {
    return Buffer.from(JSON.stringify([event, uuid, ...data]) + "\r\n\r\n");
}

export function receive(buf: Buffer): Array<[string, string, any]> {
    let pack = buf.toString().split("\r\n\r\n"),
        parts = [];

    for (let part of pack) {
        if (part) parts.push(JSON.parse(part));
    }

    return parts;
}

export function sendError(err: any) {
    let isError = err instanceof Error,
        res = !isError ? null : {
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

export function receiveError(err: any) {
    if (err.name && "message" in err && "stack" in err) {
        let _err = Object.create(Error.prototype, {
            name: err.name,
            message: err.message,
            stack: err.stack
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

export const tasks: {
    [uuid: string]: {
        success: (res) => void,
        error: (err) => void
    };
} = {};

export function proxify(srv: Service, srvId: string, ins: ServiceInstance): Service {
    return new Proxy(srv, {
        get: (srv, prop: string) => {
            if (!(prop in srv.constructor.prototype) || typeof srv[prop] != "function") {
                return srv[prop];
            } else if (!srv[prop][proxified]) {
                let fn = function (...data) {
                    return new Promise((resolve, reject) => {
                        let taskId = uuid();
                        let timer = setTimeout(() => {
                            reject(new Error("rpc request timeout after 5 seconds"));
                        }, ins.timeout);

                        ins["client"].write(send("rpc-request", srvId, taskId, prop, ...data));
                        tasks[taskId] = {
                            success: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete tasks[taskId];
                            },
                            error: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete tasks[taskId];
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
            } else {
                return srv[prop];
            }
        }
    });
}

function set(target, prop, value, writable = false) {
    Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable,
        value
    });
}