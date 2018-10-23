import * as net from "net";
import * as path from "path";
import * as fs from "fs-extra";
import { EventEmitter } from "events";
import { generate as uniqid } from "shortid";
import {
    getClassId,
    send,
    receive,
    sendError,
    receiveError,
    tasks,
    proxify,
    objectId,
    eventEmitter,
    isSocketResetError,
    absPath,
    classId
} from './util';

export type ServiceClass<T> = new (...args) => T;

export interface ServiceOptions {
    host?: string;
    port?: number;
    path?: string;
    timeout?: number;
}

export class ServiceInstance implements ServiceOptions {
    host?: string;
    port?: number;
    path?: string;
    timeout: number = 5000;
    private server: net.Server;
    private client: net.Socket;
    private services: {
        [id: string]: ServiceClass<any>
    } = {};
    private instances: {
        [objId: string]: any
    } = {};

    register<T>(target: ServiceClass<T>): void {
        target[classId] = getClassId(target);
        this.services[target[classId]] = target;
    }

    deregister<T>(target: ServiceClass<T>): void {
        if (target[classId])
            delete this.services[target[classId]];
    }

    async start(): Promise<this> {
        let server: net.Server = net.createServer();

        if (this.path) {
            await fs.ensureDir(path.dirname(this.path));

            if (await fs.pathExists(this.path)) {
                await fs.unlink(this.path);
            }

            server.listen(this.path);
        } else {
            server.listen(this.port, this.host);
        }

        this.server = server;
        this.server.on("connection", socket => {
            socket.on("data", buf => {
                for (let [event, ...data] of receive(buf)) {
                    socket.emit(event, ...data);
                }
            }).on("error", err => {
                if (!isSocketResetError(err)) {
                    console.error(err);
                }
            }).on("rpc-connect", (objId: string, name: string, id: string, ...args) => {
                if (this.services[id]) {
                    this.instances[objId] = new this.services[id](...args);
                    socket.write(send("rpc-connected", objId, id));
                } else {
                    let err = new Error(`service '${name}' not registered`);
                    socket.write(send("rpc-connect-error", objId, sendError(err)));
                }
            }).on("rpc-disconnect", (objId: string) => {
                delete this.instances[objId];
            }).on("rpc-request", (objId: string, taskId: string, method: string, ...args) => {
                let service = this.instances[objId];

                Promise.resolve().then(() => {
                    return service[method](...args);
                }).then(res => {
                    return new Promise(resolve => {
                        socket.write(send("rpc-response", objId, taskId, res), () => {
                            resolve();
                        });
                    });
                }).catch(err => {
                    socket.write(send("rpc-error", objId, taskId, sendError(err)));
                });
            });
        });

        return this;
    }

    close(): Promise<void> {
        return new Promise(resolve => this.server.close(() => {
            this.server.unref();
            resolve();
        }));
    }

    connect<T>(target: ServiceClass<T>, ...args: any[]): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                let connect = () => {
                    if (this.path) {
                        this.client = net.createConnection(this.path);
                    } else {
                        this.client = net.createConnection(this.port, this.host);
                    }
                };

                connect();

                this.client.once("connect", () => {
                    resolve();
                }).once("error", err => {
                    reject(err);
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
                                } else if (!this.client.destroyed
                                    || this.client.connecting) {
                                    clearTimeout(timer);
                                } else {
                                    reconnect();
                                }
                            }, 50);
                        };
                    }
                }).on("data", buf => {
                    for (let [event, objId, ...data] of receive(buf)) {
                        this.instances[objId][eventEmitter].emit(event, ...data);
                    }
                });
            } else {
                resolve();
            }
        }).then(() => {
            return new Promise((resolve: (value: T) => void, reject) => {
                let srv = new target(...args);
                let clsId = srv[classId] = target[classId] || (target[classId] = getClassId(target));
                let objId = srv[objectId] = uniqid();

                srv[eventEmitter] = new EventEmitter;
                this.instances[objId] = srv;
                this.client.write(send("rpc-connect", objId, target.name, clsId, ...args));

                srv[eventEmitter].once("rpc-connected", () => {
                    resolve(proxify(srv, objId, this));
                }).once("rpc-connect-error", (err: any) => {
                    reject(receiveError(err));
                }).on("rpc-response", (taskId: string, res: any) => {
                    tasks[taskId].success(res);
                }).on("rpc-error", (taskId: string, err: any) => {
                    tasks[taskId].error(receiveError(err));
                });
            });
        });
    }

    disconnect(srv: Function): Promise<void> {
        return new Promise(resolve => {
            let objId = srv[objectId];
            delete this.instances[objId];

            this.client.write(send("rpc-disconnect", objId), () => {
                resolve();
            });
        });
    }
}

export function createInstance(path: string): ServiceInstance;
export function createInstance(port: number, host?: string): ServiceInstance;
export function createInstance(options: ServiceOptions): ServiceInstance;
export function createInstance(): ServiceInstance {
    let ins = new ServiceInstance;

    if (typeof arguments[0] == "object") {
        Object.assign(ins, arguments[0]);
    } else if (typeof arguments[0] == "string") {
        ins.path = absPath(arguments[0]);
    } else {
        ins.port = arguments[0];
        ins.host = arguments[1];
    }

    return ins;
}

export default createInstance;