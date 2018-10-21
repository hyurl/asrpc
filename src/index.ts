import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as fs from "fs-extra";
import { EventEmitter } from "events";
import {
    findId,
    send,
    receive,
    sendError,
    receiveError,
    tasks,
    proxify,
    serviceId
} from './util';
import uuid = require('uuid/v4');

export type ServiceClass<T> = new (...args) => T;

export interface Service extends EventEmitter {
    readonly id: string;
    before?(): void | Promise<void>;
    after?(): void | Promise<void>;
}

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
        [id: string]: ServiceClass<Service>
    } = {};
    private instances: {
        [srvId: string]: Service
    } = {};

    register<T extends Service>(target: ServiceClass<T>): void {
        this.services[findId(target)] = target;
    }

    deregister<T extends Service>(target: ServiceClass<T>): void {
        delete this.services[findId(target)];
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
                if (!err.message.includes("socket has been ended")) {
                    console.log(err);
                }
            }).on("rpc-connect", (srvId: string, id: string) => {
                if (this.services[id]) {
                    this.instances[srvId] = new this.services[id];
                    socket.write(send("rpc-connected", srvId, id));
                } else {
                    let err = new Error(`service '${id}' not found`);
                    socket.write(send("rpc-connect-error", srvId, sendError(err)));
                }
            }).on("rpc-disconnect", (srvId: string) => {
                delete this.instances[srvId];
            }).on("rpc-request", (srvId: string, taskId: string, method: string, ...data) => {
                let service = this.instances[srvId];

                Promise.resolve().then(() => {
                    return service.before && service.before();
                }).then(() => {
                    return service[method](...data);
                }).then(res => {
                    return new Promise(resolve => {
                        socket.write(send("rpc-response", srvId, taskId, res), () => {
                            resolve();
                        });
                    });
                }).then(() => {
                    return service.after && service.after();
                }).catch(err => {
                    socket.write(send("rpc-error", srvId, taskId, sendError(err)));
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

    connect<T extends Service>(target: ServiceClass<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            let connect = () => {
                if (!this.client) {
                    if (this.path) {
                        this.client = net.createConnection(this.path);
                    } else {
                        this.client = net.createConnection(this.port, this.host);
                    }
                }
            };

            connect();

            if (this.client.connecting) {
                this.client.once("connect", () => {
                    resolve();
                }).once("error", err => {
                    reject(err);
                }).on("error", err => {
                    if (err.message.includes("socket has been ended")) {
                        this.client.unref();

                        let times = 0;
                        let reconnect = () => {
                            let timer = setTimeout(() => {
                                connect();
                                times++;

                                if (times === 5) {
                                    clearTimeout(timer);
                                } else if (!this.client.destroyed || this.client.connecting) {
                                    clearTimeout(timer);
                                } else {
                                    reconnect();
                                }
                            }, 50);
                        };
                    }
                }).on("data", buf => {
                    for (let [event, srvId, ...data] of receive(buf)) {
                        this.instances[srvId].emit(event, ...data);
                    }
                });
            } else {
                resolve();
            }
        }).then(() => {
            return new Promise((resolve: (value: T) => void, reject) => {
                let srv = new target;
                let srvId = srv[serviceId] = uuid();

                this.instances[srvId] = srv;
                this.client.write(send("rpc-connect", srvId, srv.id));

                srv.once("rpc-connected", () => {
                    resolve(<T>proxify(srv, srvId, this));
                }).once("rpc-connect-error", (err: any) => {
                    err = receiveError(err);
                    reject(err);
                }).on("rpc-response", (taskId: string, res: any) => {
                    tasks[taskId].success(res);
                }).on("rpc-error", (taskId: string, err: any) => {
                    tasks[taskId].error(err);
                });
            });
        });
    }

    disconnect(srv: Service): Promise<void> {
        return new Promise(resolve => {
            let srvId = srv[serviceId];
            delete this.instances[srvId];

            this.client.write(send("rpc-disconnect", srvId), () => {
                resolve();
            });
        });
    }
}

export function createInstance(path: string): ServiceInstance;
export function createInstance(port: number, host?: string): ServiceInstance;
export function createInstance(config: ServiceOptions): ServiceInstance;
export function createInstance(): ServiceInstance {
    let ins = new ServiceInstance;

    if (typeof arguments[0] == "string") {
        ins.path = arguments[0];

        // resolve path to be absolute
        if (!path.isAbsolute(ins.path)) {
            ins.path = path.resolve(os.tmpdir(), ".asrpc", ins.path);
        }
    } else if (typeof arguments[0] == "object") {
        Object.assign(ins, arguments[0]);
    } else {
        ins.port = arguments[0];
        ins.host = arguments[1];
    }

    return ins;
}